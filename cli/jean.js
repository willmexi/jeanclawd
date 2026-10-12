#!/usr/bin/env node
// jean — command-line interface to Jean Clawd, made for Claude and humans.
// Talks to the running server when it is up (so the web UI updates live),
// otherwise edits ~/.jean/jean.json directly. `jean --help` for usage.
'use strict';
const http = require('http');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('../lib/store');

const fs = require('fs');
const os = require('os');
const args = process.argv.slice(2);
if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') { console.log(require('../package.json').version); process.exit(0); }
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) setFlag(k, v);
    else if (i + 1 < args.length && !args[i + 1].startsWith('--')) setFlag(k, args[++i]);
    else setFlag(k, true);
  } else if (/^-[a-zA-Z]$/.test(a)) {
    const map = { P: 'project', p: 'priority', d: 'date', s: 'scope', n: 'notes', r: 'recur', j: 'json' };
    const k = map[a[1]] || a[1];
    if (k === 'json') flags.json = true;
    else flags[k] = args[++i];
  } else positional.push(a);
}
function setFlag(k, v) {
  // A repeated flag becomes a list: --next "a" --next "b"
  if (k in flags) flags[k] = [].concat(flags[k], v);
  else flags[k] = v;
}
const list_ = v => v === undefined ? [] : [].concat(v).filter(x => x !== true && x !== '');

const cmd = positional.shift() || 'today';
const JSON_OUT = !!flags.json;

// ---------- transport ----------

function port() { if (process.env.JEAN_PORT) return Number(process.env.JEAN_PORT); try { return store.load().settings.port || store.DEFAULT_PORT; } catch { return store.DEFAULT_PORT; } }

/**
 * Local mode: talk to the server on this Mac, or edit ~/.jean/jean.json when it is down.
 * Cloud mode: everything goes to one Jean server you host (JEAN_URL + JEAN_TOKEN, or
 * `jean cloud connect <url> --token …` which stores them in ~/.jean/config.json). No local file.
 */
const CLOUD = (() => {
  if (process.env.JEAN_URL) return { url: process.env.JEAN_URL.replace(/\/$/, ''), token: process.env.JEAN_TOKEN || '' };
  try { const c = JSON.parse(fs.readFileSync(path.join(store.DATA_DIR, 'config.json'), 'utf8')); if (c.mode === 'cloud' && c.url) return { url: c.url.replace(/\/$/, ''), token: c.token || '' }; } catch {}
  return null;
})();

function api(method, p, body, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const target = CLOUD ? new URL(CLOUD.url + p) : null;
    const lib = target && target.protocol === 'https:' ? require('https') : http;
    const headers = { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(CLOUD && CLOUD.token ? { Authorization: `Bearer ${CLOUD.token}` } : {}) };
    const opts = target ? { hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), path: target.pathname + target.search, method, timeout: Math.max(timeout, 8000), headers }
      : { host: '127.0.0.1', port: port(), path: p, method, timeout, headers };
    const req = lib.request(opts, res => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        let out; try { out = JSON.parse(buf); } catch { return reject(new Error('bad response')); }
        if (res.statusCode >= 400) return reject(Object.assign(new Error(out.error || 'request failed'), { http: true }));
        resolve(out);
      });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data); req.end();
  });
}

/** Run `online(api)` if the server is reachable, otherwise `offline(state)` on the file. */
async function run(online, offline) {
  try { return await online(); }
  catch (e) {
    if (e.http) throw e;                       // server answered with an error → real error
    if (CLOUD) throw new Error(`can't reach your Jean cloud at ${CLOUD.url} (${e.message || e.code || 'no answer'}) — check it's up, or switch back: jean cloud off`);
    const state = store.load();
    const out = offline(state);
    store.save(state);
    return out;
  }
}

// ---------- output helpers ----------

const C = { dim: s => `\x1b[2m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`, orange: s => `\x1b[38;5;209m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m` };
if (!process.stdout.isTTY || JSON_OUT) for (const k in C) C[k] = s => s;

let projectCache = null;
function pname(id) {
  if (!id) return '';
  if (!projectCache) { try { projectCache = store.load().projects; } catch { projectCache = []; } }
  const p = projectCache.find(x => x.id === id);
  return p ? `${p.emoji} ${p.name}` : '';
}
function line(t) {
  const box = t.status === 'done' ? C.green('[x]') : t.status === 'doing' ? C.yellow('[>]') : '[ ]';
  const pri = t.priority === 1 ? C.red(' !!') : t.priority === 3 ? C.dim(' ~') : '';
  const pj = t.project ? C.dim(`  ${pname(t.project)}`) : '';
  const rec = t.recur ? C.dim(` ↻${t.recur}`) : '';
  const who = t.assignee ? C.yellow(`  @${t.assignee}`) : '';
  const title = t.status === 'done' ? C.dim(t.title) : t.title;
  return `  ${box} ${C.dim(t.id.slice(2))}  ${title}${pri}${who}${pj}${rec}${t.scope !== 'day' ? C.dim(`  (${t.scope} · ${t.date})`) : ''}`;
}
function out(obj, text) { if (JSON_OUT) console.log(JSON.stringify(obj, null, 2)); else console.log(text); }
function dow(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][store.parse(d).getDay()]; }

// ---------- commands ----------

