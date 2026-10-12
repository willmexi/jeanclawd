/* Jean Clawd — web app. Vanilla JS, talks to /api, live-updates over SSE. */
'use strict';

// ---------- dates ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => fmt(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const addMonths = (s, n) => { const d = parse(s); d.setDate(1); d.setMonth(d.getMonth() + n); return fmt(d); };
const weekStart = (s, dow) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7)); return fmt(d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = s => { const d = parse(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const shortDate = s => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const relDay = s => s === today() ? 'Today' : s === addDays(today(), 1) ? 'Tomorrow' : s === addDays(today(), -1) ? 'Yesterday' : '';

// ---------- state ----------
const S = { state: null, view: 'today', date: today(), project: null, editing: null, replyTo: null, msgTo: '' };
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  check: '<svg viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  play: '<svg viewBox="0 0 20 20"><path d="M6.5 4.5v11l9-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 20 20"><path d="M6.5 4.5v11M13.5 4.5v11"/></svg>',
  next: '<svg viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5"/></svg>',
  edit: '<svg viewBox="0 0 20 20"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
  x: '<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  eject: '<svg viewBox="0 0 20 20"><path d="M4 12l6-7 6 7zM4 15.5h12"/></svg>',
  left: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>',
  right: '<svg viewBox="0 0 20 20"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>',
  branch: '<svg viewBox="0 0 20 20"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="15" r="2"/><circle cx="14" cy="8" r="2"/><path d="M6 7v6M14 10c0 3-8 2-8 5"/></svg>',
  reply: '<svg viewBox="0 0 20 20"><path d="M8 5L3.5 9.5 8 14M4 9.5h7.5a5 5 0 0 1 5 5v1"/></svg>',
  msg: '<svg viewBox="0 0 20 20"><path d="M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3h0a2 2 0 0 1-2-2z"/></svg>',
  folder: '<svg viewBox="0 0 20 20"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l1.5 1.5H15.5A1.5 1.5 0 0 1 17 8v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15z"/></svg>',
};

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) { toast(j.error || 'error', true); throw new Error(j.error); }
  return j;
}
async function refresh() { S.state = await api('GET', '/api/state'); applyTheme(); render(); }
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2200); }
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
// The viewer's own choice (sidebar switch, this browser only) wins over the owner's default setting.
const localTheme = () => { try { return localStorage.getItem('jean.theme'); } catch { return null; } };
function applyTheme() {
  const t = localTheme() || (S.state && S.state.settings.theme) || 'system';
  document.documentElement.dataset.theme = t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === t));
}
document.getElementById('themeSwitch').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-set]'); if (!b) return;
  try { localStorage.setItem('jean.theme', b.dataset.themeSet); } catch {}
  applyTheme();
});
darkQuery.addEventListener('change', () => { if (S.state) applyTheme(); });

const project = id => S.state.projects.find(p => p.id === id);
const activeProjects = () => S.state.projects.filter(p => !p.archived);
const visible = t => !S.project || t.project === S.project;
const sortTasks = list => list.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.priority - b.priority || a.order - b.order || a.createdAt.localeCompare(b.createdAt));
const tasksOn = (date, scope = 'day') => sortTasks(S.state.tasks.filter(t => t.scope === scope && t.date === date && visible(t)));
const tasksBetween = (a, b, scope) => sortTasks(S.state.tasks.filter(t => t.scope === scope && t.date >= a && t.date <= b && visible(t)));
const overdue = () => sortTasks(S.state.tasks.filter(t => t.scope === 'day' && t.date < today() && t.status !== 'done' && visible(t)));
const openHandoffs = () => (S.state.handoffs || []).filter(h => h.status !== 'done' && (!S.project || h.project === S.project)).sort((a, b) => (a.status === 'claimed') - (b.status === 'claimed') || a.createdAt.localeCompare(b.createdAt));
// ---------- agents ----------
const owner = () => String(S.state.settings.ownerName || 'owner').trim().toLowerCase() || 'owner';
const presence = a => { if (a.offline) return 'offline'; const m = Date.now() - new Date(a.lastSeen); return m < 20 * 60e3 ? 'active' : a.oncall || m < 3 * 3600e3 ? 'idle' : 'away'; };
const agents = () => (S.state.agents || []).map(a => ({ ...a, presence: presence(a) }))
  .sort((x, y) => ['active', 'idle', 'away', 'offline'].indexOf(x.presence) - ['active', 'idle', 'away', 'offline'].indexOf(y.presence) || y.lastSeen.localeCompare(x.lastSeen));
const agentByName = n => (S.state.agents || []).find(a => a.name.toLowerCase() === String(n || '').toLowerCase());
const ownerInbox = () => (S.state.messages || []).filter(m => m.kind !== 'event' && m.from.toLowerCase() !== owner()
  && (m.to === owner() || m.to === 'all' || m.to.startsWith('#')) && !m.readBy.includes(owner()));
const addrLabel = to => { if (to.startsWith('#')) { const p = project(to.slice(1)); return p ? `#${p.name}` : to; } return to === owner() ? (S.state.settings.ownerName || 'you') : to; };
const who = t => t.assignee ? `<span class="pill" title="assigned to ${esc(t.assignee)}">@${esc(t.assignee)}</span>` : '';
// Status is always a text pill (no dots): Live / Idle / Away, In progress / Done, Open / Claimed.
const pill = (kind, text) => `<span class="pill pill-${kind}">${text}</span>`;
const livePill = p => pill(p, { active: 'Live', idle: 'Idle', away: 'Away', offline: 'Offline' }[p] || p);
const assigneeOptions = sel => `<option value="">${esc(S.state.settings.ownerName || 'Me')} (unassigned)</option>` + agents().filter(a => a.presence !== 'offline' || a.name === sel).map(a => `<option value="${esc(a.name)}" ${sel === a.name ? 'selected' : ''}>@${esc(a.name)}${a.role ? ` · ${esc(a.role)}` : ''}</option>`).join('')
  + (sel && !agentByName(sel) ? `<option value="${esc(sel)}" selected>@${esc(sel)}</option>` : '');
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

