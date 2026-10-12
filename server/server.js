#!/usr/bin/env node
// Jean Clawd server — serves the web app and a JSON API on localhost.
// Zero dependencies. Start: node server/server.js  (or: jean serve)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('../lib/store');
const a2a = require('../lib/a2a');
const pluginKit = require('../lib/plugins');

const WEB_DIR = path.join(__dirname, '..', 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

let state = store.load();
let lastMtime = safeMtime();
const sseClients = new Set();
const jcQueue = [];           // messages / stunts for the desktop Jean-Claude
let lastPing = null;          // last time Jean-Claude checked in

function safeMtime() { try { return fs.statSync(store.DATA_FILE).mtimeMs; } catch { return 0; } }

// The CLI (or Claude editing the JSON by hand) may write the file directly:
// pick those changes up and push them to open browser tabs.
setInterval(() => {
  const m = safeMtime();
  if (m !== lastMtime) {
    lastMtime = m;
    try { state = store.load(); broadcast('changed'); wake(); forwardPending(); } catch (e) { console.error('reload failed:', e.message); }
  }
}, 1000);

function persist() { store.save(state); lastMtime = safeMtime(); broadcast('changed'); wake(); forwardPending(); emit('changed', state); }

// ---- plugins (docs/PLUGINS.md): routes, events, timers, browser assets ----
const plugins = pluginKit.load('server', state.settings);
function emit(event, data) { for (const l of plugins.listeners) if (l.event === event) { try { l.fn(data, state); } catch (e) { console.error(`[${l.plugin}] ${event}: ${e.message}`); } } }
for (const t of plugins.timers) setInterval(() => { try { t.fn(state); } catch (e) { console.error(`[${t.plugin}] timer: ${e.message}`); } }, t.ms);

// Long-poll: a request waiting for news resolves on the next change (or its timeout).
const waiters = new Set();
function wake() { for (const w of waiters) w(); waiters.clear(); }
function nextChange(ms) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); waiters.delete(done); resolve(); };
    const t = setTimeout(done, ms);
    waiters.add(done);
  });
}
async function waitFor(check, seconds) {
  const until = Date.now() + Math.min(120, Math.max(0, Number(seconds) || 0)) * 1000;
  let v = check();
  while (isEmpty(v) && Date.now() < until) { await nextChange(until - Date.now()); v = check(); }
  return v;
}
const isEmpty = v => !v || (Array.isArray(v) && !v.length);
function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

// ---- read ----
// The web app gets the recent radio only; the full history stays on disk (GET /api/messages).
route('GET', '/api/state', () => ({ ...state, messages: state.messages.slice(-300) }));
route('GET', '/api/health', () => ({ ok: true, version: 1, mode: TOKEN ? 'cloud' : 'local', ...(TOKEN ? {} : { dataFile: store.DATA_FILE }), updatedAt: state.updatedAt }));
route('GET', '/api/settings', () => state.settings);
route('GET', '/api/projects', () => state.projects);
route('GET', '/api/handoffs', (p, q) => store.filterHandoffs(state, q));
route('GET', '/api/handoffs/:id', p => {
  const h = store.findHandoff(state, p.id); if (!h) throw notFound('handoff');
  return { ...h, briefing: store.handoffBriefing(state, h) };
});
route('GET', '/api/projects/:id', p => { const pr = store.findProject(state, p.id); if (!pr) throw notFound('project'); return { ...pr, tasks: store.filterTasks(state, { project: pr.id }) }; });
route('GET', '/api/tasks', (p, q) => store.filterTasks(state, q));
route('GET', '/api/tasks/:id', p => { const t = store.findTask(state, p.id); if (!t) throw notFound('task'); return t; });
route('GET', '/api/day/:date', p => store.tasksForDay(state, store.resolveDate(p.date)));
route('GET', '/api/week/:date', p => store.tasksForWeek(state, store.resolveDate(p.date)));
route('GET', '/api/month/:date', p => store.tasksForMonth(state, store.resolveDate(p.date)));
route('GET', '/api/stats', (p, q) => store.stats(state, store.resolveDate(q.date)));
route('GET', '/api/summary', (p, q) => store.summary(state, store.resolveDate(q.date)));
route('GET', '/api/journal/:date', p => ({ date: p.date, text: state.journal[p.date] || '' }));

