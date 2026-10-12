// Jean Clawd — shared data layer used by the server, the CLI and tests.
// One JSON file on disk. Every mutation is a pure function on the state
// object; callers persist with save(). Keep this dependency-free.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.JEAN_DIR || path.join(os.homedir(), '.jean');
const DATA_FILE = process.env.JEAN_DATA || path.join(DATA_DIR, 'jean.json');
const DEFAULT_PORT = 4242;

const SCOPES = ['day', 'week', 'month'];

// Plugin extension points (filled by lib/plugins.js): extra briefing lines and request-routing scores.
const extensions = { briefing: [], routeScore: [] };
const STATUSES = ['todo', 'doing', 'done'];
const RECURS = [null, 'daily', 'weekdays', 'weekly', 'monthly'];

// ---------- dates (all local, YYYY-MM-DD strings) ----------

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parse(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function today() { return fmt(new Date()); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
function addMonths(s, n) { const d = parse(s); d.setDate(1); d.setMonth(d.getMonth() + n); return fmt(d); }
function weekStart(s, startDow = 1) {
  const d = parse(s);
  const diff = (d.getDay() - startDow + 7) % 7;
  d.setDate(d.getDate() - diff);
  return fmt(d);
}
function monthStart(s) { return s.slice(0, 7) + '-01'; }
function monthEnd(s) { const d = parse(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return fmt(d); }
function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s; }

/** Resolve friendly date words: today, tomorrow, yesterday, mon..sun, next week, +3, 2026-09-04 */
function resolveDate(input, base = today()) {
  if (!input) return base;
  const s = String(input).trim().toLowerCase();
  if (isValidDate(s)) return s;
  if (s === 'today' || s === 'now') return base;
  if (s === 'tomorrow' || s === 'tmrw') return addDays(base, 1);
  if (s === 'yesterday') return addDays(base, -1);
  if (/^[+-]\d+$/.test(s)) return addDays(base, Number(s));
  if (s === 'next week') return addDays(weekStart(base), 7);
  if (s === 'next month') return addMonths(base, 1);
  const dows = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const m = s.match(/^(next )?(sun|mon|tue|wed|thu|fri|sat)/);
  if (m) {
    const want = dows.indexOf(m[2]);
    const d = parse(base);
    let diff = (want - d.getDay() + 7) % 7;
    if (diff === 0 || m[1]) diff += 7;
    if (diff === 7 && !m[1]) diff = 7; // "friday" on a friday = next friday
    return addDays(base, diff);
  }
  throw new Error(`Unrecognised date: "${input}" (use YYYY-MM-DD, today, tomorrow, fri, next week, +3)`);
}

// ---------- ids ----------

const PALETTE = ['#D97757', '#F2C14E', '#7FB77E', '#6FA8DC', '#B392F0', '#F28CB1', '#E07A5F', '#5FB3B3'];
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function shortId(prefix) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${s}`;
}

// ---------- state ----------

function defaultState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    settings: {
      port: DEFAULT_PORT,
      theme: 'system',      // 'system' follows the Mac's light/dark appearance
      weekStart: 1,          // 0 = Sunday, 1 = Monday
      defaultView: 'today',
      showDone: true,
      defaultProject: null,
      ownerName: '',            // shown in the apps ('' = "You"); jean settings ownerName <name>
      petQuips: true,
    },
    handoffs: [],             // work passed from one Claude instance to another
    agents: [],               // every Claude instance / bot that checked in: who, role, what it's doing now
    skills: [],               // the playbook: how-tos the crew learned, per department, installable into Claude Code
    stack: [],                // the owner's default tools per area (database → Supabase, deploy → GCP, …)
    messages: [],             // agent ↔ agent ↔ owner messages, project channels, and activity events
    projects: [              // the one grouping: a project (usually a folder registered with `jean init`)
      { id: 'p_personal', name: 'Personal', emoji: '🧍', color: '#D97757', path: '', description: 'Life admin, not tied to a repo', archived: false, createdAt: now, lastActive: now },
    ],
    tasks: [
      {
        id: shortId('t'), title: 'Register a project: run `jean init` inside a repo folder', notes: 'Or ask your agent to do it.',
        project: 'p_personal', date: today(), scope: 'day', priority: 2, status: 'todo',
        recur: null, order: 0, assignee: "", createdAt: now, doneAt: null,
      },
      {
        id: shortId('t'), title: 'Ask your agent: "plan my week with jean"', notes: 'Claude Code, Codex, Cursor and Gemini can all run the jean CLI.',
        project: 'p_personal', date: today(), scope: 'day', priority: 3, status: 'todo',
        recur: null, order: 1, assignee: "", createdAt: now, doneAt: null,
      },
    ],
    journal: {},             // { 'YYYY-MM-DD': 'free text for the day' }
    updatedAt: now,
  };
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const state = JSON.parse(raw);
    return migrate(state);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const state = defaultState();
      save(state);
      return state;
    }
    throw e;
  }
}

function migrate(state) {
  state.settings = Object.assign(defaultState().settings, state.settings || {});
  state.tasks = state.tasks || [];
  state.projects = state.projects || [];
  state.handoffs = state.handoffs || [];
  state.agents = state.agents || [];
  state.messages = state.messages || [];
  state.skills = state.skills || [];
  state.stack = state.stack || [];
  state.journal = state.journal || {};
  for (const t of state.tasks) if (t.assignee === undefined) t.assignee = '';
  // v1 had "companies" next to projects. Fold them into projects (same ids, so task refs survive).
  if (Array.isArray(state.companies)) {
    for (const c of state.companies) {
      if (!state.projects.some(p => p.id === c.id)) {
        state.projects.push({ id: c.id, name: c.name, emoji: c.emoji || '📁', color: c.color, path: '', description: '',
          archived: !!c.archived, createdAt: c.createdAt || new Date().toISOString(), lastActive: c.createdAt || new Date().toISOString() });
      }
    }
    for (const t of state.tasks) { if (!t.project && t.company) t.project = t.company; delete t.company; }
    for (const p of state.projects) delete p.company;
    if (state.settings.defaultCompany) { state.settings.defaultProject = state.settings.defaultProject || state.settings.defaultCompany; }
    delete state.settings.defaultCompany;
    delete state.companies;
  }
  state.projects.forEach((p, i) => { p.emoji = p.emoji || '📁'; p.color = p.color || PALETTE[i % PALETTE.length]; });
  return state;
}

function save(state) {
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  return state;
}

// ---------- projects ----------

function findProject(state, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase();
  return state.projects.find(p => p.id === ref)
    || state.projects.find(p => p.path === ref)
    || state.projects.find(p => p.name.toLowerCase() === r)
    || state.projects.find(p => p.name.toLowerCase().startsWith(r))
    || state.projects.find(p => p.name.toLowerCase().includes(r))
    || null;
}

/** git remote → browsable URL: git@github.com:o/r.git → https://github.com/o/r */
function normalizeRepo(url) {
  let u = String(url).trim();
  const ssh = u.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
  u = u.replace(/\.git$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`; // "owner/repo"
  return u;
}

/** Register (or update) a project folder. Idempotent per path — `jean init` twice is fine. */
function addProject(state, input) {
  const name = String(input.name || '').trim();
  const projPath = String(input.path || '').trim();
  if (!name) throw new Error('Project name is required');
  const existing = (projPath && state.projects.find(p => p.path === projPath))
    || state.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  const now = new Date().toISOString();
  if (existing) {
    existing.name = name;
    if (projPath) existing.path = projPath;
    if (input.description !== undefined && input.description !== '') existing.description = String(input.description || '');
    if (input.emoji) existing.emoji = input.emoji;
    if (input.color) existing.color = input.color;
    if (input.repo) existing.repo = normalizeRepo(input.repo);
    existing.lastActive = now;
    existing.archived = false;
    return existing;
  }
  const project = {
    id: shortId('p'), name, path: projPath, description: String(input.description || ''),
    emoji: input.emoji || '📁', color: input.color || PALETTE[state.projects.length % PALETTE.length],
    repo: input.repo ? normalizeRepo(input.repo) : '',
    archived: false, createdAt: now, lastActive: now,
  };
  state.projects.push(project);
  return project;
}

function updateProject(state, id, patch) {
  const p = findProject(state, id);
  if (!p) throw new Error(`No project ${id}`);
  for (const k of ['name', 'path', 'description', 'archived', 'emoji', 'color']) if (k in patch) p[k] = patch[k];
  if ('repo' in patch) p.repo = patch.repo ? normalizeRepo(patch.repo) : '';
  p.lastActive = new Date().toISOString();
  return p;
}

function deleteProject(state, id) {
  const p = findProject(state, id);
  if (!p) throw new Error(`No project ${id}`);
  state.projects.splice(state.projects.indexOf(p), 1);
  for (const t of state.tasks) if (t.project === p.id) t.project = null;
  return p;
}

function touchProject(state, id) {
  const p = state.projects.find(x => x.id === id);
  if (p) p.lastActive = new Date().toISOString();
}

// ---------- handoffs ----------
//
// A handoff is one agent's working memory, written down so another Claude
// instance can continue: what was happening, what to do next, where the code
// is. Status: open (waiting) → claimed (someone is on it) → done.

const HANDOFF_STATUSES = ['open', 'claimed', 'done'];

function findHandoff(state, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase();
  return state.handoffs.find(h => h.id === ref)
    || state.handoffs.find(h => h.id.endsWith(ref))
    || state.handoffs.find(h => h.title.toLowerCase() === r)
    || state.handoffs.find(h => h.title.toLowerCase().includes(r))
    || null;
}

function addHandoff(state, input) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('A handoff needs a title — one line saying what this work is');
  let project = null;
  if (input.project) {
    const p = findProject(state, input.project);
    if (!p) throw new Error(`Unknown project "${input.project}" (run: jean projects)`);
    project = p.id;
    touchProject(state, p.id);
  }
  const tasks = toArray(input.tasks).map(ref => { const t = findTask(state, ref); return t ? t.id : null; }).filter(Boolean);
  const now = new Date().toISOString();
  const handoff = {
    id: shortId('h'), title,
    project, cwd: String(input.cwd || ''), branch: String(input.branch || ''), commit: String(input.commit || ''),
    context: String(input.context || ''),
    next: toArray(input.next).map(String),
    files: toArray(input.files).map(String),
    tasks,
    blockers: String(input.blockers || ''),
    from: String(input.from || 'claude'),
    to: input.to ? resolveAssignee(state, input.to) : '',
    status: 'open', claimedBy: '', claimedAt: null, closedAt: null,
    notes: [],
    createdAt: now, updatedAt: now,
  };
  state.handoffs.push(handoff);
  postEvent(state, handoff.from, `handed off: ${title}${handoff.to ? ` → ${handoff.to}` : ''}`, { project });
  if (handoff.to) sendMessage(state, { from: handoff.from, to: handoff.to, project,
    text: `🤝 handoff for you: ${title} — jean handoff take ${handoff.id.slice(2)}` });
  return handoff;
}

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v.filter(x => x !== '' && x !== null && x !== undefined) : [v];
}

