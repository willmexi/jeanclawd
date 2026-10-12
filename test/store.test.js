// node test/store.test.js — quick checks of the data layer (no server needed).
const assert = require('assert');
process.env.JEAN_DIR = require('os').tmpdir() + '/jean-test-' + Date.now();
const s = require('../lib/store');

const st = s.defaultState();
const kite = s.addProject(st, { name: 'Kiteshop', emoji: '🪁', path: '/tmp/x/kite', description: 'the kite store' });
assert.equal(s.findProject(st, 'kite').id, kite.id, 'fuzzy project lookup');
assert.equal(s.addProject(st, { name: 'Kiteshop', path: '/tmp/x/kite' }).id, kite.id, 'init twice = same project');
assert.equal(s.findProject(st, 'kite').description, 'the kite store', 'empty description does not wipe the old one');

const t = s.addTask(st, { title: 'Ship airdrop', project: 'kite', date: 'tomorrow', priority: 1 });
assert.equal(t.date, s.addDays(s.today(), 1));
assert.equal(t.project, kite.id);
assert.equal(s.findTask(st, t.id.slice(2)).id, t.id, 'short id lookup');

s.updateTask(st, t.id, { date: 'today' });
assert.equal(s.tasksForDay(st, s.today()).tasks.some(x => x.id === t.id), true);

const r = s.addTask(st, { title: 'Standup', date: 'today', recur: 'daily' });
s.completeTask(st, r.id);
assert.ok(st.tasks.find(x => x.title === 'Standup' && x.date === s.addDays(s.today(), 1) && x.status === 'todo'), 'recurring task respawns');

const old = s.addTask(st, { title: 'Old thing', date: '-3' });
assert.equal(s.tasksForDay(st, s.today()).overdue.some(x => x.id === old.id), true, 'overdue detection');

const stats = s.stats(st);
assert.equal(stats.streak, 1, 'streak counts today');
assert.ok(stats.perProject.find(x => x.id === kite.id).open === 1);

const wk = s.addTask(st, { title: 'Week goal', scope: 'week', date: 'today' });
assert.ok(s.tasksForWeek(st, s.today()).weekTasks.some(x => x.id === wk.id));
const mo = s.addTask(st, { title: 'Month goal', scope: 'month', date: 'today' });
assert.ok(s.tasksForMonth(st, s.today()).monthTasks.some(x => x.id === mo.id));
assert.equal(s.filterTasks(st, { project: 'kite' }).length, 1);

s.deleteProject(st, kite.id);
assert.equal(s.findTask(st, t.id).project, null, 'deleting a project detaches tasks');

// v1 files with companies migrate into projects
const legacy = s.migrate({ companies: [{ id: 'c_1', name: 'Old Co', emoji: '🏢', color: '#123456' }], tasks: [{ id: 't_1', title: 'x', company: 'c_1', date: s.today(), scope: 'day', status: 'todo', priority: 2, order: 0, createdAt: '2026-01-01T00:00:00Z' }] });
assert.equal(legacy.projects[0].id, 'c_1'); assert.equal(legacy.tasks[0].project, 'c_1'); assert.equal(legacy.companies, undefined);

// handoffs: one instance writes, another claims and finishes
const hp = s.addProject(st, { name: 'handoff-demo' });
const ht = s.addTask(st, { title: 'Finish the parser', project: 'handoff-demo' });
const h = s.addHandoff(st, { title: 'Parser rewrite', project: 'handoff-demo', cwd: '/tmp/p', branch: 'main',
  context: 'Half the tokenizer is done.', next: ['finish tokenizer', 'wire tests'], files: ['src/parse.js'], tasks: [ht.id.slice(2)], from: 'claude-a' });