// ---- write ----
route('POST', '/api/tasks', (p, q, body) => { const t = store.addTask(state, body); persist(); return t; });
route('PATCH', '/api/tasks/:id', (p, q, body) => { const t = store.updateTask(state, p.id, body); persist(); return t; });
route('POST', '/api/tasks/:id/done', p => { const t = store.completeTask(state, p.id); persist(); return t; });
route('POST', '/api/tasks/:id/undone', p => { const t = store.uncompleteTask(state, p.id); persist(); return t; });
route('DELETE', '/api/tasks/:id', p => { const t = store.deleteTask(state, p.id); persist(); return t; });
route('POST', '/api/tasks/reorder', (p, q, body) => { store.reorderTasks(state, body.ids || []); persist(); return { ok: true }; });
route('POST', '/api/handoffs', (p, q, body) => { const h = store.addHandoff(state, body); persist(); broadcast('handoff', { title: h.title, id: h.id }); return h; });
route('PATCH', '/api/handoffs/:id', (p, q, body) => { const h = store.updateHandoff(state, p.id, body); persist(); return h; });
route('POST', '/api/handoffs/:id/claim', (p, q, body) => {
  const h = store.claimHandoff(state, p.id, body.by, { force: !!body.force });
  persist();
  return { ...h, briefing: store.handoffBriefing(state, h) };
});
route('POST', '/api/handoffs/:id/note', (p, q, body) => { const h = store.noteHandoff(state, p.id, body.text, body.by); persist(); return h; });
route('DELETE', '/api/handoffs/:id', p => { const h = store.deleteHandoff(state, p.id); persist(); return h; });
route('POST', '/api/tasks/:id/assign', (p, q, body, req) => { const t = store.assignTask(state, p.id, body.to, req.asOwner ? store.ownerKey(state) : body.by); persist(); return t; });
// ---- the machine: dev servers, CPU / memory / GPU, Docker (lib/system.js) ----
const system = require('../lib/system');
store.extensions.briefing.push(() => system.briefingLines());
let sysBusy = false;
async function refreshSystem() { if (sysBusy) return; sysBusy = true; try { await system.snapshot(state.projects); broadcast('system'); } catch (e) {} finally { sysBusy = false; } }
setTimeout(refreshSystem, 500); setInterval(refreshSystem, 15000);
route('GET', '/api/system', async () => system.cached() || await system.snapshot(state.projects));
const localOnly = () => { if (TOKEN) throw badRequest('stopping servers and containers works in local mode only: run jean stop / jean docker on the machine itself'); };
const sysEvent = text => { postEvent(text); };
function postEvent(text) { store.postEvent(state, 'jean', text, {}); persist(); }
route('POST', '/api/system/stop', async (p, q, body) => { localOnly(); const r = await system.stopServer(body.port || body.pid); sysEvent(`stopped dev server ${r.command} :${r.ports[0]}`); refreshSystem(); return r; });
route('POST', '/api/system/docker', async (p, q, body) => { localOnly(); const r = await system.dockerAction(body.action, body.name); if (r.containers.length) sysEvent(`docker ${r.action}: ${r.containers.slice(0, 6).join(', ')}${r.containers.length > 6 ? ` +${r.containers.length - 6}` : ''}`); refreshSystem(); return r; });
route('POST', '/api/system/pause', async () => { localOnly(); const r = await system.pauseAll(); sysEvent(`paused development: ${r.stopped.length} server${r.stopped.length === 1 ? '' : 's'} stopped, ${r.paused.length} container${r.paused.length === 1 ? '' : 's'} paused`); refreshSystem(); return r; });