function updateHandoff(state, id, patch) {
  const h = findHandoff(state, id);
  if (!h) throw new Error(`No handoff ${id}`);
  for (const k of ['title', 'context', 'blockers', 'cwd', 'branch', 'commit', 'from', 'claimedBy']) if (k in patch) h[k] = String(patch[k] || '');
  if ('to' in patch) h.to = patch.to ? resolveAssignee(state, patch.to) : '';
  for (const k of ['next', 'files']) if (k in patch) h[k] = toArray(patch[k]).map(String);
  if ('tasks' in patch) h.tasks = toArray(patch.tasks).map(ref => { const t = findTask(state, ref); return t ? t.id : null; }).filter(Boolean);
  if ('project' in patch) {
    if (!patch.project) h.project = null;
    else { const p = findProject(state, patch.project); if (!p) throw new Error(`Unknown project "${patch.project}"`); h.project = p.id; }
  }
  if ('status' in patch) {
    if (!HANDOFF_STATUSES.includes(patch.status)) throw new Error(`status must be one of ${HANDOFF_STATUSES.join(', ')}`);
    const was = h.status;
    h.status = patch.status;
    if (patch.status === 'done') h.closedAt = new Date().toISOString();
    if (patch.status === 'done' && was !== 'done') postEvent(state, cleanName(patch.by) || h.claimedBy || h.from, `finished handoff: ${h.title}`, { project: h.project });
    if (patch.status === 'open') { h.claimedBy = ''; h.claimedAt = null; h.closedAt = null; }
  }
  h.updatedAt = new Date().toISOString();
  return h;
}

/** Claim a handoff. Refuses one already being worked on unless `force`. */
function claimHandoff(state, id, by, { force = false } = {}) {
  const h = findHandoff(state, id);
  if (!h) throw new Error(`No handoff ${id}`);
  if (h.status === 'done') throw new Error(`Handoff "${h.title}" is already finished`);
  if (h.status === 'claimed' && !force) {
    throw new Error(`Already claimed by ${h.claimedBy || 'someone'} at ${h.claimedAt} — pass force to take it anyway`);
  }
  h.status = 'claimed';
  h.claimedBy = String(by || 'claude');
  h.claimedAt = new Date().toISOString();
  h.updatedAt = h.claimedAt;
  if (h.project) touchProject(state, h.project);
  if (!isOwner(state, h.claimedBy)) { try { setDoing(state, h.claimedBy, `handoff: ${h.title}`); } catch {} }
  if (h.from && h.from !== h.claimedBy) sendMessage(state, { from: h.claimedBy, to: h.from, project: h.project, text: `picked up your handoff: ${h.title}` });
  return h;
}

/** Append a progress note, so a third instance can see what happened since. */
function noteHandoff(state, id, text, by) {
  const h = findHandoff(state, id);
  if (!h) throw new Error(`No handoff ${id}`);
  const note = { text: String(text || '').trim(), by: String(by || 'claude'), at: new Date().toISOString() };
  if (!note.text) throw new Error('Note text is required');
  h.notes.push(note);
  h.updatedAt = note.at;
  return h;
}

function deleteHandoff(state, id) {
  const h = findHandoff(state, id);
  if (!h) throw new Error(`No handoff ${id}`);
  state.handoffs.splice(state.handoffs.indexOf(h), 1);
  return h;
}

function filterHandoffs(state, q = {}) {
  let list = state.handoffs.slice();
  if (q.status) list = list.filter(h => h.status === q.status);
  else if (!q.all) list = list.filter(h => h.status !== 'done');
  if (q.project) { const p = findProject(state, q.project); list = list.filter(h => p && h.project === p.id); }
  if (q.cwd) list = list.filter(h => h.cwd === q.cwd);
  if (q.search) { const t = String(q.search).toLowerCase(); list = list.filter(h => h.title.toLowerCase().includes(t) || h.context.toLowerCase().includes(t)); }
  // Oldest open work first: a handoff that has been waiting should be picked up first.
  return list.sort((a, b) => (a.status === 'claimed') - (b.status === 'claimed') || a.createdAt.localeCompare(b.createdAt));
}

