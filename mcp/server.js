#!/usr/bin/env node
// Jean Clawd MCP server (stdio, zero dependencies).
// Lets any MCP-capable agent — Claude Code, Claude Desktop, Cursor, custom agents —
// read and change the plan. Each tool shells out to the jean CLI with --json, so
// behaviour is identical to what a human gets in the terminal.
//   register: claude mcp add --scope user jean -- node /path/to/mcp/server.js
'use strict';
const { execFile } = require('child_process');
const path = require('path');
const CLI = path.join(__dirname, '..', 'cli', 'jean.js');

// Which tool is talking to us (from the MCP handshake): Claude Code, Codex, Cursor, Gemini CLI, Windsurf, VS Code…
// The agent is then named <family>-<project>, and each MCP connection counts as its own session.
let FAMILY = 'agent';
const SESSION = `mcp-${process.pid}-${Date.now().toString(36)}`;
function familyOf(clientName) {
  const n = String(clientName || '').toLowerCase();
  for (const [re, f] of [[/claude/, 'claude'], [/codex|openai/, 'codex'], [/cursor/, 'cursor'], [/gemini/, 'gemini'],
    [/windsurf|codeium|cascade/, 'windsurf'], [/copilot|vscode|visual studio code/, 'copilot'], [/cline/, 'cline'], [/zed/, 'zed'], [/goose/, 'goose']]) if (re.test(n)) return f;
  return 'agent';
}

function jean(args, cwd, { timeout = 15000, as } = {}) {
  return new Promise(resolve => {
    // Calls through MCP come from an agent: the CLI names it (<family>-<project>) unless `as` is given.
    const env = { ...process.env, JEAN_IS_AGENT: '1', JEAN_AGENT_FAMILY: FAMILY, JEAN_SESSION_ID: SESSION, ...(as ? { JEAN_AGENT: as } : {}) };
    execFile(process.execPath, [CLI, ...args, '--json'], { cwd: cwd || process.cwd(), timeout, maxBuffer: 8e6, env }, (err, stdout, stderr) => {
      if (err) return resolve({ error: (stderr || stdout || err.message).trim() });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ output: stdout.trim() }); }
    });
  });
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = description => ({ type: 'number', description });
const DATE = 'YYYY-MM-DD or today, tomorrow, yesterday, fri, next mon, next week, +3';
const AS = str('Your agent name. Omit it: you are named automatically after your tool and project folder (e.g. codex-<project>)');
const CWD = str('Your working folder (decides your project and default name)');
const TO = 'An agent name, #project (a project channel), all, or the owner (owner)';