// hire specialists from the catalog (lib/catalog.js): on-call agents backed by Claude skills
const catalog = require('../lib/catalog');
route('GET', '/api/catalog', () => catalog.CATALOG.map(c => ({ ...c, hired: !!state.agents.find(a => a.name === c.name && a.specialist) })));
route('POST', '/api/crew/hire', (p, q, body, req) => {
  const r = store.hireSpecialist(state, body.id, req.asOwner ? store.ownerKey(state) : body.by);
  persist();
  // local mode: also install the skills into Claude Code on this machine, in the background
  if (!r.already && !TOKEN && body.install !== false) installPlugin(r.agent);
  return { agent: r.agent.name, already: r.already, installing: !r.already && !TOKEN };
});
function installPlugin(agent) {
  const sp = agent.specialist; if (!sp) return;
  const sh = `claude plugin marketplace add ${sp.marketplace} >/dev/null 2>&1; claude plugin install ${sp.plugin} --scope user`;
  execFile('/bin/zsh', ['-lc', sh], { timeout: 180000 }, (err, stdout, stderr) => {
    const a = state.agents.find(x => x.name === agent.name);
    if (!a || !a.specialist) return;
    a.specialist.installed = err ? `failed: ${String(stderr || err.message).trim().split('\n').pop().slice(0, 160)}` : 'installed';
    persist();
  });
}
// requests: "who can do this?" — Jean finds the right agent, the first to claim it gets it
route('GET', '/api/requests', (p, q) => state.messages.filter(m => m.kind === 'request' && (q.all || !m.claimedBy)).slice(-50));
route('GET', '/api/route', (p, q) => store.routeRequest(state, q.text || '').slice(0, 5));
route('POST', '/api/requests', (p, q, body, req) => {
  const r = store.createRequest(state, { text: body.text, project: body.project, from: req.asOwner ? store.ownerKey(state) : body.from });
  persist(); announce(r.request); return r;
});
route('POST', '/api/requests/:id/claim', (p, q, body) => { const r = store.claimRequest(state, p.id, body.agent); persist(); return r; });

// ---- agents & messages (Jean Clawd vd Dam) ----
route('GET', '/api/agents', (p, q) => store.listAgents(state, { all: !!q.all }));
route('POST', '/api/agents/hello', (p, q, body) => {
  const a = store.checkIn(state, body);
  if (body.doing) store.setDoing(state, a.name, body.doing, { task: body.task });
  persist();
  return { agent: a, briefing: store.agentBriefing(state, a.name), inbox: store.inboxFor(state, a.name) };
});
route('GET', '/api/agents/:name/brief', p => ({ agent: store.findAgent(state, p.name), briefing: store.agentBriefing(state, p.name), inbox: store.inboxFor(state, p.name) }));
route('POST', '/api/agents/:name/doing', (p, q, body) => { const a = store.setDoing(state, p.name, body.text, { task: body.task }); persist(); return a; });
route('POST', '/api/agents/:name/bye', (p, q, body) => { const a = store.signOff(state, p.name, body.text); persist(); return a; });
route('PATCH', '/api/agents/:name', (p, q, body) => { const a = store.updateAgent(state, p.name, body); persist(); return a; });
route('DELETE', '/api/agents/:name', p => { const a = store.deleteAgent(state, p.name); persist(); return a; });
route('GET', '/api/inbox/:name', async (p, q) => {
  const list = await waitFor(() => store.inboxFor(state, p.name, { all: !!q.all, since: q.since }), q.wait);
  const isAgent = !store.isOwner(state, p.name);
  if (isAgent && q.touch) { try { store.checkIn(state, { name: p.name }); } catch {} }
  if (!q.peek && list.length) store.markRead(state, p.name, list.map(m => m.id));
  if ((!q.peek && list.length) || (isAgent && q.touch)) persist();
  return list;
});
route('POST', '/api/inbox/:name/read', (p, q, body) => { store.markRead(state, p.name, body.ids || []); persist(); return { ok: true }; });
route('GET', '/api/messages', async (p, q) => q.wait && q.since ? waitFor(() => store.feed(state, q), q.wait) : store.feed(state, q));
route('POST', '/api/messages', (p, q, body, req) => {
  if (req.asOwner) body = { to: body.to, text: body.text, replyTo: body.replyTo, task: body.task, from: store.ownerKey(state) };
  const m = store.sendMessage(state, body);
  persist();
  announce(m);   // live UI + the desktop Jean-Claude speaks messages to the owner
  return m;
});