/** The full briefing another Claude needs to continue. Plain text, ready to read. */
function handoffBriefing(state, h) {
  const pname = id => (state.projects.find(p => p.id === id) || {}).name || null;
  const lines = [`HANDOFF — ${h.title}`];
  const meta = [];
  if (h.project) meta.push(`project ${pname(h.project)}`);
  if (h.to) meta.push(`for ${h.to}`);
  if (h.cwd) meta.push(`cwd ${h.cwd}`);
  if (h.branch) meta.push(`branch ${h.branch}${h.commit ? ` @ ${h.commit.slice(0, 8)}` : ''}`);
  meta.push(`from ${h.from}`, `written ${h.createdAt.slice(0, 16).replace('T', ' ')}`);
  lines.push(meta.join(' · '));
  if (h.context) lines.push('', 'CONTEXT', h.context);
  if (h.next.length) lines.push('', 'NEXT STEPS', ...h.next.map((n, i) => `${i + 1}. ${n}`));
  if (h.blockers) lines.push('', 'BLOCKERS', h.blockers);
  if (h.files.length) lines.push('', 'FILES', ...h.files.map(f => `- ${f}`));
  if (h.tasks.length) {
    const ts = h.tasks.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
    if (ts.length) lines.push('', 'JEAN TASKS', ...ts.map(t => `- [${t.status}] ${t.id.slice(2)}  ${t.title}`));
  }
  if (h.notes.length) lines.push('', 'PROGRESS NOTES', ...h.notes.map(n => `- (${n.by}, ${n.at.slice(0, 16).replace('T', ' ')}) ${n.text}`));
  return lines.join('\n');
}

// ---------- agents (Jean Clawd vd Dam) ----------
//
// Every Claude instance, cron agent or bot is an agent: a name, a role (what it
// is for), the project it works in and a "now doing" line. Agents check in with
// hello, say what they are on with doing, get tasks assigned, and talk through
// messages. The owner (the human) is addressed by their lowercased ownerName, or "owner".

const AGENT_ACTIVE_MS = 20 * 60e3;   // seen in the last 20 min → active
const AGENT_IDLE_MS = 3 * 3600e3;    // in the last 3 h → idle, otherwise away
const MESSAGE_CAP = 3000;            // oldest events are trimmed first, then oldest messages
const BROADCAST = ['all', 'everyone', '*', '@all'];
// Where an agent works in the Dojo. Unset = guessed from its role (see web/dojo.js deptOf).
const DEPARTMENTS = ['tech', 'marketing', 'backoffice', 'finance', 'external'];
function normDept(d) {
  const k = String(d || '').toLowerCase().replace(/[^a-z]/g, '');
  const alias = { backoffice: 'backoffice', office: 'backoffice', ops: 'backoffice', admin: 'backoffice', api: 'external', externalapi: 'external', ext: 'external', mkt: 'marketing', fin: 'finance', dev: 'tech', engineering: 'tech' };
  const v = alias[k] || k;
  if (!DEPARTMENTS.includes(v)) throw new Error(`department must be one of ${DEPARTMENTS.join(', ')}`);
  return v;
}

function ownerKey(state) { return String(state.settings.ownerName || 'owner').trim().toLowerCase() || 'owner'; }
function isOwner(state, name) { const n = String(name || '').trim().toLowerCase(); return n === ownerKey(state) || n === 'owner'; }
function cleanName(name) { return String(name || '').trim().replace(/^@/, '').replace(/\s+/g, '-'); }

function findAgent(state, ref) {
  if (!ref) return null;
  const r = cleanName(ref).toLowerCase();
  return state.agents.find(a => a.id === ref)
    || state.agents.find(a => a.name.toLowerCase() === r)
    || state.agents.find(a => a.name.toLowerCase().startsWith(r))
    || null;
}

function presence(a, now = Date.now()) {
  if (a.offline) return 'offline';
  const age = now - new Date(a.lastSeen).getTime();
  if (age < AGENT_ACTIVE_MS) return 'active';
  if (a.oncall) return 'idle';               // hired specialists are always on call
  return age < AGENT_IDLE_MS ? 'idle' : 'away';
}

/**
 * Hire a specialist from the catalog (lib/catalog.js): an on-call agent on its floor whose skills go
 * into the playbook. Any Claude session can take it on with `jean become <name>`.
 */
function hireSpecialist(state, id, by) {
  const c = require('./catalog').find(id);
  if (!c) throw new Error(`No specialist "${id}" in the catalog (jean hire)`);
  if (findAgent(state, c.name) && state.agents.find(a => a.name === c.name)) {
    const a = state.agents.find(x => x.name === c.name);
    if (a.specialist) return { agent: a, already: true };
  }
  const a = checkIn(state, { name: c.name, role: `${c.title}: ${c.summary}`, department: c.floor, kind: 'specialist' });
  a.oncall = true; a.offline = false;
  a.specialist = { id: c.id, title: c.title, use: c.use, source: c.source, skills: c.skills.map(k => k.name), plugin: c.install.plugin, marketplace: c.install.marketplace, installed: '' };
  const how = `In Claude Code: claude plugin marketplace add ${c.install.marketplace} && claude plugin install ${c.install.plugin} --scope user (or: jean hire ${c.id}).`;
  for (const k of c.skills) addSkill(state, { name: k.name, dept: c.floor, summary: k.does, install: how, tools: [c.install.plugin.split('@')[0]], by: c.name });
  postEvent(state, by && !isOwner(state, by) ? cleanName(by) : c.name, `joined the crew: ${c.title} (${c.floor})`, {});
  return { agent: a, already: false };
}

/** Check in (create or refresh) an agent. Only fields that are passed are overwritten. */
function checkIn(state, input) {
  const name = cleanName(input.name);
  if (!name) throw new Error('An agent needs a name (set JEAN_AGENT or pass --as)');
  if (isOwner(state, name)) throw new Error(`"${name}" is the owner's name, pick another agent name`);
  const now = new Date().toISOString();
  let a = state.agents.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!a) {
    a = { id: shortId('a'), name, role: '', kind: /^claude/i.test(name) ? 'claude' : 'agent', project: null, cwd: '', doing: null,
      offline: false, color: PALETTE[state.agents.length % PALETTE.length], createdAt: now, lastSeen: now };
    state.agents.push(a);
  }
  if (input.role) a.role = String(input.role);
  if (input.department) a.department = normDept(input.department);
  if (input.manager !== undefined && input.manager !== null && input.manager !== '') setManager(state, a, input.manager);
  if (input.kind) a.kind = String(input.kind);
  if (input.cwd) a.cwd = String(input.cwd);
  if (input.project) {
    const p = findProject(state, input.project);
    if (p) { a.project = p.id; touchProject(state, p.id); }
  }
  a.offline = false;
  a.lastSeen = now;
  return a;
}

/**
 * Floor managers: one shared agent per department (marketing, finance, back office, …) that serves
 * every project, instead of a marketing agent per project. manager = true | false | a department.
 * A department has one manager; appointing a new one demotes the old.
 */
function setManager(state, a, v) {
  const on = v === true || v === 'true' || v === 1 || (typeof v === 'string' && v && v !== 'false' && v !== 'none');
  if (!on) { a.manager = false; return a; }
  if (typeof v === 'string' && !['true'].includes(v)) a.department = normDept(v);
  if (!a.department) throw new Error('A manager needs a department: --manager marketing (or set --dept first)');
  for (const o of state.agents) if (o !== a && o.manager && o.department === a.department) o.manager = false;
  a.manager = true;
  return a;
}
function managers(state) { return state.agents.filter(a => a.manager && a.department); }