const TOOLS = [
  { name: 'jean_today', description: "Today's plan: tasks, overdue tasks and productivity stats. Start here.",
    schema: { date: str(`Optional day to inspect. ${DATE}`) },
    run: a => jean(['day', a.date || 'today']) },
  { name: 'jean_week', description: 'The week at a glance: week goals plus every day’s tasks.',
    schema: { date: str(`Any date inside the week. ${DATE}`) }, run: a => jean(['week', a.date || 'today']) },
  { name: 'jean_month', description: 'Month goals, week goals and all planned days in the month.',
    schema: { date: str(`Any date inside the month. ${DATE}`) }, run: a => jean(['month', a.date || 'today']) },
  { name: 'jean_list', description: 'Search / filter tasks across all dates.',
    schema: { search: str('Text to search in titles and notes'), project: str('Project name (fuzzy)'),
      status: str('todo | doing | done'), scope: str('day | week | month'), from: str(`Start date. ${DATE}`), to: str(`End date. ${DATE}`) },
    run: a => jean(['list', ...(a.search ? [a.search] : []), ...flagArgs(a, ['project', 'status', 'scope', 'from', 'to'])]) },
  { name: 'jean_add', description: 'Add a task. Use scope "week" or "month" for goals rather than a specific day.',
    schema: { title: str('Task title'), project: str('Project name (fuzzy). Projects: use jean_projects'),
      date: str(`When. Default today. ${DATE}`), scope: str('day (default) | week | month'), priority: num('1 = urgent, 2 = normal (default), 3 = low'),
      notes: str('Extra details'), recur: str('daily | weekdays | weekly | monthly'), to: str('Assign it to an agent (it is told in its inbox). Omit for the owner'), as: AS },
    required: ['title'],
    run: a => jean(['add', a.title, ...flagArgs(a, ['project', 'date', 'scope', 'priority', 'notes', 'recur', 'to'])], null, { as: a.as }) },
  { name: 'jean_done', description: 'Mark one or more tasks done (recurring tasks respawn automatically).',
    schema: { ids: { type: 'array', items: { type: 'string' }, description: 'Task ids (short 6-char codes or full t_… ids)' }, as: AS }, required: ['ids'],
    run: a => jean(['done', ...a.ids], null, { as: a.as }) },
  { name: 'jean_update', description: 'Edit a task: title, date, project, scope, priority, notes, status, recurrence.',
    schema: { id: str('Task id'), title: str('New title'), date: str(`New date. ${DATE}`), project: str('Project (fuzzy) or "none"'),
      scope: str('day | week | month'), priority: num('1 | 2 | 3'), notes: str('Notes'), status: str('todo | doing | done'), recur: str('daily | weekdays | weekly | monthly | none') },
    required: ['id'],
    run: a => jean(['edit', a.id, ...flagArgs(a, ['title', 'date', 'project', 'scope', 'priority', 'notes', 'status', 'recur'])]) },
  { name: 'jean_delete', description: 'Delete a task permanently.', schema: { id: str('Task id') }, required: ['id'], run: a => jean(['rm', a.id]) },
  { name: 'jean_projects', description: 'List projects (usually folders on disk) with description, linked repo, path, open / overdue counts.', schema: {}, run: () => jean(['projects']) },
  { name: 'jean_project_add', description: 'Create a project that has no folder (a company, a client, "Personal"). For folders use jean_init.',
    schema: { name: str('Project name'), description: str('One-line description'), emoji: str('An emoji for it'), repo: str('Repository URL') }, required: ['name'],
    run: a => jean(['project', 'add', a.name, ...flagArgs(a, ['description', 'emoji', 'repo'])]) },
  { name: 'jean_project', description: 'One project and its open tasks. Omit name when cwd is inside a project folder.',
    schema: { name: str('Project name (fuzzy)'), cwd: str('Folder to resolve the project from') }, run: a => jean(['project', ...(a.name ? [a.name] : [])], a.cwd) },
  { name: 'jean_init', description: 'Register a folder as a project (like git init). Links the git remote automatically. Idempotent — call it whenever you start work in a folder.',
    schema: { path: str('Absolute folder path'), name: str('Project name (default: folder name)'), description: str('One-line description of the project'), emoji: str('An emoji for it'), repo: str('Repository URL (default: git remote origin)') },
    required: ['path'],
    run: a => jean(['init', ...(a.description ? [a.description] : []), ...flagArgs(a, ['name', 'emoji', 'repo'])], a.path) },
  { name: 'jean_handoff_create', description: 'Hand your unfinished work to another Claude instance. Call this when you are running low on context or usage limits, or when work must continue elsewhere. Captures cwd, git branch and changed files automatically.',
    schema: { title: str('One line: what this work is'), context: str('What is going on: what you did, what you learned, decisions taken, anything the next instance cannot re-derive cheaply'),
      next: { type: 'array', items: { type: 'string' }, description: 'Ordered next steps, concrete enough to act on' },
      files: { type: 'array', items: { type: 'string' }, description: 'Files to look at (default: git-changed files)' },
      tasks: { type: 'array', items: { type: 'string' }, description: 'Related Jean task ids' },
      blockers: str('What is in the way, or what you could not solve'), project: str('Project name (fuzzy)'),
      cwd: str('Folder the work lives in — pass the project folder'), from: str('Name of this instance, e.g. claude-1'), to: str('A specific agent to hand it to (it is told in its inbox)') },
    required: ['title'],
    run: a => jean(['handoff', 'create', a.title, ...repeated(a, 'next'), ...repeated(a, 'files'), ...repeated(a, 'tasks', 'task'),
      ...flagArgs(a, ['context', 'blockers', 'project', 'from', 'to'])], a.cwd) },
  { name: 'jean_handoff_list', description: 'Handoffs waiting to be picked up (open first, oldest first).',
    schema: { all: str('"true" to include finished ones'), project: str('Only this project (fuzzy)') },
    run: a => jean(['handoff', 'list', ...(a.all ? ['--all'] : []), ...flagArgs(a, ['project'])]) },
  { name: 'jean_handoff_take', description: 'Claim a handoff and get the full briefing: context, next steps, blockers, files, related tasks and progress notes. With no id, takes the oldest open one.',
    schema: { id: str('Handoff id (omit to take the oldest open one)'), by: str('Name of this instance'), cwd: str('Folder to resolve the current project from'), force: str('"true" to take one already claimed') },
    run: a => jean(['handoff', 'take', ...(a.id ? [a.id] : []), ...flagArgs(a, ['by']), ...(a.force ? ['--force'] : [])], a.cwd) },
  { name: 'jean_handoff_show', description: 'Read a handoff briefing without claiming it.', schema: { id: str('Handoff id') }, required: ['id'],
    run: a => jean(['handoff', 'show', a.id]) },
  { name: 'jean_handoff_note', description: 'Append what you have done to the handoff you are working on, so the next instance sees it.',
    schema: { text: str('What happened / what you changed'), id: str('Handoff id (default: the one you claimed)') }, required: ['text'],
    run: a => jean(['handoff', 'note', ...(a.id ? [a.id] : []), a.text]) },
  { name: 'jean_handoff_done', description: 'Mark a handoff finished.', schema: { id: str('Handoff id (default: the one you claimed)') },
    run: a => jean(['handoff', 'done', ...(a.id ? [a.id] : [])]) },
  // ---- agents: Jean Clawd vd Dam ----
  { name: 'jean_hello', description: 'Check in as an agent and get your briefing: who you are, your role, tasks assigned to you, unclaimed tasks in your project, your unread messages, handoffs for you, and what every other agent is doing. Call this first in a session.',
    schema: { role: str('What you are for, one line (kept until changed), e.g. "backend for kiteshop"'), department: str('Where you work in the Dojo: tech | marketing | backoffice | finance | external (kept until changed)'), manager: str('"true" to be the shared manager of your department for every project'), doing: str('What you are about to work on'), task: str('Task id you are starting (assigns it to you)'), project: str('Project (fuzzy); default from cwd'), cwd: CWD, as: AS },
    run: a => jean(['hello', ...(a.doing ? [a.doing] : []), ...flagArgs(a, ['role', 'task', 'project']), ...(a.department ? ['--dept', a.department] : []), ...(a.manager ? ['--manager', String(a.manager)] : [])], a.cwd, { as: a.as }) },
  { name: 'jean_whoami', description: 'Your briefing again (tasks, inbox, crew) without checking in.', schema: { cwd: CWD, as: AS }, run: a => jean(['whoami'], a.cwd, { as: a.as }) },
  { name: 'jean_agents', description: 'The crew: every agent, its role, project, presence (active / idle / away) and what it is doing right now.',
    schema: { all: str('"true" to include signed-off agents') }, run: a => jean(['agents', ...(a.all ? ['--all'] : [])]) },
  { name: 'jean_doing', description: 'Tell the crew what you are working on now. Call it whenever you switch work. With task, that task is started and assigned to you.',
    schema: { text: str('What you are doing, one line'), task: str('Task id'), clear: str('"true" to clear'), cwd: CWD, as: AS },
    run: a => jean(['doing', ...(a.text ? [a.text] : []), ...flagArgs(a, ['task']), ...(a.clear ? ['--clear'] : [])], a.cwd, { as: a.as }) },
  { name: 'jean_send', description: 'Send a message to another agent, a project channel, everyone, or the owner (the desktop Jean-Claude speaks messages to the owner).',
    schema: { to: str(TO), text: str('The message'), task: str('Related task id'), cwd: CWD, as: AS }, required: ['to', 'text'],
    run: a => jean(['send', a.to, a.text, ...flagArgs(a, ['task'])], a.cwd, { as: a.as }) },
  { name: 'jean_ask', description: 'Ask another agent (or the owner) something and wait for the reply, up to `wait` seconds (default 120, max 600).',
    schema: { to: str(TO), text: str('The question'), wait: num('Seconds to wait'), cwd: CWD, as: AS }, required: ['to', 'text'],
    run: a => { const w = Math.min(600, Number(a.wait) || 120); return jean(['ask', a.to, a.text, '--wait', String(w)], a.cwd, { as: a.as, timeout: (w + 10) * 1000 }); } },
  { name: 'jean_reply', description: 'Reply to a message (it goes back to the sender, or to the channel it was posted in).',
    schema: { id: str('Message id'), text: str('Your reply'), cwd: CWD, as: AS }, required: ['id', 'text'],
    run: a => jean(['reply', a.id, a.text], a.cwd, { as: a.as }) },
  { name: 'jean_inbox', description: 'Your unread messages (direct, your project channel, broadcasts). Marks them read unless peek. With wait, blocks until something arrives.',
    schema: { all: str('"true" to include already-read messages'), peek: str('"true" to leave them unread'), wait: num('Seconds to wait for a message (max 600)'), cwd: CWD, as: AS },
    run: a => { const w = Math.min(600, Number(a.wait) || 0); return jean(['inbox', ...(a.all ? ['--all'] : []), ...(a.peek ? ['--peek'] : []), ...(w ? ['--wait', String(w)] : [])], a.cwd, { as: a.as, timeout: (w + 15) * 1000 }); } },
  { name: 'jean_feed', description: 'Recent traffic: messages and activity (who started / finished what). Filter by project, agent, or a thread (message id).',
    schema: { thread: str('Message id: show that conversation'), project: str('Project (fuzzy)'), agent: str('Agent name'), limit: num('How many (default 30)') },
    run: a => jean(['feed', ...(a.thread ? [a.thread] : []), ...flagArgs(a, ['project', 'agent', 'limit'])]) },
  { name: 'jean_requests', description: 'Open "who can do this?" requests from the owner or other agents. If one fits you, claim it with jean_claim.', schema: {},
    run: () => jean(['requests']) },
  { name: 'jean_claim', description: 'Take an open request: the first agent to claim it gets it, and it becomes a task assigned to you (in progress).',
    schema: { id: str('Request id'), cwd: CWD, as: AS }, required: ['id'], run: a => jean(['claim', a.id], a.cwd, { as: a.as }) },
  { name: 'jean_request', description: 'Ask the room for help without knowing who should do it: Jean offers it to the best-fitting agent; any agent can claim it.',
    schema: { text: str('What needs doing'), project: str('Project (fuzzy), optional'), cwd: CWD, as: AS }, required: ['text'],
    run: a => jean(['request', a.text, ...flagArgs(a, ['project'])], a.cwd, { as: a.as }) },
  { name: 'jean_assign', description: 'Assign a task to an agent ("none" gives it back to the owner). The agent is told in its inbox.',
    schema: { id: str('Task id'), to: str('Agent name or none'), as: AS }, required: ['id', 'to'],
    run: a => jean(['assign', a.id, a.to], null, { as: a.as }) },
  { name: 'jean_mine', description: 'Open tasks assigned to you.', schema: { all: str('"true" to include done ones'), cwd: CWD, as: AS },
    run: a => jean(['mine', ...(a.all ? ['--all'] : [])], a.cwd, { as: a.as }) },
  { name: 'jean_bye', description: 'Sign off when you stop working (the crew sees you are gone).', schema: { note: str('Optional last word'), cwd: CWD, as: AS },
    run: a => jean(['bye', ...(a.note ? [a.note] : [])], a.cwd, { as: a.as }) },
  { name: 'jean_stack', description: "The owner's default tools per area (database, deploy, frontend, auth, payments, images, …). Check it before picking a tool; set an entry when the owner states a preference.",
    schema: { area: str('Area to set (omit to list)'), choice: str('The tool, e.g. Supabase'), notes: str('Details: region, conventions, gotchas'), dept: str('Optional department it applies to') },
    run: a => a.area && a.choice ? jean(['stack', 'set', a.area, a.choice, ...flagArgs(a, ['notes', 'dept'])]) : jean(['stack']) },
  { name: 'jean_skills', description: 'The playbook: how-tos the crew learned, per department (tech, marketing, backoffice, finance, external). Search it before figuring something out from scratch.',
    schema: { search: str('Text to search'), dept: str('Department'), tool: str('Tool name, e.g. gemini') },
    run: a => jean(['skills', ...(a.search ? [a.search] : []), ...flagArgs(a, ['dept', 'tool'])]) },
  { name: 'jean_skill_show', description: 'Read one skill: the steps, the setup, and how to add it to Claude Code.', schema: { id: str('Skill id or name') }, required: ['id'],
    run: a => jean(['skill', 'show', a.id]) },
  { name: 'jean_learn', description: 'Write down a reusable skill you just figured out (steps, tools, setup), so every other agent can use it. Same name again = update.',
    schema: { name: str('What it lets you do, e.g. "Generate images with Gemini"'), dept: str('tech | marketing | backoffice | finance | external'), summary: str('One line'),
      body: str('The steps, in markdown: commands, code, gotchas'), tools: str('Comma-separated tools/APIs used'), install: str('Setup another agent needs: env vars, API keys (never the key itself), MCP servers, packages'), as: AS },
    required: ['name'],
    run: a => jean(['learn', a.name, ...flagArgs(a, ['dept', 'summary', 'body', 'install']), ...(a.tools ? ['--tool', a.tools] : [])], null, { as: a.as }) },
  { name: 'jean_skill_install', description: 'Install a playbook skill into Claude Code as a SKILL.md (user-wide, or project-only with project=true).',
    schema: { id: str('Skill id or name'), project: str('"true" for ./.claude/skills in cwd'), cwd: CWD }, required: ['id'],
    run: a => jean(['skill', 'install', a.id, ...(a.project ? ['--project'] : [])], a.cwd) },
  { name: 'jean_system', description: 'The machine: running dev servers (port, process, project), CPU, memory, GPU and Docker containers, and whether it is busy. Check before starting another dev server or container.',
    schema: {}, run: () => jean(['system'], null, { timeout: 30000 }) },
  { name: 'jean_stop_server', description: 'Stop a dev server by port or pid (only dev servers owned by the user; never Jean or system apps).',
    schema: { port: str('Port (or pid)') }, required: ['port'], run: a => jean(['stop', String(a.port)]) },
  { name: 'jean_docker', description: 'Control Docker containers: stop | pause | unpause | start <name>, or stop-all | pause-all | unpause-all.',
    schema: { action: str('stop | pause | unpause | start | stop-all | pause-all | unpause-all'), name: str('Container name (not for *-all)') }, required: ['action'],
    run: a => jean(['docker', a.action, ...(a.name ? [a.name] : [])], null, { timeout: 90000 }) },
  { name: 'jean_hire', description: 'Hire a specialist into the crew: a Claude skill pack (designer, writer, docs, analyst, qa, engineer, integrator, skillsmith) that becomes an on-call agent on its floor. Omit id to list the catalog.',
    schema: { id: str('Catalog id; omit to list') }, run: a => jean(['hire', ...(a.id ? [a.id] : [])], null, { timeout: 200000 }) },
  { name: 'jean_become', description: 'Take on an agent identity for this session (e.g. a hired specialist such as docs-specialist) and get its briefing.',
    schema: { name: str('Agent name'), cwd: CWD }, required: ['name'], run: a => jean(['become', a.name], a.cwd) },
  { name: 'jean_settings', description: 'Read Jean preferences, or change one. The web app is read-only, so preferences are changed by agents.',
    schema: { key: str('ownerName | theme | weekStart | defaultView | showDone | petQuips | defaultProject | port (omit to list all)'), value: str('New value') },
    run: a => jean(['settings', ...(a.key ? [a.key] : []), ...(a.value !== undefined ? [String(a.value)] : [])]) },
  { name: 'jean_project_update', description: 'Change a project: rename, describe, emoji, colour, repo, archive / unarchive, or delete it.',
    schema: { project: str('Project (fuzzy)'), action: str('rename | describe | emoji | color | repo | archive | unarchive | rm'), value: str('New name / description / emoji / #hex / repo URL') },
    required: ['project', 'action'],
    run: a => ['describe', 'emoji', 'repo'].includes(a.action)
      ? jean(['project', a.action, ...(a.value ? [a.value] : []), '--project', a.project])
      : jean(['project', a.action, a.project, ...(a.value ? [a.value] : [])]) },
  { name: 'jean_stats', description: 'Productivity check: today, week %, month %, streak, per project.',
    schema: { date: str(`Reference date. ${DATE}`) }, run: a => jean(['stats', a.date || 'today']) },
  { name: 'jean_journal', description: 'Read or write the free-text journal for a day.',
    schema: { text: str('Text to save (omit to read)'), date: str(`Day. Default today. ${DATE}`) },
    run: a => jean(['journal', ...(a.text ? [a.text] : []), ...flagArgs(a, ['date'])]) },
  { name: 'jean_say', description: 'Make the desktop Jean-Claude speak a short message (nudges, celebrations). Optionally with a stunt.',
    schema: { text: str('What he should say'), anim: str('Optional stunt: splits, epicSplit, kumite, treeKick, dance, guardUp, doubleImpact, flashKick, salute, mullet, random') },
    required: ['text'], run: a => jean(['say', a.text, ...flagArgs(a, ['anim'])]) },
  { name: 'jean_stunt', description: 'Desktop Jean-Claude performs a move from one of his films.',
    schema: { name: str('splits | epicSplit | kumite | treeKick | dance | guardUp | doubleImpact | flashKick | salute | mullet | random') }, run: a => jean(['stunt', a.name || 'random']) },
];