// ---------- plugins (docs/PLUGINS.md): window.Jean.onApp(app => …) ----------
const PLUG_VIEWS = {};
window.Jean = window.Jean || {};
const appReady = [];
window.Jean.onApp = fn => { if (S.state) fn(appApi()); else appReady.push(fn); };
function appApi() {
  return {
    state: () => S.state, toast, refresh: () => render(),
    /** a read-only view in the menu: addView('id', { label, title, render: state => html }) */
    addView: (id, def) => {
      PLUG_VIEWS[id] = def;
      const nav = document.getElementById('tabs'); if (nav.querySelector(`[data-view="${id}"]`)) return;
      const b = document.createElement('button'); b.dataset.action = 'view'; b.dataset.view = id;
      b.innerHTML = `<svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" rx="3"/></svg><span>${esc(def.label || id)}</span>`;
      nav.appendChild(b);
    },
  };
}
async function loadPlugins() {
  try {
    for (const p of await (await fetch('/api/plugins?page=app')).json()) {
      for (const href of p.styles) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
      for (const src of p.scripts) { const sc = document.createElement('script'); sc.src = src; document.body.appendChild(sc); }
    }
  } catch {}
}

// ---------- render ----------
function render() {
  const PLAN = ['today', 'week', 'month'];
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view || (b.dataset.group === 'plan' && PLAN.includes(S.view))));
  renderStats();
  renderControls();
  renderSideProjects();
  const m = $('#main');
  const views = { today: renderToday, week: renderWeek, month: renderMonth, crew: renderCrew, playbook: renderPlaybook, projects: renderProjects, settings: renderSettings };
  m.innerHTML = views[S.view] ? views[S.view]() : PLUG_VIEWS[S.view] ? PLUG_VIEWS[S.view].render(S.state) : renderToday();
  if (S.view === 'settings') drawPetPreview();
  drawAvatars(m);
  if (S.view === 'crew') { const f = $('.feed'); if (f) f.scrollTop = f.scrollHeight; markOwnerRead(); }
  const unread = ownerInbox().length, badge = $('#crewBadge');
  if (badge) { badge.hidden = !unread || S.view === 'crew'; badge.textContent = unread; }
}

function renderStats() {
  const t = tasksOn(today()); const done = t.filter(x => x.status === 'done').length;
  const ws = weekStart(today(), S.state.settings.weekStart); const we = addDays(ws, 6);
  const wk = S.state.tasks.filter(x => visible(x) && ((x.scope === 'day' && x.date >= ws && x.date <= we) || (x.scope === 'week' && x.date >= ws && x.date <= we)));
  const wkDone = wk.filter(x => x.status === 'done').length;
  const doneDays = new Set(S.state.tasks.filter(x => x.doneAt).map(x => fmt(new Date(x.doneAt))));
  let streak = 0, cur = doneDays.has(today()) ? today() : addDays(today(), -1);
  while (doneDays.has(cur)) { streak++; cur = addDays(cur, -1); }
  const od = overdue().length;
  $('#stats').innerHTML = `
    <div><b>${done}/${t.length}</b>today</div>
    <div><b>${wk.length ? Math.round(100 * wkDone / wk.length) : 0}%</b>this week</div>
    <div><b class="fire">${streak}</b>day streak</div>
    <div><b class="${od ? 'bad' : ''}">${od}</b>overdue</div>`;
}

function renderSideProjects() {
  const ws = weekStart(today(), S.state.settings.weekStart), we = addDays(ws, 6);
  const row = (p) => {
    const open = p ? S.state.tasks.filter(t => t.project === p.id && t.status !== 'done') : S.state.tasks.filter(t => t.status !== 'done');
    const od = open.filter(t => t.scope === 'day' && t.date < today()).length;
    const thisWeek = open.filter(t => t.date >= ws && t.date <= we).length;
    return `<button class="${(p ? S.project === p.id : !S.project) ? 'active' : ''}" data-action="pfilter" data-id="${p ? p.id : ''}">
      <span class="name">${p ? `${p.emoji} ${esc(p.name)}` : 'All projects'}</span>
      <span class="n ${od ? 'bad' : ''}" title="${od ? od + ' overdue' : thisWeek + ' open this week'}">${od || thisWeek || ''}</span>
    </button>`;
  };
  $('#sideProjects').innerHTML = row(null) + activeProjects().map(row).join('');
}