function updateAgent(state, ref, patch) {
  const a = findAgent(state, ref);
  if (!a) throw new Error(`No agent ${ref}`);
  for (const k of ['role', 'kind', 'cwd', 'color']) if (k in patch) a[k] = String(patch[k] || '');
  if ('department' in patch) a.department = patch.department ? normDept(patch.department) : '';
  if ('manager' in patch) setManager(state, a, patch.manager);
  if ('project' in patch) { const p = patch.project ? findProject(state, patch.project) : null; a.project = p ? p.id : null; }
  if ('name' in patch && cleanName(patch.name)) a.name = cleanName(patch.name);
  return a;
}

/** What an agent is working on right now. Linking a task also starts it and assigns it to the agent. */
function setDoing(state, name, text, { task } = {}) {
  const a = checkIn(state, { name });
  let t = null;
  if (task) {
    t = findTask(state, task);
    if (!t) throw new Error(`No task ${task}`);
    t.assignee = a.name;
    if (t.status !== 'done') setStatus(state, t, 'doing');
    if (t.project && !a.project) a.project = t.project;
  }
  const line = String(text || (t && t.title) || '').trim();
  if (!line) { a.doing = null; return a; }
  const changed = !a.doing || a.doing.text !== line;
  a.doing = { text: line, task: t ? t.id : null, since: changed ? new Date().toISOString() : a.doing.since };
  if (changed) postEvent(state, a.name, `is on: ${line}`, { task: t ? t.id : null, project: (t && t.project) || a.project });
  return a;
}

function signOff(state, name, text) {
  const a = findAgent(state, name);
  if (!a) throw new Error(`No agent ${name}`);
  postEvent(state, a.name, text ? `signed off: ${text}` : 'signed off', { project: a.project });
  a.doing = null; a.offline = true; a.lastSeen = new Date().toISOString();
  return a;
}

function deleteAgent(state, ref) {
  const a = findAgent(state, ref);
  if (!a) throw new Error(`No agent ${ref}`);
  state.agents.splice(state.agents.indexOf(a), 1);
  return a;
}

function listAgents(state, { all = false } = {}) {
  const now = Date.now();
  const order = { active: 0, idle: 1, away: 2, offline: 3 };
  return state.agents
    .map(a => ({ ...a, presence: presence(a, now),
      open: state.tasks.filter(t => t.assignee === a.name && t.status !== 'done').length,
      unread: inboxFor(state, a.name).length }))
    .filter(a => all || a.presence !== 'offline' || a.open || a.unread)
    .sort((x, y) => order[x.presence] - order[y.presence] || y.lastSeen.localeCompare(x.lastSeen));
}

// ---------- messages ----------
//
// to: an agent name, the owner (their ownerName or "owner"), "all", or a project channel "#<project id>".
// kind: msg (a message someone wrote) or event (activity: started, finished, handed off).

/** Normalise an address: "@claude-x" → "claude-x", "#kiteshop" → "#p_abc123", "everyone" → "all". */
function resolveAddress(state, to) {
  const raw = String(to || '').trim();
  if (!raw) throw new Error('A message needs a recipient: an agent name, #project, all, or ' + ownerKey(state));
  if (BROADCAST.includes(raw.toLowerCase())) return { to: 'all', project: null };
  if (raw.startsWith('#')) {
    const p = findProject(state, raw.slice(1));
    if (!p) throw new Error(`Unknown project channel "${raw}" (run: jean projects)`);
    return { to: '#' + p.id, project: p.id };
  }
  if (isOwner(state, raw)) return { to: ownerKey(state), project: null };
  const a = findAgent(state, raw);
  return { to: a ? a.name : cleanName(raw), project: null }; // unknown names get a mailbox; it waits for them
}

function findMessage(state, ref) {
  if (!ref) return null;
  return state.messages.find(m => m.id === ref) || state.messages.find(m => m.id.endsWith(ref)) || null;
}

function sendMessage(state, input) {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('Message text is required');
  const from = cleanName(input.from) || ownerKey(state);
  let parent = null;
  if (input.replyTo) {
    parent = findMessage(state, input.replyTo);
    if (!parent) throw new Error(`No message ${input.replyTo}`);
  }
  // A reply goes back to whoever wrote the parent (or to the channel it was in) unless told otherwise.
  const addr = input.to ? resolveAddress(state, input.to)
    : parent ? (parent.to.startsWith('#') || parent.to === 'all' ? { to: parent.to, project: parent.project } : { to: parent.from, project: parent.project })
    : resolveAddress(state, '');
  let task = null;
  if (input.task) { const t = findTask(state, input.task); if (!t) throw new Error(`No task ${input.task}`); task = t.id; }
  const project = addr.project || (input.project && (findProject(state, input.project) || {}).id) || (task && findTask(state, task).project) || (parent && parent.project) || null;
  if (!isOwner(state, from) && input.kind !== 'event' && !input.system) { try { checkIn(state, { name: from }); } catch {} }
  const msg = {
    id: shortId('m'), from, to: addr.to, text, kind: ['event', 'request'].includes(input.kind) ? input.kind : 'msg',
    replyTo: parent ? (parent.thread || parent.id) : null, thread: parent ? (parent.thread || parent.id) : null,
    task, project, at: new Date().toISOString(), readBy: [from.toLowerCase()],
  };
  state.messages.push(msg);
  trimMessages(state);
  return msg;
}

function postEvent(state, from, text, extra = {}) {
  return sendMessage(state, { from, to: 'all', text, kind: 'event', task: extra.task || null, project: extra.project || null });
}

function trimMessages(state) {
  if (state.messages.length <= MESSAGE_CAP) return;
  let extra = state.messages.length - MESSAGE_CAP;
  state.messages = state.messages.filter(m => { if (extra > 0 && m.kind === 'event') { extra--; return false; } return true; });
  if (state.messages.length > MESSAGE_CAP) state.messages.splice(0, state.messages.length - MESSAGE_CAP);
}

/** Messages that reach `name`: direct, broadcast, its project channel(s), replies in threads it started. Events excluded. */
function addressedTo(state, name, m) {
  const n = String(name || '').toLowerCase();
  if (m.kind === 'event' || m.from.toLowerCase() === n) return false;
  if (m.to.toLowerCase() === n || m.to === 'all') return true;
  if (m.to.startsWith('#')) {
    const a = findAgent(state, name);
    if (isOwner(state, name)) return true;   // the owner hears every project channel
    return !!(a && a.project && m.to === '#' + a.project);
  }
  return false;
}

function inboxFor(state, name, { all = false, since } = {}) {
  const n = String(name || '').toLowerCase();
  return state.messages.filter(m => addressedTo(state, name, m)
    && (all || !m.readBy.includes(n))
    && (!since || m.at > since));
}

function markRead(state, name, ids) {
  const n = String(name || '').toLowerCase();
  const set = new Set(ids);
  for (const m of state.messages) if (set.has(m.id) && !m.readBy.includes(n)) m.readBy.push(n);
}

/** Recent traffic, newest last. Filters: project, agent (from or to), thread, kinds. */
function feed(state, q = {}) {
  let list = state.messages;
  if (q.project) { const p = findProject(state, q.project); list = list.filter(m => p && m.project === p.id); }
  if (q.agent) { const n = cleanName(q.agent).toLowerCase(); list = list.filter(m => m.from.toLowerCase() === n || m.to.toLowerCase() === n); }
  if (q.thread) { const root = findMessage(state, q.thread); const id = root ? (root.thread || root.id) : q.thread; list = list.filter(m => m.id === id || m.thread === id); }
  if (q.kind) list = list.filter(m => m.kind === q.kind);
  if (q.since) list = list.filter(m => m.at > q.since);
  const limit = Number(q.limit) || 50;
  return list.slice(-limit);
}