// ---- playbook: the owner's stack + skills the crew learned ----
route('GET', '/api/stack', () => state.stack);
route('PUT', '/api/stack/:area', (p, q, body) => { const e = store.setStack(state, { ...body, area: p.area }); persist(); return e; });
route('DELETE', '/api/stack/:area', p => { const e = store.deleteStack(state, p.area); persist(); return e; });
route('GET', '/api/skills', (p, q) => store.filterSkills(state, q));
route('GET', '/api/skills/:id', p => { const k = store.findSkill(state, p.id); if (!k) throw notFound('skill'); return { ...k, markdown: store.skillMarkdown(state, k) }; });
route('POST', '/api/skills', (p, q, body) => { const k = store.addSkill(state, body); persist(); return k; });
route('DELETE', '/api/skills/:id', p => { const k = store.deleteSkill(state, p.id); persist(); return k; });

// ---- Jean Agent Protocol v1: the small surface any agent can speak (see PROTOCOL.md) ----
const me = (body, req, q) => String((body && (body.agent || body.from)) || (q && q.agent) || req.headers['x-jean-agent'] || '').trim();
const need = name => { if (!name) throw badRequest('who are you? pass "agent" in the body or an X-Jean-Agent header'); return name; };
const compactMsg = m => ({ id: m.id, from: m.from, to: m.to, text: m.text, task: m.task, replyTo: m.replyTo, at: m.at });
route('GET', '/v1', () => ({
  protocol: 'jean-agent-protocol', version: 1, owner: store.ownerKey(state), docs: 'PROTOCOL.md',
  endpoints: {
    'POST /v1/hello': '{agent, role?, project?, doing?, task?} → your briefing',
    'POST /v1/doing': '{agent, text?, task?} → tell the crew what you are on',
    'POST /v1/send': '{agent, to, text, task?, replyTo?} → to = agent | #project | all | owner',
    'GET /v1/inbox/:agent?wait=30': 'unread messages (long-poll up to wait seconds); marks them read',
    'POST /v1/done': '{agent, task} → finish a task',
    'GET /v1/agents': 'the crew',
    'GET /v1/tasks?agent=X': 'open tasks assigned to X (or ?project=P)',
    'POST /v1/bye': '{agent}',
    'POST /v1/link': '{name, url} → add an external A2A agent to the crew',
    'GET /v1/requests': 'open "who can do this?" requests; POST /v1/claim {agent, request} takes one (first claim wins → a task assigned to you)',
    'GET /v1/stack': "the owner's default tools per area (use these)",
    'GET /v1/skills?dept=X': 'how-tos the crew learned; GET /v1/skills/:id for steps + SKILL.md; POST /v1/skills to add one',
  },
  a2a: { card: '/.well-known/agent-card.json', perAgent: '/a2a/:agent (JSON-RPC: SendMessage, GetTask, CancelTask)' },
}));
route('POST', '/v1/hello', (p, q, body, req) => {
  const name = need(me(body, req));
  const a = store.checkIn(state, { ...body, name, kind: body.kind || 'agent' });
  if (body.doing || body.task) store.setDoing(state, a.name, body.doing, { task: body.task });
  const inbox = store.inboxFor(state, a.name);
  store.markRead(state, a.name, inbox.map(m => m.id));
  persist();
  return { agent: a.name, briefing: store.agentBriefing(state, a.name, { http: true }).replace(/\nINBOX \(\d+ unread\)\n(- .*\n)*/, ''), inbox: inbox.map(compactMsg) };
});
route('POST', '/v1/doing', (p, q, body, req) => { const a = store.setDoing(state, need(me(body, req)), body.text, { task: body.task }); persist(); return { agent: a.name, doing: a.doing }; });
route('POST', '/v1/send', (p, q, body, req) => {
  const m = store.sendMessage(state, { from: need(me(body, req)), to: body.to, text: body.text, task: body.task, replyTo: body.replyTo, project: body.project });
  persist(); announce(m); return compactMsg(m);
});
route('GET', '/v1/inbox/:agent', async (p, q) => {
  const list = await waitFor(() => store.inboxFor(state, p.agent), q.wait);
  if (!store.isOwner(state, p.agent)) { try { store.checkIn(state, { name: p.agent }); } catch {} }
  if (!q.peek && list.length) store.markRead(state, p.agent, list.map(m => m.id));
  persist();
  return list.map(compactMsg);
});
route('POST', '/v1/done', (p, q, body, req) => { const t = store.updateTask(state, body.task, { status: 'done', by: need(me(body, req)) }); persist(); return { id: t.id, title: t.title, status: t.status }; });
route('GET', '/v1/agents', () => store.listAgents(state).map(a => ({ name: a.name, role: a.role, kind: a.kind, department: a.department || null, presence: a.presence, doing: a.doing && a.doing.text, project: (state.projects.find(x => x.id === a.project) || {}).name || null, open: a.open })));
route('GET', '/v1/tasks', (p, q, body, req) => {
  const agent = q.agent || req.headers['x-jean-agent'];
  const list = store.filterTasks(state, { assignee: q.project && !agent ? undefined : agent, project: q.project, open: 1 });
  return list.map(t => ({ id: t.id.slice(2), title: t.title, date: t.date, scope: t.scope, priority: t.priority, status: t.status, assignee: t.assignee, notes: t.notes || undefined }));
});
route('GET', '/v1/stack', () => state.stack.map(e => ({ area: e.area, choice: e.choice, notes: e.notes || undefined, dept: e.dept || undefined })));
route('POST', '/v1/stack', (p, q, body, req) => { const e = store.setStack(state, { ...body, by: me(body, req) }); persist(); return e; });
route('GET', '/v1/skills', (p, q) => store.filterSkills(state, q).map(k => ({ id: k.id.slice(2), name: k.name, dept: k.dept, summary: k.summary, tools: k.tools })));
route('GET', '/v1/skills/:id', p => { const k = store.findSkill(state, p.id); if (!k) throw notFound('skill'); return { ...k, markdown: store.skillMarkdown(state, k) }; });
route('POST', '/v1/skills', (p, q, body, req) => { const k = store.addSkill(state, { ...body, by: me(body, req) }); persist(); return { id: k.id.slice(2), name: k.name, dept: k.dept }; });
route('GET', '/v1/requests', () => store.openRequests(state).map(m => ({ id: m.id.slice(2), from: m.from, text: m.text, suggested: (m.candidates || [])[0] || null, at: m.at })));
route('POST', '/v1/requests', (p, q, body, req) => { const r = store.createRequest(state, { text: body.text, project: body.project, from: need(me(body, req)) }); persist(); announce(r.request); return { id: r.request.id.slice(2), suggested: r.ranked.slice(0, 3).map(x => x.name) }; });
route('POST', '/v1/claim', (p, q, body, req) => { const r = store.claimRequest(state, body.request || body.id, need(me(body, req))); persist(); return { task: r.task.id.slice(2), title: r.task.title }; });
route('POST', '/v1/bye', (p, q, body, req) => { const a = store.signOff(state, need(me(body, req)), body.text); persist(); return { agent: a.name, offline: true }; });
route('POST', '/v1/link', async (p, q, body) => {
  const name = String(body.name || '').trim(); const url = String(body.url || '').trim();
  if (!name || !/^https?:\/\//.test(url)) throw badRequest('usage: {name, url} — url of an A2A agent (its base or its agent card)');
  const info = await discover(url);
  const a = store.checkIn(state, { name, role: body.role || info.description.slice(0, 140) || 'external A2A agent', kind: 'a2a' });
  a.a2a = { url: info.url, card: info.card || null, remoteName: info.name || null };
  persist();
  return { agent: a.name, endpoint: a.a2a.url, remoteName: a.a2a.remoteName };
});

// ---- A2A: every Jean agent is an A2A agent (cards + JSON-RPC) ----
const base = req => `http://${req.headers.host || `localhost:${port}`}`;
route('GET', '/.well-known/agent-card.json', (p, q, b, req) => a2a.agentCard(state, base(req), ''));
route('GET', '/.well-known/agent.json', (p, q, b, req) => a2a.agentCard(state, base(req), ''));
route('GET', '/a2a/:agent/.well-known/agent-card.json', (p, q, b, req) => { const c = a2a.agentCard(state, base(req), p.agent); if (!c) throw notFound('agent'); return c; });
route('POST', '/a2a', (p, q, body, req) => rpc('', body, req));
route('POST', '/a2a/:agent', (p, q, body, req) => rpc(p.agent, body, req));
function rpc(target, body, req) {
  const r = a2a.handleRpc(state, target, body, req.headers['x-jean-agent']);
  if (r.changed) { persist(); if (r.message) announce(r.message); }
  return { __raw: r.response };
}

/** Side effects of a new message: live UI, the desktop Jean-Claude for messages to the owner. */
function announce(m) {
  emit('message', m);
  broadcast('message', { id: m.id, from: m.from, to: m.to, text: m.text });
  if (m.to === store.ownerKey(state)) jcQueue.push({ text: `${m.from}: ${m.text}`.slice(0, 160), seconds: 10, anim: 'talk', at: Date.now() });
}

// ---- outbound bridge: messages to linked A2A agents are delivered over A2A, replies come back ----
async function discover(url) {
  const tries = /agent(-card)?\.json$/.test(url) ? [url] : [url.replace(/\/$/, '') + '/.well-known/agent-card.json', url.replace(/\/$/, '') + '/.well-known/agent.json'];
  for (const u of tries) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(5000) }); if (r.ok) { const c = await r.json(); return { ...a2a.endpointFromCard(c), card: u }; } } catch {}
  }
  return { url, name: null, description: '' };   // no card: treat the url as the JSON-RPC endpoint itself
}
async function rpcCall(url, payload) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  return r.json();
}
const inflight = new Set();
function forwardPending() {
  for (const m of state.messages) {
    if (m.kind !== 'msg' || m.fwd || inflight.has(m.id)) continue;
    const ag = state.agents.find(a => a.a2a && a.name.toLowerCase() === m.to.toLowerCase());
    if (ag) { inflight.add(m.id); forward(m, ag).finally(() => inflight.delete(m.id)); }
  }
}
async function forward(m, ag) {
  const root = (m.thread && state.messages.find(x => x.id === m.thread)) || m;
  const out = root.a2aOut || (root.a2aOut = {});
  m.fwd = { at: new Date().toISOString(), status: 'sending' };
  const reply = text => {
    const r = store.sendMessage(state, { from: ag.name, replyTo: m.id, to: m.from, text });
    persist(); announce(r);
  };
  try {
    let res = await rpcCall(ag.a2a.url, a2a.outboundSend(m, out.contextId || root.id, out.taskId));
    if (res.error && res.error.code === -32601) {           // a 0.x agent: speak its dialect
      const legacy = { jsonrpc: '2.0', id: m.id, method: 'message/send', params: { message: { kind: 'message', messageId: m.id, contextId: out.contextId || root.id, ...(out.taskId ? { taskId: out.taskId } : {}), role: 'user', parts: [{ kind: 'text', text: m.text }], metadata: { from: m.from } } } };
      res = await rpcCall(ag.a2a.url, legacy); out.legacy = true;
    }
    if (res.error) throw new Error(res.error.message || 'A2A error');
    let r = a2a.readResult(res.result);
    if (r.taskId) out.taskId = r.taskId;
    if (r.contextId) out.contextId = r.contextId;
    m.fwd.status = 'sent';
    const until = Date.now() + 10 * 60e3;
    while (!r.done && r.taskId && Date.now() < until) {     // poll the remote task until it finishes
      await new Promise(x => setTimeout(x, 3000));
      const g = await rpcCall(ag.a2a.url, { jsonrpc: '2.0', id: `${m.id}-get`, method: out.legacy ? 'tasks/get' : 'GetTask', params: { id: r.taskId } });
      if (g.error) throw new Error(g.error.message || 'GetTask failed');
      r = a2a.readResult(g.result);
    }
    if (r.done && r.text) { ag.lastSeen = new Date().toISOString(); m.fwd.status = 'answered'; reply(r.text); }
    else { m.fwd.status = r.done ? 'done' : 'timeout'; persist(); }
  } catch (e) {
    m.fwd.status = 'failed'; m.fwd.error = e.message;
    const n = store.sendMessage(state, { from: ag.name, replyTo: m.id, to: m.from, text: `⚠ could not deliver over A2A (${ag.a2a.url}): ${e.message}`, system: true });
    persist(); announce(n);
  }
}