function renderControls() {
  const c = $('#controls');
  const pj = S.project && project(S.project);
  const scope = pj ? `<small>${pj.emoji} ${esc(pj.name)}</small>` : '';
  if (S.view === 'crew') { const n = agents().filter(a => a.presence === 'active').length; c.innerHTML = `<div><h1 class="page-title">Crew<small>${n} active · ${agents().filter(a => a.presence !== 'offline').length} checked in</small></h1><p class="page-desc">Your crew: company-wide floors and the team on each project. <a href="/dojo.html">Watch them work in the Dojo →</a></p></div><button class="btn primary" data-action="hireopen" style="margin-left:auto">Add specialists</button>`; return; }
  if (PLUG_VIEWS[S.view]) { c.innerHTML = `<div><h1 class="page-title">${esc(PLUG_VIEWS[S.view].title || PLUG_VIEWS[S.view].label || S.view)}</h1></div>`; return; }
  if (S.view === 'playbook') { c.innerHTML = `<div><h1 class="page-title">Playbook</h1><p class="page-desc">Your default stack and the skills the crew has learned, per department. Every agent gets this in its briefing.</p></div>`; return; }
  if (S.view === 'projects') { c.innerHTML = `<div><h1 class="page-title">Projects</h1><p class="page-desc">Everything you're running, and how each one is going.</p></div>`; return; }
  if (S.view === 'settings') { c.innerHTML = `<div><h1 class="page-title">Settings</h1><p class="page-desc">Preferences, Claude access, and the desktop Jean-Claude.</p></div>`; return; }
  let label = '';
  if (S.view === 'today') label = `${relDay(S.date) || DOW[parse(S.date).getDay()]}<small>${longDate(S.date)}</small>`;
  if (S.view === 'week') { const ws = weekStart(S.date, S.state.settings.weekStart); label = `${ws === weekStart(today(), S.state.settings.weekStart) ? 'This week' : 'Week'}<small>${shortDate(ws)} – ${shortDate(addDays(ws, 6))}</small>`; }
  if (S.view === 'month') { const d = parse(S.date); label = `${MONTHS[d.getMonth()]}<small>${d.getFullYear()}</small>`; }
  const seg = [['today', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button class="${S.view === v ? 'on' : ''}" data-action="view" data-view="${v}">${l}</button>`).join('');
  c.innerHTML = `
    <div><h1 class="page-title">${label}${scope}</h1></div>
    <div class="planswitch" role="group" aria-label="Planning range">${seg}</div>
    <div class="datenav">
      <button data-action="nav" data-n="-1" title="previous">${I.left}</button>
      <button data-action="today">Today</button>
      <button data-action="nav" data-n="1" title="next">${I.right}</button>
    </div>`;
}

function taskRow(t, opts = {}) {
  const pj = project(t.project);
  const isOverdue = t.scope === 'day' && t.date < today() && t.status !== 'done';
  return `<li class="task ${t.status} ${isOverdue ? 'overdue' : ''} ${opts.compact ? 'compact' : ''}" data-id="${t.id}" data-action="tshow">
    <div class="body">
      <div class="title">${esc(t.title)}${t.status === 'doing' ? ' ' + pill('doing', 'In progress') : ''}</div>${opts.compact && t.assignee ? `<div class="cwho">${who(t)}</div>` : ''}
      <div class="meta">
        ${t.priority !== 2 ? `<span class="pri pri-${t.priority}">${t.priority === 1 ? 'Urgent' : 'Low'}</span>` : ''}
        ${who(t)}
        ${pj ? `<span class="pill" data-action="pfilter" data-id="${pj.id}">${esc(pj.name)}</span>` : ''}
        ${opts.showDate !== false && (t.scope !== 'day' || isOverdue || opts.showDate) ? `<span class="date">${t.scope !== 'day' ? t.scope + ' · ' : ''}${shortDate(t.date)}</span>` : ''}
        ${t.recur ? `<span>repeats ${t.recur}</span>` : ''}
      </div>
      ${t.notes ? `<div class="notes" title="${esc(t.notes)}">${esc(t.notes)}</div>` : ''}
    </div>
  </li>`;
}
const list = (tasks, opts, empty = 'nothing here') => tasks.length ? `<ul class="tasks">${tasks.map(t => taskRow(t, opts)).join('')}</ul>` : `<div class="empty">${empty}</div>`;
const progress = (tasks, cls = '') => { const d = tasks.filter(t => t.status === 'done').length; return tasks.length ? `<div class="progress ${cls}"><i style="width:${100 * d / tasks.length}%"></i></div>` : ''; };
const pjOptions = sel => `<option value="">no project</option>` + activeProjects().map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${p.emoji} ${esc(p.name)}</option>`).join('');
// Jean is run by AI agents: the app shows the plan, Claude / Codex / any agent changes it.
const askAI = text => `<div class="askai">${I.msg}<span>${text}</span></div>`;

function renderToday() {
  const t = tasksOn(S.date);
  const od = S.date === today() ? overdue() : [];
  const ws = weekStart(S.date, S.state.settings.weekStart);
  const wk = tasksBetween(ws, addDays(ws, 6), 'week');
  const mo = tasksBetween(S.date.slice(0, 8) + '01', addDays(addMonths(S.date, 1), -1), 'month');
  const done = t.filter(x => x.status === 'done').length;
  const journal = S.state.journal[S.date] || '';
  return `<div class="grid2">
    <div class="stack">
      <div class="card">
        <h3>Plan <span class="count">${done} of ${t.length} done</span></h3>
        ${progress(t)}
        ${list(S.state.settings.showDone ? t : t.filter(x => x.status !== 'done'), {}, 'Nothing planned yet. Ask Claude to plan your day.')}
      </div>
      ${od.length ? `<div class="card"><h3 class="danger">Overdue <span class="count">${od.length}</span></h3>${list(od, { showDate: true })}${askAI('Ask Claude what to move, keep or drop.')}</div>` : ''}
      ${renderHandoffs()}
    </div>
    <div class="stack">
      ${renderCrewNow()}
      <div class="card"><h3>This week <span class="count">${wk.filter(x => x.status === 'done').length} of ${wk.length}</span></h3>${progress(wk, 'green')}
        ${list(wk, { compact: true }, 'No week goals yet.')}</div>
      <div class="card"><h3>This month <span class="count">${mo.filter(x => x.status === 'done').length} of ${mo.length}</span></h3>${progress(mo, 'green')}
        ${list(mo, { compact: true }, 'No month goals yet.')}</div>
      <div class="card"><h3>Journal</h3>
        ${journal ? `<div class="journal-text">${esc(journal)}</div>` : '<div class="empty">Nothing written for this day. Tell Claude how it went and it keeps the journal.</div>'}
      </div>
    </div>
  </div>`;
}

function renderCrewNow() {
  const list = agents().filter(a => a.presence !== 'offline' && a.presence !== 'away' && (!S.project || a.project === S.project));
  const unread = ownerInbox().length;
  if (!list.length && !unread) return '';
  return `<div class="card"><h3>Crew now <span class="count">${list.length}</span>${unread ? ` <button class="btn small" data-action="view" data-view="crew">${unread} new message${unread === 1 ? '' : 's'}</button>` : ''}</h3>
    <ul class="crewmini">${list.map(a => `<li>${livePill(a.presence)}<b>${esc(a.name)}</b><span class="doing">${a.doing ? esc(a.doing.text) : '<i>nothing set</i>'}</span></li>`).join('')}</ul></div>`;
}

// Departments (the Dojo's floors): the agent's own setting, else guessed from its role, like the Dojo does.
const FLOORS = { marketing: 'Marketing', finance: 'Finance', backoffice: 'Back office', tech: 'Tech', external: 'External API' };
function floorOf(a) {
  if (a.department && FLOORS[a.department]) return a.department;
  if (a.kind === 'a2a' || a.kind === 'a2a-client' || a.a2a) return 'external';
  const t = `${a.role || ''} ${a.name}`.toLowerCase();
  if (/financ|invoice|billing|stripe|payment|accounting|tax|budget|revenue/.test(t)) return 'finance';
  if (/market|seo|content|social|brand|landing|copy|campaign|growth|design|deck|pitch/.test(t)) return 'marketing';
  if (/extern|a2a|integration|webhook|partner/.test(t)) return 'external';
  if (/back.?office|admin|ops\b|support|onboard|planner|planning|customer/.test(t)) return 'backoffice';
  return 'tech';
}
const avatarPalette = color => ({ ...JeanSprite.PALETTE, O: color || '#D97757', o: color || '#B35C3E' });
function drawAvatars(root = document) {
  root.querySelectorAll('canvas[data-sprite]').forEach(c => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, c.width, c.height); JeanSprite.draw(x, c.dataset.frame || 'idle', 2, avatarPalette(c.dataset.sprite)); });
}
function avatar(a) {
  const pj = project(a.project);
  const top = a.manager ? `${FLOORS[floorOf(a)]} manager` : pj ? pj.name : FLOORS[floorOf(a)];
  const working = a.presence === 'active' && a.doing;
  return `<div class="avatar ${a.presence}" data-action="ashow" data-agent="${esc(a.name)}" title="${esc(a.role || a.name)}">
    <canvas width="64" height="56" data-sprite="${esc(a.color || '')}" data-frame="${working ? 'typeA' : a.presence === 'away' ? 'sitSleep' : 'idle'}"></canvas>
    <div class="ntag"><small>${esc(top)}</small><b>${esc(a.name)}</b></div>
    ${livePill(a.presence)}
    <div class="adoing">${a.doing ? esc(a.doing.text) : '<i>nothing set</i>'}</div>
  </div>`;
}
function renderCrew() {
  const list = agents().filter(a => a.presence !== 'offline' || S.showOffline);
  // company-wide: managers and agents not tied to a project, by floor · project teams: the rest
  const shared = list.filter(a => a.manager || !a.project);
  const byProject = activeProjects().map(p => ({ p, team: list.filter(a => a.project === p.id && !a.manager), open: S.state.tasks.filter(t => t.project === p.id && t.status !== 'done').length })).filter(x => x.team.length);
  const floors = Object.keys(FLOORS).map(f => ({ f, team: shared.filter(a => floorOf(a) === f).sort((x, y) => (y.manager === true) - (x.manager === true)) })).filter(x => x.team.length);
  const cards = `
    <div class="card team"><h3>Company-wide <span class="count">shared floors · serve every project</span></h3>
      ${floors.map(x => `<div class="floorrow"><div class="flabel">${FLOORS[x.f]}</div><div class="avatars">${x.team.map(avatar).join('')}</div></div>`).join('') || '<div class="empty">No shared agents yet. Make one the manager of a floor: <b>jean agent manager &lt;name&gt; marketing</b></div>'}
    </div>
    <div class="teams">${byProject.map(x => `<div class="card team"><h3>${esc(x.p.emoji || '')} ${esc(x.p.name)} <span class="count">${x.team.length} agent${x.team.length === 1 ? '' : 's'} · ${x.open} open</span></h3><div class="avatars">${x.team.map(avatar).join('')}</div></div>`).join('')}</div>`;
  const offline = agents().filter(a => a.presence === 'offline').length;
  return `<div class="stack crewpage">
      ${list.length ? cards : `<div class="card empty">No agents yet. A Claude session joins with <b>jean hello --role "what it is for"</b>, or automatically with <b>jean setup --hooks</b>.</div>`}
      ${offline ? `<button class="btn small ghost" data-action="aoffline">${S.showOffline ? 'Hide' : 'Show'} ${offline} signed-off agent${offline === 1 ? '' : 's'}</button>` : ''}
      ${askAI('Talk to the crew in the Dojo (chat, or click an agent), or tell Claude: “ask codex-kiteshop …”.')}
    </div>`;
}