assert.equal(h.status, 'open');
assert.equal(h.tasks[0], ht.id, 'task refs resolve from short ids');
assert.equal(s.filterHandoffs(st, {}).length, 1);
s.claimHandoff(st, h.id, 'claude-b');
assert.equal(s.findHandoff(st, h.id).status, 'claimed');
assert.equal(s.findHandoff(st, h.id).claimedBy, 'claude-b');
assert.throws(() => s.claimHandoff(st, h.id, 'claude-c'), /Already claimed/);
assert.equal(s.claimHandoff(st, h.id, 'claude-c', { force: true }).claimedBy, 'claude-c', 'force takes it over');
s.noteHandoff(st, h.id, 'tokenizer done', 'claude-c');
const brief = s.handoffBriefing(st, s.findHandoff(st, h.id));
assert.ok(brief.includes('NEXT STEPS') && brief.includes('finish tokenizer') && brief.includes('Finish the parser') && brief.includes('tokenizer done'));
s.updateHandoff(st, h.id, { status: 'done' });
assert.equal(s.filterHandoffs(st, {}).length, 0, 'done handoffs drop out of the default list');
assert.equal(s.filterHandoffs(st, { all: true }).length, 1);
assert.equal(s.stats(st).handoffs.open, 0);
s.deleteHandoff(st, h.id);
s.deleteProject(st, hp.id);

// agents: check in, take work, talk, finish
const ap = s.addProject(st, { name: 'agent-demo' });
const ana = s.checkIn(st, { name: 'claude-ana', role: 'backend', project: 'agent-demo' });
assert.equal(s.checkIn(st, { name: '@Claude-Ana' }).id, ana.id, 'check-in is idempotent and case-insensitive');
assert.equal(s.findAgent(st, 'claude-ana').role, 'backend', 'role survives a check-in without one');
assert.throws(() => s.checkIn(st, { name: 'owner' }), /owner/);
s.checkIn(st, { name: 'claude-bob', project: 'agent-demo' });
const job = s.addTask(st, { title: 'Write the API', project: 'agent-demo', assignee: 'claude-ana', by: 'owner' });
assert.equal(job.assignee, 'claude-ana');
assert.ok(s.inboxFor(st, 'claude-ana').some(m => m.task === job.id), 'assignee is told in its inbox');
assert.equal(s.filterTasks(st, { assignee: 'claude-ana' }).length, 1);
assert.equal(s.resolveAssignee(st, 'owner'), '', 'assigning to the owner = unassigned');

s.setDoing(st, 'claude-ana', null, { task: job.id.slice(2) });
assert.equal(s.findTask(st, job.id).status, 'doing', 'doing --task starts the task');
assert.equal(s.findAgent(st, 'claude-ana').doing.text, 'Write the API');

const q = s.sendMessage(st, { from: 'claude-bob', to: 'claude-ana', text: 'which port?' });
const a1 = s.sendMessage(st, { from: 'claude-ana', replyTo: q.id.slice(2), text: '4242' });
assert.equal(a1.to, 'claude-bob', 'a reply goes back to the sender');
assert.equal(a1.thread, q.id);
s.sendMessage(st, { from: 'claude-bob', to: '#agent', text: 'deploying' });
assert.ok(s.inboxFor(st, 'claude-ana').some(m => m.text === 'deploying'), 'project channel reaches agents in that project');
assert.ok(s.inboxFor(st, 'owner').some(m => m.text === 'deploying'), 'the owner hears project channels');
assert.ok(!s.inboxFor(st, 'claude-bob').some(m => m.text === 'deploying'), 'you do not get your own messages');
s.sendMessage(st, { from: 'claude-ana', to: 'owner', text: 'need a key' });
assert.equal(s.inboxFor(st, 'owner').filter(m => m.text === 'need a key').length, 1);
s.markRead(st, 'claude-ana', s.inboxFor(st, 'claude-ana').map(m => m.id));
assert.equal(s.inboxFor(st, 'claude-ana').length, 0, 'mark read empties the inbox');
assert.ok(s.agentBriefing(st, 'claude-ana').includes('YOUR TASKS (1)'));
assert.ok(s.agentBriefing(st, 'claude-ana').includes('claude-bob'), 'briefing lists the crew');