route('GET', '/api/plugins', (p, q) => q.page ? pluginKit.webAssets(state.settings, q.page)
  : plugins.plugins.map(x => ({ name: x.name, version: x.version, description: x.description, source: x.source, enabled: x.enabled, loaded: !!x.loaded, error: x.error })));
for (const r of plugins.routes) route(r.method, r.path, async (p, q, body, req) => { const out = await r.handler(p, q, body, req, state); if (r.method !== 'GET') persist(); return out; });

route('POST', '/api/projects', (p, q, body) => { const pr = store.addProject(state, body); persist(); return pr; });
route('PATCH', '/api/projects/:id', (p, q, body) => { const pr = store.updateProject(state, p.id, body); persist(); return pr; });
route('DELETE', '/api/projects/:id', p => { const pr = store.deleteProject(state, p.id); persist(); return pr; });
route('PATCH', '/api/settings', (p, q, body) => { Object.assign(state.settings, body); persist(); return state.settings; });
route('PUT', '/api/journal/:date', (p, q, body) => { state.journal[p.date] = String(body.text || ''); if (!state.journal[p.date]) delete state.journal[p.date]; persist(); return { ok: true }; });
route('POST', '/api/import', (p, q, body) => { state = store.migrate(body); persist(); return { ok: true }; });