let markingRead = false;
async function markOwnerRead() {
  const ids = ownerInbox().map(m => m.id);
  if (!ids.length || markingRead) return;
  markingRead = true;
  try { await api('POST', `/api/inbox/${encodeURIComponent(owner())}/read`, { ids }); } finally { markingRead = false; }
}

const DEPT_NAMES = { tech: 'Tech', marketing: 'Marketing', backoffice: 'Back office', finance: 'Finance', external: 'External API' };
const DEPT_COLORS = { tech: '#6a9be6', marketing: '#ff4f8b', finance: '#4fb47a', backoffice: '#e8b54a', external: '#b392f0' };
function renderPlaybook() {
  const stack = S.state.stack || [], skills = S.state.skills || [];
  const stackRows = stack.map(e => `<div class="kvrow"><span>${esc(e.area)}</span><b>${esc(e.choice)}${e.notes ? `<small>${esc(e.notes)}</small>` : ''}</b></div>`).join('');
  const groups = Object.keys(DEPT_NAMES).map(d => ({ d, list: skills.filter(k => k.dept === d) })).filter(g => g.list.length);
  return `<div class="grid2">
    <div class="stack">
      <div class="card"><h3>Skills <span class="count">${skills.length}</span></h3>
        ${groups.map(g => `<div class="dhead">${DEPT_NAMES[g.d]}</div>
          <ul class="tasks">${g.list.map(k => `<li class="task skill" data-action="kshow" data-kid="${k.id}">            <div class="body"><div class="title">${esc(k.name)}</div><div class="meta">${k.summary ? `<span>${esc(k.summary)}</span>` : ''}${k.tools.map(t => `<span class="toolchip">${esc(t)}</span>`).join('')}${k.author ? `<span>by ${esc(k.author)}</span>` : ''}</div></div></li>`).join('')}</ul>`).join('')
        || '<div class="empty">No skills yet. When an agent figures out something reusable (say, generating images with Gemini), it writes it down with <b>jean learn</b> and every other agent can use it.</div>'}
      </div>
    </div>
    <div class="stack">
      <div class="card"><h3>Stack <span class="count">${stack.length}</span></h3>
        ${stackRows || '<div class="empty">No defaults yet. Tell Claude your stack, e.g. “we use Supabase, deploy on GCP, React front ends”.</div>'}
        ${askAI('Agents check this before picking a tool, in every project.')}
      </div>
    </div>
  </div>`;
}
function openSkill(k) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="modal"><h2>${esc(k.name)} <span class="count">${esc(DEPT_NAMES[k.dept] || k.dept)}</span></h2>
    ${k.summary ? `<p class="lead">${esc(k.summary)}</p>` : ''}
    ${k.tools.length ? `<div class="meta">${k.tools.map(t => `<span class="toolchip">${esc(t)}</span>`).join('')}${k.author ? `<span>learned by ${esc(k.author)}</span>` : ''}</div>` : ''}
    <div class="field"><label>Steps</label><div class="text notes-full">${esc(k.body || 'No steps written yet.')}</div></div>
    ${k.install ? `<div class="field"><label>Setup</label><div class="text notes-full">${esc(k.install)}</div></div>` : ''}
    <div class="field"><label>Add it to Claude Code (ask an agent, or run)</label><pre class="code">jean skill install ${k.id.slice(2)}            # every session