s.updateTask(st, job.id, { status: 'done', by: 'claude-ana' });
assert.equal(s.findAgent(st, 'claude-ana').doing, null, 'finishing the current task clears doing');
assert.ok(s.feed(st, { kind: 'event' }).some(m => m.text === 'finished: Write the API'), 'finishing is announced');
const ho = s.addHandoff(st, { title: 'Ana → Bob', from: 'claude-ana', to: 'claude-bob', project: 'agent-demo' });
assert.ok(s.inboxFor(st, 'claude-bob').some(m => m.text.includes(ho.id.slice(2))), 'targeted handoff lands in the inbox');
s.claimHandoff(st, ho.id, 'claude-bob');
assert.ok(s.inboxFor(st, 'claude-ana').some(m => m.text.startsWith('picked up')), 'writer hears it was picked up');
s.signOff(st, 'claude-bob');
assert.equal(s.listAgents(st, { all: true }).find(x => x.name === 'claude-bob').presence, 'offline');
s.deleteHandoff(st, ho.id); s.deleteProject(st, ap.id);

// A2A: an external client messages a Jean agent; the task completes when it replies
const A = require('../lib/a2a');
s.checkIn(st, { name: 'claude-x' });
const sent = A.handleRpc(st, 'claude-x', { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'e1', role: 'ROLE_USER', parts: [{ text: 'hi' }], metadata: { from: 'ext' } } } });
const tid = sent.response.result.task.id;
assert.equal(sent.response.result.task.status.state, 'TASK_STATE_SUBMITTED');
assert.ok(s.inboxFor(st, 'claude-x').some(m => m.text === 'hi'), 'A2A message lands in the inbox');
s.sendMessage(st, { from: 'claude-x', replyTo: tid, text: 'hello back' });
const got = A.handleRpc(st, 'claude-x', { jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: tid } }).response.result;
assert.equal(got.status.state, 'TASK_STATE_COMPLETED'); assert.equal(got.status.message.parts[0].text, 'hello back');
const follow = A.handleRpc(st, 'claude-x', { jsonrpc: '2.0', id: 3, method: 'SendMessage', params: { message: { messageId: 'e2', taskId: tid, role: 'ROLE_USER', parts: [{ text: 'thanks' }], metadata: { from: 'ext' } } } });
assert.equal(follow.message.to, 'claude-x', 'a follow-up goes to the agent, not back to the caller');
assert.equal(A.handleRpc(st, 'claude-x', { jsonrpc: '2.0', id: 4, method: 'tasks/get', params: { id: tid } }).response.result.kind, 'task', '0.x names work');
assert.equal(A.handleRpc(st, 'claude-x', { jsonrpc: '2.0', id: 5, method: 'GetTask', params: { id: 'nope' } }).response.error.code, -32001);
assert.equal(A.readResult({ task: { id: 't', status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: 'ok' }] } } } }).text, 'ok');
assert.equal(A.readResult({ kind: 'task', id: 't', status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'old' }] }] }).text, 'old');
assert.equal(A.agentCard(st, 'http://x', 'claude-x').supportedInterfaces[0].url, 'http://x/a2a/claude-x');

// playbook: stack + skills land in the briefing and export as a Claude Code skill
s.setStack(st, { area: 'Database', choice: 'Supabase', notes: 'Postgres + auth + storage' });
assert.equal(s.setStack(st, { area: 'database', choice: 'Supabase (EU)' }).notes, 'Postgres + auth + storage', 'stack upserts by area');
s.setStack(st, { area: 'deploy', choice: 'Google Cloud Run' });
const sk = s.addSkill(st, { name: 'Generate images with Gemini', dept: 'marketing', summary: 'Make images from a prompt', tools: 'gemini, nano-banana', body: '1. call the API', by: 'claude-x' });
assert.equal(s.addSkill(st, { name: 'generate images with gemini', install: 'set GEMINI_API_KEY' }).id, sk.id, 'skills upsert by name');
assert.deepEqual(s.findSkill(st, sk.id.slice(2)).tools, ['gemini', 'nano-banana']);
assert.equal(s.filterSkills(st, { dept: 'mkt' }).length, 1, 'department aliases work');
assert.ok(s.feed(st, { kind: 'event' }).some(m => m.text === 'learned a skill: Generate images with Gemini'));
const md = s.skillMarkdown(st, sk);
assert.ok(md.startsWith('---\nname: generate-images-with-gemini\n') && md.includes('## Setup') && md.includes('database: Supabase (EU)'));
s.checkIn(st, { name: 'claude-mk', department: 'marketing' });
const br = s.agentBriefing(st, 'claude-mk');
assert.ok(br.includes('STACK') && br.includes('deploy: Google Cloud Run') && br.includes('SKILLS FOR MARKETING'));
assert.throws(() => s.checkIn(st, { name: 'claude-mk', department: 'kitchen' }), /department/);
s.deleteSkill(st, sk.id); s.deleteStack(st, 'deploy');