// ---- Jean-Claude channel (the desktop app polls this) ----
const STUNTS = ['splits', 'epicSplit', 'kumite', 'treeKick', 'dance', 'guardUp', 'doubleImpact', 'flashKick', 'salute', 'mullet', 'random'];
function jcOnline() { return !!lastPing && Date.now() - lastPing < 15000; }
route('GET', '/api/jc/stunts', () => STUNTS);
route('POST', '/api/jc/say', (p, q, body) => {
  const text = String(body.text || '').trim();
  const anim = body.anim && STUNTS.includes(body.anim) ? body.anim : (body.anim ? null : 'talk');
  if (anim === null) throw badRequest(`unknown stunt "${body.anim}" — one of ${STUNTS.join(', ')}`);
  if (!text && anim === 'talk') throw badRequest('text or anim required');
  jcQueue.push({ text, seconds: Number(body.seconds) || 8, anim, at: Date.now() });
  if (text) broadcast('jc', { text });
  return { queued: jcQueue.length, online: jcOnline() };
});
route('POST', '/api/jc/stunt', (p, q, body) => {
  const anim = String(body.name || 'random');
  if (!STUNTS.includes(anim)) throw badRequest(`unknown stunt "${anim}" — one of ${STUNTS.join(', ')}`);
  jcQueue.push({ text: '', seconds: 4, anim, at: Date.now() });
  return { queued: jcQueue.length, online: jcOnline() };
});
route('GET', '/api/jc/messages', () => { lastPing = Date.now(); const out = jcQueue.splice(0); return { messages: out, summary: store.summary(state) }; });
route('GET', '/api/jc/status', () => ({ online: jcOnline(), lastPing }));
route('POST', '/api/open', () => { execFile('open', [`http://localhost:${port}`]); return { ok: true }; });