jean skill install ${k.id.slice(2)} --project  # this repo only</pre></div>
    <div class="foot"><button type="button" class="btn" data-action="editclose">Close</button></div>
  </div>`;
}

function renderHandoffs() {
  const hs = openHandoffs();
  if (!hs.length) return '';
  const rows = hs.map(h => {
    const pj = project(h.project);
    return `<li class="handoff ${h.status}" data-hid="${h.id}">
      <div class="body" data-action="hshow">
        <div class="title">${esc(h.title)} ${pill(h.status === 'claimed' ? 'doing' : 'open', h.status === 'claimed' ? 'Claimed' : 'Open')}</div>
        <div class="meta">
          ${pj ? `<span class="pill">${esc(pj.name)}</span>` : ''}
          <span>${h.status === 'claimed' ? `claimed by ${esc(h.claimedBy || 'someone')}` : `${h.next.length} next step${h.next.length === 1 ? '' : 's'} · from ${esc(h.from)}`}</span>
          <span class="date">${ago(h.createdAt)}</span>
        </div>
      </div>
    </li>`;
  }).join('');
  return `<div class="card"><h3>Claude handoffs <span class="count">${hs.length}</span></h3>
    <div class="hint">Work one Claude instance parked for another. Pick one up in any session: <code>jean handoff take</code></div>
    <ul class="tasks">${rows}</ul></div>`;
}

function openHandoff(h) {
  const pj = project(h.project);
  const m = $('#modal'); m.hidden = false;
  const sec = (label, html) => html ? `<div class="field"><label>${label}</label><div class="text">${html}</div></div>` : '';
  m.innerHTML = `<div class="modal"><h2>${esc(h.title)} <span class="count">${h.status}</span></h2>
    <div class="meta">
      ${pj ? `<span>${pj.emoji} ${esc(pj.name)}</span>` : ''}
      <span>from ${esc(h.from)}</span><span>${ago(h.createdAt)}</span>
      ${h.claimedBy ? `<span>claimed by ${esc(h.claimedBy)}</span>` : ''}
    </div>
    ${sec('Where', [h.cwd && `${esc(h.cwd)}`, h.branch && `${esc(h.branch)}${h.commit ? ` @ ${esc(h.commit.slice(0, 8))}` : ''}`].filter(Boolean).map(x => `<code>${x}</code>`).join('<br>'))}
    ${sec('Context', esc(h.context).replace(/\n/g, '<br>'))}
    ${sec('Next steps', h.next.length ? `<ol>${h.next.map(n => `<li>${esc(n)}</li>`).join('')}</ol>` : '')}
    ${sec('Blockers', esc(h.blockers).replace(/\n/g, '<br>'))}
    ${sec('Files', h.files.map(f => `<code>${esc(f)}</code>`).join('<br>'))}
    ${sec('Progress notes', h.notes.map(n => `<div class="note"><b>${esc(n.by)}</b><span>${ago(n.at)}</span>${esc(n.text)}</div>`).join(''))}
    <div class="field"><label>Pick it up in a Claude session</label><pre class="code">jean handoff take ${h.id.slice(2)}</pre></div>
    <div class="foot"><button type="button" class="btn" data-action="editclose">Close</button></div>
  </div>`;
}

function renderWeek() {
  const ws = weekStart(S.date, S.state.settings.weekStart);
  const wk = tasksBetween(ws, addDays(ws, 6), 'week');
  let cols = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i); const t = tasksOn(d); const dn = t.filter(x => x.status === 'done').length;
    cols += `<div class="daycol ${d === today() ? 'today' : ''} ${d < today() ? 'past' : ''}">
      <h4><span><b>${DOW[parse(d).getDay()]}</b> ${shortDate(d)}</span><span>${t.length ? `${dn}/${t.length}` : ''}</span></h4>
      ${t.length ? list(t, { compact: true }, '') : '<div class="empty-day"></div>'}
    </div>`;
  }
  return `<div class="card"><h3>Week goals <span class="count">${wk.filter(x => x.status === 'done').length} of ${wk.length}</span></h3>${progress(wk, 'green')}
    ${list(wk, { compact: true }, 'No week goals yet. Ask Claude to set this week up.')}</div>
    <div class="week">${cols}</div>`;
}

function renderMonth() {
  const first = S.date.slice(0, 8) + '01'; const last = addDays(addMonths(first, 1), -1);
  const mo = tasksBetween(first, last, 'month');
  const wkGoals = tasksBetween(first, last, 'week');
  const start = weekStart(first, S.state.settings.weekStart);
  let cells = '';
  for (let i = 0; i < 7; i++) cells += `<div class="dow">${DOW[(S.state.settings.weekStart + i) % 7]}</div>`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); if (i >= 35 && d > last) break;
    const t = tasksOn(d); const dn = t.filter(x => x.status === 'done').length;
    const shown = t.slice(0, 3);
    cells += `<div class="cell ${d.slice(0, 7) !== first.slice(0, 7) ? 'other' : ''} ${d === today() ? 'today' : ''}" data-action="goday" data-date="${d}">
      <div class="n"><b>${parse(d).getDate()}</b>${t.length ? `<span class="pct">${dn}/${t.length}</span>` : ''}</div>
      ${shown.map(x => { const pj = project(x.project); return `<div class="t ${x.status}" title="${esc(x.title)}${pj ? ' · ' + esc(pj.name) : ''}">${esc(x.title)}</div>`; }).join('')}
      ${t.length > 3 ? `<div class="more">+${t.length - 3} more</div>` : ''}
    </div>`;
  }
  return `<div class="grid2" style="grid-template-columns: minmax(0,2.2fr) minmax(280px,.8fr)">
    <div class="month">${cells}</div>
    <div class="stack">
      <div class="card"><h3>Month goals <span class="count">${mo.filter(x => x.status === 'done').length} of ${mo.length}</span></h3>${progress(mo, 'green')}
        ${list(mo, { compact: true }, 'No month goals yet.')}</div>
      <div class="card"><h3>Week goals this month <span class="count">${wkGoals.length}</span></h3>${list(wkGoals, { compact: true, showDate: true }, 'None.')}</div>
    </div>
  </div>`;
}

function renderProjects() {
  const ws = weekStart(today(), S.state.settings.weekStart), we = addDays(ws, 6);
  const cards = S.state.projects.slice().sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || '')).map(p => {
    const all = S.state.tasks.filter(t => t.project === p.id);
    const open = all.filter(t => t.status !== 'done');
    const od = open.filter(t => t.scope === 'day' && t.date < today());
    const wk = all.filter(t => t.date >= ws && t.date <= we && t.scope !== 'month');
    const wkDone = wk.filter(t => t.status === 'done').length;
    const ago = p.lastActive ? Math.round((Date.now() - new Date(p.lastActive)) / 864e5) : null;
    const repoLabel = p.repo ? p.repo.replace(/^https?:\/\/(www\.)?/, '') : '';
    return `<div class="cocard ${p.archived ? 'archived' : ''}" data-id="${p.id}">
      <div class="head"><span class="emoji">${p.emoji}</span><span class="name">${esc(p.name)}</span>${p.archived ? '<span class="tag">archived</span>' : ''}</div>
      <div class="desc ${p.description ? '' : 'placeholder'}">${esc(p.description || 'No description yet.')}</div>
      <div class="links">
        ${p.repo ? `<a href="${esc(p.repo)}" target="_blank" rel="noopener">${I.branch}<span>${esc(repoLabel)}</span></a>` : `<span class="muted">${I.branch}<span>No repo linked</span></span>`}
        ${p.path ? `<span title="${esc(p.path)}">${I.folder}<span>${esc(p.path.replace(/^\/Users\/[^/]+/, '~'))}</span></span>` : `<span class="muted">${I.folder}<span>No folder</span></span>`}
      </div>
      <div class="nums"><div><b>${open.length}</b>open</div><div class="${od.length ? 'bad' : ''}"><b>${od.length}</b>overdue</div><div><b>${wk.length ? Math.round(100 * wkDone / wk.length) : 0}%</b>this week</div><div><b>${all.length - open.length}</b>done</div><div><b>${ago === null ? '–' : ago === 0 ? 'today' : ago + 'd'}</b>active</div></div>
      ${progress(wk)}
      <div class="foot"><button class="btn small" data-action="pfocus">View tasks →</button></div>
    </div>`;
  }).join('');
  return `<div class="stack">${askAI('New project? Open Claude in its folder and say “jean init”. Renaming, archiving, linking a repo: just ask.')}
    <div class="cogrid">${cards || '<div class="empty">No projects yet.</div>'}</div></div>`;
}

function renderSettings() {
  const s = S.state.settings;
  const proj = s.defaultProject ? project(s.defaultProject) : null;
  const row = (k, v) => `<div class="kvrow"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="settings">
    <div class="card"><h3>Preferences</h3>
      ${row('Your name', esc(s.ownerName || '—'))}
      ${row('Theme', { light: 'Light', dark: 'Dark' }[s.theme] || 'Follows your Mac (light / dark)')}
      ${row('Week starts on', s.weekStart == 0 ? 'Sunday' : 'Monday')}
      ${row('Default view', esc(s.defaultView || 'today'))}
      ${row('Default project', proj ? `${proj.emoji} ${esc(proj.name)}` : 'none')}
      ${row('Show finished tasks', s.showDone ? 'yes' : 'no')}
      ${row('Jean-Claude one-liners', s.petQuips ? 'on' : 'off')}
      ${row('Server port', s.port)}
      ${askAI('Want something different? Ask Claude, e.g. “set Jean to light mode” (jean settings theme light|dark|system).')}
    </div>
    <div class="card"><h3>Crew setup</h3>
      <p>Add specialists: Claude skill packs (designer, writer, documents, finance analyst, QA, senior engineer, integrations, skill smith) that join your crew as on-call agents.</p>
      <div class="kvrow"><span>Specialists in your crew</span><b>${(S.state.agents || []).filter(a => a.specialist).map(a => esc(a.name)).join(', ') || 'none yet'}</b></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-action="hireopen">Add specialists</button></div>
    </div>
    <div class="card"><h3>Who controls Jean</h3>
      <p>Only AI agents change the plan: Claude Code, Codex, Claude Desktop, cron agents, anything that speaks the protocol. This app is the monitor. Browsers can read but never write; the server refuses it.</p>
      <pre class="code"><b>jean today</b> · <b>jean week</b> · <b>jean add</b> "…" -P kiteshop -d fri -p 1 · <b>jean done</b> k3m2x