// Tools added by plugins (docs/PLUGINS.md): run(args, ctx) with ctx.jean([...cli args], cwd)
try {
  const store = require('../lib/store');
  const reg = require('../lib/plugins').load('mcp', store.load().settings);
  for (const t of reg.tools) TOOLS.push({ name: t.name, description: `${t.description} [plugin: ${t.plugin}]`, schema: t.schema || {}, required: t.required,
    run: a => Promise.resolve(t.run(a, { jean: (args, cwd) => jean(args, cwd) })) });
} catch (e) { /* a broken plugin never takes the MCP server down */ }

function repeated(a, key, flagName) {
  const out = [];
  for (const v of [].concat(a[key] || [])) if (v) out.push(`--${flagName || key}`, String(v));
  return out;
}

function flagArgs(a, keys) {
  const out = [];
  for (const k of keys) if (a[k] !== undefined && a[k] !== null && a[k] !== '') out.push(`--${k}`, String(a[k]));
  return out;
}

const toolList = TOOLS.map(t => ({ name: t.name, description: t.description,
  inputSchema: { type: 'object', properties: t.schema, required: t.required || [] } }));

// ---- JSON-RPC over stdio (newline-delimited) ----
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
let pending = 0, ended = false;
process.stdin.on('end', () => { ended = true; if (!pending) process.exit(0); });   // finish running calls first

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case 'initialize':
      FAMILY = familyOf(params.clientInfo && params.clientInfo.name);
      return reply(id, { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'jean-clawd', version: require('../package.json').version },
        instructions: 'Jean Clawd vd Dam is the user’s planner and the switchboard between AI agents. You are an agent in it: call jean_hello first (your briefing: your tasks, inbox, and what the other agents are doing), jean_doing whenever you switch work, jean_send / jean_ask / jean_reply to coordinate with other agents or the owner, jean_inbox to read, jean_done when a task is finished, jean_bye when you stop. Before picking tools, check jean_stack (the owner’s defaults) and jean_skills (how-tos the crew learned); after figuring out something reusable, jean_learn it. Planning: call jean_today, add tasks with jean_add, close them with jean_done. Every task belongs to a project (jean_projects / jean_init). Keep days to 3–6 tasks; use week/month scope for goals. When you are running out of context or usage limits, call jean_handoff_create so another Claude instance can continue; when you start fresh, call jean_handoff_list to see if work is waiting.' });
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: toolList });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool ${params.name}`);
      pending++;
      const result = await tool.run(params.arguments || {}).finally(() => { pending--; if (ended && !pending) setImmediate(() => process.exit(0)); });
      const isError = !!(result && result.error);
      return reply(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }], isError });
    }
    default: return fail(id, -32601, `Method not found: ${method}`);
  }
}