/** Everything an agent needs to know about itself and the crew. Plain text, ready to read. */
function agentBriefing(state, name, { http = false } = {}) {
  const a = findAgent(state, name);
  const pname = id => { const p = state.projects.find(x => x.id === id); return p ? `${p.emoji} ${p.name}` : ''; };
  const short = id => id.slice(2);
  const L = [];
  if (a) {
    L.push(`YOU — ${a.name}${a.role ? ` · ${a.role}` : ' · (no role yet: jean hello --role "what you are for")'}${a.project ? ` · project ${pname(a.project)}` : ''}`);
    L.push(a.doing ? `NOW: ${a.doing.text}${a.doing.task ? ` [${short(a.doing.task)}]` : ''} (since ${(d => `${pad(d.getHours())}:${pad(d.getMinutes())}`)(new Date(a.doing.since))})` : 'NOW: nothing set — jean doing "…" when you start something');
  } else L.push(`YOU — ${name} (not checked in yet: jean hello)`);

  const mine = sortTasks(state.tasks.filter(t => t.assignee && t.assignee.toLowerCase() === String(name).toLowerCase() && t.status !== 'done'));
  L.push('', `YOUR TASKS (${mine.length})`);
  if (mine.length) L.push(...mine.map(t => `- [${t.status}] ${short(t.id)}  ${t.title}${t.priority === 1 ? ' !!' : ''}${t.project ? `  ${pname(t.project)}` : ''}  ${t.scope === 'day' ? t.date : t.scope}`));
  else L.push('- none assigned to you');
  if (a && a.project) {
    const unassigned = sortTasks(state.tasks.filter(t => t.project === a.project && !t.assignee && t.status !== 'done')).slice(0, 8);
    if (unassigned.length) L.push('', `UNCLAIMED IN ${pname(a.project).toUpperCase()} (take one: jean doing --task <id>)`, ...unassigned.map(t => `- ${short(t.id)}  ${t.title}${t.priority === 1 ? ' !!' : ''}`));
  }

  const inbox = inboxFor(state, name);
  L.push('', `INBOX (${inbox.length} unread)`);
  if (inbox.length) L.push(...inbox.slice(-15).map(m => `- ${short(m.id)} ${m.from} → ${m.to.startsWith('#') ? '#' + ((state.projects.find(p => '#' + p.id === m.to) || {}).name || m.to) : m.to}: ${m.text}`));
  else L.push('- nothing new');

  const reqs = openRequests(state).slice(-8);
  if (reqs.length) L.push('', 'OPEN REQUESTS (nobody has these yet — take one: jean claim <id>)', ...reqs.map(m => `- ${m.id.slice(2)}  ${m.from}: ${m.text}${m.candidates && m.candidates[0] && m.candidates[0].toLowerCase() === String(name).toLowerCase() ? '  ← Jean suggests you' : ''}`));
  const hs = state.handoffs.filter(h => h.status === 'open' && ((h.to && h.to.toLowerCase() === String(name).toLowerCase()) || (a && a.project && h.project === a.project)));
  if (hs.length) L.push('', 'HANDOFFS FOR YOU', ...hs.map(h => `- ${short(h.id)}  ${h.title}  (from ${h.from}${h.to ? `, to ${h.to}` : ''}) → jean handoff take ${short(h.id)}`));

  const mgrs = managers(state).filter(m => m.name.toLowerCase() !== String(name).toLowerCase());
  if (a && a.specialist) L.push('', `YOU ARE THE ${a.specialist.title.toUpperCase()}: ${a.specialist.use} Your Claude skills: ${a.specialist.skills.join(', ')} (plugin ${a.specialist.plugin}). Use them for every task you take.`);
  if (a && a.manager) L.push('', `YOU MANAGE THE ${String(a.department).toUpperCase()} FLOOR: you serve every project. Take ${a.department} requests from any agent (jean requests), keep its skills current (jean learn), and answer agents who ask you.`);
  if (mgrs.length) L.push('', 'FLOOR MANAGERS (shared across all projects: send them the work, don\'t do it yourself)', ...mgrs.map(m => `- ${m.department}: ${m.name}${m.role ? ` — ${m.role}` : ''} [${presence(m)}]`));
  if (state.stack.length) L.push('', 'STACK (the owner\'s defaults: use these unless told otherwise)', ...state.stack.map(e => `- ${e.area}: ${e.choice}${e.notes ? ` — ${e.notes}` : ''}`));
  const mySkills = state.skills.filter(k => !a || !a.department || k.dept === a.department);
  if (mySkills.length) L.push('', `SKILLS${a && a.department ? ` FOR ${a.department.toUpperCase()}` : ''} (jean skill show <id> · jean skill install <id> adds it to Claude Code)`, ...mySkills.slice(0, 12).map(k => `- ${k.id.slice(2)}  ${k.name}${k.summary ? ` — ${k.summary}` : ''}${a && a.department ? '' : `  [${k.dept}]`}`));
  const crew = listAgents(state).filter(x => x.name.toLowerCase() !== String(name).toLowerCase());
  for (const fn of extensions.briefing) { try { const extra = fn(state, name) || []; if (extra.length) L.push('', ...extra); } catch {} }
  L.push('', `THE CREW (${crew.length})`);
  if (crew.length) L.push(...crew.map(x => `- ${x.name} [${x.presence}]${x.role ? ` ${x.role}` : ''}${x.project ? ` · ${pname(x.project)}` : ''} — ${x.doing ? x.doing.text : 'nothing set'}`));
  else L.push('- nobody else checked in');
  if (http) L.push('', `RULES: POST /v1/doing when you switch work · POST /v1/send {to: agent | #project | all | ${ownerKey(state)}} to coordinate (replyTo to answer) · GET /v1/inbox/${name}?wait=30 to listen · POST /v1/done {task} when finished · POST /v1/bye when you stop`);
  else L.push('', `RULES: jean doing "…" (or --task id) when you switch work · jean send <agent|#project|all|${ownerKey(state)}> "…" to coordinate · jean inbox to read · jean done <id> when finished · jean handoff create before you run out of context · jean bye when you stop`);
  return L.join('\n');
}

// ---------- requests: "who can do this?" ----------
//
// The owner (or any agent) posts a request without knowing who should do it. Jean ranks the crew on
// role, department, project, skills and presence, offers it to the best fit and tells everyone. The
// first agent to claim it gets it: the request becomes a task assigned to them, and the owner hears.

const DEPT_HINTS = {
  finance: /financ|invoice|billing|stripe|payment|account|tax|budget|revenue|bookkeep|cost|price|pricing/,
  marketing: /market|seo|content|social|brand|landing|copy|campaign|ads|growth|tiktok|instagram|design|deck|pitch|image|video|post/,
  external: /extern|a2a|integration|webhook|partner|relay|api key|third.?party/,
  backoffice: /back.?office|admin|ops\b|support|onboard|planner|planning|hr\b|legal|crm|customer|schedule|email/,
  tech: /code|bug|deploy|server|database|supabase|api|frontend|backend|react|test|build|migrat|fix|gcp|docker|repo/,
};
/** An agent's department: its own setting, else guessed from role/name/project (same rules as the Dojo). */
function guessDept(state, a) {
  if (a.department) return a.department;
  if (a.kind === 'a2a' || a.kind === 'a2a-client') return 'external';
  const pj = a.project ? (state.projects.find(p => p.id === a.project) || {}).name || '' : '';
  const t = `${a.role || ''} ${a.name} ${pj}`.toLowerCase();
  for (const d of ['finance', 'marketing', 'external', 'backoffice']) if (DEPT_HINTS[d].test(t)) return d;
  return 'tech';
}
const STOP = new Set('the and for with that this you can could please from have will need into make about what when who our your are was its just some also then them they there here want would should does done get got'.split(' '));
const words = t => String(t || '').toLowerCase().match(/[a-z0-9.]{3,}/g)?.filter(w => !STOP.has(w)) || [];