<b>jean init</b> "what this repo is"    <b>jean settings</b> theme light
<b>jean hello</b> · <b>jean agents</b> · <b>jean send</b> codex-kiteshop "…" · <b>jean ask</b> owner "…"
MCP: jean_* tools  ·  HTTP: /v1 (PROTOCOL.md)  ·  A2A: /.well-known/agent-card.json</pre>
      <div class="kv">Data file: <b id="dataFile">…</b></div>
    </div>
    <div class="card"><h3>Jean-Claude on your desktop</h3>
      <div class="pet-preview"><canvas id="petPreview" width="128" height="112"></canvas>
        <div>
          <p>The Muscles from Brussels lives above your Dock: he walks around, performs stunts from his films and speaks your plan and the agents' messages to you. <kbd>⌘J</kbd> hides him, <kbd>⌘E</kbd> pauses his walking.</p>
          <div class="kv">Status: <b id="petStatus">checking…</b></div>
        </div>
      </div>
    </div>
    <div class="card"><h3>Data</h3>
      <p>Everything is one JSON file. Agents read and write it through Jean; you can take a copy any time.</p>
      <div class="row"><button class="btn" data-action="export">Download a copy (JSON)</button></div>
    </div>
  </div>`;
}

function drawPetPreview() {
  const c = $('#petPreview'); if (!c) return;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  let i = 0; const frames = ['idle', 'walkA', 'walkB', 'walkA', 'splits', 'splits', 'epicSplit', 'epicSplit', 'danceA', 'danceB', 'danceA', 'danceB', 'treeKickB', 'treeKickA', 'treeKickA', 'double', 'double', 'flashKickA', 'kick', 'salute', 'salute', 'mulletA', 'mulletB', 'guardA', 'guardB'];
  clearInterval(drawPetPreview._t);
  const tick = () => { ctx.clearRect(0, 0, c.width, c.height); JeanSprite.draw(ctx, frames[i++ % frames.length], 4); };
  tick(); drawPetPreview._t = setInterval(tick, 380);
  api('GET', '/api/health').then(h => { const el = $('#dataFile'); if (el) el.textContent = h.dataFile; });
  api('GET', '/api/jc/status').then(p => { const el = $('#petStatus'); if (el) el.textContent = p.online ? 'on screen 🟢' : 'not running — open JeanClawd.app'; });
}

// ---------- read-only task detail ----------
function openTask(t) {
  const pj = project(t.project);
  const m = $('#modal'); m.hidden = false;
  const f = (label, html) => html ? `<div class="kvrow"><span>${label}</span><b>${html}</b></div>` : '';
  m.innerHTML = `<div class="modal"><h2>${esc(t.title)} <span class="count">${t.status}</span></h2>
    ${f('Project', pj ? `${pj.emoji} ${esc(pj.name)}` : '')}
    ${f('When', `${t.scope === 'day' ? longDate(t.date) : `${t.scope} goal · ${shortDate(t.date)}`}`)}
    ${f('Priority', { 1: 'Urgent', 2: 'Normal', 3: 'Low' }[t.priority])}
    ${f('Assigned to', t.assignee ? `@${esc(t.assignee)}` : esc(S.state.settings.ownerName || 'you'))}
    ${f('Repeats', t.recur || '')}
    ${f('Created', `${ago(t.createdAt)}${t.createdBy ? ` by ${esc(t.createdBy)}` : ''}`)}
    ${f('Finished', t.doneAt ? ago(t.doneAt) : '')}
    ${t.notes ? `<div class="field"><label>Notes</label><div class="text notes-full">${esc(t.notes)}</div></div>` : ''}
    <div class="field"><label>Change it by asking Claude</label><pre class="code">jean move ${t.id.slice(2)} tomorrow   ·   jean done ${t.id.slice(2)}   ·   jean assign ${t.id.slice(2)} &lt;agent&gt;</pre></div>
    <div class="foot"><button type="button" class="btn" data-action="editclose">Close</button></div>
  </div>`;
}
function openAgent(a) {
  const m = $('#modal'); m.hidden = false;
  const pj = project(a.project);
  const tasks = sortTasks(S.state.tasks.filter(t => t.assignee === a.name && t.status !== 'done'));
  const msgs = (S.state.messages || []).filter(x => x.kind !== 'event' && (x.from === a.name || x.to === a.name)).slice(-6).reverse();
  const f = (label, html) => html ? `<div class="kvrow"><span>${label}</span><b>${html}</b></div>` : '';
  m.innerHTML = `<div class="modal"><div class="agenthead"><canvas width="64" height="56" data-sprite="${esc(a.color || '')}" data-frame="idle"></canvas><div><h2>${esc(a.name)}</h2><p class="lead">${esc(a.role || 'no role yet')}</p>${livePill(a.presence)}</div></div>
    ${f('Floor', `${FLOORS[floorOf(a)]}${a.manager ? ' · manager (serves every project)' : ''}`)}${f('Project', pj ? esc(pj.name) : 'company-wide')}${f('Doing', a.doing ? esc(a.doing.text) : '')}${f('Tool', esc(a.kind || ''))}${f('Seen', ago(a.lastSeen))}
    ${tasks.length ? `<div class="field"><label>Tasks</label><ul class="tasks">${tasks.map(t => taskRow(t, { compact: true })).join('')}</ul></div>` : ''}
    ${msgs.length ? `<div class="field"><label>Recent messages</label>${msgs.map(x => `<div class="note"><b>${esc(x.from)}</b><span>→ ${esc(addrLabel(x.to))}</span> ${esc(x.text.slice(0, 160))}</div>`).join('')}</div>` : ''}
    <div class="field"><label>Talk to ${esc(a.name)}</label>${askAI('Open the Dojo and click them, or tell Claude: “ask ' + esc(a.name) + ' …”.')}</div>
    <div class="foot"><a class="btn" href="/dojo.html">Open the Dojo</a><button type="button" class="btn" data-action="editclose">Close</button></div></div>`;
  drawAvatars(m);
}
// ---------- hire specialists: Claude skill packs that join the crew ----------
async function openHire() {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = '<div class="modal wide"><h2>Add specialists</h2><div class="empty">Loading the catalog…</div></div>';
  let list = [];
  try { list = await api('GET', '/api/catalog'); } catch { return; }
  const groups = Object.keys(FLOORS).map(f => ({ f, items: list.filter(c => c.floor === f) })).filter(g => g.items.length);
  m.innerHTML = `<div class="modal wide"><h2>Add specialists <span class="count">${list.filter(c => c.hired).length} in your crew</span></h2>
    <p class="lead">Each specialist is a Claude skill pack that joins your crew as an on-call agent on its floor. Jean routes matching work to it, its skills go into your Playbook, and the plugin is installed into Claude Code on this machine. Any Claude session can work as it with <code>jean become &lt;name&gt;</code>.</p>
    ${groups.map(g => `<div class="hiregroup"><div class="flabel">${FLOORS[g.f]}</div><div class="hiregrid">${g.items.map(c => `
      <div class="hirecard ${c.hired ? 'hired' : ''}">
        <div class="hirehead"><canvas width="64" height="56" data-sprite="${{ marketing: '#F28CB1', finance: '#F2C14E', backoffice: '#B392F0', tech: '#6FA8DC', external: '#5FB3B3' }[c.floor]}" data-frame="idle"></canvas><div><b>${esc(c.title)}</b><small>@${esc(c.name)}</small></div></div>
        <p>${esc(c.summary)}</p>
        <div class="skillchips">${c.skills.map(k => `<span class="pill" title="${esc(k.does)}">${esc(k.name)}</span>`).join('')}</div>
        <p class="use"><span>Use it for</span> ${esc(c.use)}</p>
        <div class="hirefoot"><small>${esc(c.source)}</small>${c.hired ? '<span class="pill pill-done">In your crew</span>' : `<button class="btn primary small" data-action="hire" data-id="${esc(c.id)}">Add to crew</button>`}</div>
      </div>`).join('')}</div></div>`).join('')}
    <div class="foot"><button type="button" class="btn" data-action="editclose">Done</button></div></div>`;
  drawAvatars(m);
}

function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; S.editing = null; }

// ---------- events (navigation only: nothing here changes the plan) ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action; const row = e.target.closest('.task'); const id = row && row.dataset.id;
  if (a === 'view') { S.view = el.dataset.view; render(); }
  else if (a === 'nav') { const n = Number(el.dataset.n); S.date = S.view === 'month' ? addMonths(S.date, n) : addDays(S.date, S.view === 'week' ? 7 * n : n); render(); }
  else if (a === 'today') { S.date = today(); render(); }
  else if (a === 'pfilter') { e.stopPropagation(); S.project = el.dataset.id || null; if (S.view === 'projects' && el.dataset.id) S.view = 'today'; render(); }
  else if (a === 'goday') { S.date = el.dataset.date; S.view = 'today'; render(); }
  else if (a === 'kshow') { const k = (S.state.skills || []).find(x => x.id === el.dataset.kid); if (k) openSkill(k); }
  else if (a === 'hireopen') openHire();
  else if (a === 'hire') {
    el.disabled = true; el.textContent = 'Adding…';
    try { const r = await api('POST', '/api/crew/hire', { id: el.dataset.id }); toast(r.already ? `${r.agent} is already in your crew` : `${r.agent} joined the crew${r.installing ? ' · installing its skills in Claude Code' : ''}`); openHire(); } catch { el.disabled = false; el.textContent = 'Add to crew'; }
  }
  else if (a === 'ashow') { const ag = agents().find(x => x.name === el.dataset.agent); if (ag) openAgent(ag); }
  else if (a === 'tshow') { const t = S.state.tasks.find(x => x.id === id); if (t) openTask(t); }
  else if (a === 'hshow') { const h = S.state.handoffs.find(x => x.id === e.target.closest('.handoff').dataset.hid); if (h) openHandoff(h); }
  else if (a === 'editclose') closeModal();
  else if (a === 'aoffline') { S.showOffline = !S.showOffline; render(); }
  else if (a === 'pfocus') { S.project = e.target.closest('.cocard').dataset.id; S.view = 'today'; render(); }
  else if (a === 'export') { const blob = new Blob([JSON.stringify(S.state, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `jean-clawd-${today()}.json`; l.click(); }
  if (e.target === $('#modal')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable || e.metaKey || e.ctrlKey) return;
  const keys = { t: 'today', w: 'week', m: 'month', c: 'crew', b: 'playbook', p: 'projects', ',': 'settings' };
  if (keys[e.key]) { S.view = keys[e.key]; render(); }
  if (e.key === 'd') location.href = '/dojo.html';
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') $(`[data-action=nav][data-n="${e.key === 'ArrowLeft' ? -1 : 1}"]`)?.click();
});

// ---------- live updates ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('changed', () => refresh().catch(() => {}));
  es.addEventListener('jc', ev => { const d = JSON.parse(ev.data); toast(`🥋 ${d.text}`); });
  es.addEventListener('message', ev => { const d = JSON.parse(ev.data); if (S.view !== 'crew' && d.from !== owner() && (d.to === owner() || d.to === 'all')) toast(`💬 ${d.from}: ${d.text}`); });
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}

// ---------- boot ----------
(function drawLogo() {
  const c = $('#logo'); const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const off = document.createElement('canvas'); off.width = 64; off.height = 56;
  JeanSprite.draw(off.getContext('2d'), 'idle', 2);
  ctx.drawImage(off, 16, 0, 32, 56, 0, 0, 32, 56);
  // favicon from the same sprite
  const f = document.createElement('canvas'); f.width = 64; f.height = 64; const fc = f.getContext('2d');
  fc.fillStyle = '#D97757'; fc.beginPath(); fc.roundRect(0, 0, 64, 64, 14); fc.fill();
  const t = document.createElement('canvas'); t.width = 64; t.height = 56;
  JeanSprite.draw(t.getContext('2d'), 'idle', 2, { K: '#8A3E24', H: '#F4EDE4', h: '#F4EDE4', S: '#FBD6B8', s: '#F0C29C', O: '#F4EDE4', o: '#EADFD0', P: '#F0B896', G: '#F4EDE4', M: '#C2643F', W: '#fff' });
  fc.drawImage(t, 16, 0, 32, 56, 16, 4, 32, 56);
  $('link[rel=icon]').href = f.toDataURL();
})();
refresh().then(() => { S.view = S.state.settings.defaultView || 'today'; render(); connect(); appReady.splice(0).forEach(fn => { try { fn(appApi()); } catch (e) { console.error(e); } }); loadPlugins(); })
  .catch(() => { $('#main').innerHTML = '<div class="card empty">Cannot reach the server. Start it with <b>jean serve</b>.</div>'; });