// requests: ask the room, the right agent is offered it, the first claim wins
s.checkIn(st, { name: 'claude-pay', role: 'stripe billing and invoices' });
s.checkIn(st, { name: 'claude-web', role: 'react frontend' });
const rq = s.createRequest(st, { text: 'Can someone fix the stripe invoice emails?' });
assert.equal(rq.ranked[0].name, 'claude-pay', 'routing picks the billing agent');
assert.ok(s.inboxFor(st, 'claude-pay').some(m => m.text.includes('best fit')), 'best fit is pinged directly');
assert.ok(s.inboxFor(st, 'claude-web').some(m => m.kind === 'request'), 'everyone sees the request');
assert.ok(s.agentBriefing(st, 'claude-pay').includes('OPEN REQUESTS') && s.agentBriefing(st, 'claude-pay').includes('Jean suggests you'));
const cl = s.claimRequest(st, rq.request.id.slice(2), 'claude-pay');
assert.equal(cl.task.assignee, 'claude-pay'); assert.equal(s.findTask(st, cl.task.id).status, 'doing');
assert.throws(() => s.claimRequest(st, rq.request.id, 'claude-web'), /Already taken by claude-pay/);
assert.ok(s.inboxFor(st, 'owner').some(m => m.text.startsWith("I'll take it")), 'the asker hears who took it');
assert.equal(s.openRequests(st).length, 0);

// floor managers: one per department, shared by every project; routing prefers them
s.checkIn(st, { name: 'claude-mkt', role: 'growth', manager: 'marketing' });
assert.equal(s.findAgent(st, 'claude-mkt').department, 'marketing');
s.checkIn(st, { name: 'claude-mkt2', department: 'marketing', manager: true });
assert.equal(s.findAgent(st, 'claude-mkt').manager, false, 'one manager per floor');
s.updateAgent(st, 'claude-mkt2', { manager: false }); s.updateAgent(st, 'claude-mkt', { manager: 'marketing' });
assert.equal(s.routeRequest(st, 'write the launch campaign copy and social posts')[0].name, 'claude-mkt', 'marketing work goes to the marketing manager');
assert.ok(s.agentBriefing(st, 'claude-web').includes('FLOOR MANAGERS') && s.agentBriefing(st, 'claude-mkt').includes('YOU MANAGE THE MARKETING FLOOR'));

// hire a specialist from the catalog: an on-call agent on its floor, skills in the playbook
const hired = s.hireSpecialist(st, 'docs');
assert.equal(hired.agent.name, 'docs-specialist'); assert.equal(hired.agent.department, 'backoffice');
assert.equal(s.presence({ ...hired.agent, lastSeen: new Date(Date.now() - 864e5).toISOString() }), 'idle', 'on call, never asleep');
assert.ok(['docx', 'pdf', 'pptx', 'xlsx'].every(n => s.findSkill(st, n)), 'its skills are in the playbook');
assert.equal(s.hireSpecialist(st, 'docs').already, true, 'hiring twice is a no-op');
assert.ok(s.agentBriefing(st, 'docs-specialist').includes('YOU ARE THE DOCUMENT SPECIALIST'));
assert.equal(s.routeRequest(st, 'turn this proposal into a pdf and a word document')[0].name, 'docs-specialist', 'document work goes to the document specialist');

s.save(st);
const back = s.load();
assert.equal(back.tasks.length, st.tasks.length, 'round-trips through disk');

assert.throws(() => s.addTask(st, { title: 'x', project: 'nope' }), /Unknown project/);
assert.throws(() => s.resolveDate('someday'), /Unrecognised/);
console.log('✓ store tests passed');