/** Rank the crew for a piece of work. Returns [{ name, score, why }] best first (offline agents excluded). */
function routeRequest(state, text) {
  const ws = words(text);
  const textDept = Object.keys(DEPT_HINTS).find(d => DEPT_HINTS[d].test(String(text).toLowerCase()));
  const now = Date.now();
  return state.agents.map(a => {
    const pres = presence(a, now);
    if (pres === 'offline') return null;
    const pj = a.project ? state.projects.find(p => p.id === a.project) : null;
    const dept = guessDept(state, a);
    const skills = state.skills.filter(k => k.dept === dept).map(k => `${k.name} ${k.tools.join(' ')}`).join(' ').toLowerCase();
    const why = []; let score = 0;
    const hit = (src, weight, label) => { const n = ws.filter(w => String(src || '').toLowerCase().includes(w)).length; if (n) { score += n * weight; why.push(label); } };
    hit(a.role, 3, 'role'); hit(pj && pj.name, 4, 'project'); hit(pj && pj.description, 1, 'project'); hit(skills, 2, 'skills'); hit(a.doing && a.doing.text, 1, 'current work'); hit(a.name, 2, 'name');
    if (textDept && textDept === dept) { score += 3; why.push(`${dept} dept`); }
    if (a.manager && textDept && textDept === a.department) { score += 4; why.push(`${dept} manager`); }
    score += { active: 2, idle: 1, away: -2 }[pres] || 0;
    if (pres === 'active' && a.doing) score -= 0.5;   // busy
    for (const fn of extensions.routeScore) { try { const r = fn(a, text, state) || {}; if (r.score) { score += Number(r.score) || 0; if (r.why) why.push(r.why); } } catch {} }
    return { name: a.name, score: Math.round(score * 10) / 10, why, presence: pres, dept };
  }).filter(Boolean).sort((x, y) => y.score - x.score);
}

function createRequest(state, input) {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('A request needs text: what needs doing');
  const from = cleanName(input.from) || ownerKey(state);
  const ranked = routeRequest(state, text).filter(r => r.name.toLowerCase() !== from.toLowerCase());
  const best = ranked[0] && ranked[0].score > 0 ? ranked[0] : null;
  const m = sendMessage(state, { from, to: 'all', text, kind: 'request', project: input.project, system: isOwner(state, from) });
  m.kind = 'request';
  m.candidates = ranked.slice(0, 3).map(r => r.name);
  m.claimedBy = ''; m.claimedAt = null; m.taskId = null;
  if (best) sendMessage(state, { from: 'jean', to: best.name, replyTo: m.id, system: true,
    text: `🙋 You look like the best fit (${best.why.join(', ') || 'available'}) for: "${text}". Take it with: jean claim ${m.id.slice(2)} — or reply why not.` });
  return { request: m, ranked: ranked.slice(0, 5) };
}
function openRequests(state) { return state.messages.filter(m => m.kind === 'request' && !m.claimedBy && !m.canceled); }

/** First agent to claim gets it: becomes a task assigned to them; the asker hears it. */
function claimRequest(state, id, agent) {
  const m = findMessage(state, id);
  if (!m || m.kind !== 'request') throw new Error(`No request ${id}`);
  const who = cleanName(agent);
  if (!who || isOwner(state, who)) throw new Error('Only an agent can claim a request');
  if (m.claimedBy) throw new Error(`Already taken by ${m.claimedBy}`);
  const a = checkIn(state, { name: who });
  m.claimedBy = a.name; m.claimedAt = new Date().toISOString();
  const title = m.text.length > 90 ? m.text.slice(0, 88) + '…' : m.text;
  const t = addTask(state, { title, notes: m.text === title ? '' : m.text, project: m.project || a.project || undefined, assignee: a.name, by: a.name });
  m.taskId = t.id;
  setDoing(state, a.name, t.title, { task: t.id });
  sendMessage(state, { from: a.name, to: m.from, replyTo: m.id, text: `I'll take it: ${title} (task ${t.id.slice(2)})` });
  postEvent(state, a.name, `claimed: ${title}`, { task: t.id, project: t.project });
  return { request: m, task: t };
}

// ---------- playbook: stack + skills ----------
//
// The stack is the owner's default choice per area ("database" → Supabase), so every agent on every
// project reaches for the same tools. Skills are how-tos the crew learned ("generate images with
// Gemini"), filed under a department, with what to install so another agent can use them too.

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function setStack(state, input) {
  const area = slug(input.area);
  const choice = String(input.choice || '').trim();
  if (!area || !choice) throw new Error('usage: area + choice, e.g. database Supabase');
  let e = state.stack.find(x => x.area === area);
  const now = new Date().toISOString();
  if (!e) { e = { id: shortId('k'), area, choice, notes: '', dept: '', createdAt: now }; state.stack.push(e); }
  e.choice = choice;
  if (input.notes !== undefined) e.notes = String(input.notes || '');
  if (input.dept !== undefined) e.dept = input.dept ? normDept(input.dept) : '';
  e.by = cleanName(input.by) || e.by || '';
  e.updatedAt = now;
  return e;
}
function deleteStack(state, area) {
  const e = state.stack.find(x => x.area === slug(area) || x.id === area);
  if (!e) throw new Error(`No stack entry "${area}"`);
  state.stack.splice(state.stack.indexOf(e), 1);
  return e;
}

function findSkill(state, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase();
  return state.skills.find(x => x.id === ref) || state.skills.find(x => x.id.endsWith(ref))
    || state.skills.find(x => x.slug === slug(ref)) || state.skills.find(x => x.name.toLowerCase().includes(r)) || null;
}
/** Add (or update, by name) a skill. */
function addSkill(state, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('A skill needs a name, e.g. "Generate images with Gemini"');
  const now = new Date().toISOString();
  let k = state.skills.find(x => x.slug === slug(name));
  const isNew = !k;
  if (!k) { k = { id: shortId('s'), name, slug: slug(name), dept: 'tech', summary: '', body: '', install: '', tools: [], projects: [], author: '', createdAt: now }; state.skills.push(k); }
  if (input.dept) k.dept = normDept(input.dept);
  for (const f of ['summary', 'body', 'install']) if (input[f] !== undefined && input[f] !== null && input[f] !== '') k[f] = String(input[f]);
  if (input.tools !== undefined) k.tools = toArray(input.tools).flatMap(t => String(t).split(',')).map(t => t.trim()).filter(Boolean);
  if (input.projects !== undefined) k.projects = toArray(input.projects).map(p => (findProject(state, p) || {}).id).filter(Boolean);
  k.author = k.author || cleanName(input.by) || '';
  k.updatedAt = now;
  if (isNew && k.author) postEvent(state, k.author, `learned a skill: ${name}`, { project: k.projects[0] || null });
  return k;
}
function deleteSkill(state, ref) {
  const k = findSkill(state, ref);
  if (!k) throw new Error(`No skill ${ref}`);
  state.skills.splice(state.skills.indexOf(k), 1);
  return k;
}
function filterSkills(state, q = {}) {
  let list = state.skills.slice();
  if (q.dept) { const d = normDept(q.dept); list = list.filter(k => k.dept === d); }
  if (q.tool) { const t = String(q.tool).toLowerCase(); list = list.filter(k => k.tools.some(x => x.toLowerCase().includes(t))); }
  if (q.search) { const t = String(q.search).toLowerCase(); list = list.filter(k => `${k.name} ${k.summary} ${k.tools.join(' ')} ${k.body}`.toLowerCase().includes(t)); }
  return list.sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));
}
/** A Claude Code skill file (SKILL.md) for this playbook entry. */
function skillMarkdown(state, k) {
  const stack = state.stack.filter(e => !e.dept || e.dept === k.dept);
  const sentence = t => t ? t.trim().replace(/([^.!?])$/, '$1.') : '';
  const desc = `${sentence(k.summary || k.name)}${k.tools.length ? ` Tools: ${k.tools.join(', ')}.` : ''} Use when a task needs to: ${k.name.toLowerCase()}.`.replace(/\s+/g, ' ');
  const sections = [
    `---\nname: ${k.slug}\ndescription: ${desc}\n---`,
    `# ${k.name}`,
    k.summary,
    k.body || `(no steps written yet — add them with: jean skill edit ${k.id.slice(2)} --stdin)`,
    k.install && `## Setup\n${k.install}`,
    stack.length && `## House stack (use these unless told otherwise)\n${stack.map(e => `- ${e.area}: ${e.choice}${e.notes ? ` — ${e.notes}` : ''}`).join('\n')}`,
    `_From the Jean Clawd playbook (${k.dept}). Update it with \`jean skill edit ${k.id.slice(2)}\`._`,
  ];
  return sections.filter(Boolean).join('\n\n') + '\n';
}