const commands = {
  async today() { return commands.day(); },
  async day() {
    const date = store.resolveDate(positional[0] || flags.date);
    const r = await run(() => api('GET', `/api/summary?date=${date}`), s => store.summary(s, date));
    const st = r.stats;
    const head = `${C.orange(C.bold(`${dow(date)} ${date}`))}  ${st.today.done}/${st.today.total} done · week ${st.week.pct}% · streak ${st.streak}d`;
    const body = r.tasks.length ? r.tasks.map(line).join('\n') : C.dim('  nothing planned — add with: jean add "title" -P project');
    const od = r.overdue.length ? `\n${C.red('  overdue:')}\n${r.overdue.map(line).join('\n')}` : '';
    out(r, `${head}\n${body}${od}`);
  },
  async week() {
    const date = store.resolveDate(positional[0] || flags.date);
    const r = await run(() => api('GET', `/api/week/${date}`), s => store.tasksForWeek(s, date));
    const parts = [C.orange(C.bold(`Week ${r.start} → ${r.end}`))];
    if (r.weekTasks.length) parts.push(C.bold('  week goals:'), ...r.weekTasks.map(line));
    for (const d of r.days) {
      const mark = d.date === store.today() ? C.orange('▸ ') : '  ';
      parts.push(`${mark}${C.bold(dow(d.date))} ${d.date}${d.tasks.length ? '' : C.dim('  —')}`);
      parts.push(...d.tasks.map(line));
    }
    out(r, parts.join('\n'));
  },
  async month() {
    const date = store.resolveDate(positional[0] || flags.date);
    const r = await run(() => api('GET', `/api/month/${date}`), s => store.tasksForMonth(s, date));
    const parts = [C.orange(C.bold(`Month ${r.start.slice(0, 7)}`))];
    if (r.monthTasks.length) parts.push(C.bold('  month goals:'), ...r.monthTasks.map(line));
    if (r.weekTasks.length) parts.push(C.bold('  week goals:'), ...r.weekTasks.map(line));
    for (const d of Object.keys(r.byDay).sort()) { parts.push(`  ${C.bold(dow(d))} ${d}`); parts.push(...r.byDay[d].map(line)); }
    if (parts.length === 1) parts.push(C.dim('  nothing planned this month'));
    out(r, parts.join('\n'));
  },
  async list() {
    const q = { from: flags.from, to: flags.to, scope: flags.scope, status: flags.status, project: flags.project, search: flags.search || positional[0],
      assignee: flags.mine ? agentName() : flags.assignee };
    if (flags.open) q.status = 'todo';
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const r = await run(() => api('GET', `/api/tasks?${qs}`), s => store.filterTasks(s, q));
    out(r, r.length ? r.map(t => `${line(t)}  ${C.dim(t.date)}`).join('\n') : C.dim('  no matching tasks'));
  },
  async add() {
    const title = positional.join(' ').trim();
    if (!title) throw new Error('usage: jean add "task title" [-P project] [-d date] [-s day|week|month] [-p 1-3] [-n notes] [-r daily|weekdays|weekly|monthly]');
    const ctx = projectContext();
    const input = { title, date: flags.date, scope: flags.scope, priority: flags.priority, notes: flags.notes, recur: flags.recur,
      project: flags.project || (ctx && ctx.id) || undefined, assignee: flags.to || flags.assign || undefined, by: agentName() };
    const t = await run(() => api('POST', '/api/tasks', input), s => store.addTask(s, input));
    projectCache = null;
    out(t, `${C.green('added')}\n${line(t)}  ${C.dim(t.date)}`);
  },
  async done() { return mark('done', positional); },
  async undo() { return mark('todo', positional); },
  async start() { return mark('doing', positional); },
  async edit() {
    const id = positional.shift();
    if (!id) throw new Error('usage: jean edit <id> [--title ..] [-P project] [-d date] [-s scope] [-p priority] [-n notes] [-r recur]');
    const patch = {};
    if (positional.length) patch.title = positional.join(' ');
    for (const k of ['title', 'project', 'date', 'scope', 'priority', 'notes', 'recur', 'status']) if (k in flags) patch[k] = flags[k] === 'none' ? null : flags[k];
    if ('to' in flags || 'assign' in flags) patch.assignee = flags.to || flags.assign;
    patch.by = agentName();
    const t = await run(() => api('PATCH', `/api/tasks/${resolveId(id)}`, patch), s => store.updateTask(s, id, patch));
    out(t, `${C.green('updated')}\n${line(t)}  ${C.dim(t.date)}`);
  },
  async move() {
    const [id, ...rest] = positional;
    const date = rest.join(' ') || flags.date;
    if (!id || !date) throw new Error('usage: jean move <id> <date>   e.g. jean move 8f2k tomorrow');
    const patch = { date: store.resolveDate(date) };
    if (flags.scope) patch.scope = flags.scope;
    const t = await run(() => api('PATCH', `/api/tasks/${resolveId(id)}`, patch), s => store.updateTask(s, id, patch));
    out(t, `${C.green('moved')}\n${line(t)}  ${C.dim(t.date)}`);
  },
  async rm() {
    const id = positional[0];
    if (!id) throw new Error('usage: jean rm <id>');
    const t = await run(() => api('DELETE', `/api/tasks/${resolveId(id)}`), s => store.deleteTask(s, id));
    out(t, `${C.red('deleted')} ${t.title}`);
  },
  async init() {
    const dir = process.cwd();
    const facts = inspectDir(dir);
    const name = flags.name || facts.suggested.name || path.basename(dir);
    const description = positional.join(' ').trim() || flags.desc || flags.description || flags.notes || facts.suggested.description;
    const repo = flags.repo || facts.suggested.repo;
    const input = { name, path: dir, description, repo, emoji: flags.emoji || facts.suggested.emoji, color: flags.color };
    const p = await run(() => api('POST', '/api/projects', input), s => store.addProject(s, input));
    fs.writeFileSync(path.join(dir, '.jean'), JSON.stringify({ project: p.id, name: p.name }, null, 2) + '\n');
    // Make sure any Claude working in this folder knows about Jean.
    const claudeMd = path.join(dir, 'CLAUDE.md');
    const hint = `\n## Planning — Jean Clawd\nThis folder is the Jean project **${p.name}**. Track work with the \`jean\` CLI (\`jean project\` shows this project's tasks, \`jean add "…"\` files a task here automatically, \`jean today\`). Run \`jean --help\` for the rest.\n`;
    let wroteHint = false;
    if (!fs.existsSync(claudeMd) || !fs.readFileSync(claudeMd, 'utf8').includes('Jean Clawd')) { fs.appendFileSync(claudeMd, hint); wroteHint = true; }
    // Codex, Cursor and VS Code agents read AGENTS.md
    const agentsMd = path.join(dir, 'AGENTS.md');
    if (!fs.existsSync(agentsMd) || !fs.readFileSync(agentsMd, 'utf8').includes('Jean Clawd')) fs.appendFileSync(agentsMd, (fs.existsSync(agentsMd) ? '\n' : '') + agentNote(path.join(__dirname, '..')) + `This folder is the Jean project **${p.name}**.\n`);
    p.autoFilled = { name: !flags.name, description: !(positional.length || flags.desc || flags.description), emoji: !flags.emoji, repo: !flags.repo };
    out(p, `${C.green('✓ project registered')} ${p.emoji} ${C.bold(p.name)} ${C.dim(p.id)}\n  ${C.dim(dir)}${p.repo ? `\n  ${C.dim('repo')} ${p.repo}` : ''}${p.description ? `\n  ${p.description}` : ''}\n  wrote .jean${wroteHint ? ' + CLAUDE.md note' : ''} + AGENTS.md note — \`jean add\` in here files tasks under this project`);
  },
  async inspect() {
    const dir = positional[0] ? path.resolve(positional[0]) : process.cwd();
    const f = inspectDir(dir);
    out(f, `${C.orange(C.bold(f.suggested.emoji + ' ' + f.suggested.name))}  ${C.dim(dir)}\n  repo      ${f.remote || C.dim('none')}${f.branch ? C.dim(` (${f.branch})`) : ''}\n  language  ${f.language || C.dim('?')}${f.hints.length ? C.dim('  ' + f.hints.join(', ')) : ''}\n  readme    ${f.readme.title || C.dim('—')}${f.readme.summary ? `\n            ${C.dim(f.readme.summary)}` : ''}\n  package   ${f.pkg ? `${f.pkg.name || ''} ${C.dim(f.pkg.description || '')}` : C.dim('—')}\n  suggested description: ${f.suggested.description || C.dim('(none found — write one)')}`);
  },
  async projects() {
    const r = await run(() => api('GET', '/api/projects'), s => s.projects);
    const st = await run(() => api('GET', '/api/stats'), s => store.stats(s));
    const rows = r.filter(p => !p.archived || flags.all).sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || '')).map(p => {
      const pp = st.perProject.find(x => x.id === p.id) || {};
      return `  ${p.emoji} ${C.bold(p.name.padEnd(22))} ${C.dim(p.id)}  open ${pp.open ?? 0}${pp.overdue ? C.red(` overdue ${pp.overdue}`) : ''}  week ${pp.doneWeek ?? 0}/${pp.totalWeek ?? 0}\n    ${C.dim(p.description || '(no description)')}${p.repo ? `  ${C.dim(p.repo)}` : ''}${p.path ? `  ${C.dim(p.path)}` : ''}`;
    });
    out(r, rows.join('\n') || C.dim('  no projects yet — run `jean init "what this project is"` inside a project folder'));
  },
  async project() {
    const sub = positional[0];
    if (sub === 'add') {
      positional.shift();
      const input = { name: positional.join(' '), description: flags.desc || flags.description, emoji: flags.emoji, color: flags.color, repo: flags.repo, path: flags.path || '' };
      const p = await run(() => api('POST', '/api/projects', input), s => store.addProject(s, input));
      return out(p, `${C.green('added project')} ${p.emoji} ${p.name} ${C.dim(p.id)}`);
    }
    if (sub === 'rename' || sub === 'color' || sub === 'unarchive') {
      positional.shift();
      const ref = positional.shift();
      const state = store.load();
      const p = store.findProject(state, ref);
      if (!p) throw new Error(`usage: jean project ${sub} <project> ${sub === 'rename' ? '"New name"' : sub === 'color' ? '#hex' : ''}`.trim());
      const patch = sub === 'rename' ? { name: positional.join(' ').trim() } : sub === 'color' ? { color: positional[0] } : { archived: false };
      if (sub === 'rename' && !patch.name) throw new Error('usage: jean project rename <project> "New name"');
      if (sub === 'color' && !/^#[0-9a-f]{6}$/i.test(patch.color || '')) throw new Error('usage: jean project color <project> #RRGGBB');
      const r = await run(() => api('PATCH', `/api/projects/${p.id}`, patch), st => store.updateProject(st, p.id, patch));
      return out(r, `${C.green('updated')} ${r.emoji} ${r.name}`);
    }
    if (sub === 'describe' || sub === 'rm' || sub === 'archive' || sub === 'repo' || sub === 'emoji') {
      positional.shift();
      const ctx = projectContext();
      const state = store.load();
      const ref = (sub === 'describe' || sub === 'repo' || sub === 'emoji') ? (flags.project || (ctx && ctx.id)) : positional.shift();
      const p = store.findProject(state, ref);
      if (!p) throw new Error(sub === 'describe' ? 'not inside a jean project (run jean init first) — or pass -P <project>' : `no project "${ref}"`);
      if (sub === 'rm') { await run(() => api('DELETE', `/api/projects/${p.id}`), s => store.deleteProject(s, p.id)); return out({ ok: true }, `${C.red('deleted')} ${p.name}`); }
      const patch = sub === 'archive' ? { archived: true } : sub === 'repo' ? { repo: positional.join(' ') } : sub === 'emoji' ? { emoji: positional.join(' ') } : { description: positional.join(' ') };
      const r = await run(() => api('PATCH', `/api/projects/${p.id}`, patch), s => store.updateProject(s, p.id, patch));
      return out(r, `${C.green('updated')} ${r.name}`);
    }
    const ctx = projectContext();
    const ref = sub || flags.project || (ctx && ctx.id);
    if (!ref) throw new Error('usage: jean project <name>   (or run inside a folder that has `jean init`)');
    const state = store.load();
    const p = store.findProject(state, ref);
    if (!p) throw new Error(`no project "${ref}" — jean projects`);
    const tasks = await run(() => api('GET', `/api/tasks?project=${encodeURIComponent(p.id)}${flags.all ? '' : '&status=todo'}`), s => store.filterTasks(s, { project: p.id, status: flags.all ? undefined : 'todo' }));
    const doing = flags.all ? [] : await run(() => api('GET', `/api/tasks?project=${encodeURIComponent(p.id)}&status=doing`), s => store.filterTasks(s, { project: p.id, status: 'doing' }));
    const list = doing.concat(tasks);
    out({ project: p, tasks: list }, `${C.orange(C.bold(`${p.emoji} ${p.name}`))}  ${C.dim(p.description || '')}\n  ${C.dim([p.repo, p.path].filter(Boolean).join('  '))}\n${list.length ? list.map(t => `${line(t)}  ${C.dim(t.date)}`).join('\n') : C.dim('  no open tasks — jean add "…" in this folder')}`);
  },
  async handoff() {
    const sub = positional.shift() || 'list';
    const ctx = projectContext();

    if (sub === 'list' || sub === 'ls') {
      const q = { all: !!flags.all, status: flags.status, project: flags.project || (flags.here && ctx ? ctx.id : undefined) };
      const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const r = await run(() => api('GET', `/api/handoffs?${qs}`), st => store.filterHandoffs(st, q));
      const rows = r.map(h => {
        const mark = h.status === 'claimed' ? C.yellow('◐ claimed') : h.status === 'done' ? C.dim('✓ done   ') : C.green('● open   ');
        const age = Math.round((Date.now() - new Date(h.createdAt)) / 36e5);
        return `  ${mark} ${C.dim(h.id.slice(2))}  ${C.bold(h.title)}${h.project ? C.dim(`  ${pname(h.project)}`) : ''}\n` +
               `             ${C.dim(`${h.next.length} next step${h.next.length === 1 ? '' : 's'} · from ${h.from}${h.claimedBy ? ` · taken by ${h.claimedBy}` : ''} · ${age < 1 ? 'just now' : age + 'h ago'}`)}`;
      });
      return out(r, rows.join('\n') || C.dim('  no handoffs waiting — write one with: jean handoff create "title" --next "…"'));
    }

    if (sub === 'create' || sub === 'write' || sub === 'new') {
      const dir = process.cwd();
      const git = gitFacts(dir);
      const context = flags.stdin === true || flags.stdin === 'true' ? readStdin() : (flags.context || flags.summary || '');
      const input = {
        title: positional.join(' ').trim() || flags.title,
        project: flags.project || (ctx && ctx.id) || undefined,
        cwd: dir, branch: git.branch, commit: git.commit,
        context,
        next: list_(flags.next),
        files: list_(flags.files).length ? list_(flags.files) : git.dirty,
        tasks: list_(flags.task || flags.tasks),
        blockers: flags.blockers || '',
        from: flags.from || agentName(),
        to: flags.to || undefined,
      };
      if (!input.title) throw new Error('usage: jean handoff create "what this work is" --next "first thing" --next "second thing" [--context "…" | --stdin] [--blockers "…"] [--task <id>]');
      const h = await run(() => api('POST', '/api/handoffs', input), st => store.addHandoff(st, input));
      return out(h, `${C.green('✓ handoff written')} ${C.bold(h.title)} ${C.dim(h.id.slice(2))}${h.to ? ` → ${C.bold(h.to)}` : ''}\n  ${C.dim(`${h.next.length} next steps · ${h.files.length} files · ${h.cwd}`)}\n  ${C.dim('another Claude picks it up with:')} ${C.bold('jean handoff take')}`);
    }

    if (sub === 'take' || sub === 'claim') {
      const ref = positional.shift();
      let id = ref;
      if (!id) {
        // Nothing named: take the oldest open handoff, preferring this folder's project.
        const openHere = ctx ? await run(() => api('GET', `/api/handoffs?status=open&project=${ctx.id}`), st => store.filterHandoffs(st, { status: 'open', project: ctx.id })) : [];
        const pool = openHere.length ? openHere : await run(() => api('GET', '/api/handoffs?status=open'), st => store.filterHandoffs(st, { status: 'open' }));
        if (!pool.length) throw new Error('no open handoffs — jean handoff list --all to see finished ones');
        id = pool[0].id;
      }
      const by = flags.as || flags.by || agentName();
      const r = await run(() => api('POST', `/api/handoffs/${resolveHandoffId(id)}/claim`, { by, force: !!flags.force }),
                          st => { const h = store.claimHandoff(st, id, by, { force: !!flags.force }); return { ...h, briefing: store.handoffBriefing(st, h) }; });
      const cdHint = r.cwd && r.cwd !== process.cwd() ? `\n${C.yellow(`→ this work lives in ${r.cwd} — cd there first`)}` : '';
      return out(r, `${C.orange(C.bold('▸ picked up'))} ${C.dim(`(${r.id.slice(2)}, from ${r.from})`)}${cdHint}\n\n${r.briefing}\n\n${C.dim('when you stop: jean handoff note "<what you did>" · jean handoff done ' + r.id.slice(2))}`);
    }

    if (sub === 'show' || sub === 'read') {
      const id = positional.shift() || (ctx ? null : null);
      if (!id) throw new Error('usage: jean handoff show <id>');
      const r = await run(() => api('GET', `/api/handoffs/${resolveHandoffId(id)}`), st => { const h = store.findHandoff(st, id); if (!h) throw new Error(`No handoff ${id}`); return { ...h, briefing: store.handoffBriefing(st, h) }; });
      return out(r, r.briefing);
    }

    if (sub === 'note') {
      const id = flags.id || (positional.length > 1 ? positional.shift() : null);
      const text = positional.join(' ');
      if (!text) throw new Error('usage: jean handoff note ["id"] "what happened"');
      const target = id || (await currentHandoffId());
      if (!target) throw new Error('no handoff in progress — pass an id');
      const r = await run(() => api('POST', `/api/handoffs/${resolveHandoffId(target)}/note`, { text, by: flags.as || agentName() }),
                          st => store.noteHandoff(st, target, text, flags.as || agentName()));
      return out(r, `${C.green('noted')} on ${C.bold(r.title)}`);
    }

    if (sub === 'done' || sub === 'finish') {
      const id = positional.shift() || (await currentHandoffId());
      if (!id) throw new Error('usage: jean handoff done <id>');
      const r = await run(() => api('PATCH', `/api/handoffs/${resolveHandoffId(id)}`, { status: 'done' }), st => store.updateHandoff(st, id, { status: 'done' }));
      return out(r, `${C.green('✓ handoff finished')} ${r.title}`);
    }

    if (sub === 'drop' || sub === 'release' || sub === 'reopen') {
      const id = positional.shift() || (await currentHandoffId());
      if (!id) throw new Error('usage: jean handoff drop <id>');
      const r = await run(() => api('PATCH', `/api/handoffs/${resolveHandoffId(id)}`, { status: 'open' }), st => store.updateHandoff(st, id, { status: 'open' }));
      return out(r, `${C.yellow('released')} ${r.title} — open again for any instance`);
    }

    if (sub === 'rm' || sub === 'delete') {
      const id = positional.shift();
      if (!id) throw new Error('usage: jean handoff rm <id>');
      const r = await run(() => api('DELETE', `/api/handoffs/${resolveHandoffId(id)}`), st => store.deleteHandoff(st, id));
      return out(r, `${C.red('deleted')} ${r.title}`);
    }

    throw new Error('usage: jean handoff [list|create|take|show|note|done|drop|rm]  —  jean handoff --help');
  },
  // ---------- agents (Jean Clawd vd Dam) ----------

  async hello() {
    const me = agentName();
    if (!isAgentProcess() && !flags.as) throw new Error('hello is for agents: run it from Claude, or pass --as <name> / set JEAN_AGENT');
    const ctx = projectContext();
    const input = { name: me, role: flags.role, kind: flags.kind || agentFamily(), department: flags.dept || flags.department, manager: flags.manager, cwd: process.cwd(), project: flags.project || (ctx && ctx.id) || undefined,
      doing: positional.join(' ').trim() || flags.doing || undefined, task: flags.task };
    const r = await run(() => api('POST', '/api/agents/hello', input), st => {
      const a = store.checkIn(st, input);
      if (input.doing || input.task) store.setDoing(st, a.name, input.doing, { task: input.task });
      return { agent: a, briefing: store.agentBriefing(st, a.name), inbox: store.inboxFor(st, a.name) };
    });
    if (r.inbox.length && !flags.peek) await inboxGet(me);
    if (!/^MACHINE \(/m.test(r.briefing)) {   // cloud or offline: describe the machine this agent is on
      try { const sys = require('../lib/system'); sys.protectPort(port()); await sys.snapshot(store.load().projects); r.briefing = r.briefing.replace(/\n\nTHE CREW/, `\n\n${sys.briefingLines().join('\n')}\n\nTHE CREW`); } catch {}
    }
    out(r, `${C.orange(C.bold('🥋 Jean Clawd vd Dam'))} ${C.dim('— checked in as')} ${C.bold(r.agent.name)}\n\n${r.briefing}`);
  },
  async whoami() {
    const me = agentName();
    const r = await run(() => api('GET', `/api/agents/${encodeURIComponent(me)}/brief`), st => ({ agent: store.findAgent(st, me), briefing: store.agentBriefing(st, me), inbox: store.inboxFor(st, me) }));
    out({ name: me, ...r }, r.briefing);
  },
  async brief() { return commands.whoami(); },
  async agents() {
    const r = await run(() => api('GET', `/api/agents${flags.all ? '?all=1' : ''}`), st => store.listAgents(st, { all: !!flags.all }));
    const dot = { active: C.green('●'), idle: C.yellow('◐'), away: C.dim('○'), offline: C.dim('·') };
    const rows = r.map(a => {
      const seen = Math.round((Date.now() - new Date(a.lastSeen)) / 60000);
      return `  ${dot[a.presence]} ${C.bold(a.name.padEnd(26))} ${a.role ? a.role : C.dim('(no role)')}${a.project ? C.dim(`  ${pname(a.project)}`) : ''}\n` +
        `      ${a.doing ? `▸ ${a.doing.text}` : C.dim('— nothing set')}  ${C.dim(`· ${a.presence} ${seen < 1 ? 'now' : seen < 60 ? seen + 'm' : Math.round(seen / 60) + 'h'} · ${a.open} task${a.open === 1 ? '' : 's'}${a.unread ? ` · ${a.unread} unread` : ''}`)}`;
    });
    out(r, rows.join('\n') || C.dim('  no agents checked in — a Claude session joins with: jean hello --role "what it is for"'));
  },
  async crew() { return commands.agents(); },
  async doing() {
    const me = agentName();
    const text = flags.clear ? '' : positional.join(' ').trim();
    if (!text && !flags.task && !flags.clear) throw new Error('usage: jean doing "what you are working on" [--task <id>]   (or --clear)');
    const body = { text, task: flags.task ? resolveId(flags.task) : undefined };
    const a = await run(() => api('POST', `/api/agents/${encodeURIComponent(me)}/doing`, body), st => store.setDoing(st, me, body.text, { task: body.task }));
    out(a, a.doing ? `${C.green('▸')} ${C.bold(a.name)} is on: ${a.doing.text}` : `${C.dim(a.name + ': nothing set')}`);
  },
  async bye() {
    const me = agentName();
    const text = positional.join(' ').trim();
    const a = await run(() => api('POST', `/api/agents/${encodeURIComponent(me)}/bye`, { text }), st => store.signOff(st, me, text));
    out(a, `${C.dim('signed off')} ${a.name}`);
  },
  async send() {
    const to = positional.shift();
    const text = positional.join(' ').trim() || (flags.stdin ? readStdin() : '');
    if (!to || !text) throw new Error('usage: jean send <agent|#project|all|owner> "message" [--task <id>] [--wait 120]');
    const m = await postMessage({ to, text });
    if (flags.wait) return waitReply(m, Number(flags.wait) || 120);
    out(m, `${C.green('sent')} ${C.dim(m.id.slice(2))} ${m.from} → ${addr(m.to)}`);
  },
  async ask() {
    const to = positional.shift();
    const text = positional.join(' ').trim();
    if (!to || !text) throw new Error('usage: jean ask <agent|#project|owner> "question" [--wait 300]   — sends, then waits for the reply');
    const m = await postMessage({ to, text: text });
    return waitReply(m, Number(flags.wait) || 300);
  },
  async reply() {
    const id = positional.shift();
    const text = positional.join(' ').trim();
    if (!id || !text) throw new Error('usage: jean reply <message id> "text"');
    const m = await postMessage({ replyTo: id, text });
    out(m, `${C.green('replied')} ${C.dim(m.id.slice(2))} ${m.from} → ${addr(m.to)}`);
  },
  async inbox() {
    const me = flags.for || agentName();
    let list = await inboxGet(me, { all: !!flags.all, peek: !!flags.peek });
    if (!list.length && flags.wait) {
      const until = Date.now() + (Number(flags.wait) || 120) * 1000;
      while (!list.length && Date.now() < until) list = await inboxGet(me, { peek: !!flags.peek, wait: Math.min(25, Math.ceil((until - Date.now()) / 1000)) });
    }
    out(list, list.length ? `${C.orange(C.bold(`inbox · ${me}`))}\n${list.map(msgLine).join('\n')}\n${C.dim('reply: jean reply <id> "…"')}` : C.dim(`  inbox empty for ${me}`));
  },
  async feed() {
    const q = { project: flags.project, agent: flags.agent, thread: flags.thread || positional[0], kind: flags.kind, limit: flags.limit || 30 };
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const r = await run(() => api('GET', `/api/messages?${qs}`), st => store.feed(st, q));
    out(r, r.length ? r.map(msgLine).join('\n') : C.dim('  quiet — nobody said anything yet'));
  },
  async managers() {
    const list = await run(() => api('GET', '/api/agents?all=1'), st => store.listAgents(st, { all: true }));
    const m = list.filter(a => a.manager);
    out(m, m.length ? m.map(a => `  👑 ${a.department.padEnd(11)} ${C.bold(a.name)} ${C.dim(`${a.presence}${a.role ? ' · ' + a.role : ''}`)}`).join('\n') : C.dim('  no floor managers yet — one agent per department can serve every project: jean agent manager <name> marketing'));
  },
  /** Ask the room: Jean finds the right agent. jean request "text" */
  async request() {
    const text = positional.join(' ').trim();
    if (!text) throw new Error('usage: jean request "what needs doing"   — Jean offers it to the best-fitting agent; any agent can claim it');
    const body = { text, from: agentName(), project: flags.project };
    const r = await run(() => api('POST', '/api/requests', body), st => store.createRequest(st, body));
    out(r, `${C.green('asked the crew')} ${C.dim(r.request.id.slice(2))}\n${r.ranked.length ? r.ranked.slice(0, 3).map((x, k) => `  ${k ? ' ' : C.orange('→')} ${C.bold(x.name)} ${C.dim(`score ${x.score} · ${x.presence}${x.why.length ? ' · ' + x.why.join(', ') : ''}`)}`).join('\n') : C.dim('  nobody is checked in to offer it to; it waits on the board')}\n  ${C.dim('an agent takes it with: jean claim ' + r.request.id.slice(2))}`);
  },
  async requests() {
    const list = await run(() => api('GET', `/api/requests${flags.all ? '?all=1' : ''}`), st => st.messages.filter(m => m.kind === 'request' && (flags.all || !m.claimedBy)));
    out(list, list.length ? list.map(m => `  ${C.dim(m.id.slice(2))}  ${m.claimedBy ? C.green('taken by ' + m.claimedBy) : C.yellow('open')}  ${m.from}: ${m.text}${!m.claimedBy && m.candidates && m.candidates[0] ? C.dim(`  (Jean suggests ${m.candidates[0]})`) : ''}`).join('\n') : C.dim('  no open requests'));
  },
  async claim() {
    const id = positional[0];
    if (!id) throw new Error('usage: jean claim <request id>   — take an open request; it becomes your task');
    const me = agentName();
    const ref = (store.findMessage(store.load(), id) || {}).id || id;
    const r = await run(() => api('POST', `/api/requests/${encodeURIComponent(ref)}/claim`, { agent: me }), st => store.claimRequest(st, id, me));
    out(r, `${C.green('yours')} ${r.task.title} ${C.dim(`(task ${r.task.id.slice(2)}, in progress)`)}`);
  },
  async assign() {
    const [id, to] = positional;
    if (!id || !to) throw new Error('usage: jean assign <task id> <agent|none>');
    const body = { to, by: agentName() };
    const t = await run(() => api('POST', `/api/tasks/${resolveId(id)}/assign`, body), st => store.assignTask(st, id, to, body.by));
    out(t, `${C.green('assigned')}\n${line(t)}`);
  },
  async mine() {
    const me = flags.for || agentName();
    const q = { assignee: me, open: flags.all ? undefined : 1 };
    const qs = `assignee=${encodeURIComponent(me)}${flags.all ? '' : '&open=1'}`;
    const r = await run(() => api('GET', `/api/tasks?${qs}`), st => store.filterTasks(st, q));
    out(r, `${C.orange(C.bold(`tasks for ${me}`))}\n${r.length ? r.map(t => `${line(t)}  ${C.dim(t.date)}`).join('\n') : C.dim('  nothing assigned — jean assign <id> ' + me)}`);
  },
  async agent() {
    const sub = positional.shift();
    const name = positional.shift();
    if (sub === 'rm' && name) { const a = await run(() => api('DELETE', `/api/agents/${encodeURIComponent(name)}`), st => store.deleteAgent(st, name)); return out(a, `${C.red('removed')} ${a.name}`); }
    if (sub === 'manager' && name) { const v = positional.join(' ') || 'true'; const a = await run(() => api('PATCH', `/api/agents/${encodeURIComponent(name)}`, { manager: v }), st => store.updateAgent(st, name, { manager: v })); return out(a, a.manager ? `${C.green('👑')} ${a.name} manages the ${a.department} floor (for every project)` : `${a.name} is no longer a manager`); }
    if ((sub === 'dept' || sub === 'department') && name) { const department = positional.join(' '); const a = await run(() => api('PATCH', `/api/agents/${encodeURIComponent(name)}`, { department }), st => store.updateAgent(st, name, { department })); return out(a, `${C.green('moved')} ${a.name} → ${a.department || 'auto'}`); }
    if (sub === 'role' && name) { const role = positional.join(' '); const a = await run(() => api('PATCH', `/api/agents/${encodeURIComponent(name)}`, { role }), st => store.updateAgent(st, name, { role })); return out(a, `${C.green('updated')} ${a.name}: ${a.role}`); }
    if (sub === 'link' && name) {
      const url = positional.shift();
      if (!url) throw new Error('usage: jean agent link <name> <url of an A2A agent or its agent card> [--role "…"]');
      let r;
      try { r = await api('POST', '/v1/link', { name, url, role: flags.role }, 15000); }
      catch (e) { if (e.http) throw e; throw new Error('linking needs the server (it talks to the remote agent): jean serve --bg'); }
      return out(r, `${C.green('linked')} ${C.bold(r.agent)} → ${r.endpoint}${r.remoteName ? C.dim(` (calls itself "${r.remoteName}")`) : ''}\n  messages to ${r.agent} are now delivered over A2A; its replies land in your inbox`);
    }
    throw new Error('usage: jean agent role <name> "role" | jean agent link <name> <a2a url> | jean agent rm <name>');
  },
  /** Instructions any agent (Codex, Cursor, Gemini, a script…) can be given to join the crew. */
  async prompt() {
    const name = flags.as || positional[0] || 'your-agent-name';
    const base = CLOUD ? CLOUD.url : `http://localhost:${port()}`;
    const text = protocolPrompt(name, base, !!CLOUD);
    out({ name, base, prompt: text }, text);
  },
  /** Claude Code hook: SessionStart → check in + briefing, UserPromptSubmit → new messages, SessionEnd → sign off. */
  async hook() {
    process.env.JEAN_HOOK = '1';
    try { hookInput = JSON.parse(readStdin() || '{}'); } catch { hookInput = {}; }
    if (hookInput.cwd) { try { process.chdir(hookInput.cwd); } catch {} }
    const ev = flags.event || hookInput.hook_event_name || 'UserPromptSubmit';
    const me = agentName();
    try {
      if (ev === 'SessionStart') {
        const ctx = projectContext();
        const input = { name: me, cwd: process.cwd(), project: ctx ? ctx.id : undefined };
        const r = await run(() => api('POST', '/api/agents/hello', input), st => { const a = store.checkIn(st, input); return { agent: a, briefing: store.agentBriefing(st, a.name), inbox: store.inboxFor(st, a.name) }; });
        if (r.inbox.length) await inboxGet(me);
        console.log(`[Jean Clawd vd Dam] You are agent "${me}" in the owner's multi-agent planner. Use the jean CLI with this identity (it is automatic). ` +
          `Set what you are doing with \`jean doing "…"\` (or --task <id>), coordinate with \`jean send\`, finish with \`jean done <id>\`.\n\n${r.briefing}`);
      } else if (ev === 'SessionEnd') {
        await run(() => api('POST', `/api/agents/${encodeURIComponent(me)}/bye`, {}), st => { if (store.findAgent(st, me)) store.signOff(st, me); });
      } else {
        const list = await inboxGet(me, { touch: true });
        if (list.length) console.log(`[Jean Clawd vd Dam] ${list.length} new message${list.length === 1 ? '' : 's'} for ${me} (reply with \`jean reply <id> "…"\`):\n${list.map(msgLine).join('\n')}`);
      }
    } catch { /* a hook must never break the session */ }
  },

  /**
   * Plug Jean into every coding agent on this Mac: registers the MCP server and drops a short
   * "how to use Jean" note where each tool reads global instructions. Dry run unless --yes.
   *   jean connect                 show what would change
   *   jean connect --yes           apply to every tool found     jean connect codex cursor --yes   only those
   */
  async connect() {
    const root = path.join(__dirname, '..'), home = os.homedir();
    const mcp = path.join(root, 'mcp', 'server.js'), node = process.execPath;
    const apply = !!flags.yes;
    const only = positional.map(x => x.toLowerCase());
    const note = agentNote(root);
    const exists = p => fs.existsSync(p);
    const hasBin = b => { try { require('child_process').execFileSync('/bin/zsh', ['-lc', `command -v ${b}`], { stdio: 'ignore' }); return true; } catch { return false; } };
    const backup = f => { if (exists(f)) fs.copyFileSync(f, f + '.bak-jean'); };
    const mergeJson = (file, key, entry) => {
      let cfg = {};
      if (exists(file)) { try { cfg = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { throw new Error(`${file} is not plain JSON (comments?) — add "jean" under "${key}" by hand: ${JSON.stringify(entry)}`); } }
      cfg[key] = cfg[key] || {};
      const same = JSON.stringify(cfg[key].jean) === JSON.stringify(entry);
      if (same) return 'already set';
      const verb = cfg[key].jean ? 'update' : 'add';
      if (apply) { fs.mkdirSync(path.dirname(file), { recursive: true }); backup(file); cfg[key].jean = entry; fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n'); }
      return verb;
    };
    const appendNote = file => {
      if (exists(file) && fs.readFileSync(file, 'utf8').includes('Jean Clawd')) return 'already there';
      if (apply) { fs.mkdirSync(path.dirname(file), { recursive: true }); backup(file); fs.appendFileSync(file, (exists(file) ? '\n' : '') + note); }
      return 'add';
    };
    const std = { command: node, args: [mcp] };
    const P = [
      { id: 'claude', name: 'Claude Code', found: () => hasBin('claude') || exists(path.join(home, '.claude')), steps: () => [
        ['MCP (claude mcp add, user scope)', () => { const { execFileSync } = require('child_process'); let listed = ''; try { listed = execFileSync('claude', ['mcp', 'get', 'jean'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch {}
          if (listed.includes(mcp)) return 'already set'; if (apply) { try { execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'jean'], { stdio: 'ignore' }); } catch {} execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'jean', '--', node, mcp], { stdio: 'ignore' }); } return 'add'; }],
        ['note → ~/.claude/CLAUDE.md', () => appendNote(path.join(home, '.claude', 'CLAUDE.md'))]] },
      { id: 'claude-desktop', name: 'Claude Desktop', found: () => exists(path.join(home, 'Library/Application Support/Claude')), steps: () => [
        ['MCP → claude_desktop_config.json', () => mergeJson(path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json'), 'mcpServers', std)]] },
      { id: 'codex', name: 'Codex (CLI + IDE)', found: () => hasBin('codex') || exists(path.join(home, '.codex')), steps: () => [
        ['MCP → ~/.codex/config.toml [mcp_servers.jean]', () => { const f = path.join(home, '.codex', 'config.toml'); const txt = exists(f) ? fs.readFileSync(f, 'utf8') : '';
          if (/^\[mcp_servers\.jean\]/m.test(txt)) return txt.includes(mcp) ? 'already set' : 'present (left as is)';
          if (apply) { fs.mkdirSync(path.dirname(f), { recursive: true }); backup(f); fs.appendFileSync(f, `${txt && !txt.endsWith('\n') ? '\n' : ''}\n# Jean Clawd: the planner + agent switchboard\n[mcp_servers.jean]\ncommand = ${JSON.stringify(node)}\nargs = [${JSON.stringify(mcp)}]\n`); }
          return 'add'; }],
        ['note → ~/.codex/AGENTS.md', () => appendNote(path.join(home, '.codex', 'AGENTS.md'))]] },
      { id: 'cursor', name: 'Cursor', found: () => exists(path.join(home, '.cursor')) || exists('/Applications/Cursor.app'), steps: () => [
        ['MCP → ~/.cursor/mcp.json', () => mergeJson(path.join(home, '.cursor', 'mcp.json'), 'mcpServers', std)],
        ['note → AGENTS.md in each project (jean init writes it)', () => 'per project']] },
      { id: 'gemini', name: 'Gemini CLI', found: () => hasBin('gemini') || exists(path.join(home, '.gemini')), steps: () => [
        ['MCP → ~/.gemini/settings.json', () => mergeJson(path.join(home, '.gemini', 'settings.json'), 'mcpServers', std)],
        ['note → ~/.gemini/GEMINI.md', () => appendNote(path.join(home, '.gemini', 'GEMINI.md'))]] },
      { id: 'windsurf', name: 'Windsurf', found: () => exists(path.join(home, '.codeium', 'windsurf')), steps: () => [
        ['MCP → ~/.codeium/windsurf/mcp_config.json', () => mergeJson(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers', std)],
        ['note → windsurf global_rules.md', () => appendNote(path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'))]] },
      { id: 'vscode', name: 'VS Code (Copilot agent)', found: () => exists(path.join(home, 'Library/Application Support/Code/User')), steps: () => [
        ['MCP → Code/User/mcp.json', () => mergeJson(path.join(home, 'Library/Application Support/Code/User/mcp.json'), 'servers', { type: 'stdio', ...std })],
        ['note → AGENTS.md in each project (jean init writes it)', () => 'per project']] },
    ];
    const rows = [], report = [];
    for (const p of P) {
      if (only.length && !only.includes(p.id)) continue;
      if (!p.found()) { rows.push(`  ${C.dim('·')} ${p.name.padEnd(24)} ${C.dim('not installed')}`); report.push({ platform: p.id, found: false }); continue; }
      const res = [];
      for (const [label, fn] of p.steps()) { let r; try { r = fn(); } catch (e) { r = `error: ${e.message}`; } res.push({ step: label, result: r }); }
      report.push({ platform: p.id, found: true, steps: res });
      rows.push(`  ${C.green('✓')} ${C.bold(p.name.padEnd(24))}\n${res.map(r => `      ${r.result.startsWith('error') ? C.red(r.result) : r.result === 'add' || r.result === 'update' ? C.yellow(apply ? { add: 'added', update: 'updated' }[r.result] : 'will ' + r.result) : C.dim(r.result)}  ${C.dim(r.step)}`).join('\n')}`);
    }
    out({ applied: apply, report }, `${C.orange(C.bold('Connect Jean to your coding agents'))} ${apply ? '' : C.dim('(dry run — nothing written; add --yes to apply)')}\n${rows.join('\n')}\n${apply ? C.dim('\nRestart those apps / sessions to load Jean. Backups: <file>.bak-jean') : ''}`);
  },

  async setup() {
    const root = path.join(__dirname, '..');
    const home = os.homedir();
    const report = [];
    // 1. CLI on PATH
    const target = '/usr/local/bin/jean';
    try {
      try { fs.unlinkSync(target); } catch {}
      fs.symlinkSync(path.join(root, 'cli/jean.js'), target);
      report.push(`${C.green('✓')} CLI            ${target}`);
    } catch {
      try { require('child_process').execFileSync('npm', ['link'], { cwd: root, stdio: 'ignore' }); report.push(`${C.green('✓')} CLI            npm link → ${require('child_process').execFileSync('/bin/zsh', ['-lc', 'command -v jean']).toString().trim()}`); }
      catch { report.push(`${C.yellow('·')} CLI            not on PATH — run: npm link   (in ${root})`); }
    }
    // 2. Claude Code skill
    const installed = [];
    for (const name of fs.readdirSync(path.join(root, 'skills'))) {
      const src = path.join(root, 'skills', name, 'SKILL.md'); if (!fs.existsSync(src)) continue;
      const skillDir = path.join(home, '.claude/skills', name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), fs.readFileSync(src, 'utf8').replace(/__JEAN_ROOT__/g, root));
      installed.push('/' + name);
    }
    report.push(`${C.green('✓')} Claude skills  ${installed.join(', ')}  → ~/.claude/skills/`);
    // 3. Global CLAUDE.md pointer
    const globalMd = path.join(home, '.claude/CLAUDE.md');
    const pointer = `\n## Jean Clawd — the planner\nThe user plans through Jean Clawd. When they talk about tasks, what to do today/this week/month, deadlines, priorities or projects, use the \`jean\` CLI (\`jean today\`, \`jean add "…" -P project -d date\`, \`jean done <id>\`, \`jean stats\`, \`jean init\` in a project folder; \`--json\` for structured output; \`jean --help\`). Guide: ${root}/CLAUDE.md\nIf \`jean\` is not on PATH: node "${root}/cli/jean.js" …\n`;
    fs.mkdirSync(path.dirname(globalMd), { recursive: true });
    if (!fs.existsSync(globalMd) || !fs.readFileSync(globalMd, 'utf8').includes('Jean Clawd')) fs.appendFileSync(globalMd, pointer);
    report.push(`${C.green('✓')} Global notes   ${globalMd}`);
    // 4. MCP server for Claude Code / Claude Desktop / other agents
    if (!flags['no-mcp']) {
      const mcpPath = path.join(root, 'mcp/server.js');
      const { execFileSync } = require('child_process');
      let registered = false;
      try {
        execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'jean'], { stdio: 'ignore' });
      } catch {}
      try {
        execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'jean', '--', process.execPath, mcpPath], { stdio: 'ignore' });
        registered = true;
      } catch {}
      report.push(registered
        ? `${C.green('✓')} MCP server     registered with Claude Code (user scope) as "jean"`
        : `${C.yellow('·')} MCP server     add manually:  claude mcp add --scope user jean -- ${process.execPath} ${mcpPath}`);
      const desktopCfg = path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
      if (fs.existsSync(desktopCfg) && !flags['no-desktop']) {
        try {
          const cfg = JSON.parse(fs.readFileSync(desktopCfg, 'utf8'));
          cfg.mcpServers = cfg.mcpServers || {};
          cfg.mcpServers.jean = { command: process.execPath, args: [mcpPath] };
          fs.writeFileSync(desktopCfg, JSON.stringify(cfg, null, 2));
          report.push(`${C.green('✓')} Claude Desktop ${desktopCfg} (restart Claude Desktop)`);
        } catch { report.push(`${C.yellow('·')} Claude Desktop could not edit ${desktopCfg}`); }
      }
    }
    // 5. Claude Code hooks: every session checks in as an agent, gets its briefing, and sees new messages
    const settingsPath = path.join(home, '.claude/settings.json');
    if (flags.hooks) {
      const cmd = `node "${path.join(root, 'cli/jean.js')}" hook`;
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`could not parse ${settingsPath}: ${e.message}`); }
      cfg.hooks = cfg.hooks || {};
      for (const ev of ['SessionStart', 'UserPromptSubmit', 'SessionEnd']) {
        const groups = cfg.hooks[ev] = cfg.hooks[ev] || [];
        if (!groups.some(g => (g.hooks || []).some(h => String(h.command || '').includes('jean.js" hook')))) groups.push({ hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
      }
      if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.bak-jean');
      fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + '\n');
      report.push(`${C.green('✓')} Claude hooks   SessionStart / UserPromptSubmit / SessionEnd → ${settingsPath} (backup: settings.json.bak-jean)`);
    } else report.push(`${C.dim('·')} Claude hooks   not installed — jean setup --hooks makes every Claude session a Jean agent automatically`);
    out({ ok: true, report }, `${C.orange(C.bold('Jean Clawd setup'))}\n${report.join('\n')}\n\nEvery Claude / agent on this Mac can now plan with you. Try: ${C.bold('jean today')}`);
  },
  async mcp() { require('../mcp/server.js'); },
  async stats() {
    const date = store.resolveDate(positional[0] || flags.date);
    const s = await run(() => api('GET', `/api/stats?date=${date}`), st => store.stats(st, date));
    const bar = pct => { const n = Math.round(pct / 10); return C.orange('█'.repeat(n)) + C.dim('░'.repeat(10 - n)); };
    const lines = [
      C.orange(C.bold('Productivity')),
      `  today   ${s.today.done}/${s.today.total}${s.today.overdue ? C.red(`  (${s.today.overdue} overdue)`) : ''}`,
      `  week    ${bar(s.week.pct)} ${s.week.pct}%  ${s.week.done}/${s.week.total}`,
      `  month   ${bar(s.month.pct)} ${s.month.pct}%  ${s.month.done}/${s.month.total}`,
      `  streak  ${s.streak} day${s.streak === 1 ? '' : 's'}   all-time done ${s.doneAllTime}`,
      C.bold('  per project (this week)'),
      ...s.perProject.map(c => `    ${c.emoji} ${c.name.padEnd(22)} ${c.doneWeek}/${c.totalWeek}  open ${c.open}${c.overdue ? C.red(` overdue ${c.overdue}`) : ''}`),
    ];
    out(s, lines.join('\n'));
  },
  // ---------- playbook: stack + skills ----------
  /** The owner's default tool per area. jean stack · jean stack set database Supabase -n "…" · jean stack rm database */
  async stack() {
    const sub = positional.shift();
    if (sub === 'set' || sub === 'add') {
      const area = positional.shift(); const choice = positional.join(' ').trim();
      if (!area || !choice) throw new Error('usage: jean stack set <area> "<choice>" [-n notes] [--dept tech|marketing|…]   e.g. jean stack set deploy "Google Cloud Run" -n "europe-west4"');
      const body = { area, choice, notes: flags.notes, dept: flags.dept, by: agentName() };
      const e = await run(() => api('PUT', `/api/stack/${encodeURIComponent(area)}`, body), st => store.setStack(st, body));
      return out(e, `${C.green('stack')} ${e.area} → ${C.bold(e.choice)}${e.notes ? C.dim(`  ${e.notes}`) : ''}`);
    }
    if (sub === 'rm') {
      const area = positional.shift(); if (!area) throw new Error('usage: jean stack rm <area>');
      const e = await run(() => api('DELETE', `/api/stack/${encodeURIComponent(area)}`), st => store.deleteStack(st, area));
      return out(e, `${C.red('removed')} ${e.area}`);
    }
    const list = await run(() => api('GET', '/api/stack'), st => st.stack);
    out(list, list.length ? `${C.orange(C.bold('Stack'))} ${C.dim('— the defaults every agent uses unless told otherwise')}\n` + list.map(e => `  ${e.area.padEnd(14)} ${C.bold(e.choice)}${e.notes ? C.dim(`  ${e.notes}`) : ''}${e.dept ? C.dim(`  [${e.dept}]`) : ''}`).join('\n')
      : C.dim('  no stack yet — jean stack set database Supabase'));
  },
  async skills() {
    const q = { dept: flags.dept, tool: flags.tool, search: positional.join(' ') || undefined };
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const list = await run(() => api('GET', `/api/skills?${qs}`), st => store.filterSkills(st, q));
    let dept = '';
    out(list, list.length ? list.map(k => `${k.dept !== dept ? `${C.orange(C.bold((dept = k.dept).toUpperCase()))}\n` : ''}  ${C.dim(k.id.slice(2))}  ${C.bold(k.name)}${k.summary ? C.dim(` — ${k.summary}`) : ''}${k.tools.length ? C.dim(`  [${k.tools.join(', ')}]`) : ''}`).join('\n')
      : C.dim('  no skills yet — learned something reusable? jean learn "How to …" --dept marketing --summary "…" --stdin'));
  },
  async learn() { positional.unshift('add'); return commands.skill(); },
  /** jean skill add|show|edit|install|rm */
  async skill() {
    const sub = positional.shift() || 'list';
    if (sub === 'list') return commands.skills();
    if (sub === 'add' || sub === 'edit') {
      const ref = sub === 'edit' ? positional.shift() : null;
      let name = sub === 'add' ? positional.join(' ').trim() : null;
      if (sub === 'edit') { const k = store.findSkill(store.load(), ref); if (!k) throw new Error(`no skill "${ref}"`); name = k.name; }
      if (!name) throw new Error('usage: jean skill add "Generate images with Gemini" --dept marketing --summary "one line" [--tool gemini] [--install "setup steps"] [--stdin | --body "steps" | --file steps.md]');
      const body = flags.stdin ? readStdin() : flags.file ? fs.readFileSync(String(flags.file), 'utf8') : flags.body;
      const input = { name, dept: flags.dept, summary: flags.summary, body, install: flags.install, tools: flags.tool || flags.tools, projects: flags.project ? list_(flags.project) : undefined, by: agentName() };
      const k = await run(() => api('POST', '/api/skills', input), st => store.addSkill(st, input));
      return out(k, `${C.green(sub === 'add' ? 'learned' : 'updated')} ${C.bold(k.name)} ${C.dim(`(${k.dept} · ${k.id.slice(2)})`)}\n  ${C.dim('any agent can now read it with')} jean skill show ${k.id.slice(2)} ${C.dim('· add it to Claude Code with')} jean skill install ${k.id.slice(2)}`);
    }
    const ref = positional.shift();
    if (!ref) throw new Error(`usage: jean skill ${sub} <id or name>`);
    const k = await run(() => api('GET', `/api/skills/${encodeURIComponent(store.findSkill(store.load(), ref)?.id || ref)}`), st => { const x = store.findSkill(st, ref); if (!x) throw new Error(`no skill "${ref}"`); return { ...x, markdown: store.skillMarkdown(st, x) }; });
    if (sub === 'show') {
      const guide = `\n${C.bold('Add it to Claude Code')}\n  jean skill install ${k.id.slice(2)}            ${C.dim('→ ~/.claude/skills/' + k.slug + '/SKILL.md (every session)')}\n  jean skill install ${k.id.slice(2)} --project  ${C.dim('→ ./.claude/skills/' + k.slug + '/SKILL.md (this repo only)')}${k.install ? `\n  ${C.dim('then the setup:')} ${k.install}` : ''}`;
      return out(k, `${C.orange(C.bold(k.name))} ${C.dim(`· ${k.dept}${k.tools.length ? ' · ' + k.tools.join(', ') : ''}${k.author ? ' · by ' + k.author : ''}`)}\n${k.summary ? k.summary + '\n' : ''}\n${k.body || C.dim('(no steps written yet)')}${k.install ? `\n\n${C.bold('Setup')}\n${k.install}` : ''}\n${guide}`);
    }
    if (sub === 'install') {
      const base = flags.project ? path.join(process.cwd(), '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills');
      const dir = path.join(base, k.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), k.markdown);
      return out({ installed: path.join(dir, 'SKILL.md'), skill: k.id }, `${C.green('installed')} ${k.name} → ${path.join(dir, 'SKILL.md')}\n  ${C.dim('Claude Code picks it up in new sessions (/' + k.slug + ')')}${k.install ? `\n  ${C.yellow('setup still needed:')} ${k.install}` : ''}`);
    }
    if (sub === 'rm') {
      const r = await run(() => api('DELETE', `/api/skills/${k.id}`), st => store.deleteSkill(st, k.id));
      return out(r, `${C.red('forgot')} ${r.name}`);
    }
    throw new Error('usage: jean skill add|show|edit|install|rm …');
  },
  /** The machine: jean system [pause --yes] — dev servers, CPU / memory / GPU, Docker */
  async system() {
    const sys = require('../lib/system'); sys.protectPort(port());
    if (positional[0] === 'pause') {
      if (!flags.yes) { const s = await sys.snapshot(store.load().projects); return out({ dryRun: true, servers: s.servers, containers: s.docker.containers.filter(c => c.state === 'running').map(c => c.name) }, `${C.yellow('this stops')} ${s.servers.length} dev server${s.servers.length === 1 ? '' : 's'} (${s.servers.map(x => x.command + ' :' + x.ports[0]).join(', ') || 'none'}) ${C.yellow('and pauses')} ${s.docker.containers.filter(c => c.state === 'running').length} containers. Run again with --yes.`); }
      const r = await sys.pauseAll();
      return out(r, `${C.green('paused development')}: ${r.stopped.length} server${r.stopped.length === 1 ? '' : 's'} stopped, ${r.paused.length} container${r.paused.length === 1 ? '' : 's'} paused ${C.dim('(jean docker unpause-all to resume)')}`);
    }
    const s = await sys.snapshot(store.load().projects);
    const bar = pct => { const n = Math.round((pct || 0) / 10); return (pct >= 85 ? C.red : pct >= 65 ? C.yellow : C.green)('█'.repeat(n)) + C.dim('░'.repeat(10 - n)); };
    const running = s.docker.containers.filter(c => c.state === 'running'), paused = s.docker.containers.filter(c => c.state === 'paused');
    out(s, [
      `${C.orange(C.bold(`Machine · ${s.host}`))}  ${s.busy ? C.red('busy: ' + s.hot.join(', ')) : C.green('fine')}`,
      `  CPU     ${bar(s.cpu)} ${s.cpu}%  ${C.dim(`load ${s.load} on ${s.cores} cores`)}`,
      `  memory  ${bar(s.mem)} ${s.mem}%  ${C.dim(`of ${s.memTotalGB} GB`)}`,
      s.gpu ? `  GPU     ${bar(s.gpu.util)} ${s.gpu.util}%  ${C.dim(s.gpu.name)}` : `  GPU     ${C.dim('not visible')}`,
      C.bold(`  dev servers (${s.servers.length})`) + C.dim('  stop one: jean stop <port>'),
      ...s.servers.map(x => `    :${String(x.ports[0]).padEnd(6)} ${x.command.padEnd(12)} ${x.project ? C.bold(x.project) : C.dim(x.cwd.replace(os.homedir(), '~') || '')}${x.ports.length > 1 ? C.dim(`  +${x.ports.slice(1).join(', ')}`) : ''}`),
      C.bold(`  docker`) + (s.docker.available ? `  ${running.length} running · ${paused.length} paused · ${s.docker.containers.length} total` + C.dim('  jean docker pause|stop <name> · pause-all · stop-all') : C.dim('  not running')),
      ...running.slice(0, 12).map(c => `    ${c.name.padEnd(34)} ${C.dim(`${c.cpu != null ? c.cpu + '% cpu' : ''}  ${c.image}`)}`),
      running.length > 12 ? C.dim(`    +${running.length - 12} more`) : '',
      C.dim(`  top: ${s.top.slice(0, 4).map(p => `${p.command} ${p.cpu}%`).join(' · ')}`),
    ].filter(Boolean).join('\n'));
  },
  async stop() {
    const ref = positional[0]; if (!ref) throw new Error('usage: jean stop <port|pid>   — stops a dev server (never Jean, never system apps)');
    const sys = require('../lib/system'); sys.protectPort(port());
    const r = await sys.stopServer(ref);
    out(r, `${C.green('stopped')} ${r.command} :${r.ports.join(', :')} ${C.dim(`(pid ${r.stopped})`)}`);
  },
  async docker() {
    const sys = require('../lib/system');
    const action = positional[0] || 'ps';
    if (action === 'ps') return commands.system();
    const r = await sys.dockerAction(action, positional[1]);
    out(r, r.containers.length ? `${C.green(r.action)} ${r.containers.join(', ')}` : C.dim(`  nothing to ${r.action}`));
  },
  /** Hire a specialist (a Claude skill pack) into the crew: jean hire · jean hire <id> [--no-install] */
  async hire() {
    const id = positional[0];
    const list = await run(() => api('GET', '/api/catalog'), st => require('../lib/catalog').CATALOG.map(c => ({ ...c, hired: !!st.agents.find(a => a.name === c.name && a.specialist) })));
    if (!id) return out(list, `${C.orange(C.bold('Specialists you can hire'))} ${C.dim('— Claude skills that join the crew as on-call agents')}\n` +
      list.map(c => `  ${c.hired ? C.green('✓') : ' '} ${C.bold(c.id.padEnd(11))} ${c.title.padEnd(22)} ${C.dim(c.floor.padEnd(11))} ${C.dim(c.skills.map(k => k.name).join(', '))}`).join('\n') + `\n  ${C.dim('jean hire <id>  ·  then any Claude session can be it: jean become <name>')}`);
    const c = list.find(x => x.id === id || x.name === id);
    if (!c) throw new Error(`no specialist "${id}" — jean hire`);
    const r = await run(() => api('POST', '/api/crew/hire', { id: c.id, by: agentName(), install: false }), st => { const x = store.hireSpecialist(st, c.id, agentName()); return { agent: x.agent.name, already: x.already }; });
    let installed = 'skipped';
    if (!flags['no-install']) {
      const { execFileSync } = require('child_process');
      try { execFileSync('/bin/zsh', ['-lc', `claude plugin marketplace add ${c.install.marketplace} >/dev/null 2>&1; claude plugin install ${c.install.plugin} --scope user`], { stdio: 'ignore', timeout: 180000 }); installed = 'installed'; }
      catch (e) { installed = `failed — install by hand: claude plugin marketplace add ${c.install.marketplace} && claude plugin install ${c.install.plugin}`; }
    }
    out({ ...r, installed }, `${r.already ? C.dim('already in the crew:') : C.green('hired')} ${C.bold(r.agent)} ${C.dim(`(${c.title}, ${c.floor})`)}\n  skills  ${c.skills.map(k => k.name).join(', ')}\n  claude  ${installed === 'installed' ? C.green('plugin installed') : installed}\n  ${C.dim('a Claude session takes it on with:')} jean become ${r.agent}`);
  },
  /** Take on an agent's identity for this session (a hired specialist, or any agent name). */
  async become() {
    const name = positional[0];
    if (!name) throw new Error('usage: jean become <agent name>   — e.g. jean become docs-specialist');
    const sid = process.env.CLAUDE_CODE_SESSION_ID || process.env.JEAN_SESSION_ID;
    if (sid) {
      const file = path.join(store.DATA_DIR, 'sessions.json');
      let map = {}; try { map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      map[sid] = { name, at: Date.now(), saved: true };
      fs.mkdirSync(store.DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(map, null, 1));
    }
    agentNameCache = name; flags.as = name;
    await commands.hello();
    if (!sid) console.log(C.yellow(`\nthis shell has no session id: run later commands with JEAN_AGENT=${name} (or --as ${name})`));
  },
  /** Cloud mode. jean cloud [status] | connect <url> --token T | off | token | push | link | agent-env */
  async cloud() {
    const sub = positional.shift() || 'status';
    const file = path.join(store.DATA_DIR, 'config.json');
    const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
    const write = c => { fs.mkdirSync(store.DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 }); fs.chmodSync(file, 0o600); };
    if (sub === 'token') { const t = require('crypto').randomBytes(24).toString('base64url'); return out({ token: t }, `${t}\n${C.dim('  use it as JEAN_TOKEN on the server, then: jean cloud connect <url> --token <it>')}`); }
    if (sub === 'connect') {
      const url = (positional[0] || '').replace(/\/$/, ''); const token = flags.token;
      if (!/^https?:\/\//.test(url) || !token || token === true) throw new Error('usage: jean cloud connect https://your-jean.example.com --token <token>');
      const probe = await new Promise(resolve => {
        const u = new URL(url + '/api/agents'), lib = u.protocol === 'https:' ? require('https') : http;
        const r = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'GET', timeout: 8000, headers: { Authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); });
        r.on('error', e => resolve(e.message)); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end();
      });
      if (probe !== 200) throw new Error(`could not use ${url}: ${probe === 401 ? 'wrong token' : probe}`);
      write({ ...read(), mode: 'cloud', url, token });
      return out({ mode: 'cloud', url }, `${C.green('☁ cloud mode')} ${url}\n  ${C.dim('the CLI, Jean tools (MCP) and hooks on this machine now use it. Copy your local plan up once with:')} jean cloud push`);
    }
    if (sub === 'off' || sub === 'local') { const c = read(); c.mode = 'local'; write(c); return out({ mode: 'local' }, `${C.green('local mode')} ${C.dim('— back to ~/.jean/jean.json and http://localhost:' + port())}`); }
    if (!CLOUD && sub !== 'status') throw new Error('not in cloud mode — jean cloud connect <url> --token <token>');
    if (sub === 'push') {
      const local = JSON.parse(fs.readFileSync(store.DATA_FILE, 'utf8'));
      if (!flags.yes) return out({ dryRun: true }, `${C.yellow('this replaces everything on')} ${CLOUD.url} ${C.yellow('with your local plan')} (${local.tasks.length} tasks, ${local.projects.length} projects, ${(local.agents || []).length} agents).\n  run again with --yes to do it`);
      await api('POST', '/api/import', local, 30000);
      return out({ pushed: true }, `${C.green('pushed')} your local plan to ${CLOUD.url}`);
    }
    if (sub === 'link') return out({ url: `${CLOUD.url}/?token=${CLOUD.token}` }, `${CLOUD.url}/?token=${CLOUD.token}\n${C.dim('  open once in your browser to log in (keep it private: it holds your token)')}`);
    if (sub === 'agent-env') return out({ JEAN_URL: CLOUD.url, JEAN_TOKEN: CLOUD.token }, `JEAN_URL=${CLOUD.url}\nJEAN_TOKEN=${CLOUD.token}\n${C.dim('  put these in a cloud agent environment (e.g. Claude Code cloud sessions) so it joins this crew. Then: jean prompt <name>')}`);
    let health = null; try { health = await api('GET', '/api/health'); } catch {}
    out({ mode: CLOUD ? 'cloud' : 'local', url: CLOUD ? CLOUD.url : `http://localhost:${port()}`, reachable: !!health },
      CLOUD ? `  mode    ${C.green('☁ cloud')}\n  server  ${CLOUD.url} ${health ? C.green('reachable') : C.red('unreachable')}\n  ${C.dim('jean cloud push · jean cloud link · jean cloud agent-env · jean cloud off')}`
        : `  mode    local\n  server  http://localhost:${port()} ${health ? C.green('running') : C.dim('stopped (CLI edits the file)')}\n  ${C.dim('go cloud: host Jean (docs/CLOUD.md), then jean cloud connect <url> --token <token>')}`);
  },
  /** jean plugins [list] | enable <name> | disable <name> | new <name> | dirs */
  async plugins() {
    const kit = require('../lib/plugins');
    const sub = positional.shift() || 'list';
    const settings = (() => { try { return store.load().settings; } catch { return {}; } })();
    if (sub === 'new') { const name = positional[0]; if (!name) throw new Error('usage: jean plugins new <name>'); const dir = kit.scaffold(name); return out({ dir }, `${C.green('created')} ${dir}\n  ${C.dim('edit index.js / dojo.js, then try:')} jean ${name}\n  ${C.dim('docs: docs/PLUGINS.md')}`); }
    if (sub === 'dirs') return out(kit.dirs(), kit.dirs().map(d => '  ' + d).join('\n'));
    if (sub === 'enable' || sub === 'disable') {
      const name = positional[0]; if (!name) throw new Error(`usage: jean plugins ${sub} <name>`);
      if (!kit.discover(settings).some(p => p.name === name)) throw new Error(`no plugin "${name}" — jean plugins`);
      const map = { ...(settings.plugins || {}) }; if (sub === 'enable') delete map[name]; else map[name] = false;
      await run(() => api('PATCH', '/api/settings', { plugins: map }), st => { st.settings.plugins = map; });
      return out({ name, enabled: sub === 'enable' }, `${sub === 'enable' ? C.green('enabled') : C.yellow('disabled')} ${name} ${C.dim('(restart the server to apply: jean serve)')}`);
    }
    const reg = kit.load('cli', settings);
    out(reg.plugins.map(p => ({ name: p.name, version: p.version, source: p.source, enabled: p.enabled, error: p.error })),
      reg.plugins.length ? reg.plugins.map(p => `  ${p.error ? C.red('✗') : p.enabled ? C.green('●') : C.dim('○')} ${C.bold(p.name.padEnd(18))} ${C.dim((p.version || '') + ' · ' + (p.source || '?'))}  ${p.error ? C.red(p.error) : p.description || ''}`).join('\n') + `\n${C.dim('  new one: jean plugins new <name> · docs/PLUGINS.md')}`
        : C.dim('  no plugins — make one: jean plugins new my-plugin'));
  },
  /** Preferences (the web app only shows them; agents change them). */
  async settings() {
    const KEYS = { ownerName: 'string', theme: ['system', 'dark', 'light'], weekStart: [0, 1], defaultView: ['today', 'week', 'month'],
      showDone: 'bool', petQuips: 'bool', defaultProject: 'project', port: 'number' };
    const [key, ...rest] = positional;
    if (!key) {
      const st = await run(() => api('GET', '/api/settings'), x => x.settings);
      return out(st, Object.entries(KEYS).map(([k]) => `  ${k.padEnd(15)} ${C.bold(String(st[k] ?? ''))}`).join('\n') + `\n${C.dim('  change: jean settings <key> <value>')}`);
    }
    if (!(key in KEYS)) throw new Error(`unknown setting "${key}" — one of ${Object.keys(KEYS).join(', ')}`);
    const raw = rest.join(' ').trim();
    if (!raw) throw new Error(`usage: jean settings ${key} <value>`);
    const kind = KEYS[key];
    let v = raw;
    if (kind === 'bool') v = /^(1|true|on|yes)$/i.test(raw);
    else if (kind === 'number') v = Number(raw);
    else if (Array.isArray(kind)) {
      if (key === 'weekStart') v = /^(0|sun)/i.test(raw) ? 0 : 1;
      if (!kind.includes(v)) throw new Error(`${key} must be one of ${kind.join(', ')}`);
    } else if (kind === 'project') {
      if (/^(none|-)$/i.test(raw)) v = null;
      else { const p = store.findProject(store.load(), raw); if (!p) throw new Error(`no project "${raw}"`); v = p.id; }
    }
    const patch = { [key]: v };
    const r = await run(() => api('PATCH', '/api/settings', patch), x => Object.assign(x.settings, patch));
    out(r, `${C.green('set')} ${key} = ${v}`);
  },
  async journal() {
    const date = store.resolveDate(flags.date);
    const text = positional.join(' ');
    if (text) {
      await run(() => api('PUT', `/api/journal/${date}`, { text }), s => { s.journal[date] = text; });
      return out({ date, text }, `${C.green('journal saved')} for ${date}`);
    }
    const r = await run(() => api('GET', `/api/journal/${date}`), s => ({ date, text: s.journal[date] || '' }));
    out(r, r.text || C.dim('  (empty) — jean journal "what happened today"'));
  },
  async say() {
    const text = positional.join(' ');
    if (!text) throw new Error('usage: jean say "message for Jean-Claude to speak" [--anim splits|dance|…]');
    let r;
    try { r = await api('POST', '/api/jc/say', { text, seconds: Number(flags.seconds) || 8, anim: flags.anim }); }
    catch (e) { if (e.http) throw e; throw new Error('server not running — start with: jean serve'); }
    out(r, r.online ? C.green('Jean-Claude will say it.') : C.yellow('queued — the Jean Clawd desktop app is not running right now.'));
  },
  async stunt() {
    const name = positional[0] || 'random';
    if (name === 'list') { const l = await api('GET', '/api/jc/stunts'); return out(l, l.join('\n')); }
    let r;
    try { r = await api('POST', '/api/jc/stunt', { name }); }
    catch (e) { if (e.http) throw e; throw new Error('server not running — start with: jean serve'); }
    out(r, r.online ? C.green(`Jean-Claude does: ${name}`) : C.yellow('queued — the Jean Clawd desktop app is not running right now.'));
  },
  async serve() {
    const p = path.join(__dirname, '..', 'server', 'server.js');
    if (flags.bg || flags.background) {
      const child = spawn(process.execPath, [p], { detached: true, stdio: 'ignore' });
      child.unref();
      console.log(`started in background (pid ${child.pid}) → http://localhost:${port()}`);
    } else {
      spawn(process.execPath, [p], { stdio: 'inherit' });
    }
  },
  async open() {
    try { await api('GET', '/api/health'); } catch { await commands.serve.call(null); await new Promise(r => setTimeout(r, 600)); }
    execFile('open', [`http://localhost:${port()}`]);
  },
  async status() {
    let health = null;
    try { health = await api('GET', '/api/health'); } catch {}
    let pet = null;
    try { pet = await api('GET', '/api/jc/status'); } catch {}
    const o = { server: !!health, url: `http://localhost:${port()}`, dataFile: store.DATA_FILE, jeanClaudeOnline: !!(pet && pet.online) };
    out(o, `  server       ${health ? C.green('running') : C.red('stopped')}  ${o.url}\n  jean-claude  ${o.jeanClaudeOnline ? C.green('on screen') : C.dim('not running')}\n  data         ${o.dataFile}`);
  },
  async export() { console.log(JSON.stringify(store.load(), null, 2)); },
  async help() {
    let extra = '';
    try { const reg = require('../lib/plugins').load('cli', store.load().settings); if (reg.commands.size) extra = '\n\n plugins\n' + [...reg.commands].map(([n, d]) => `  ${(d.usage || 'jean ' + n).padEnd(30)} ${d.describe || ''}  ${C.dim('[' + d.plugin + ']')}`).join('\n'); } catch {}
    console.log(HELP + extra);
  },
};

async function mark(status, ids) {
  if (!ids.length) throw new Error(`usage: jean ${status === 'done' ? 'done' : status === 'todo' ? 'undo' : 'start'} <id> [id...]`);
  const results = [];
  for (const id of ids) {
    const patch = { status, by: agentName() };
    const t = await run(() => api('PATCH', `/api/tasks/${resolveId(id)}`, patch), s => store.updateTask(s, id, patch));
    results.push(t);
  }
  const verb = { done: C.green('done ✓'), todo: C.yellow('reopened'), doing: C.yellow('in progress') }[status];
  out(results, results.map(t => `${verb}  ${t.title}`).join('\n'));
}

/** Facts about a folder so a project can be filled in without reading the whole repo. */
function inspectDir(dir) {
  const facts = { dir, name: path.basename(dir), remote: '', readme: { title: '', summary: '' }, pkg: null, language: '', hints: [] };
  try { facts.remote = store.normalizeRepo(require('child_process').execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch {}
  try { facts.branch = require('child_process').execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const readmeName = fs.readdirSync(dir).find(f => /^readme(\.md|\.txt)?$/i.test(f));
  if (readmeName) {
    const lines = fs.readFileSync(path.join(dir, readmeName), 'utf8').split('\n');
    const h = lines.find(l => /^#\s+/.test(l)); if (h) facts.readme.title = h.replace(/^#\s+/, '').replace(/[*_`]/g, '').trim();
    let para = [];
    for (const l of lines) {
      if (/^#/.test(l) || /^\s*[!\[<]/.test(l) || /^\s*[-*]\s/.test(l)) { if (para.length) break; continue; }
      if (!l.trim()) { if (para.length) break; continue; }
      para.push(l.trim());
    }
    facts.readme.summary = para.join(' ').replace(/[*_`]/g, '').slice(0, 200);
  }
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) { try { const pk = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); facts.pkg = { name: pk.name, description: pk.description, deps: Object.keys(pk.dependencies || {}).slice(0, 12) }; } catch {} }
  const has = f => fs.existsSync(path.join(dir, f));
  const files = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
  if (has('Package.swift') || files.some(f => f.endsWith('.xcodeproj'))) { facts.language = 'swift'; facts.hints.push('macOS/iOS app'); }
  else if (has('Cargo.toml')) facts.language = 'rust';
  else if (has('go.mod')) facts.language = 'go';
  else if (has('pyproject.toml') || has('requirements.txt')) facts.language = 'python';
  else if (has('Anchor.toml') || has('hardhat.config.js') || has('foundry.toml')) { facts.language = 'solidity'; facts.hints.push('smart contracts'); }
  else if (facts.pkg) { facts.language = 'javascript'; const d = facts.pkg.deps; if (d.includes('next')) facts.hints.push('Next.js site'); else if (d.includes('react')) facts.hints.push('React app'); else if (d.includes('express')) facts.hints.push('Node server'); if (d.includes('telegraf') || d.includes('grammy') || d.includes('node-telegram-bot-api')) facts.hints.push('Telegram bot'); }
  facts.suggested = {
    name: (facts.readme.title && facts.readme.title.length < 40 ? facts.readme.title : (facts.pkg && facts.pkg.name) || facts.name)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim() || facts.name,
    description: (facts.pkg && facts.pkg.description) || facts.readme.summary || '',
    emoji: { swift: '🍎', rust: '🦀', go: '🐹', python: '🐍', solidity: '⛓️', javascript: facts.hints.includes('Telegram bot') ? '🤖' : facts.hints.includes('Next.js site') ? '🌐' : '📦' }[facts.language] || '📁',
    repo: facts.remote,
  };
  return facts;
}

/** git branch, HEAD and locally-changed files — the "where was I" part of a handoff. */
function gitFacts(dir) {
  const git = args => { try { return require('child_process').execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain']).split('\n').filter(Boolean).map(l => l.slice(3)).slice(0, 20),
  };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8').trim(); } catch { return ''; }
}

/** Is this command being run by an agent (Claude Code, a hook, the MCP server) rather than the owner at a terminal? */
function isAgentProcess() {
  return !!(process.env.JEAN_AGENT || process.env.CLAUDE_AGENT_NAME || process.env.CLAUDECODE || process.env.JEAN_HOOK || process.env.JEAN_IS_AGENT
    || process.env.JEAN_AGENT_FAMILY || agentFamily() !== 'agent');
}
/** Which tool this agent runs in: set by the MCP server from the handshake, or sniffed from the shell. */
function agentFamily() {
  const e = process.env;
  if (e.JEAN_AGENT_FAMILY) return e.JEAN_AGENT_FAMILY;
  if (e.CLAUDECODE || e.CLAUDE_CODE_SESSION_ID || e.JEAN_HOOK) return 'claude';
  if (Object.keys(e).some(k => k.startsWith('CODEX_'))) return 'codex';
  if (e.GEMINI_CLI) return 'gemini';
  return 'agent';
}

/**
 * Who is running this command. --as wins, then JEAN_AGENT. A Claude session gets a stable
 * name from its tool and project folder (claude-kiteshop, codex-kiteshop); a second live session
 * in the same folder becomes claude-kiteshop-2. A human at the terminal is the owner.
 */
let agentNameCache = null;
function agentName() {
  if (agentNameCache) return agentNameCache;
  const clean = n => String(n).trim().replace(/^@/, '').replace(/\s+/g, '-');
  if (flags.as && flags.as !== true) return (agentNameCache = clean(flags.as));
  if (process.env.JEAN_AGENT || process.env.CLAUDE_AGENT_NAME) return (agentNameCache = clean(process.env.JEAN_AGENT || process.env.CLAUDE_AGENT_NAME));
  let state; try { state = store.load(); } catch { state = null; }
  if (!isAgentProcess()) return (agentNameCache = state ? store.ownerKey(state) : 'owner');
  const ctx = projectContext();
  const p = ctx && state ? state.projects.find(x => x.id === ctx.id) : null;
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'agent';
  const fam = agentFamily() === 'agent' ? 'claude' : agentFamily();
  const base = `${fam}-${slug(p ? p.name : path.basename(process.cwd())).replace(new RegExp(`^${fam}-`), '')}`;
  const sid = process.env.CLAUDE_CODE_SESSION_ID || process.env.JEAN_SESSION_ID || hookInput.session_id;
  if (!sid) return (agentNameCache = base);
  // Remember which name each Claude session got, so it keeps it for the whole session.
  const file = path.join(store.DATA_DIR, 'sessions.json');
  let map = {}; try { map = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const now = Date.now(), LIVE = 6 * 3600e3;
  let entry = map[sid];
  if (!entry) {
    const taken = new Set(Object.entries(map).filter(([k, v]) => k !== sid && now - v.at < LIVE).map(([, v]) => v.name));
    let name = base, i = 2; while (taken.has(name)) name = `${base}-${i++}`;
    entry = map[sid] = { name, at: now };
  }
  if (now - entry.at > 5 * 60e3 || !entry.saved) {
    entry.at = now; entry.saved = true;
    for (const k in map) if (now - map[k].at > 7 * 864e5) delete map[k];
    try { fs.mkdirSync(store.DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(map, null, 1)); } catch {}
  }
  return (agentNameCache = entry.name);
}
let hookInput = {};

/** Walk up from cwd looking for a `.jean` marker written by `jean init`. */
function projectContext() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const marker = path.join(dir, '.jean');
    if (fs.existsSync(marker)) {
      try { const j = JSON.parse(fs.readFileSync(marker, 'utf8')); return { id: j.project, dir }; } catch { return null; }
    }
    const up = path.dirname(dir); if (up === dir) break; dir = up;
  }
  return null;
}

function resolveHandoffId(ref) {
  try { const h = store.findHandoff(store.load(), ref); if (h) return h.id; } catch {}
  return ref;
}

/** The handoff this instance is currently on: newest one it has claimed. */
async function currentHandoffId() {
  try {
    const mine = store.load().handoffs.filter(h => h.status === 'claimed' && h.claimedBy === agentName());
    return mine.length ? mine[mine.length - 1].id : null;
  } catch { return null; }
}

function protocolPrompt(name, base, cloud = false) {
  return `## Jean Clawd vd Dam — you are agent "${name}"
A shared planner + message bus for the owner's AI agents. JSON over HTTP at ${base}${cloud ? ' (send Authorization: Bearer $JEAN_TOKEN on every call)' : ' (localhost, no auth)'}.
Every call carries your name: "agent" in the body, or an X-Jean-Agent header.

1. Check in:      POST ${base}/v1/hello  {"agent":"${name}","role":"<what you are for, one line>"}
                  → read "briefing": your tasks, unread messages, and what every other agent is doing.
2. Say what you're on (whenever you switch):  POST ${base}/v1/doing {"agent":"${name}","text":"…","task":"<task id, optional>"}
3. Talk:          POST ${base}/v1/send {"agent":"${name}","to":"<agent | #project | all | owner>","text":"…","replyTo":"<message id, optional>"}
4. Listen:        GET  ${base}/v1/inbox/${name}?wait=30     (long-poll: returns as soon as something arrives)
5. Your tasks:    GET  ${base}/v1/tasks?agent=${name}        finish one: POST ${base}/v1/done {"agent":"${name}","task":"<id>"}
6. The crew:      GET  ${base}/v1/agents                     leaving: POST ${base}/v1/bye {"agent":"${name}"}

Rules: check in first. Don't redo work another agent is doing — ask it. Reply to messages addressed to you
(use replyTo). Tell the crew when you start and finish. The owner reads everything in the web app at ${base}.
Speaks A2A too: agent card at ${base}/.well-known/agent-card.json, per agent at ${base}/a2a/<name>.
With a shell and node, the jean CLI does the same: JEAN_AGENT=${name} jean hello | doing | send | ask | inbox | reply | done.
e.g. curl -s ${base}/v1/send -H 'Content-Type: application/json'${cloud ? ' -H "Authorization: Bearer $JEAN_TOKEN"' : ''} -d '{"agent":"${name}","to":"all","text":"hello crew"}'`;
}

/** The short "how to use Jean" note other tools read as global/project instructions. */
function agentNote(root) {
  return `## Jean Clawd: the planner + agent switchboard
The owner plans and coordinates all of his AI agents (Claude Code, Codex, Cursor, Gemini, …) through Jean.
Use the \`jean\` MCP tools (or the CLI: \`node "${root}/cli/jean.js" …\`):
- Start of a session: jean_hello with your role → your briefing: your tasks, messages, the owner's stack, skills, and what every other agent is doing.
- Before choosing a tool: jean_stack (the owner's defaults, e.g. database → Supabase) and jean_skills (how-tos the crew learned).
- Say what you are on (jean_doing), talk to other agents (jean_send / jean_ask / jean_reply / jean_inbox), close work (jean_done).
- Learned something reusable? jean_learn it. Running out of context? jean_handoff_create.
- Jean is controlled by AI only: change plans through these tools, never by editing its files.
`;
}

// ---------- messaging helpers ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Unread messages for `name`; marks them read unless peek. touch = also counts as a heartbeat. */
async function inboxGet(name, { all = false, peek = false, touch = false, wait = 0 } = {}) {
  const q = [all && 'all=1', peek && 'peek=1', touch && 'touch=1', wait && `wait=${wait}`].filter(Boolean).join('&');
  let offline = false;
  const out = await run(() => api('GET', `/api/inbox/${encodeURIComponent(name)}${q ? '?' + q : ''}`, null, (wait + 5) * 1000), st => {
    offline = true;
    const list = store.inboxFor(st, name, { all });
    if (touch && !store.isOwner(st, name)) { try { store.checkIn(st, { name }); } catch {} }
    if (!peek && list.length) store.markRead(st, name, list.map(m => m.id));
    return list;
  });
  if (offline && wait && !out.length) await sleep(2000);   // no server to long-poll: check the file again shortly
  return out;
}

async function postMessage({ to, text, replyTo }) {
  const body = { from: agentName(), to, text, replyTo: replyTo || flags.reply, task: flags.task ? resolveId(flags.task) : undefined, project: flags.project };
  return run(() => api('POST', '/api/messages', body), st => store.sendMessage(st, body));
}

/** Block until someone answers in the thread of `m` (or the timeout). Prints the answer. */
async function waitReply(m, seconds) {
  const me = agentName();
  const until = Date.now() + seconds * 1000;
  if (!JSON_OUT) process.stderr.write(C.dim(`sent ${m.id.slice(2)} → ${addr(m.to)} · waiting up to ${seconds}s for a reply…\n`));
  while (Date.now() < until) {
    // Long-poll the server for news in this thread; without a server, re-read the file every 2s.
    const w = Math.min(25, Math.max(1, Math.ceil((until - Date.now()) / 1000)));
    let offline = false;
    const thread = await run(() => api('GET', `/api/messages?thread=${m.id}&limit=50&since=${encodeURIComponent(m.at)}&wait=${w}`, null, (w + 5) * 1000),
      st => { offline = true; return store.feed(st, { thread: m.id, limit: 50 }); });
    if (offline) await sleep(2000);
    const replies = thread.filter(x => x.id !== m.id && x.from.toLowerCase() !== me.toLowerCase());
    if (replies.length) {
      const ids = replies.map(x => x.id);
      await run(() => api('POST', `/api/inbox/${encodeURIComponent(me)}/read`, { ids }), st => { store.markRead(st, me, ids); return {}; });
      return out({ sent: m, replies }, replies.map(msgLine).join('\n'));
    }
  }
  out({ sent: m, replies: [], timedOut: true }, C.yellow(`no reply within ${seconds}s — it stays in their inbox; check later with: jean feed ${m.id.slice(2)}`));
}

function addr(to) {
  if (to && to.startsWith('#')) { const n = pname(to.slice(1)); return n ? `#${n.replace(/^\S+\s/, '')}` : to; }
  return to;
}
function msgLine(m) {
  const when = new Date(m.at); const hh = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const ref = m.task ? C.dim(` [${m.task.slice(2)}]`) : '';
  if (m.kind === 'event') return `  ${C.dim(hh)} ${C.dim('·')} ${C.dim(`${m.from} ${m.text}`)}${ref}`;
  return `  ${C.dim(hh)} ${C.dim(m.id.slice(2))} ${C.bold(m.from)} → ${addr(m.to)}${m.replyTo ? C.dim(' ↩') : ''}: ${m.text}${ref}`;
}

/** Accept the 6-char tail, a full id, or an exact title. */
function resolveId(ref) {
  try { const t = store.findTask(store.load(), ref); if (t) return t.id; } catch {}
  return ref;
}

const HELP = `jean — Jean Clawd CLI  (Claude-friendly: add --json to any command)

  jean today [date]             today's plan, overdue, stats     (default command)
  jean week [date]              the week at a glance
  jean month [date]             month goals + every planned day
  jean list [search] [--open] [--project X] [--from D --to D] [--scope S] [--status S]
  jean add "title" [-P project] [-d date] [-s day|week|month] [-p 1|2|3] [-n notes] [-r daily|weekdays|weekly|monthly]
                                (inside a folder where you ran 'jean init', the project is attached automatically)
  jean done <id...>   jean undo <id>   jean start <id>
  jean edit <id> [new title] [-P ..] [-d ..] [-s ..] [-p ..] [-n ..] [-r ..|none]
  jean move <id> <date>         e.g. jean move k3m2x tomorrow
  jean rm <id>
  jean init ["description"] [--name X] [--emoji 🚀] [--repo url]   register the current folder as a project
                                (like git init; name, description, emoji and repo are auto-filled from
                                 the git remote, README and package.json when you don't pass them)
  jean inspect [dir]            what init would auto-fill (remote, README, package.json, language)
  jean projects                 all projects: description, repo, path, open/overdue
  jean project [name]           this folder's (or a named) project and its open tasks
  jean project add "Name" [--desc ..] [--emoji 🚀] [--repo url]     a project without a folder
  jean project describe "text" | repo <url> | emoji 🚀 | archive <name> | unarchive <name> | rm <name>
  jean project rename <name> "New name"   jean project color <name> #RRGGBB
  jean settings [key value]     preferences: ownerName, theme system|dark|light, weekStart mon|sun, defaultView,
                                showDone, petQuips, defaultProject, port   (the web app is read-only)
  jean stats [date]             productivity check, per project
  jean journal ["text"] [-d date]

 agents — Jean Clawd vd Dam: every Claude session is an agent with a name, a role and a "now doing" line
  jean hello ["doing…"] [--role "what I am for"] [--dept tech|marketing|backoffice|finance|external] [--task id]
                                check in; prints your briefing: your tasks,
                                inbox, handoffs for you, and what every other agent is doing
  jean whoami                   your briefing again          jean agents   the crew: who is on what (--all)
  jean doing "text" [--task id] what you are working on now (--task also starts + assigns it to you)
  jean send <to> "text" [--task id] [--wait 120]     to = agent name · #project · all · owner
  jean ask <to> "question" [--wait 300]              send and wait for the answer
  jean reply <msg id> "text"    jean inbox [--all] [--peek] [--wait 60]    jean feed [msg id] [--project X] [--agent X]
  jean assign <task id> <agent|none>    jean add "…" --to <agent>    jean mine   tasks assigned to you
  jean request "what needs doing"       ask the room: Jean offers it to the best-fitting agent
  jean requests [--all]   jean claim <id>   take an open request (first claim wins → becomes your task)
  jean bye ["note"]             sign off          jean agent role <name> "…" · jean agent dept <name> <dept> · jean agent rm <name>
  jean agent manager <name> <dept|false>   make an agent the shared manager of a floor (serves every project)
  jean managers                 who runs which floor   (jean hello --manager marketing to become one)
  jean hook                     Claude Code hook (installed by: jean setup --hooks)
  jean cloud [connect <url> --token T|off|push|link|agent-env|token]   run Jean on a server you host
                                (docs/CLOUD.md): every machine and cloud agent shares one crew
  jean system [pause --yes]     the machine: dev servers + ports, CPU / memory / GPU, Docker; pause = stop all
                                dev servers and pause every container
  jean stop <port|pid>          stop a dev server      jean docker ps|stop|pause|unpause|start <name>|stop-all|pause-all|unpause-all
  jean hire [id] [--no-install]  hire a specialist: a Claude skill pack that joins the crew (designer, docs, qa…)
  jean become <name>            take on an agent's identity for this session (e.g. a hired specialist)
  jean plugins [list|new|enable|disable] add your own commands, tools, routes, Dojo add-ons (docs/PLUGINS.md)
  jean connect [tool…] [--yes]  plug Jean into Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf,
                                VS Code: registers the MCP server + a usage note (dry run without --yes)
  jean prompt [name]            instructions that let ANY agent join over HTTP (paste into its system prompt / AGENTS.md)
  jean agent link <name> <url>  add an external A2A agent to the crew (messages to it go over A2A, replies come back)
  protocol: PROTOCOL.md — /v1 HTTP endpoints + A2A (/.well-known/agent-card.json, /a2a/<agent>)

 playbook — the owner's stack and the skills the crew learned (agents see both in their briefing)
  jean stack                    default tool per area      jean stack set <area> "<choice>" [-n notes] · jean stack rm <area>
  jean skills [search] [--dept X] [--tool X]                 what the crew knows how to do
  jean learn "How to …" --dept marketing --summary "…" [--tool gemini] [--install "setup"] [--stdin|--file f.md]
  jean skill show <id>          the steps + how to add it to Claude Code
  jean skill install <id> [--project]   write it as a Claude Code skill (~/.claude/skills or ./.claude/skills)
  jean skill edit <id> [--summary ..] [--stdin]   ·   jean skill rm <id>

 handoff — pass unfinished work to another Claude instance when you run out of context/limits
  jean handoff create "what this work is" --next "step" --next "step" [--context "…" | --stdin]
                                [--blockers "…"] [--task <id>] [--files path] [--from name] [--to agent]
                                (cwd, git branch/commit and changed files are captured automatically)
  jean handoff                  open handoffs waiting to be picked up   (--all includes finished)
  jean handoff take [id]        claim one (oldest open by default) and print the full briefing
  jean handoff show <id>        read a briefing without claiming it
  jean handoff note "text"      append progress to the handoff you are on
  jean handoff done [id]        finished     jean handoff drop [id]   release it for someone else
  jean say "text" [--anim X]    make Jean-Claude on the desktop say something (optionally with a stunt)
  jean stunt [name|list]        he performs a move from his films: splits, epicSplit, kumite, treeKick,
                                dance, guardUp, doubleImpact, flashKick, salute, mullet (default: random)
  jean serve [--bg]             start the web app     jean open   open it in the browser
  jean status                   is the server / Jean-Claude running?   jean export   dump JSON
  jean setup [--hooks]          install for every AI on this Mac: CLI on PATH, Claude skill (/jean),
                                global CLAUDE.md note, MCP server; --hooks adds Claude Code hooks so
                                every session checks in as an agent and sees its messages
  jean mcp                      run the MCP server (stdio) — for any MCP-capable agent

dates: 2026-09-04, today, tomorrow, yesterday, fri, next mon, next week, next month, +3
identity: a Claude session is claude-<project> automatically (a 2nd live session in the same folder gets -2);
        override with JEAN_AGENT="name" or --as name. At a normal terminal you are the owner.
ids:   the short code printed after the checkbox (also accepts full t_xxxxxx or an exact title)
data:  ${store.DATA_FILE}`;

/** Commands added by plugins (docs/PLUGINS.md). Loaded only when the command isn't a built-in. */
function pluginCommand(name) {
  try {
    const reg = require('../lib/plugins').load('cli', store.load().settings);
    const def = reg.commands.get(name);
    if (!def) return null;
    return () => def.run({ args: positional, flags, out, C, api, run, store, agentName,
      state: () => run(() => api('GET', '/api/state'), s => s) });
  } catch (e) { return null; }
}

(async () => {
  if (CLOUD && !['cloud', 'help', '--help', '-h', 'setup', 'connect', 'serve', 'mcp', 'hook'].includes(cmd)) {
    // ids, names and projects are resolved locally in a few places: give those a copy of the cloud state
    try { const remote = await api('GET', '/api/state'); store.load = () => store.migrate(JSON.parse(JSON.stringify(remote))); store.save = s => s; } catch {}
  }
  const fn = commands[cmd] || (cmd === '--help' || cmd === '-h' ? commands.help : null) || pluginCommand(cmd);
  if (!fn) { console.error(`unknown command "${cmd}"\n`); console.log(HELP); process.exit(1); }
  try { await fn(); } catch (e) { console.error(C.red('error: ') + e.message); process.exit(1); }
})();