function notFound(what) { const e = new Error(`${what} not found`); e.status = 404; return e; }
function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

// ---- cloud mode: with JEAN_TOKEN set, every API call needs it (Bearer header, or the browser cookie) ----
const TOKEN = process.env.JEAN_TOKEN || '';
const crypto = require('crypto');
const sameToken = t => !!t && t.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN));
function authed(req, url) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && sameToken(h.slice(7))) return true;
  const c = (req.headers.cookie || '').match(/(?:^|;\s*)jean_token=([^;]+)/);
  return !!(c && sameToken(decodeURIComponent(c[1])));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (TOKEN) {
    // browser login: open https://your-jean/?token=… once; it becomes an HttpOnly cookie
    const t = url.searchParams.get('token');
    if (t && req.method === 'GET') {
      if (!sameToken(t)) return json(res, 401, { error: 'wrong token' });
      url.searchParams.delete('token');
      res.writeHead(302, { 'Set-Cookie': `jean_token=${encodeURIComponent(t)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000`, Location: url.pathname + (url.search || '') });
      return res.end();
    }
    const open = (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname.startsWith('/.well-known/'))) || req.method === 'OPTIONS';
    const guarded = /^\/(api|v1|a2a|plugins)(\/|$)/.test(url.pathname);
    if (guarded && !open && !authed(req, url)) return json(res, 401, { error: 'Jean is in cloud mode: send Authorization: Bearer <token> (agents) or open /?token=<token> once (browser).' });
  }
  const q = Object.fromEntries(url.searchParams);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-Jean-Agent, A2A-Version' });
    return res.end();
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
    return;
  }

  // The plan is changed by AI agents only (jean CLI, MCP, /v1, A2A). Browsers always send
  // Sec-Fetch-Site; agents and the CLI never do. From a browser the owner may only talk to the crew
  // (message, ask, post a request, hand a task to an agent, mark their inbox read), and only from
  // this app's own pages (same-origin), always as the owner. Everything else is refused.
  const site = req.headers['sec-fetch-site'];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && site) {
    const talk = req.method === 'POST' && /^\/api\/(messages|requests|inbox\/[^/]+\/read|tasks\/[^/]+\/assign|crew\/hire|system\/(stop|docker|pause))$/.test(url.pathname);
    if (!talk || site !== 'same-origin') return json(res, 403, { error: 'Jean is controlled by AI agents only. Ask Claude (jean CLI / MCP) or use the /v1 API from an agent.' });
    req.asOwner = true;
  }

  // a plugin's browser file, only if its manifest lists it
  const pf = url.pathname.match(/^\/plugins\/([a-z0-9-]+)\/([\w./-]+)$/);
  if (pf && req.method === 'GET' && !routes.some(r => r.method === 'GET' && r.re.test(url.pathname))) {
    const file = pluginKit.webFile(state.settings, pf[1], pf[2]);
    if (!file) { res.writeHead(404); return res.end('not found'); }
    return fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  }

  if (/^\/(api|v1|a2a|plugins)(\/|$)|^\/\.well-known\//.test(url.pathname)) {
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      let body = {};
      try {
        if (['POST', 'PATCH', 'PUT'].includes(req.method)) body = await readBody(req);
        const out = await r.handler(params, q, body, req);
        return json(res, 200, out && out.__raw ? out.__raw : out);
      } catch (e) {
        if (req.method === 'POST' && url.pathname.startsWith('/a2a')) return json(res, 200, { jsonrpc: '2.0', id: (body && body.id) ?? null, error: { code: -32603, message: e.message } });
        return json(res, e.status || 400, { error: e.message });
      }
    }
    return json(res, 404, { error: `No route ${req.method} ${url.pathname}` });
  }

  // static
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(WEB_DIR, file);
  if (!full.startsWith(WEB_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const port = Number(process.env.JEAN_PORT || process.env.PORT || process.argv[2] || state.settings.port || store.DEFAULT_PORT);
const host = process.env.JEAN_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !TOKEN) {
  console.error(`Refusing to listen on ${host} without JEAN_TOKEN: anyone could read and change your plan. Set JEAN_TOKEN (jean cloud token makes one).`);
  process.exit(2);
}
const server = http.createServer((req, res) => handle(req, res).catch(e => json(res, 500, { error: e.message })));
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${port} already in use — Jean Clawd is probably already running.`); process.exit(2); }
  throw e;
});
system.protectPort(port);
server.listen(port, host, () => {
  console.log(`Jean Clawd → http://localhost:${port}   (data: ${store.DATA_FILE})`);
  forwardPending();   // messages written while the server was down
});