// ---------- tasks ----------

function findTask(state, ref) {
  if (!ref) return null;
  return state.tasks.find(t => t.id === ref)
    || state.tasks.find(t => t.id.endsWith(ref))       // allow the 6-char tail
    || state.tasks.find(t => t.title.toLowerCase() === String(ref).toLowerCase())
    || null;
}

function addTask(state, input) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Task title is required');
  const scope = input.scope || 'day';
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join(', ')}`);
  let project = null;
  if (input.project) {
    const p = findProject(state, input.project);
    if (!p) throw new Error(`Unknown project "${input.project}" (run: jean projects)`);
    project = p.id;
    touchProject(state, p.id);
  } else if (state.settings.defaultProject && state.projects.some(p => p.id === state.settings.defaultProject)) {
    project = state.settings.defaultProject;
  }
  const date = resolveDate(input.date);
  const priority = Math.min(3, Math.max(1, Number(input.priority) || 2));
  const recur = input.recur || null;
  if (!RECURS.includes(recur)) throw new Error(`recur must be one of ${RECURS.filter(Boolean).join(', ')}`);
  const siblings = state.tasks.filter(t => t.date === date && t.scope === scope);
  const task = {
    id: shortId('t'), title, notes: String(input.notes || ''),
    project, date, scope, priority,
    status: STATUSES.includes(input.status) ? input.status : 'todo',
    recur, order: siblings.length,
    assignee: input.assignee ? resolveAssignee(state, input.assignee) : '',
    createdBy: input.by ? cleanName(input.by) : '',
    createdAt: new Date().toISOString(), doneAt: null,
  };
  state.tasks.push(task);
  if (task.assignee && input.by && cleanName(input.by).toLowerCase() !== task.assignee.toLowerCase()) notifyAssigned(state, task, input.by);
  return task;
}

/** "" / none / the owner → unassigned (the owner's own plan); otherwise an agent name. */
function resolveAssignee(state, ref) {
  const r = cleanName(ref);
  if (!r || ['none', 'nobody', '-'].includes(r.toLowerCase()) || isOwner(state, r)) return '';
  const a = findAgent(state, r);
  return a ? a.name : r;
}

function notifyAssigned(state, t, by) {
  sendMessage(state, { from: cleanName(by) || ownerKey(state), to: t.assignee, task: t.id,
    text: `📌 assigned to you: ${t.title}${t.scope === 'day' ? ` (${t.date})` : ` (${t.scope} goal)`} — jean doing --task ${t.id.slice(2)}` });
}

/** Give a task to an agent (or back to the owner with "none"). Tells the agent through its inbox. */
function assignTask(state, id, to, by) {
  const t = findTask(state, id);
  if (!t) throw new Error(`No task ${id}`);
  const was = t.assignee;
  t.assignee = resolveAssignee(state, to);
  if (t.assignee && t.assignee !== was) notifyAssigned(state, t, by);
  if (t.project) touchProject(state, t.project);
  return t;
}

function updateTask(state, id, patch) {
  const t = findTask(state, id);
  if (!t) throw new Error(`No task ${id}`);
  if ('title' in patch) t.title = String(patch.title).trim() || t.title;
  if ('notes' in patch) t.notes = String(patch.notes || '');
  if ('date' in patch) t.date = resolveDate(patch.date);
  if ('scope' in patch && SCOPES.includes(patch.scope)) t.scope = patch.scope;
  if ('priority' in patch) t.priority = Math.min(3, Math.max(1, Number(patch.priority) || 2));
  if ('order' in patch) t.order = Number(patch.order) || 0;
  if ('recur' in patch) t.recur = RECURS.includes(patch.recur) ? patch.recur : null;
  if ('project' in patch) {
    if (!patch.project) t.project = null;
    else {
      const p = findProject(state, patch.project);
      if (!p) throw new Error(`Unknown project "${patch.project}"`);
      t.project = p.id;
      touchProject(state, p.id);
    }
  }
  if ('assignee' in patch) {
    const was = t.assignee;
    t.assignee = resolveAssignee(state, patch.assignee);
    if (t.assignee && t.assignee !== was) notifyAssigned(state, t, patch.by);
  }
  if ('status' in patch && STATUSES.includes(patch.status)) {
    const was = t.status;
    setStatus(state, t, patch.status);
    // When an agent finishes or starts something, the crew hears about it.
    const by = cleanName(patch.by);
    if (by && !isOwner(state, by) && was !== t.status && t.status !== 'todo') {
      if (t.status === 'done') {
        postEvent(state, by, `finished: ${t.title}`, { task: t.id, project: t.project });
        const a = findAgent(state, by);
        if (a && a.doing && a.doing.task === t.id) a.doing = null;
      } else if (t.status === 'doing') setDoing(state, by, t.title, { task: t.id });
    }
  }
  if (t.project) touchProject(state, t.project);
  return t;
}

function setStatus(state, t, status) {
  const was = t.status;
  t.status = status;
  t.doneAt = status === 'done' ? new Date().toISOString() : null;
  // Recurring tasks respawn on completion.
  if (status === 'done' && was !== 'done' && t.recur) {
    const next = nextRecurrence(t.date, t.recur);
    const exists = state.tasks.some(x => x.title === t.title && x.date === next && x.recur === t.recur && x.status !== 'done');
    if (!exists) {
      state.tasks.push({ ...t, id: shortId('t'), date: next, status: 'todo', doneAt: null, createdAt: new Date().toISOString() });
    }
  }
}

function nextRecurrence(date, recur) {
  switch (recur) {
    case 'daily': return addDays(date, 1);
    case 'weekdays': { let d = addDays(date, 1); while ([0, 6].includes(parse(d).getDay())) d = addDays(d, 1); return d; }
    case 'weekly': return addDays(date, 7);
    case 'monthly': return addMonths(date, 1).slice(0, 8) + date.slice(8);
    default: return addDays(date, 1);
  }
}

function completeTask(state, id) { return updateTask(state, id, { status: 'done' }); }
function uncompleteTask(state, id) { return updateTask(state, id, { status: 'todo' }); }

function deleteTask(state, id) {
  const t = findTask(state, id);
  if (!t) throw new Error(`No task ${id}`);
  state.tasks.splice(state.tasks.indexOf(t), 1);
  return t;
}

function reorderTasks(state, ids) {
  ids.forEach((id, i) => { const t = findTask(state, id); if (t) t.order = i; });
  return true;
}

// ---------- queries ----------

function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.status === 'done') - (b.status === 'done')
    || a.priority - b.priority
    || a.order - b.order
    || a.createdAt.localeCompare(b.createdAt));
}

/** Tasks visible on a given day: day-scoped for that date, plus overdue open day tasks when asking for today. */
function tasksForDay(state, date, { includeOverdue = true } = {}) {
  const dayTasks = state.tasks.filter(t => t.scope === 'day' && t.date === date);
  const overdue = includeOverdue && date === today()
    ? state.tasks.filter(t => t.scope === 'day' && t.date < date && t.status !== 'done')
    : [];
  return { tasks: sortTasks(dayTasks), overdue: sortTasks(overdue) };
}

function tasksForWeek(state, date) {
  const start = weekStart(date, state.settings.weekStart);
  const end = addDays(start, 6);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    days.push({ date: d, tasks: sortTasks(state.tasks.filter(t => t.scope === 'day' && t.date === d)) });
  }
  const weekTasks = sortTasks(state.tasks.filter(t => t.scope === 'week' && t.date >= start && t.date <= end));
  return { start, end, days, weekTasks };
}

function tasksForMonth(state, date) {
  const start = monthStart(date), end = monthEnd(date);
  const inMonth = state.tasks.filter(t => t.date >= start && t.date <= end);
  const byDay = {};
  for (const t of inMonth) if (t.scope === 'day') (byDay[t.date] = byDay[t.date] || []).push(t);
  for (const k in byDay) byDay[k] = sortTasks(byDay[k]);
  return {
    start, end, byDay,
    monthTasks: sortTasks(inMonth.filter(t => t.scope === 'month')),
    weekTasks: sortTasks(inMonth.filter(t => t.scope === 'week')),
  };
}

function filterTasks(state, q = {}) {
  let list = state.tasks;
  if (q.from) list = list.filter(t => t.date >= q.from);
  if (q.to) list = list.filter(t => t.date <= q.to);
  if (q.scope) list = list.filter(t => t.scope === q.scope);
  if (q.status) list = list.filter(t => t.status === q.status);
  if (q.open) list = list.filter(t => t.status !== 'done');
  if (q.assignee !== undefined && q.assignee !== null) {
    const a = String(q.assignee).toLowerCase();
    list = list.filter(t => a === 'none' || a === '' ? !t.assignee : (t.assignee || '').toLowerCase() === a);
  }
  if (q.project) { const p = findProject(state, q.project); list = list.filter(t => p && t.project === p.id); }
  if (q.search) { const s = q.search.toLowerCase(); list = list.filter(t => t.title.toLowerCase().includes(s) || t.notes.toLowerCase().includes(s)); }
  return sortTasks(list);
}

// ---------- stats / productivity ----------

function stats(state, date = today()) {
  const { tasks: dayTasks, overdue } = tasksForDay(state, date);
  const done = dayTasks.filter(t => t.status === 'done').length;
  const wk = tasksForWeek(state, date);
  const wkAll = wk.days.flatMap(d => d.tasks).concat(wk.weekTasks);
  const wkDone = wkAll.filter(t => t.status === 'done').length;
  const mo = tasksForMonth(state, date);
  const moAll = Object.values(mo.byDay).flat().concat(mo.monthTasks, mo.weekTasks);
  const moDone = moAll.filter(t => t.status === 'done').length;

  // Streak: consecutive days (ending today or yesterday) with >= 1 completion.
  const doneDays = new Set(state.tasks.filter(t => t.doneAt).map(t => fmt(new Date(t.doneAt))));
  let streak = 0;
  let cursor = doneDays.has(date) ? date : addDays(date, -1);
  while (doneDays.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const perProject = state.projects.filter(p => !p.archived).map(p => {
    const all = state.tasks.filter(t => t.project === p.id);
    const open = all.filter(t => t.status !== 'done');
    const doneWeek = wkAll.filter(t => t.project === p.id && t.status === 'done').length;
    const totalWeek = wkAll.filter(t => t.project === p.id).length;
    return { id: p.id, name: p.name, emoji: p.emoji, color: p.color, open: open.length, done: all.length - open.length,
      overdue: open.filter(t => t.scope === 'day' && t.date < date).length, doneWeek, totalWeek, lastActive: p.lastActive };
  });

  return {
    date,
    today: { total: dayTasks.length, done, open: dayTasks.length - done, overdue: overdue.length },
    week: { start: wk.start, end: wk.end, total: wkAll.length, done: wkDone, pct: wkAll.length ? Math.round(100 * wkDone / wkAll.length) : 0 },
    month: { start: mo.start, total: moAll.length, done: moDone, pct: moAll.length ? Math.round(100 * moDone / moAll.length) : 0 },
    streak,
    handoffs: { open: state.handoffs.filter(h => h.status === 'open').length, claimed: state.handoffs.filter(h => h.status === 'claimed').length },
    agents: (() => { const l = listAgents(state, { all: true }); return { total: l.length, active: l.filter(a => a.presence === 'active').length, idle: l.filter(a => a.presence === 'idle').length }; })(),
    inbox: inboxFor(state, ownerKey(state)).length,
    perProject,
    doneAllTime: state.tasks.filter(t => t.status === 'done').length,
  };
}

/** Compact summary for Jean-Claude (desktop) and Claude. */
function summary(state, date = today()) {
  const { tasks, overdue } = tasksForDay(state, date);
  const s = stats(state, date);
  const pname = id => (state.projects.find(p => p.id === id) || {}).name || null;
  const line = t => `${t.status === 'done' ? '✓' : t.status === 'doing' ? '▶' : '·'} ${t.title}${t.project ? ` [${pname(t.project)}]` : ''}${t.assignee ? ` @${t.assignee}` : ''}${t.priority === 1 ? ' !!' : ''}`;
  return {
    date,
    stats: s,
    crew: listAgents(state).map(a => ({ name: a.name, role: a.role, presence: a.presence, doing: a.doing ? a.doing.text : null, project: pname(a.project) })),
    tasks: tasks.map(t => ({ ...t, projectName: pname(t.project) })),
    overdue: overdue.map(t => ({ ...t, projectName: pname(t.project) })),
    text: [
      `${date} — ${s.today.done}/${s.today.total} done${overdue.length ? `, ${overdue.length} overdue` : ''}, week ${s.week.pct}%, streak ${s.streak}d`,
      ...tasks.map(line),
      ...(overdue.length ? ['overdue:', ...overdue.map(line)] : []),
    ].join('\n'),
  };
}

module.exports = {
  extensions,
  DATA_DIR, DATA_FILE, DEFAULT_PORT, SCOPES, STATUSES, RECURS, PALETTE,
  today, addDays, addMonths, weekStart, monthStart, monthEnd, resolveDate, isValidDate, fmt, parse,
  defaultState, load, save, migrate, shortId,
  findProject, addProject, updateProject, deleteProject, touchProject, normalizeRepo,
  HANDOFF_STATUSES, findHandoff, addHandoff, updateHandoff, claimHandoff, noteHandoff, deleteHandoff, filterHandoffs, handoffBriefing,
  DEPARTMENTS, normDept, ownerKey, isOwner, findAgent, presence, checkIn, updateAgent, setDoing, signOff, deleteAgent, listAgents, agentBriefing,
  resolveAddress, findMessage, sendMessage, postEvent, inboxFor, markRead, feed,
  resolveAssignee, assignTask,
  hireSpecialist, setManager, managers, guessDept, routeRequest, createRequest, openRequests, claimRequest,
  slug, setStack, deleteStack, findSkill, addSkill, deleteSkill, filterSkills, skillMarkdown,
  findTask, addTask, updateTask, completeTask, uncompleteTask, deleteTask, reorderTasks, setStatus,
  tasksForDay, tasksForWeek, tasksForMonth, filterTasks, sortTasks, stats, summary,
};
