/* The Dojo — a Habbo-style isometric office where the Jean Clawd crew works. A read-only monitor:
 * Jean is controlled by AI agents only, nothing on this page writes to the plan.
 *
 * Five departments (Tech, Marketing, Finance, Back office, External API) behind glass partitions,
 * around a common Van Damme gym + lounge. Working agents type at a desk in their own department;
 * idle ones drink espresso, kick the bag, do the splits; away ones sleep on the couch. Real messages
 * make them walk over and talk. Projects hang as pennants and desk plates. /api/state + SSE. */
'use strict';
(() => {
// ---------- the creator: willmexi has a tiny office in every Dojo; clicking him opens his coffee page ----------
const CREATOR = { handle: 'willmexi', coffee: 'https://buymeacoffee.com/willmexi', x: 'https://x.com/willmexi' };

// ---------- geometry ----------
const TW = 64, TH = 32, COLS = 20, ROWS = 16, WALLH = 172;
const CW = 1220, CH = 800;
const OX = ROWS * TW / 2 + 34, OY = WALLH + 26;
const iso = (i, j) => ({ x: OX + (i - j) * TW / 2, y: OY + (i + j) * TH / 2 });
const SPEED = 2.4; // tiles per second

const cv = document.getElementById('room');
cv.width = CW; cv.height = CH;
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------- palette ----------
const C = { wood: ['#7b4a33', '#85513a'], woodLine: '#5e3626', wallL: '#241f3d', wallR: '#2d2750', wallTop: '#e0784f', base: '#151126', ink: '#120d18', white: '#f6efe4' };
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const ch = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f))); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
const AGENT_COLORS = ['#D97757', '#F2C14E', '#7FB77E', '#6FA8DC', '#B392F0', '#F28CB1', '#E07A5F', '#5FB3B3'];

// ---------- departments ----------
const DEPTS = {
  tech:       { name: 'TECH',         i0: 0,    j0: 0,  i1: 7,  j1: 6,  carpet: ['#27324a', '#2c3852'], accent: '#6a9be6' },
  marketing:  { name: 'MARKETING',    i0: 7,    j0: 0,  i1: 13.5, j1: 6, carpet: ['#4a2442', '#52294a'], accent: '#ff4f8b' },
  finance:    { name: 'FINANCE',      i0: 13.5, j0: 0,  i1: 20, j1: 6,  carpet: ['#22402f', '#264735'], accent: '#4fb47a' },
  backoffice: { name: 'BACK OFFICE',  i0: 0,    j0: 6,  i1: 7,  j1: 11, carpet: ['#4a3f29', '#52462e'], accent: '#e8b54a' },
  external:   { name: 'EXTERNAL API', i0: 0,    j0: 11, i1: 7,  j1: 16, carpet: ['#32264d', '#382b56'], accent: '#b392f0' },
};
const DEPT_KEYS = Object.keys(DEPTS);
const inZone = (z, i, j) => i >= z.i0 && i < z.i1 && j >= z.j0 && j < z.j1;
/** An agent's department: its own setting, else guessed from what it is for. */
function deptOf(d) {
  if (!d) return 'tech';
  if (d.department && DEPTS[d.department]) return d.department;
  if (d.kind === 'a2a' || d.kind === 'a2a-client') return 'external';
  const pj = W.state && d.project ? (W.state.projects.find(p => p.id === d.project) || {}).name || '' : '';
  const t = `${d.role || ''} ${d.name} ${pj}`.toLowerCase();
  if (/financ|invoice|billing|stripe|payment|accounting|tax|budget|revenue|bookkeep/.test(t)) return 'finance';
  if (/market|seo|content|social|brand|landing|copy|campaign|ads|growth|tiktok|instagram|design|deck|pitch/.test(t)) return 'marketing';
  if (/extern|a2a|integration|webhook|partner|relay/.test(t)) return 'external';
  if (/back.?office|admin|ops\b|support|onboard|planner|planning|hr\b|legal|crm|customer|jean/.test(t)) return 'backoffice';
  return 'tech';
}

// ---------- layout (tile coordinates) ----------
const DESKS = [
  ['tech', 0.8, 1.9], ['tech', 3.8, 1.9], ['tech', 0.8, 4.4], ['tech', 3.8, 4.4],
  ['marketing', 8, 1.9], ['marketing', 10.8, 1.9], ['marketing', 8, 4.4],
  ['finance', 14.4, 1.9], ['finance', 14.4, 4.4], ['finance', 17.0, 4.4],
  ['backoffice', 0.9, 7.6], ['backoffice', 3.9, 7.6],
  ['external', 0.9, 12.4], ['external', 3.9, 12.0],
].map(([dept, i, j], n) => ({ dept, i, j, n, seat: { i: i + 1, j: j - 0.42 } }));

// glass partitions: [axis, at, from, to] — gaps between them are the doorways
const WALLS = [
  ['i', 7, 0, 3.5], ['i', 13.5, 0, 3.5],                          // tech | marketing | finance
  ['j', 6, 7, 9], ['j', 6, 11.5, 15], ['j', 6, 17, 20],           // marketing + finance → the gym
  ['j', 6, 0, 4],                                                  // tech → back office
  ['i', 7, 6, 7.5], ['i', 7, 9.5, 11],                             // back office → the gym
  ['j', 11, 0, 4], ['j', 11, 6.2, 7],                              // back office | external
  ['i', 7, 11, 12.5], ['i', 7, 14.5, 16],                          // external → the gym
  ['j', 1.7, 17.8, 20], ['i', 17.8, 0, 1.7],                      // willmexi HQ: a tiny glass office in the right back corner
];
const HQ = { i0: 17.8, j0: 0, i1: 20, j1: 1.7, spot: { i: 18.75, j: 1.0 } };

const SPOTS = {
  coffee: [{ i: 16.6, j: 15.6 }, { i: 17.5, j: 15.65 }, { i: 18.4, j: 15.6 }, { i: 19.3, j: 15.65 }],
  bag: [{ i: 18.25, j: 7.9 }],
  mat: [{ i: 16.0, j: 9.0 }, { i: 17.6, j: 9.4 }],
  mirror: [{ i: 13.7, j: 7.3 }],
  dance: [{ i: 18.5, j: 12.0 }, { i: 18.4, j: 13.1 }],
  couch: [{ i: 9.0, j: 15.25 }, { i: 9.9, j: 15.25 }, { i: 10.8, j: 15.25 }],
  beanbag: [{ i: 12.4, j: 15.45 }, { i: 13.6, j: 15.5 }, { i: 14.8, j: 15.45 }],
  stage: [{ i: 12.5, j: 11.3 }],
  phone: [{ i: 0.7, j: 11.75 }],
  portal: [{ i: 4.3, j: 14.4 }, { i: 5.4, j: 14.9 }, { i: 3.4, j: 15.2 }],
  wander: [{ i: 10, j: 8.2 }, { i: 12, j: 9.6 }, { i: 16.3, j: 12.1 }, { i: 11, j: 13.2 }, { i: 9.2, j: 10.6 }, { i: 17.4, j: 12.8 }],
};
const DOOR = { i: 0.6, j: 14.65 };

const FURN = [];
const box = (i, j, w, d, h, top, z = 0, extra = {}) => FURN.push({ i, j, w, d, h, z, top, ...extra });
DESKS.forEach(d => box(d.i, d.j, 2, 1, 22, '#c98b54', 0, { kind: 'desk', desk: d }));
// common area: the Van Damme gym + lounge
box(16, 14.5, 3.6, 0.7, 34, '#e9e3d7', 0, { side: '#2f6f73', kind: 'counter' });
box(8.4, 14.6, 3, 1, 14, '#7a4a8c', 0, { kind: 'couch', depthBias: -6 });
box(19.25, 11.6, 0.6, 0.8, 50, '#ff4f8b', 0, { kind: 'jukebox', side: '#8c2350' });
box(19.0, 7.0, 0.6, 0.5, 0, null, 0, { kind: 'bag' });
box(13.2, 6.45, 1.0, 0.2, 72, '#cfd8e6', 0, { kind: 'mirror' });
SPOTS.beanbag.forEach(s => box(s.i - 0.35, s.j - 0.3, 0.7, 0.6, 0, '#3f7f8c', 0, { kind: 'beanbag', noBlock: true, depthBias: -3 }));
// department props
box(6.0, 0.3, 0.6, 1.3, 84, '#2a2f3a', 0, { kind: 'rack', side: '#1b1f27' });
box(4.0, 0.35, 1.3, 0.8, 0, null, 0, { kind: 'whalespot' });        // the Docker whale lives here
box(17.85, 0.02, 2.13, 1.66, 0, null, 0, { kind: 'hqfloor', depthBias: -30 });   // nobody walks into the HQ
box(19.05, 0.12, 0.8, 0.5, 18, '#2a2420', 0, { kind: 'hqdesk', side: '#1c1815' });                    // tech: server rack
box(11.3, 4.4, 1.6, 0.18, 62, '#f4f1ea', 0, { kind: 'whiteboard', side: '#c9c4b8' });           // marketing
box(19.1, 2.4, 0.9, 0.8, 40, '#3a3f48', 0, { kind: 'safe', side: '#2a2e35' });                  // finance
box(0.25, 9.3, 0.6, 1.4, 44, '#8a8f99', 0, { kind: 'files', side: '#6b707a' });                 // back office: filing cabinets
box(4.6, 9.8, 0.8, 0.6, 22, '#d9dbe0', 0, { kind: 'printer', side: '#b3b6bd' });
box(4.1, 14.0, 0, 0, 0, null, 0, { kind: 'portal', noBlock: true, depthBias: -20 });            // external: the API gate
[{ i: 19.4, j: 6.3 }, { i: 7.4, j: 15.4 }, { i: 13.0, j: 0.25 }].forEach(p => box(p.i, p.j, 0.55, 0.55, 18, '#c0663f', 0, { kind: 'plant', side: '#8a4024' }));

// ---------- walk grid (half tiles) ----------
const GI = COLS * 2, GJ = ROWS * 2;
const blocked = new Uint8Array(GI * GJ);
for (const f of FURN) {
  if (f.noBlock) continue;
  for (let ci = Math.floor(f.i * 2); ci < Math.ceil((f.i + f.w) * 2); ci++)
    for (let cj = Math.floor(f.j * 2); cj < Math.ceil((f.j + f.d) * 2); cj++)
      if (ci >= 0 && cj >= 0 && ci < GI && cj < GJ) blocked[cj * GI + ci] = 1;
}
for (const [axis, at, a, b] of WALLS) {
  for (let k = Math.round(a * 2); k < Math.round(b * 2); k++) {
    const line = Math.round(at * 2) - 1;
    if (axis === 'i') blocked[k * GI + line] = 1; else blocked[line * GI + k] = 1;
  }
}
const cellOf = (i, j) => ({ ci: Math.max(0, Math.min(GI - 1, Math.floor(i * 2))), cj: Math.max(0, Math.min(GJ - 1, Math.floor(j * 2))) });
const free = (ci, cj) => ci >= 0 && cj >= 0 && ci < GI && cj < GJ && !blocked[cj * GI + ci];
function nearestFree(c) {
  if (free(c.ci, c.cj)) return c;
  for (let r = 1; r < 8; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++)
    if (Math.max(Math.abs(di), Math.abs(dj)) === r && free(c.ci + di, c.cj + dj)) return { ci: c.ci + di, cj: c.cj + dj };
  return c;
}
function findPath(fi, fj, ti, tj) {
  const s = nearestFree(cellOf(fi, fj)), t = nearestFree(cellOf(ti, tj));
  const key = c => c.cj * GI + c.ci;
  const open = [s], came = new Map(), g = new Map([[key(s), 0]]);
  const h = c => Math.hypot(c.ci - t.ci, c.cj - t.cj);
  const f = new Map([[key(s), h(s)]]);
  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (f.get(key(open[k])) < f.get(key(open[bi]))) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur.ci === t.ci && cur.cj === t.cj) {
      const path = []; let k = key(cur), c = cur;
      while (c) { path.unshift({ i: (c.ci + 0.5) / 2, j: (c.cj + 0.5) / 2 }); c = came.get(k); k = c && key(c); }
      path.shift();
      return simplify(path);
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n = { ci: cur.ci + di, cj: cur.cj + dj };
      if (!free(n.ci, n.cj)) continue;
      if (di && dj && (!free(cur.ci + di, cur.cj) || !free(cur.ci, cur.cj + dj))) continue;
      const ng = g.get(key(cur)) + (di && dj ? 1.414 : 1);
      if (ng < (g.get(key(n)) ?? Infinity)) {
        came.set(key(n), cur); g.set(key(n), ng); f.set(key(n), ng + h(n));
        if (!open.some(o => o.ci === n.ci && o.cj === n.cj)) open.push(n);
      }
    }
  }
  return [];
}
function simplify(path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let k = 1; k < path.length - 1; k++) {
    const a = out[out.length - 1], b = path[k], c = path[k + 1];
    if (Math.sign(b.i - a.i) !== Math.sign(c.i - b.i) || Math.sign(b.j - a.j) !== Math.sign(c.j - b.j)) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---------- sprites ----------
const spriteCache = new Map();
const palette = color => color ? { ...JeanSprite.PALETTE, O: color, o: shade(color, 0.72) } : JeanSprite.PALETTE;
function sprite(frame, color, mirror) {
  const k = `${color || 'jc'}|${frame}|${mirror ? 1 : 0}`;
  let c = spriteCache.get(k);
  if (!c) {
    c = document.createElement('canvas'); c.width = JeanSprite.W * 2; c.height = JeanSprite.H * 2;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    JeanSprite.draw(x, frame, 2, palette(color), mirror);
    spriteCache.set(k, c);
  }
  return c;
}

// ---------- world state ----------
const W = {
  state: null, owner: 'owner', ownerName: 'You', actors: new Map(), seen: new Set(), loadedAt: Date.now(),
  reserved: new Map(), particles: [], selected: null, labels: true, t: 0,
  focus: null,   // { kind: 'project' | 'dept', id } — spotlight
  offers: new Map(),   // agent (lowercase) → open request id Jean offered them
  win: null, history: [], waiting: new Map(),
};
const presenceOf = a => { if (a.offline) return 'offline'; const m = Date.now() - new Date(a.lastSeen); return m < 20 * 60e3 ? 'active' : a.oncall || m < 3 * 3600e3 ? 'idle' : 'away'; };
const statusOf = a => { const p = presenceOf(a); return p === 'offline' ? 'gone' : p === 'away' ? 'away' : (p === 'active' && a.doing) ? 'working' : 'idle'; };
const hash = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };

function reserve(kind, who) {
  const list = SPOTS[kind];
  const freeSpots = list.map((s, n) => ({ s, k: `${kind}:${n}` })).filter(x => !W.reserved.has(x.k) || W.reserved.get(x.k) === who);
  if (!freeSpots.length) return null;
  const pick = freeSpots[Math.floor(Math.random() * freeSpots.length)];
  W.reserved.set(pick.k, who);
  return { ...pick.s, key: pick.k };
}
function release(a) { for (const [k, v] of W.reserved) if (v === a.name) W.reserved.delete(k); }
const MANAGER_DESK = {}; for (const d of DESKS) if (!(d.dept in MANAGER_DESK)) MANAGER_DESK[d.dept] = d.n;
function deskFor(a) {
  const dept = deptOf(a.data);
  if (a.data && a.data.manager) { const k = `desk:${MANAGER_DESK[dept]}`; if (!W.reserved.has(k) || W.reserved.get(k) === a.name) { W.reserved.set(k, a.name); return DESKS[MANAGER_DESK[dept]]; } }
  for (const d of DESKS) if (W.reserved.get(`desk:${d.n}`) === a.name && d.dept === dept) return d;
  for (const d of DESKS) if (W.reserved.get(`desk:${d.n}`) === a.name) W.reserved.delete(`desk:${d.n}`);
  const d = DESKS.find(d => d.dept === dept && !W.reserved.has(`desk:${d.n}`) && d.n !== MANAGER_DESK[dept])
    || DESKS.find(d => d.dept === dept && !W.reserved.has(`desk:${d.n}`));
  if (d) W.reserved.set(`desk:${d.n}`, a.name);
  return d || null;
}
/** A free standing spot inside a department (overflow when its desks are full). */
function deptSpot(dept) {
  const z = DEPTS[dept];
  for (let k = 0; k < 30; k++) {
    const i = z.i0 + 0.8 + Math.random() * (z.i1 - z.i0 - 1.6), j = z.j0 + 0.8 + Math.random() * (z.j1 - z.j0 - 1.6);
    const c = cellOf(i, j); if (free(c.ci, c.cj)) return { i, j };
  }
  return { i: (z.i0 + z.i1) / 2, j: (z.j0 + z.j1) / 2 };
}

function makeActor(name, data, npc = false) {
  const start = npc ? SPOTS.stage[0] : DOOR;
  return { name, data, npc, i: start.i, j: start.j, path: [], act: null, queue: [], bubble: null, mirror: false,
    frame: 'idle', color: npc ? null : (data && data.color) || AGENT_COLORS[Math.abs(hash(name)) % AGENT_COLORS.length],
    status: npc ? 'npc' : 'entering', leaving: false, alpha: npc ? 1 : 0, rect: null, sitOffset: 0, jobActive: false };
}
const HOST = makeActor('Jean-Claude', null, true);
W.actors.set('__host', HOST);

function goTo(a, spot, then) {
  a.path = findPath(a.i, a.j, spot.i, spot.j);
  a.path.push({ i: spot.i, j: spot.j });
  a.arrive = then || null;
}
function setAct(a, kind, frames, seconds, opts = {}) {
  a.act = { kind, frames, fps: opts.fps || 2.5, until: seconds === Infinity ? Infinity : W.t + seconds, sit: !!opts.sit, onEnd: opts.onEnd };
  a.sitOffset = opts.sit ? (opts.sitOffset ?? 10) : 0;
  if (opts.face) a.mirror = opts.face === 'left';
}
function say(a, text, seconds, kind = 'msg') {
  a.bubble = { text, until: W.t + (seconds || Math.max(4.5, Math.min(10, 2.5 + text.length / 16))), kind };
}

function plan(a) {
  a.jobActive = false;
  release(a);
  a.sitOffset = 0;
  if (a.queue.length) return runJob(a, a.queue.shift());
  if (a.npc) return planHost(a);
  const st = a.status, dept = deptOf(a.data);
  if (st === 'gone') { a.leaving = true; goTo(a, DOOR); return; }
  if (st === 'working') {
    const d = deskFor(a);
    if (d) return goTo(a, d.seat, () => setAct(a, 'work', ['typeA', 'typeB'], Infinity, { fps: 5, sit: true, sitOffset: 8 }));
    return goTo(a, deptSpot(dept), () => setAct(a, 'work', ['typeA', 'typeB'], Infinity, { fps: 5, sit: true }));
  }
  if (st === 'away') {
    const s = reserve('couch', a.name) || reserve('beanbag', a.name);
    if (s) return goTo(a, s, () => setAct(a, 'sleep', ['sitSleep'], Infinity, { sit: true, sitOffset: 6 }));
  }
  if (dept === 'external' && (a.data.kind === 'a2a' || a.data.kind === 'a2a-client')) { // outside agents wait at the gate
    const s = reserve('portal', a.name);
    if (s) return goTo(a, s, () => setAct(a, 'stand', ['idle', 'idle', 'talk'], 8 + Math.random() * 8, { fps: 1 }));
  }
  const options = [['coffee', 4], ['bag', 1.5], ['mat', 1.5], ['mirror', 1], ['dance', 1], ['wander', 1]];
  let r = Math.random() * options.reduce((s, o) => s + o[1], 0), pick = 'coffee';
  for (const [k, w] of options) { if ((r -= w) <= 0) { pick = k; break; } }
  const spot = reserve(pick, a.name) || reserve('coffee', a.name) || reserve('wander', a.name);
  if (!spot) return setAct(a, 'stand', ['idle'], 4);
  const dur = 7 + Math.random() * 9;
  const acts = {
    coffee: () => setAct(a, 'coffee', ['coffeeB', 'coffeeB', 'coffeeA', 'coffeeB'], dur, { fps: 1.2 }),
    bag: () => setAct(a, 'bag', ['guardA', 'kick', 'guardB', 'kick'], dur, { fps: 2.5, face: 'right' }),
    mat: () => setAct(a, 'mat', ['splits'], dur, { fps: 1 }),
    mirror: () => setAct(a, 'mirror', ['mulletA', 'mulletB'], dur, { fps: 2 }),
    dance: () => setAct(a, 'dance', ['danceA', 'danceB'], dur, { fps: 3 }),
    wander: () => setAct(a, 'stand', ['idle', 'idle', 'talk'], 3 + Math.random() * 4, { fps: 1 }),
  };
  goTo(a, spot, acts[pick]);
}
const HOST_LINES = ['Sit. Type. Kick. Repeat.', 'Coffee is the real kumite.', 'Flexibility is a feature.', 'No task is too high to kick.', 'Ship it like a roundhouse.', 'Balance: two trucks, one plan.'];
function planHost(a) {
  const moves = [
    () => goTo(a, SPOTS.stage[0], () => setAct(a, 'stunt', ['epicSplit'], 4)),
    () => goTo(a, { i: 16.8, j: 9.2 }, () => setAct(a, 'stunt', ['splits'], 4)),
    () => goTo(a, { i: 18.4, j: 12.5 }, () => setAct(a, 'stunt', ['danceA', 'danceB'], 5, { fps: 3 })),
    () => goTo(a, { i: 13.7, j: 7.3 }, () => setAct(a, 'stunt', ['mulletA', 'mulletB'], 4, { fps: 2 })),
    () => goTo(a, { i: 10.5, j: 12.2 }, () => setAct(a, 'stunt', ['treeKickB', 'treeKickA'], 4, { fps: 2 })),
    () => goTo(a, { i: 11.5, j: 9.0 }, () => { setAct(a, 'stunt', ['salute'], 4); if (Math.random() < 0.5) say(a, HOST_LINES[Math.floor(Math.random() * HOST_LINES.length)], 4, 'host'); }),
    () => goTo(a, { i: 14.5, j: 11.0 }, () => setAct(a, 'stunt', ['double'], 4)),
  ];
  moves[Math.floor(Math.random() * moves.length)]();
}

// ---------- jobs: what messages and events look like on the floor ----------
function onFloor(name) {
  const k = String(name || '').toLowerCase();
  for (const a of W.actors.values()) if (!a.npc && !a.leaving && a.name.toLowerCase() === k) return a;
  return null;
}
function runJob(a, job) {
  a.act = null;
  a.jobActive = true;
  if (job.type === 'say') {
    const after = () => { setAct(a, 'talk', ['talk', 'idle'], job.seconds || 6, { fps: 4 }); say(a, job.text, job.seconds, job.kind); };
    if (job.where === 'here') return after();
    if (job.where === 'stage') return goTo(a, SPOTS.stage[0], after);
    if (job.where === 'phone') return goTo(a, SPOTS.phone[0], () => { setAct(a, 'talk', ['talk', 'idle'], 6, { fps: 4, face: 'left' }); say(a, job.text, 6, 'phone'); });
    if (job.where === 'actor') {
      const b = job.to;
      if (!b || b.leaving) return after();
      const side = b.i > 10 ? -0.75 : 0.75;
      return goTo(a, { i: b.i + side, j: b.j + 0.35 }, () => { a.mirror = b.i < a.i; after(); if (!b.act || b.act.kind !== 'work') b.mirror = a.i < b.i; });
    }
  }
  if (job.type === 'celebrate') {
    setAct(a, 'party', ['epicSplit'], 4.5);
    say(a, job.text, 5, 'done');
    burst(a);
    return;
  }
  plan(a);
}
function enqueue(a, job) {
  if (!a || a.leaving) return;
  a.queue.push(job);
  if (!a.jobActive) { a.path = []; a.arrive = null; a.act = null; plan(a); }   // drop the coffee, there's news
}
const clip = (s, n = 120) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function handleMessage(m) {
  for (const fn of PLUG.message) { try { fn(m); } catch (e) { console.error(e); } }
  const from = onFloor(m.from);
  const isOwner = m.from.toLowerCase() === W.owner;
  if (m.kind === 'event') {
    if (/^finished: /.test(m.text) && from) enqueue(from, { type: 'celebrate', text: '✓ ' + clip(m.text.slice(10), 70) });
    else if (/^finished: /.test(m.text)) enqueue(HOST, { type: 'say', where: 'stage', text: `${m.from} finished: ${clip(m.text.slice(10), 70)}`, kind: 'host' });
    else if (/^handed off: /.test(m.text) && from) enqueue(from, { type: 'say', where: 'here', text: '📦 ' + clip(m.text, 90), seconds: 5 });
    return;
  }
  if (m.kind === 'request') {
    enqueue(HOST, { type: 'say', where: 'stage', text: `🙋 Who can: ${clip(m.text, 90)}`, kind: 'host' });
    return;
  }
  if (m.from === 'jean' && /best fit/.test(m.text)) { const c = onFloor(m.to); if (c) enqueue(c, { type: 'say', where: 'here', text: 'Hmm, me?', seconds: 3 }); return; }
  if (/^I'll take it/.test(m.text) && from) {
    enqueue(from, { type: 'say', where: 'stage', text: `I'll take it! ${clip(m.text.replace(/^I'll take it:\s*/, ''), 60)}`, kind: 'done' });
    enqueue(from, { type: 'celebrate', text: '⚔ quest accepted' });
    return;
  }
  const toAgent = onFloor(m.to);
  const text = clip(m.text);
  if (isOwner) {
    if (toAgent) enqueue(HOST, { type: 'say', where: 'actor', to: toAgent, text: `${W.ownerName} says: ${text}`, kind: 'host' });
    else enqueue(HOST, { type: 'say', where: 'stage', text: `📢 ${W.ownerName}: ${text}`, kind: 'host' });
    return;
  }
  if (!from) { if (toAgent) enqueue(toAgent, { type: 'say', where: 'here', text: `📨 ${m.from}: ${text}`, seconds: 6 }); return; }
  if (m.to.toLowerCase() === W.owner) return enqueue(from, { type: 'say', where: 'phone', text: `📞 ${W.ownerName}, ${text}` });
  if (m.to === 'all' || m.to.startsWith('#')) return enqueue(from, { type: 'say', where: 'stage', text: `📢 ${text}` });
  if (toAgent && toAgent !== from) return enqueue(from, { type: 'say', where: 'actor', to: toAgent, text });
  enqueue(from, { type: 'say', where: 'here', text: `→ ${m.to}: ${text}` });
}
function burst(a) {
  const p = iso(a.i, a.j);
  for (let k = 0; k < 40; k++) W.particles.push({ x: p.x, y: p.y - 50, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 140, life: 1.6 + Math.random(), color: AGENT_COLORS[k % AGENT_COLORS.length] });
}

// ---------- theme: follow the Mac unless a fixed theme is set ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() { let local = null; try { local = localStorage.getItem('jean.theme'); } catch {} const t = local || W.theme || 'system'; document.documentElement.dataset.theme = t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t; }
darkQuery.addEventListener('change', applyTheme);

// ---------- data ----------
async function load() {
  const r = await fetch('/api/state');
  const s = await r.json();
  const first = !W.state;
  W.state = s;
  W.owner = String(s.settings.ownerName || 'owner').trim().toLowerCase() || 'owner';
  W.theme = s.settings.theme || 'system'; applyTheme();
  const name = String(s.settings.ownerName || 'You').trim() || 'You';
  if (name !== W.ownerName) { W.ownerName = name; roomLayer = null; }
  sync();
  W.offers = new Map((s.messages || []).filter(m => m.kind === 'request' && !m.claimedBy && m.candidates && m.candidates[0]).map(m => [m.candidates[0].toLowerCase(), m.id]));
  for (const m of s.messages || []) {
    if (W.seen.has(m.id)) continue;
    W.seen.add(m.id);
    if (!first && new Date(m.at).getTime() > W.loadedAt - 5000) handleMessage(m);
  }
  renderPanels();
}
function sync() {
  const agents = W.state.agents || [];
  for (const d of agents) {
    const st = statusOf(d);
    let a = W.actors.get(d.name);
    if (!a && st === 'gone') continue;
    if (!a) { a = makeActor(d.name, d); a.status = st; W.actors.set(d.name, a); plan(a); continue; }
    const deptChanged = deptOf(a.data) !== deptOf(d);
    a.data = d; a.color = d.color || a.color;
    if (a.status !== st || (deptChanged && st === 'working')) {
      a.status = st;
      if (st === 'gone') { a.queue = []; a.leaving = true; release(a); goTo(a, DOOR); }
      else if (!a.jobActive) { a.act = null; a.path = []; plan(a); }
    }
  }
  for (const [k, a] of W.actors) if (!a.npc && !agents.some(d => d.name === k) && !a.leaving) { a.leaving = true; release(a); goTo(a, DOOR); }
}

// ---------- simulation ----------
function update(dt) {
  W.t += dt;
  for (const [k, a] of W.actors) {
    if (a.alpha < 1 && !a.leaving) a.alpha = Math.min(1, a.alpha + dt * 2);
    if (a.path.length) {
      const p = a.path[0];
      const di = p.i - a.i, dj = p.j - a.j, d = Math.hypot(di, dj);
      const step = SPEED * dt;
      if (d <= step) { a.i = p.i; a.j = p.j; a.path.shift(); }
      else { a.i += di / d * step; a.j += dj / d * step; }
      if (Math.abs(di - dj) > 0.01) a.mirror = (di - dj) < 0;
      a.frame = Math.floor(W.t * 6) % 2 ? 'walkA' : 'walkB';
      a.sitOffset = 0;
      if (!a.path.length) {
        if (a.leaving) continue;
        const then = a.arrive; a.arrive = null;
        if (then) then(); else plan(a);
      }
      continue;
    }
    if (a.leaving) { a.alpha -= dt * 2; if (a.alpha <= 0) { W.actors.delete(k); release(a); } continue; }
    if (!a.act) { plan(a); continue; }
    const fr = a.act.frames;
    a.frame = fr[Math.floor(W.t * a.act.fps) % fr.length];
    if (W.t >= a.act.until) { const end = a.act.onEnd; a.act = null; end ? end() : plan(a); }
  }
  for (const a of W.actors.values()) if (a.bubble && W.t > a.bubble.until) a.bubble = null;
  W.particles = W.particles.filter(p => (p.life -= dt) > 0);
  for (const p of W.particles) { p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
}

// ---------- drawing helpers ----------
let roomLayer = null;
function poly(c, pts, fill, stroke) { c.beginPath(); pts.forEach((p, k) => k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.stroke(); } }
const up = (p, h) => ({ x: p.x, y: p.y - h });
function onRightWall(c, fn) { const o = iso(0, 0); c.save(); c.translate(o.x, o.y); c.transform(1, 0.5, 0, 1, 0, 0); fn(c); c.restore(); }    // u = i*32, v up = negative
function onLeftWall(c, fn) { const o = iso(0, ROWS); c.save(); c.translate(o.x, o.y); c.transform(1, -0.5, 0, 1, 0, 0); fn(c); c.restore(); } // u = (ROWS - j)*32
function onFloorPlane(c, i, j, fn) { const o = iso(i, j); c.save(); c.translate(o.x, o.y); c.transform(1, 0.5, -1, 0.5, 0, 0); fn(c); c.restore(); } // u along i, v along j (32 per tile)
const LW = j => (ROWS - j) * 32;  // left-wall u for a j
function skyColors() {
  const h = new Date().getHours();
  if (h >= 7 && h < 17) return ['#7fc3ff', '#ffd59e', '#ffb36b'];
  if (h >= 17 && h < 21) return ['#2b1e5c', '#ff6f61', '#ffb347'];
  return ['#0b0b2b', '#2a1747', '#5b2a5e'];
}
const zoneAt = (i, j) => DEPT_KEYS.find(k => inZone(DEPTS[k], i, j));

// ---------- the static room ----------
function buildRoom() {
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const x = c.getContext('2d');
  const o = iso(0, 0), r = iso(COLS, 0), l = iso(0, ROWS);
  poly(x, [l, o, up(o, WALLH), up(l, WALLH)], C.wallL);
  poly(x, [o, r, up(r, WALLH), up(o, WALLH)], C.wallR);
  onLeftWall(x, w => { w.fillStyle = 'rgba(224,120,79,.22)'; w.fillRect(0, -36, ROWS * 32, 8); w.fillStyle = 'rgba(255,79,139,.16)'; w.fillRect(0, -26, ROWS * 32, 5); });
  onRightWall(x, w => { w.fillStyle = 'rgba(224,120,79,.22)'; w.fillRect(0, -36, COLS * 32, 8); w.fillStyle = 'rgba(255,79,139,.16)'; w.fillRect(0, -26, COLS * 32, 5); });
  x.lineWidth = 3; x.strokeStyle = C.wallTop;
  x.beginPath(); x.moveTo(up(l, WALLH).x, up(l, WALLH).y); x.lineTo(up(o, WALLH).x, up(o, WALLH).y); x.lineTo(up(r, WALLH).x, up(r, WALLH).y); x.stroke();
  x.lineWidth = 1;
  // floors: department carpets, the gym's wooden planks
  for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
    const z = zoneAt(i + 0.5, j + 0.5);
    const cols = z ? DEPTS[z].carpet : C.wood;
    poly(x, [iso(i, j), iso(i + 1, j), iso(i + 1, j + 1), iso(i, j + 1)], cols[(i + j) % 2], z ? shade(cols[0], 0.8) : C.woodLine);
  }
  x.strokeStyle = C.base; x.lineWidth = 4;
  x.beginPath(); x.moveTo(l.x, l.y - 2); x.lineTo(o.x, o.y - 2); x.lineTo(r.x, r.y - 2); x.stroke(); x.lineWidth = 1;
  // department names painted on the floor
  for (const k of DEPT_KEYS) {
    const z = DEPTS[k];
    onFloorPlane(x, z.i0 + 0.5, z.j1 - 0.55, w => {
      w.font = '12px "Press Start 2P", monospace'; w.fillStyle = z.accent; w.globalAlpha = 0.7;
      w.fillText(z.name, 0, 0); w.globalAlpha = 1;
    });
  }
  // willmexi HQ: a gold-and-black checker carpet and a sign on the back glass
  for (let i = HQ.i0; i < HQ.i1 - 0.01; i += 0.55) for (let j = HQ.j0; j < HQ.j1 - 0.01; j += 0.45) {
    const k = Math.round((i - HQ.i0) / 0.55) + Math.round((j - HQ.j0) / 0.45);
    poly(x, [iso(i, j), iso(Math.min(HQ.i1, i + 0.55), j), iso(Math.min(HQ.i1, i + 0.55), Math.min(HQ.j1, j + 0.45)), iso(i, Math.min(HQ.j1, j + 0.45))], k % 2 ? '#2a2318' : '#3b311d');
  }
  onFloorPlane(x, HQ.i0 + 0.15, HQ.j1 - 0.12, w => { w.font = '7px "Press Start 2P", monospace'; w.fillStyle = 'rgba(255,211,107,.75)'; w.fillText('WILLMEXI HQ', 0, 0); });
  // gym: kumite mat + stage rug
  poly(x, [iso(15, 7.2), iso(19.4, 7.2), iso(19.4, 10.2), iso(15, 10.2)], '#2d4f8c', '#e8e2d6');
  poly(x, [iso(15.4, 7.55), iso(19.0, 7.55), iso(19.0, 9.85), iso(15.4, 9.85)], null, '#c23b3b');
  const sc = iso(SPOTS.stage[0].i, SPOTS.stage[0].j);
  x.fillStyle = '#7c1f3f'; x.beginPath(); x.ellipse(sc.x, sc.y, 64, 32, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#f2c14e'; x.lineWidth = 2; x.beginPath(); x.ellipse(sc.x, sc.y, 56, 28, 0, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1;
  x.fillStyle = '#f2c14e'; x.font = '12px "Press Start 2P", monospace'; x.textAlign = 'center'; x.fillText('★', sc.x, sc.y + 5); x.textAlign = 'left';

  // right wall: tech window · marketing neon + posters · finance ticker frame + flag
  const [s1, s2, s3] = skyColors();
  onRightWall(x, w => {
    const g = w.createLinearGradient(0, -150, 0, -62); g.addColorStop(0, s1); g.addColorStop(0.6, s2); g.addColorStop(1, s3);
    w.fillStyle = '#16122a'; w.fillRect(30, -154, 100, 96); w.fillStyle = g; w.fillRect(34, -150, 92, 88);
    w.fillStyle = 'rgba(255,230,160,.85)'; w.beginPath(); w.arc(80, -84, 14, Math.PI, 0); w.fill();
    w.fillStyle = '#1b1430';
    for (const px of [46, 110]) { w.fillRect(px, -112, 3, 50); for (let k = -2; k <= 2; k++) w.fillRect(px - 12 + k * 3, -114 + Math.abs(k) * 3, 14, 3); }
    w.fillRect(34, -66, 92, 4); w.fillRect(79, -150, 3, 88);
    // code screen frame (contents live)
    w.fillStyle = '#0b0f14'; w.fillRect(146, -140, 64, 52); w.fillStyle = '#2a2f3a'; w.fillRect(174, -88, 8, 10);
    // marketing neon + posters
    w.font = '15px "Press Start 2P", monospace';
    w.shadowColor = '#ff4f8b'; w.shadowBlur = 14; w.fillStyle = '#ff7aa8'; w.fillText('JEAN CLAWD', 244, -140);
    w.shadowColor = '#e0784f'; w.fillStyle = '#ffb38f'; w.font = '10px "Press Start 2P", monospace'; w.fillText('By @willmexi', 262, -122); w.shadowBlur = 0;
    const poster = (u, bg, title, sub) => {
      w.fillStyle = '#0f0b16'; w.fillRect(u - 3, -112, 50, 70); w.fillStyle = bg; w.fillRect(u, -109, 44, 64);
      w.fillStyle = '#1a1020'; w.fillRect(u + 17, -96, 10, 22); w.fillRect(u + 6, -86, 32, 4); w.fillRect(u + 12, -74, 4, 18); w.fillRect(u + 28, -76, 10, 4);
      w.font = '6px "Press Start 2P", monospace'; w.fillStyle = '#fff3d6'; w.textAlign = 'center'; w.fillText(title, u + 22, -101); w.fillText(sub, u + 22, -50); w.textAlign = 'left';
    };
    poster(258, '#c23b3b', 'KUMITE', '1988');
    poster(330, '#f2c14e', 'BRUSSELS', 'MUSCLES');
    // finance: ticker frame + flag
    w.fillStyle = '#0a0d0b'; w.fillRect(446, -150, 132, 40); w.fillStyle = '#1d2a22'; w.fillRect(446, -110, 132, 3);
    w.font = '7px "Press Start 2P", monospace'; w.fillStyle = '#4fb47a'; w.fillText('MARKETS', 446, -156);
    w.fillStyle = '#111'; w.fillRect(596, -150, 8, 24); w.fillStyle = '#f2c14e'; w.fillRect(604, -150, 8, 24); w.fillStyle = '#d6303f'; w.fillRect(612, -150, 8, 24);
  });
  // left wall: tech TV · back-office task board · external hotline + door
  onLeftWall(x, w => {
    w.fillStyle = '#0d0a14'; w.fillRect(LW(3.6), -126, 78, 58); w.fillStyle = '#2b2440'; w.fillRect(LW(3.6) + 31, -68, 16, 6);  // TV
    w.fillStyle = '#5a3b22'; w.fillRect(LW(10.6), -160, 150, 116); w.fillStyle = '#c29a63'; w.fillRect(LW(10.6) + 6, -154, 138, 104); // cork board
    w.fillStyle = '#2a1b10'; w.font = '7px "Press Start 2P", monospace'; w.fillText('OPEN TASKS', LW(10.6) + 36, -140);
    w.fillStyle = '#c23b3b'; w.fillRect(LW(12.0), -96, 22, 32); w.fillStyle = '#7d1c1c'; w.fillRect(LW(12.0) + 3, -92, 16, 8);  // hotline
    w.fillStyle = '#ffe0a0'; w.font = '6px "Press Start 2P", monospace'; w.fillText(W.ownerName.toUpperCase().slice(0, 8), LW(12.0) - 2, -102);
    w.fillStyle = '#3b2216'; w.fillRect(LW(15.4), -104, 44, 104); w.fillStyle = '#5a3422'; w.fillRect(LW(15.4) + 4, -100, 36, 100); // door
    w.fillStyle = '#f2c14e'; w.fillRect(LW(15.4) + 32, -54, 4, 4);
    w.shadowColor = '#b392f0'; w.shadowBlur = 10; w.fillStyle = '#d6c2ff'; w.font = '7px "Press Start 2P", monospace'; w.fillText('API GATE', LW(15.4) - 2, -114); w.shadowBlur = 0;
  });
  return c;
}

// ---------- live wall content ----------
function drawLive() {
  onLeftWall(ctx, w => { // TV: a tiny pixel fight
    const u = LW(3.6) + 4;
    w.fillStyle = '#1f3b6b'; w.fillRect(u, -122, 70, 50); w.fillStyle = '#2f6b3f'; w.fillRect(u, -84, 70, 12);
    const f = Math.floor(W.t * 3) % 4;
    w.fillStyle = '#ffd9b0'; w.fillRect(u + 22, -102, 6, 6); w.fillRect(u + 44, -102, 6, 6);
    w.fillStyle = '#111'; w.fillRect(u + 21, -96, 8, 12); w.fillStyle = '#c23b3b'; w.fillRect(u + 43, -96, 8, 12);
    w.fillStyle = '#ffd9b0';
    if (f === 1 || f === 2) w.fillRect(u + 29, -92 + (f === 2 ? -4 : 0), 13, 3); else w.fillRect(u + 22, -84, 3, 10);
    if (f === 3) w.fillRect(u + 36, -94, 7, 3);
  });
  onRightWall(ctx, w => { // tech: scrolling code · finance: project ticker
    w.save(); w.beginPath(); w.rect(148, -138, 60, 48); w.clip();
    for (let k = 0; k < 9; k++) {
      const y = -138 + ((k * 6 + W.t * 10) % 54);
      w.fillStyle = k % 3 ? '#3fbf6a' : '#6a9be6'; w.fillRect(150 + (k * 7) % 14, y, 18 + (hash(k) % 30 + 30) % 30, 2);
    }
    w.restore();
    const ps = liveProjects();
    const text = ps.map(p => { const n = W.state ? W.state.tasks.filter(t => t.project === p.id && t.status !== 'done').length : 0; return `${p.name.toUpperCase()} ${n} OPEN ${n > 5 ? '▼' : '▲'}`; }).join('   ·   ') || 'NO PROJECTS';
    w.save(); w.beginPath(); w.rect(448, -148, 128, 36); w.clip();
    w.font = '8px "Press Start 2P", monospace'; w.fillStyle = '#4fb47a';
    const tw = w.measureText(text + '   ·   ').width;
    const off = (W.t * 24) % tw;
    w.fillText(text + '   ·   ' + text, 452 - off, -133);
    w.fillStyle = '#e5645a'; w.fillText(`${(W.state ? W.state.tasks.filter(t => t.status !== 'done' && t.scope === 'day' && t.date < todayStr()).length : 0)} OVERDUE`, 452, -117);
    w.restore();
  });
  const tasks = boardTasks();
  onLeftWall(ctx, w => { // back office: the task board
    const u0 = LW(10.6) + 12;
    tasks.slice(0, 18).forEach((t, k) => {
      const u = u0 + (k % 6) * 22, v = -132 + Math.floor(k / 6) * 27;
      const tilt = ((hash(t.id) % 5) - 2) * 0.5;
      w.fillStyle = t.color; w.fillRect(u, v + tilt, 18, 21);
      w.fillStyle = 'rgba(0,0,0,.35)'; for (let l = 0; l < 3; l++) w.fillRect(u + 3, v + 5 + l * 5 + tilt, 12 - (l === 2 ? 5 : 0), 1);
      if (t.priority === 1) { w.fillStyle = '#c23b3b'; w.fillRect(u + 7, v - 2 + tilt, 4, 4); }
      if (t.status === 'doing') { w.fillStyle = '#e0784f'; w.fillRect(u, v + 19 + tilt, 18, 2); }
    });
    if (tasks.length > 18) { w.fillStyle = '#2a1b10'; w.font = '6px "Press Start 2P", monospace'; w.fillText(`+${tasks.length - 18}`, u0 + 116, -54); }
  });
  drawBunting();
  if (Math.random() < 0.02) onRightWall(ctx, w => { w.fillStyle = 'rgba(13,11,20,.55)'; w.fillRect(240, -158, 170, 22); });
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Projects the owner is working on: not archived, and active in the last 14 days, with open recent tasks, or with an agent on them. */
function liveProjects() {
  if (!W.state) return [];
  const since = Date.now() - 14 * 864e5;
  const d14 = (() => { const d = new Date(since); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const onIt = new Set([...W.actors.values()].filter(a => !a.npc && a.data && a.data.project).map(a => a.data.project));
  return W.state.projects.filter(p => !p.archived && (onIt.has(p.id) || new Date(p.lastActive) > since
      || W.state.tasks.some(t => t.project === p.id && t.status !== 'done' && t.date >= d14)))
    .sort((a, b) => (onIt.has(b.id) - onIt.has(a.id)) || String(b.lastActive).localeCompare(String(a.lastActive)));
}
const projectOf = a => a && a.data && a.data.project && W.state ? W.state.projects.find(p => p.id === a.data.project) : null;
const dimmed = a => !a.npc && W.focus && (W.focus.kind === 'dept' ? deptOf(a.data) !== W.focus.id : (!a.data || a.data.project !== W.focus.id));

function drawBunting() {
  const ps = liveProjects().slice(0, 14);
  if (!ps.length) return;
  const flag = (w, u, v, p) => {
    const sway = Math.sin(W.t * 1.6 + u / 40) * 1.2;
    w.globalAlpha = W.focus && W.focus.kind === 'project' && W.focus.id !== p.id ? 0.3 : 1;
    w.fillStyle = p.color || '#e0784f';
    w.beginPath(); w.moveTo(u - 13, v); w.lineTo(u + 13, v); w.lineTo(u + sway, v + 30); w.closePath(); w.fill();
    w.strokeStyle = 'rgba(0,0,0,.35)'; w.stroke();
    w.font = '12px serif'; w.textAlign = 'center'; w.fillText(p.emoji || '📁', u + sway * 0.3, v + 15);
    w.globalAlpha = 1; w.textAlign = 'left';
  };
  onRightWall(ctx, w => {
    w.strokeStyle = '#d9c9a8'; w.beginPath(); w.moveTo(0, -168); w.quadraticCurveTo(COLS * 16, -158, COLS * 32 - 20, -170); w.stroke();
    ps.slice(0, 9).forEach((p, k) => flag(w, 30 + k * 70, -168, p));
  });
  onLeftWall(ctx, w => {
    w.strokeStyle = '#d9c9a8'; w.beginPath(); w.moveTo(20, -170); w.quadraticCurveTo(ROWS * 16, -160, ROWS * 32, -168); w.stroke();
    ps.slice(9).forEach((p, k) => flag(w, ROWS * 32 - 40 - k * 70, -168, p));
  });
}

function boardTasks() {
  if (!W.state) return [];
  const floor = new Map([...W.actors.values()].filter(a => !a.npc).map(a => [a.name, a]));
  const keep = t => {
    if (!W.focus) return true;
    if (W.focus.kind === 'project') return t.project === W.focus.id;
    const a = floor.get(t.assignee); return a && deptOf(a.data) === W.focus.id;
  };
  return W.state.tasks.filter(t => t.status !== 'done' && t.assignee && floor.has(t.assignee) && keep(t))
    .map(t => ({ ...t, color: floor.get(t.assignee).color }))
    .concat(W.state.tasks.filter(t => t.status !== 'done' && !t.assignee && (W.focus && W.focus.kind === 'project' ? t.project === W.focus.id : !W.focus && t.priority === 1)).map(t => ({ ...t, color: '#f6e27a' })));
}

// ---------- furniture ----------
function isoBoxDraw(f) {
  const A = iso(f.i, f.j), B = iso(f.i + f.w, f.j), Cc = iso(f.i + f.w, f.j + f.d), D = iso(f.i, f.j + f.d);
  const z = f.z, h = f.h;
  const side = f.side || shade(f.top, 0.75), side2 = f.side ? shade(f.side, 0.8) : shade(f.top, 0.6);
  poly(ctx, [up(D, z), up(Cc, z), up(Cc, z + h), up(D, z + h)], side, C.ink);
  poly(ctx, [up(B, z), up(Cc, z), up(Cc, z + h), up(B, z + h)], side2, C.ink);
  poly(ctx, [up(A, z + h), up(B, z + h), up(Cc, z + h), up(D, z + h)], f.top, C.ink);
}
function drawFurniture(f) {
  const center = (h = 0) => up(iso(f.i + f.w / 2, f.j + f.d / 2), h);
  switch (f.kind) {
    case 'bag': {
      const p = iso(f.i + 0.3, f.j + 0.25), sway = Math.sin(W.t * 2) * 2;
      ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 150); ctx.lineTo(p.x + sway, p.y - 86); ctx.stroke();
      ctx.fillStyle = '#b5302e'; ctx.fillRect(p.x - 10 + sway, p.y - 86, 20, 52); ctx.strokeStyle = C.ink; ctx.strokeRect(p.x - 10 + sway, p.y - 86, 20, 52);
      ctx.fillStyle = '#e9e3d7'; ctx.fillRect(p.x - 10 + sway, p.y - 70, 20, 4);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'plant': {
      isoBoxDraw(f);
      const p = center(f.h);
      ctx.fillStyle = '#5a3a1f'; ctx.fillRect(p.x - 2, p.y - 34, 4, 34);
      ctx.fillStyle = '#4f8a3e';
      for (let k = -2; k <= 2; k++) { ctx.save(); ctx.translate(p.x, p.y - 34); ctx.rotate(k * 0.6 + Math.sin(W.t + f.i) * 0.05); ctx.fillRect(0, -3, 26, 6); ctx.restore(); }
      return;
    }
    case 'beanbag': {
      const p = center();
      ctx.fillStyle = '#2c5f6a'; ctx.beginPath(); ctx.ellipse(p.x, p.y - 4, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f8a99'; ctx.beginPath(); ctx.ellipse(p.x - 2, p.y - 8, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    case 'couch':
      isoBoxDraw(f); isoBoxDraw({ i: f.i, j: f.j - 0.05, w: f.w, d: 0.28, h: 34, z: 0, top: '#8d5aa0' });
      return;
    case 'jukebox': {
      isoBoxDraw(f);
      const p = up(iso(f.i, f.j + f.d / 2), 30);
      ctx.fillStyle = `hsl(${(W.t * 80) % 360},90%,65%)`; ctx.fillRect(p.x - 8, p.y - 6, 16, 10);
      if (Math.floor(W.t * 2) % 2) { ctx.fillStyle = '#ffd36b'; ctx.font = '10px "VT323", monospace'; ctx.fillText('♪', p.x - 22, p.y - 18 - (W.t * 10 % 12)); }
      return;
    }
    case 'mirror': {
      isoBoxDraw({ ...f, top: '#e0784f', side: '#e0784f' });
      const A = up(iso(f.i + 0.08, f.j + f.d), 6), B = up(iso(f.i + f.w - 0.08, f.j + f.d), 6);
      const g = ctx.createLinearGradient(A.x, A.y - 60, B.x, B.y);
      g.addColorStop(0, '#dfe7f2'); g.addColorStop(0.5, '#8ea0bd'); g.addColorStop(1, '#cfd8e6');
      poly(ctx, [A, B, up(B, 60), up(A, 60)], g);
      return;
    }
    case 'counter': {
      isoBoxDraw(f);
      isoBoxDraw({ i: 18.6, j: 14.54, w: 0.55, d: 0.42, h: 24, z: 34, top: '#d4d7de', side: '#a8adb8' });
      const p = up(iso(18.9, 14.98), 46);
      ctx.fillStyle = Math.floor(W.t * 2) % 2 ? '#ff5a4f' : '#7d1c1c'; ctx.fillRect(p.x - 2, p.y, 4, 3);
      for (const ci of [16.5, 17.1, 17.7]) { const q = up(iso(ci, 14.85), 34); ctx.fillStyle = C.white; ctx.fillRect(q.x - 3, q.y - 6, 6, 6); ctx.fillStyle = '#5a321c'; ctx.fillRect(q.x - 2, q.y - 6, 4, 2); }
      const s = up(iso(17.2, 15.2), 18);
      ctx.fillStyle = '#ffd36b'; ctx.font = '7px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText('ESPRESSO', s.x, s.y); ctx.textAlign = 'left';
      return;
    }
    case 'rack': {
      isoBoxDraw(f);
      const lit = W.sys ? Math.min(7, W.sys.servers.length) : 0, hot = W.sys && W.sys.busy;
      for (let k = 0; k < 7; k++) { const q = up(iso(f.i + f.w, f.j + 0.2 + k * 0.15), 12 + k * 9); ctx.fillStyle = k >= lit ? '#2b313b' : hot ? ((Math.floor(W.t * 4 + k) % 2) ? '#ff5a4f' : '#7d1c1c') : ((Math.floor(W.t * 3 + k) % 3) ? '#3fbf6a' : '#e0784f'); ctx.fillRect(q.x - 6, q.y, 3, 2); }
      if (hot) { const q = up(iso(f.i + f.w / 2, f.j + f.d / 2), f.h + 4); ctx.fillStyle = 'rgba(230,230,240,.45)'; for (let k = 0; k < 3; k++) { const t = (W.t + k / 3) % 1; ctx.fillRect(q.x - 4 + Math.sin(t * 6 + k) * 4, q.y - t * 26, 3, 3); } }
      return;
    }
    case 'whiteboard': {
      isoBoxDraw(f);
      const A = up(iso(f.i + 0.1, f.j + f.d), 18), B = up(iso(f.i + f.w - 0.1, f.j + f.d), 18);
      ctx.strokeStyle = '#ff4f8b'; ctx.lineWidth = 2; ctx.beginPath();
      [0.1, 0.35, 0.25, 0.6, 0.5, 0.9].forEach((v, k) => { const t = k / 5; const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t - v * 34; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.lineWidth = 1;
      return;
    }
    case 'safe': {
      isoBoxDraw(f);
      const q = up(iso(f.i + f.w / 2, f.j + f.d), 22);
      ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4fb47a'; ctx.font = '10px "VT323", monospace'; ctx.fillText('$', q.x - 2, q.y - 28 - (W.t * 8 % 10));
      return;
    }
    case 'files': {
      isoBoxDraw(f);
      for (let k = 0; k < 3; k++) { const q = up(iso(f.i + f.w, f.j + 0.25 + k * 0.45), 30 - k * 0); ctx.fillStyle = '#4a4f59'; ctx.fillRect(q.x - 4, q.y, 6, 2); ctx.fillRect(q.x - 4, q.y + 12, 6, 2); }
      return;
    }
    case 'printer': {
      isoBoxDraw(f);
      const q = up(iso(f.i + f.w / 2, f.j + f.d / 2), 22);
      const out = (W.t * 4) % 12;
      ctx.fillStyle = C.white; ctx.fillRect(q.x - 6, q.y - 4 + out / 2, 12, 4);
      return;
    }
    case 'portal': {
      const p = iso(4.6, 14.6);
      const pulse = 0.5 + Math.sin(W.t * 2) * 0.2;
      ctx.strokeStyle = `rgba(179,146,240,${pulse})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 60, 30, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(214,194,255,${pulse * 0.6})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 48 + (W.t * 12 % 12), 24 + (W.t * 6 % 6), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(214,194,255,.5)'; ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.fillText('A2A', p.x, p.y + 4); ctx.textAlign = 'left';
      return;
    }
    case 'desk': {
      isoBoxDraw(f);
      const d = f.desk, acc = DEPTS[d.dept].accent;
      const user = [...W.actors.values()].find(a => a.act && a.act.kind === 'work' && Math.abs(a.i - d.seat.i) < 0.3 && Math.abs(a.j - d.seat.j) < 0.3);
      isoBoxDraw({ i: f.i + 0.62, j: f.j + 0.12, w: 0.76, d: 0.4, h: 2, z: 22, top: '#9aa0ab', side: '#6c717c' });
      const L0 = up(iso(f.i + 0.62, f.j + 0.12), 24), L1 = up(iso(f.i + 1.38, f.j + 0.12), 24);
      poly(ctx, [L0, L1, up(L1, 18), up(L0, 18)], user ? '#3b3f4a' : '#2a2d35', C.ink);
      const mid = { x: (L0.x + L1.x) / 2, y: (L0.y + L1.y) / 2 - 9 };
      ctx.fillStyle = user ? user.color : acc; ctx.globalAlpha = user ? 1 : 0.5; ctx.fillRect(mid.x - 2, mid.y - 2, 4, 4); ctx.globalAlpha = 1;
      if (d.n === MANAGER_DESK[d.dept]) { // the manager's desk: a gold plate on the front
        const q = up(iso(f.i + 0.45, f.j + f.d), 6);
        ctx.fillStyle = '#2a1b10'; ctx.fillRect(Math.round(q.x - 13), Math.round(q.y - 6), 26, 9);
        ctx.fillStyle = '#ffd36b'; ctx.fillRect(Math.round(q.x - 12), Math.round(q.y - 5), 24, 7);
        ctx.fillStyle = '#2a1b10'; ctx.font = '6px "Press Start 2P", monospace'; ctx.fillText('MGR', Math.round(q.x - 9), Math.round(q.y + 1));
      }
      const pj = user && projectOf(user);
      if (pj && !(user.data && user.data.manager)) {
        const q = up(iso(f.i + 1, f.j + f.d), 11);
        ctx.font = '13px "VT323", monospace';
        const label = pj.name.slice(0, 18);
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = '#2a1b10'; ctx.fillRect(Math.round(q.x - w / 2) - 1, Math.round(q.y - 8) - 1, w + 2, 14);
        ctx.fillStyle = pj.color || '#c9a24a'; ctx.fillRect(Math.round(q.x - w / 2), Math.round(q.y - 8), w, 12);
        ctx.fillStyle = '#1a0d08'; ctx.fillText(label, Math.round(q.x - w / 2) + 5, Math.round(q.y + 2));
      }
      if (user) {
        const g = ctx.createRadialGradient(mid.x, mid.y - 14, 2, mid.x, mid.y - 14, 34);
        g.addColorStop(0, 'rgba(140,200,255,.25)'); g.addColorStop(1, 'rgba(140,200,255,0)');
        ctx.fillStyle = g; ctx.fillRect(mid.x - 34, mid.y - 48, 68, 68);
      }
      return;
    }
    case 'whalespot': case 'hqfloor': return;
    case 'hqdesk': {
      isoBoxDraw(f);
      const m = up(iso(f.i + 0.25, f.j + 0.25), f.h);   // his coffee
      ctx.fillStyle = '#f6efe4'; ctx.fillRect(m.x - 3, m.y - 6, 6, 6); ctx.fillStyle = '#5a321c'; ctx.fillRect(m.x - 2, m.y - 6, 4, 2);
      ctx.fillStyle = 'rgba(255,255,255,.5)'; for (let k = 0; k < 2; k++) { const t = (W.t * 1.3 + k / 2) % 1; ctx.fillRect(m.x - 1 + Math.sin(t * 6) * 2, m.y - 8 - t * 12, 2, 2); }
      const L0 = up(iso(f.i + 0.4, f.j + 0.08), f.h + 1), L1 = up(iso(f.i + 0.78, f.j + 0.08), f.h + 1);   // his laptop
      poly(ctx, [L0, L1, up(L1, 12), up(L0, 12)], '#3b3f4a', C.ink); ctx.fillStyle = '#ffd36b'; ctx.fillRect((L0.x + L1.x) / 2 - 1, (L0.y + L1.y) / 2 - 7, 3, 3);
      return;
    }
    default: isoBoxDraw(f);
  }
}
// ---- Docker: a pixel whale in the Tech floor carrying its running containers ----
const WHALE = [
  '.....................KK.',
  '....................KbbK',
  '..KKKKKKKKKKKK.....KbbK.',
  '.KBBBBBBBBBBBBKK..KbbK..',
  'KBBBBBBBBBBBBBBBKKbbK...',
  'KBBWKBBBBBBBBBBBBBbK....',
  'KBBKKBBBBBBBBBBBBBK.....',
  'KBBBBBBBBBBBBBBBBK......',
  '.KWWWWWWWWWWWWBK........',
  '..KKWWWWWWWWKKK.........',
  '....KKKKKKKK............',
];
const WHALE_SPOT = { i: 4.6, j: 0.75 };
function drawWhale() {
  const d = W.sys && W.sys.docker;
  if (!d || !d.available) return;
  const running = d.containers.filter(c => c.state === 'running').length, paused = d.containers.filter(c => c.state === 'paused').length;
  const asleep = !running;
  const p = iso(WHALE_SPOT.i, WHALE_SPOT.j), s = 2;
  const bob = asleep ? 0 : Math.round(Math.sin(W.t * 2.2) * 2);
  const x0 = Math.round(p.x - 24), y0 = Math.round(p.y - 30 + bob);
  ctx.fillStyle = 'rgba(36,150,237,.18)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 34, 12, 0, 0, Math.PI * 2); ctx.fill();   // its puddle
  const col = { K: '#0b2a45', B: asleep ? '#5a7c99' : '#2496ED', b: asleep ? '#45627a' : '#1a6fb0', W: '#e8f4ff' };
  WHALE.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const ch = row[c]; if (ch === '.') continue; ctx.fillStyle = col[ch]; ctx.fillRect(x0 + c * s, y0 + r * s, s, s); } });
  if (asleep) { ctx.fillStyle = '#0b2a45'; ctx.fillRect(x0 + 3 * s, y0 + 5 * s, 2 * s, s); }   // closed eye
  // containers stacked on its back: one box per running container (up to 14)
  const n = Math.min(14, running);
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / 7), col2 = k % 7;
    const bx = x0 + 4 + col2 * 6 + row * 3, by = y0 + 2 - (row + 1) * 6;
    ctx.fillStyle = '#0b2a45'; ctx.fillRect(bx - 1, by - 1, 7, 7);
    ctx.fillStyle = k % 2 ? '#3fa0f0' : '#1a6fb0'; ctx.fillRect(bx, by, 5, 5);
  }
  if (asleep && paused) { ctx.fillStyle = 'rgba(220,230,255,.85)'; ctx.font = '14px "VT323", monospace'; for (let k = 0; k < 2; k++) { const t = (W.t * 0.6 + k / 2) % 1; ctx.globalAlpha = 1 - t; ctx.fillText('z', x0 + 44 + t * 10, y0 - 4 - t * 16); } ctx.globalAlpha = 1; }
  if (W.sys.busy && running) { ctx.fillStyle = 'rgba(255,90,80,.55)'; for (let k = 0; k < 3; k++) { const t = (W.t * 1.2 + k / 3) % 1; ctx.fillRect(x0 + 40 + Math.sin(t * 6 + k) * 3, y0 - 6 - t * 20, 3, 3); } }
  W.whaleRect = { x: x0 - 4, y: y0 - 30, w: 56, h: 60 };
  // its name tag, like the agents'
  const top = 'DOCKER', name = asleep ? (paused ? `${paused} paused` : 'idle') : `${running} running`;
  ctx.font = '8px "Press Start 2P", monospace'; const w1 = ctx.measureText(top).width; ctx.font = '15px "VT323", monospace'; const w2 = ctx.measureText(name).width;
  const w = Math.max(w1, w2) + 20, h = 28, tx = Math.round(p.x - w / 2), ty = Math.round(y0 - 34 - (n > 7 ? 6 : 0));
  ctx.fillStyle = 'rgba(11,42,69,.92)'; roundRect(tx, ty, w, h, 5); ctx.fill();
  ctx.fillStyle = W.sys.busy ? '#ff5a4f' : '#2496ED'; ctx.fillRect(tx, ty + 4, 3, h - 8);
  ctx.font = '8px "Press Start 2P", monospace'; ctx.fillStyle = '#7cc4ff'; ctx.fillText(top, tx + 10, ty + 11);
  ctx.font = '15px "VT323", monospace'; ctx.fillStyle = '#e8f4ff'; ctx.fillText(name, tx + 10, ty + 24);
}

// ---- willmexi, the creator, in his HQ (hand-drawn from his 3D character) ----
const WILL = [
  '....Y..YY..Y....', '....YYYYYYYY....', '...KYYGYYGYYK...', '...KHHHHHHHHK...', '..KHHSSSSSSHHK..', '..KHNNNNNNNNHK..',
  '..KSNnNSSNnNSK..', '..KSSSSSSSSSSK..', '...KSSSssSSSK...', '...KSSMMMMSSK...', '....KSSSSSSK....', '.....KRRRRK.....',
  '...KKDRRRRDKK...', '..KDDDXDDXDDDK..', '.KDDDXXXXXXDDDK.', 'KDXDDDXDDXDDDXDK', 'KDXDDXXXXXXDDXDK', 'KDXDDDXDDXDDDXDK',
  'KDXDDXXXXXXDDXDK', 'KSKDDDDXXDDDDKSK', '.KK.KDDDDDDK.KK.', '....KPPPPPPK....', '....KPPKKPPK....', '....KPPKKPPK....',
  '....KPPK.KPPK...', '....KPPK.KPPK...', '...KYKKK.KKKYK..', '...KKKKK.KKKKK..',
];
const WILL_WAVE = { 15: 'KDXDDDXDDXDDDKSK', 16: 'KDXDDXXXXXXDDKSK', 17: 'KDXDDDXDDXDDDKXK', 18: 'KDXDDXXXXXXDDDXK', 19: 'KSKDDDDXXDDDDDK.', 20: '.KK.KDDDDDDK....' };
const WILL_ARM_UP = ['..KK', '.KSSK', '.KSK', 'KXDK', 'KXDK', 'KXDK'];
const WILL_COLORS = { K: '#14100c', Y: '#f2c14e', G: '#e0784f', H: '#1c1614', S: '#e9b48c', s: '#c99268', N: '#151515', n: '#6e8796', M: '#8c3a2a', R: '#e07a3a', D: '#2b2b31', X: '#f2f2f2', P: '#232328' };
function drawWill() {
  const p = iso(HQ.spot.i, HQ.spot.j), s = 2;
  const waving = (W.t % 14) < 2.2, bob = Math.round(Math.sin(W.t * 1.8));
  const x0 = Math.round(p.x - 16), y0 = Math.round(p.y - 56 + bob);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  WILL.forEach((row0, r) => { const row = waving && WILL_WAVE[r] ? WILL_WAVE[r] : row0; for (let c = 0; c < 16; c++) { const ch = row[c]; if (ch === '.') continue; ctx.fillStyle = WILL_COLORS[ch]; ctx.fillRect(x0 + c * s, y0 + r * s, s, s); } });
  if (waving) WILL_ARM_UP.forEach((row, r) => { for (let c = 0; c < row.length; c++) { const ch = row[c]; if (ch === '.') continue; ctx.fillStyle = WILL_COLORS[ch]; ctx.fillRect(x0 + (13 + c) * s, y0 + (9 + r) * s - (Math.floor(W.t * 6) % 2) * s, s, s); } });
  if (Math.floor(W.t * 2) % 5 === 0) { ctx.fillStyle = '#fff6c8'; ctx.fillRect(x0 + 8 * s, y0 - 2, 2, 2); }   // the crown glints
  W.willRect = { x: x0 - 6, y: y0 - 34, w: 44, h: 92 };
  // his tag: gold, two lines like everyone's
  const top = 'CREATOR', name = `☕ ${CREATOR.handle}`;
  ctx.font = '8px "Press Start 2P", monospace'; const w1 = ctx.measureText(top).width; ctx.font = '15px "VT323", monospace'; const w2 = ctx.measureText(name).width;
  const w = Math.max(w1, w2) + 20, h = 28, tx = Math.round(p.x - w / 2), ty = y0 - 32;
  ctx.fillStyle = 'rgba(40,28,8,.94)'; roundRect(tx, ty, w, h, 5); ctx.fill();
  ctx.fillStyle = '#f2c14e'; ctx.fillRect(tx, ty + 4, 3, h - 8);
  ctx.font = '8px "Press Start 2P", monospace'; ctx.fillStyle = '#f2c14e'; ctx.fillText(top, tx + 10, ty + 11);
  ctx.font = '15px "VT323", monospace'; ctx.fillStyle = '#fff3d6'; ctx.fillText(name, tx + 10, ty + 24);
  if (waving) { ctx.font = '16px "VT323", monospace'; const msg = 'Buy me a coffee? ☕'; const bw = ctx.measureText(msg).width + 16; const bx = Math.round(p.x - bw / 2), by = ty - 26;
    ctx.fillStyle = '#ffe9a8'; roundRect(bx, by, bw, 20, 5); ctx.fill(); ctx.strokeStyle = '#1a1020'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = '#1a1020'; ctx.fillText(msg, bx + 8, by + 15); }
}
const onWill = pt => { const r = W.willRect; return !!r && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h; };

function drawChair(d) {
  const s = d.seat;
  isoBoxDraw({ i: s.i - 0.28, j: s.j - 0.3, w: 0.56, d: 0.2, h: 30, z: 0, top: shade(DEPTS[d.dept].accent, 0.45), side: shade(DEPTS[d.dept].accent, 0.32) });
}
// glass partitions, cut in half-tile pieces so they depth-sort with the agents
const GLASS = [];
for (const [axis, at, a, b] of WALLS) for (let t = a; t < b - 0.01; t += 0.5) {
  const t2 = Math.min(b, t + 0.5);
  const p0 = axis === 'i' ? { i: at, j: t } : { i: t, j: at }, p1 = axis === 'i' ? { i: at, j: t2 } : { i: t2, j: at };
  GLASS.push({ p0, p1, depth: (p0.i + p1.i) / 2 + (p0.j + p1.j) / 2 });
}
function drawGlass(g) {
  const A = iso(g.p0.i, g.p0.j), B = iso(g.p1.i, g.p1.j), H = 44;
  poly(ctx, [A, B, up(B, H), up(A, H)], 'rgba(170,205,255,.12)');
  ctx.strokeStyle = 'rgba(220,235,255,.45)'; ctx.beginPath(); ctx.moveTo(A.x, A.y - H); ctx.lineTo(B.x, B.y - H); ctx.stroke();
  ctx.strokeStyle = 'rgba(10,8,16,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.lineWidth = 1;
}

// ---------- actors ----------
function drawActor(a) {
  const p = iso(a.i, a.j);
  const spr = sprite(a.frame, a.color, a.mirror);
  const x = Math.round(p.x - 32), y = Math.round(p.y - 54 + a.sitOffset);
  ctx.save(); ctx.globalAlpha = Math.max(0, a.alpha) * (dimmed(a) ? 0.3 : 1);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (W.selected === a.name) { ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 18, 8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
  ctx.drawImage(spr, x, y);
  ctx.restore();
  a.rect = { x: x + 14, y, w: 36, h: 56 };
  if (a.frame === 'coffeeA' || a.frame === 'coffeeB') {
    const sx = x + (a.frame === 'coffeeA' ? 36 : 48), sy = y + (a.frame === 'coffeeA' ? 14 : 34);
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let k = 0; k < 3; k++) { const t = (W.t * 1.5 + k / 3) % 1; ctx.fillRect(sx + Math.sin(t * 6 + k) * 2, sy - t * 14, 2, 2); }
  }
  if (a.act && a.act.kind === 'sleep') {
    ctx.fillStyle = 'rgba(220,230,255,.85)'; ctx.font = '14px "VT323", monospace';
    for (let k = 0; k < 2; k++) { const t = (W.t * 0.6 + k / 2) % 1; ctx.globalAlpha = 1 - t; ctx.fillText('z', x + 42 + t * 10, y + 10 - t * 18); }
    ctx.globalAlpha = 1;
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
// Agent badge, left of the name tag: Claude's sunburst for Claude agents, a bot for other
// agents, a link for external A2A agents, a star for the host.
const isClaude = d => d && (d.kind === 'claude' || /^claude/i.test(d.name));
function drawBadge(cx, cy, a) {
  if (a.npc) { ctx.fillStyle = '#ffd36b'; ctx.font = '14px "VT323", monospace'; ctx.textAlign = 'center'; ctx.fillText('★', cx, cy + 4); ctx.textAlign = 'left'; return; }
  const d = a.data;
  if (isClaude(d)) {
    ctx.strokeStyle = '#D97757'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4 + Math.PI / 8, r0 = 1.6, r1 = k % 2 ? 5.2 : 6.6;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke();
    }
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    return;
  }
  if (d && (d.kind === 'a2a' || d.kind === 'a2a-client')) { // two links
    ctx.strokeStyle = '#b392f0'; ctx.lineWidth = 2;
    ctx.strokeRect(cx - 6, cy - 3, 7, 5); ctx.strokeRect(cx - 1, cy - 2, 7, 5); ctx.lineWidth = 1;
    return;
  }
  ctx.fillStyle = '#9aa7b8'; ctx.fillRect(cx - 5, cy - 4, 10, 8); ctx.fillRect(cx - 1, cy - 7, 2, 3);   // a little bot
  ctx.fillStyle = '#13111a'; ctx.fillRect(cx - 3, cy - 2, 2, 2); ctx.fillRect(cx + 1, cy - 2, 2, 2);
}
function drawTag(a) {
  if (a.alpha <= 0.05 || !a.rect) return;
  const p = iso(a.i, a.j), bottom = p.y - 60 + a.sitOffset;
  const pj = projectOf(a);
  const mgr = !a.npc && a.data && a.data.manager;
  const top = a.npc ? 'HOST' : mgr ? `${DEPTS[deptOf(a.data)].name} MANAGER` : pj ? pj.name.toUpperCase() : DEPTS[deptOf(a.data)].name;
  const name = a.npc ? 'Jean-Claude' : a.name;
  ctx.font = '8px "Press Start 2P", monospace'; const tw1 = ctx.measureText(top).width;
  ctx.font = '15px "VT323", monospace'; const tw2 = ctx.measureText(name).width;
  const w = Math.max(tw1, tw2) + 34, h = 28, x = Math.round(p.x - w / 2), y = Math.round(bottom - h);
  ctx.globalAlpha = Math.max(0, a.alpha) * (dimmed(a) ? 0.3 : 0.94);
  ctx.fillStyle = a.npc ? '#3a1320' : 'rgba(13,11,20,.88)'; roundRect(x, y, w, h, 5); ctx.fill();
  ctx.fillStyle = a.npc ? '#ffd36b' : { working: '#4fb47a', idle: '#e8b54a', away: '#6f6480', gone: '#6f6480', entering: '#4fb47a' }[a.status];
  ctx.fillRect(x, y + 4, 3, h - 8);                                   // status strip
  drawBadge(x + 15, y + h / 2, a);
  ctx.font = '8px "Press Start 2P", monospace'; ctx.fillStyle = a.npc || mgr ? '#ffd36b' : (pj ? pj.color : DEPTS[deptOf(a.data)].accent);
  ctx.fillText(top, x + 26, y + 11);
  ctx.font = '15px "VT323", monospace'; ctx.fillStyle = a.npc ? '#ffd36b' : '#f1e9dd';
  ctx.fillText(name, x + 26, y + 24);
  if (!a.npc && W.offers.has(a.name.toLowerCase())) { // a request is waiting for them: the quest "!"
    const bob = Math.round(Math.sin(W.t * 4) * 2), qx = Math.round(p.x), qy = y - 22 + bob;
    ctx.fillStyle = '#2a1b10'; ctx.fillRect(qx - 6, qy - 13, 12, 18);
    ctx.fillStyle = '#ffd36b'; ctx.fillRect(qx - 4, qy - 11, 8, 10); ctx.fillRect(qx - 4, qy + 1, 8, 3);
    ctx.fillStyle = '#2a1b10'; ctx.fillRect(qx - 1, qy - 9, 2, 6); ctx.fillRect(qx - 1, qy + 1, 2, 2);
  }
  if (W.labels && !a.npc && a.data && a.data.doing && a.status === 'working' && !a.bubble && !W.offers.has(a.name.toLowerCase())) {
    ctx.font = '13px "VT323", monospace';
    const t = clip(a.data.doing.text, 34), dw = ctx.measureText(t).width + 10;
    ctx.fillStyle = 'rgba(224,120,79,.92)'; roundRect(p.x - dw / 2, y - 16, dw, 13, 3); ctx.fill();
    ctx.fillStyle = '#1a0d08'; ctx.fillText(t, p.x - dw / 2 + 5, y - 6);
  }
  ctx.globalAlpha = 1;
}
function wrap(text, max) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > max && line) { lines.push(line); line = wd; } else line = t; }
  if (line) lines.push(line);
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/.{0,2}$/, '…'); }
  return lines;
}
function drawBubble(a) {
  const b = a.bubble; if (!b || a.alpha <= 0.05) return;
  const p = iso(a.i, a.j);
  ctx.font = '16px "VT323", monospace';
  const lines = wrap(b.text, 210);
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, h = lines.length * 15 + 10;
  let x = Math.round(p.x - w / 2), y = Math.round(p.y - 96 + a.sitOffset - h);
  x = Math.max(4, Math.min(CW - w - 4, x)); y = Math.max(4, y);
  ctx.globalAlpha = Math.min(1, (b.until - W.t) * 2);
  const bg = { host: '#ffe9a8', phone: '#ffd0d0', done: '#c9f2d4' }[b.kind] || '#ffffff';
  ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(x + 2, y + 3, w, h, 6); ctx.fill();
  ctx.fillStyle = bg; roundRect(x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = '#1a1020'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(p.x - 6, y + h - 1); ctx.lineTo(p.x + 6, y + h - 1); ctx.lineTo(p.x, y + h + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = a.npc ? '#7c1f3f' : (a.color || '#333'); ctx.fillRect(x, y + 4, 3, h - 8);
  ctx.fillStyle = '#1a1020'; lines.forEach((l, k) => ctx.fillText(l, x + 10, y + 17 + k * 15));
  ctx.globalAlpha = 1;
}

function render() {
  if (!roomLayer) roomLayer = buildRoom();
  ctx.clearRect(0, 0, CW, CH);
  ctx.drawImage(roomLayer, 0, 0);
  if (W.focus && W.focus.kind === 'dept') { // spotlight a department: darken the rest of the floor
    const z = DEPTS[W.focus.id];
    ctx.save(); ctx.fillStyle = 'rgba(5,3,10,.45)';
    ctx.beginPath(); ctx.rect(0, 0, CW, CH);
    const pts = [iso(z.i0, z.j0), iso(z.i1, z.j0), iso(z.i1, z.j1), iso(z.i0, z.j1)];
    ctx.moveTo(pts[0].x, pts[0].y); for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].y); ctx.closePath();
    ctx.fill('evenodd'); ctx.restore();
  }
  drawLive();
  const items = [];
  for (const f of FURN) items.push({ depth: f.i + f.w / 2 + f.j + f.d / 2 + (f.depthBias || 0) + (f.kind === 'desk' ? 0.3 : 0), draw: () => drawFurniture(f) });
  for (const d of DESKS) items.push({ depth: d.seat.i + d.seat.j - 0.4, draw: () => drawChair(d) });
  for (const g of GLASS) items.push({ depth: g.depth, draw: () => drawGlass(g) });
  for (const a of W.actors.values()) items.push({ depth: a.i + a.j + (a.act && a.act.sit ? 0.01 : 0), draw: () => drawActor(a) });
  items.push({ depth: WHALE_SPOT.i + WHALE_SPOT.j, draw: drawWhale });
  items.push({ depth: HQ.spot.i + HQ.spot.j, draw: drawWill });
  items.sort((x, y) => x.depth - y.depth).forEach(it => it.draw());
  for (const p of W.particles) { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }
  for (const fn of PLUG.draw) { try { ctx.save(); fn(ctx, { t: W.t, iso, actors: [...W.actors.values()] }); ctx.restore(); } catch (e) { console.error(e); PLUG.draw.splice(PLUG.draw.indexOf(fn), 1); } }
  const actors = [...W.actors.values()].sort((x, y) => (x.i + x.j) - (y.i + y.j));
  actors.forEach(drawTag);
  actors.forEach(drawBubble);
}

// Real time even when the tab is in the background (browsers throttle or pause frames there).
let last = performance.now();
function advance(now) {
  let dt = Math.min(5, (now - last) / 1000); last = now;
  while (dt > 0) { const step = Math.min(0.05, dt); update(step); dt -= step; }
}
function loop(now) { advance(now); render(); requestAnimationFrame(loop); }
setInterval(() => { if (document.hidden) { advance(performance.now()); render(); } }, 500);

// ---------- plugins (docs/PLUGINS.md): window.Jean.onDojo(dojo => …) ----------
const PLUG = { draw: [], message: [], windows: {}, ready: [] };
window.Jean = window.Jean || {};
window.Jean.onDojo = fn => { if (W.state) fn(dojoApi()); else PLUG.ready.push(fn); };
function dojoApi() {
  return {
    state: () => W.state, world: W, iso, toast: msg => toast(msg), open: (kind, opts) => openWin(kind, opts),
    /** draw on top of the room every frame: fn(ctx, { t, iso, actors }) */
    onDraw: fn => PLUG.draw.push(fn),
    /** every new message or event as it arrives: fn(message) */
    onMessage: fn => PLUG.message.push(fn),
    /** a game window: addWindow('kind', { title, render: (win, state) => html, onClick: (el, win) => {} }) */
    addWindow: (kind, def) => { PLUG.windows[kind] = def; WIN_TITLES[kind] = String(def.title || kind).toUpperCase(); },
    /** a hotbar button that opens a window: addHotbar({ kind, label, key }) */
    addHotbar: ({ kind, label, key }) => {
      const b = document.createElement('button'); b.dataset.win = kind; b.innerHTML = `${key ? `<kbd>${esc(key.toUpperCase())}</kbd>` : '<kbd>·</kbd>'}${esc(label)}`;
      b.addEventListener('click', () => { if (W.win && W.win.kind === kind) return closeWin(); W.history = []; W.win = null; openWin(kind); });
      document.getElementById('hotbar').appendChild(b);
      if (key) PLUG.keys[key.toLowerCase()] = kind;
    },
  };
}
PLUG.keys = {};
async function loadPlugins() {
  try {
    const list = await (await fetch('/api/plugins?page=dojo')).json();
    if (!Array.isArray(list)) return;
    for (const p of list) {
      for (const href of p.styles) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
      for (const src of p.scripts) { const sc = document.createElement('script'); sc.src = src; document.body.appendChild(sc); }
    }
  } catch { /* no server (demo) or no plugins */ }
}

// ---------- full screen: the room is scaled to fit the window ----------
function fit() {
  const s = Math.min(innerWidth / CW, innerHeight / CH);
  cv.style.width = Math.round(CW * s) + 'px'; cv.style.height = Math.round(CH * s) + 'px';
  cv.style.left = Math.round((innerWidth - CW * s) / 2) + 'px'; cv.style.top = Math.round((innerHeight - CH * s) / 2) + 'px';
}
addEventListener('resize', fit); fit();

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const addr = to => to.startsWith('#') ? '#' + ((W.state.projects.find(p => '#' + p.id === to) || {}).name || to.slice(1)) : to === W.owner ? W.ownerName : to;
const isFocus = (kind, id) => W.focus && W.focus.kind === kind && W.focus.id === id;
const agentData = name => (W.state.agents || []).find(a => a.name === name);
const projName = id => (W.state.projects.find(p => p.id === id) || {}).name || '';
const STATUS_BADGE = { working: ['live', 'WORKING'], idle: ['idle', 'IDLE'], away: ['away', 'AWAY'], gone: ['offline', 'OFFLINE'] };
const statusBadge = d => { const [c, t] = STATUS_BADGE[statusOf(d)] || ['away', '?']; return `<span class="badge ${c}">${t}</span>`; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); }
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || 'that did not work'); throw new Error(j.error); }
  return j;
}
const skillsIn = dept => ((W.state && W.state.skills) || []).filter(k => k.dept === dept);
const crewList = () => (W.state.agents || []).map(a => ({ ...a, st: statusOf(a), dept: deptOf(a) })).filter(a => a.st !== 'gone');

// ---------- HUD + chat ----------
function renderPanels() {
  if (!W.state) return;
  const crew = crewList(), n = s => crew.filter(a => a.st === s).length;
  $('#chips').innerHTML = `<span class="chip"><b>${crew.length}</b> on the floor</span><span class="chip"><b>${n('working')}</b> working</span><span class="chip"><b>${n('idle')}</b> idle</span><span class="chip"><b>${n('away')}</b> away</span>${W.offers.size ? `<span class="chip" style="color:var(--gold)"><b>${W.offers.size}</b> open request${W.offers.size === 1 ? '' : 's'}</span>` : ''}`;
  $('#chatAs').textContent = W.ownerName.toUpperCase().slice(0, 10);
  renderChat();
  if (W.win) renderWin();
}
function renderHudSystem() {
  const s = W.sys; if (!s) return;
  let el = document.getElementById('sysChip');
  if (!el) { el = document.createElement('button'); el.id = 'sysChip'; el.className = 'chip syschip'; el.addEventListener('click', () => { W.history = []; W.win = null; openWin('system'); }); $('#chips').after(el); }
  const running = s.docker.containers.filter(c => c.state === 'running').length;
  el.classList.toggle('hot', !!s.busy);
  el.innerHTML = `CPU <b>${s.cpu}%</b> · MEM <b>${s.mem}%</b>${s.gpu ? ` · GPU <b>${s.gpu.util}%</b>` : ''} · <b>${s.servers.length}</b> servers${s.docker.available ? ` · 🐳 <b>${running}</b>` : ''}`;
}
function renderChat() {
  const me = W.owner;
  const rel = (W.state.messages || []).filter(m => m.kind === 'request' || m.from === me || m.to === me || m.from === 'jean' || /^I'll take it/.test(m.text)).slice(-7);
  $('#chatLog').innerHTML = rel.map((m, k) => {
    const cls = m.from === me ? 'me' : m.from === 'jean' ? 'host' : /^I'll take it/.test(m.text) ? 'claim' : m.kind === 'request' ? 'host' : '';
    const who = m.from === me ? W.ownerName : m.from === 'jean' ? '★ Jean-Claude' : m.from;
    const to = m.kind === 'request' ? ' → everyone' : m.to !== me && m.from !== 'jean' ? ` → ${addr(m.to)}` : m.from === 'jean' ? ` → ${m.to}` : '';
    const text = m.kind === 'request' ? `🙋 ${m.text}${m.claimedBy ? ` — taken by ${m.claimedBy}` : m.candidates && m.candidates[0] ? ` — offered to ${m.candidates[0]}` : ''}` : m.text;
    return `<div class="cl ${cls} ${k < rel.length - 4 ? 'fade' : ''}" data-mid="${m.id}"><b>${esc(who)}${esc(to)}:</b>${esc(clip(text, 110))}</div>`;
  }).join('');
}
$('#chatLog').addEventListener('click', e => {
  const el = e.target.closest('[data-mid]'); if (!el) return;
  const m = W.state.messages.find(x => x.id === el.dataset.mid); if (!m) return;
  if (m.kind === 'request' || (m.thread && (W.state.messages.find(x => x.id === m.thread) || {}).kind === 'request')) return openWin('request', { id: m.thread || m.id });
  const other = m.from === W.owner ? m.to : m.from;
  if (agentData(other)) openWin('agent', { id: other }); else openWin('radio');
});
$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const inp = $('#chatInput'); const text = inp.value.trim(); if (!text) return;
  const dm = text.match(/^@([\w.-]+)\s+([\s\S]+)/);
  try {
    if (dm) { await post('/api/messages', { to: dm[1], text: dm[2] }); toast(`sent to ${dm[1]}`); }
    else { const r = await post('/api/requests', { text }); toast(r.ranked && r.ranked[0] ? `Jean offers it to ${r.ranked[0].name}` : 'posted to the room'); }
    inp.value = '';
  } catch {}
});

// ---------- game windows ----------
const WIN_TITLES = { system: 'SYSTEM', quests: 'QUEST LOG', crew: 'THE CREW', agent: 'AGENT', projects: 'PROJECTS', depts: 'FLOORS', playbook: 'PLAYBOOK', radio: 'RADIO', request: 'REQUEST' };
function openWin(kind, opts = {}) {
  if (W.win) W.history.push(W.win);
  W.win = { kind, ...opts };
  $('#winLayer').hidden = false;
  document.querySelectorAll('#hotbar button').forEach(b => b.classList.toggle('on', b.dataset.win === kind));
  renderWin(true);
}
function closeWin() { W.win = null; W.history = []; $('#winLayer').hidden = true; document.querySelectorAll('#hotbar button').forEach(b => b.classList.remove('on')); }
function backWin() { W.win = W.history.pop() || null; if (!W.win) return closeWin(); renderWin(true); }
function renderWin(fresh) {
  const el = $('#win'); const w = W.win; if (!w || !W.state) return;
  // keep what the owner is typing across live refreshes
  const inp = el.querySelector('input[data-keep]'), keep = inp ? { v: inp.value, f: document.activeElement === inp, k: inp.dataset.keep } : null;
  const scroll = fresh ? 0 : (el.querySelector('.win-body') || {}).scrollTop || 0;
  const builtIn = { system: winSystem, quests: winQuests, crew: winCrew, agent: winAgent, projects: winProjects, depts: winDepts, playbook: winPlaybook, radio: winRadio, request: winRequest }[w.kind];
  const plug = PLUG.windows[w.kind];
  const body = builtIn ? builtIn() : plug ? plug.render(w, W.state) : '<p class="muted">Unknown window.</p>';
  el.innerHTML = `<div class="win-head">${W.history.length ? '<button class="win-back" data-act="back">◂ back</button>' : ''}<h2>${WIN_TITLES[w.kind]}</h2><small>${esc(w.sub || '')}</small><button class="win-x" data-act="close" title="close (Esc)">X</button></div><div class="win-body">${body}</div>`;
  el.querySelector('.win-body').scrollTop = scroll;
  el.querySelectorAll('canvas[data-sprite]').forEach(c => { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(sprite(c.dataset.frame || 'idle', c.dataset.sprite === 'jc' ? null : c.dataset.sprite, false), 0, 0); });
  const th = el.querySelector('.thread'); if (th) th.scrollTop = th.scrollHeight;
  if (keep) { const n = el.querySelector(`input[data-keep="${keep.k}"]`); if (n) { n.value = keep.v; if (keep.f) n.focus(); } }
}
const spr = (name, frame = 'idle', w = 64, h = 56) => { const a = W.actors.get(name); const d = agentData(name); return `<canvas width="${w}" height="${h}" data-sprite="${esc((a && a.color) || (d && d.color) || '#D97757')}" data-frame="${frame}"></canvas>`; };

// QUEST LOG — tasks as quests
function questList() {
  const tab = W.win.tab || 'crew', open = W.state.tasks.filter(t => t.status !== 'done');
  const onFloor = new Set(crewList().map(a => a.name));
  const td = todayStr();
  const lists = {
    crew: open.filter(t => t.assignee && onFloor.has(t.assignee)),
    urgent: open.filter(t => !t.assignee && t.priority === 1),
    open: open.filter(t => t.scope === 'day' ? t.date <= td : true).slice(0, 200),
    done: W.state.tasks.filter(t => t.status === 'done' && t.doneAt && Date.now() - new Date(t.doneAt) < 7 * 864e5).reverse(),
  };
  if (W.focus && W.focus.kind === 'project') for (const k in lists) lists[k] = lists[k].filter(t => t.project === W.focus.id);
  return { tab, lists };
}
function winQuests() {
  const { tab, lists } = questList();
  const list = lists[tab];
  const sel = W.state.tasks.find(t => t.id === W.win.sel) || list[0];
  const row = t => `<div class="row ${sel && sel.id === t.id ? 'on' : ''}" data-act="qsel" data-id="${t.id}">${t.priority === 1 ? '<span class="star">!!</span>' : ''}<span class="t">${esc(t.title)}</span><span class="r">${t.assignee ? '@' + esc(t.assignee) : esc(projName(t.project))}</span></div>`;
  const tabs = [['crew', 'Crew quests'], ['urgent', 'Unclaimed · urgent'], ['open', 'All open'], ['done', 'Done this week']]
    .map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l} (${lists[k].length})</button>`).join('');
  return `<div class="tabs">${tabs}</div><div class="split"><div class="list">${list.map(row).join('') || '<p class="muted">Nothing here.</p>'}</div><div>${sel ? questDetail(sel) : '<p class="muted">Pick a quest.</p>'}</div></div>`;
}
function questDetail(t) {
  const pj = W.state.projects.find(p => p.id === t.project);
  const due = t.scope === 'day' ? (t.date < todayStr() && t.status !== 'done' ? `${t.date} · overdue` : t.date) : `${t.scope} goal`;
  const hero = t.assignee ? agentData(t.assignee) : null;
  const crew = crewList();
  let pickers = '';
  if (t.status !== 'done') {
    const ranked = crew.map(a => a.name);
    pickers = `<div class="label">${t.assignee ? 'Reassign to' : 'Give this quest to'}</div><div class="pick">${ranked.filter(n => n !== t.assignee).map(n => `<button data-act="assign" data-id="${t.id}" data-to="${esc(n)}">@${esc(n)}</button>`).join('') || '<span class="muted">nobody on the floor</span>'}</div>
      <div class="btns">${!t.assignee ? `<button class="gbtn" data-act="askcrew" data-id="${t.id}">🙋 Ask the crew who can</button>` : `<button class="gbtn alt" data-act="open" data-kind="agent" data-id="${esc(t.assignee)}">Talk to @${esc(t.assignee)}</button>`}</div>`;
  }
  return `<div class="card"><div class="label">Quest</div><div class="qtitle">${esc(t.title)}</div>
    <div class="btns" style="margin:0 0 10px">${t.status === 'done' ? '<span class="badge done">DONE</span>' : t.status === 'doing' ? '<span class="badge doing">IN PROGRESS</span>' : '<span class="badge open">OPEN</span>'}${t.priority === 1 ? '<span class="badge urgent">URGENT</span>' : ''}</div>
    <div class="stats"><span>giver</span><b>${esc(t.createdBy && t.createdBy !== W.owner ? t.createdBy : W.ownerName)}</b>
      <span>hero</span><b>${hero ? `@${esc(hero.name)} ${statusBadge(hero)}` : t.assignee ? '@' + esc(t.assignee) : '<span class="muted">nobody yet</span>'}</b>
      ${pj ? `<span>project</span><b>${esc(pj.name)}</b>` : ''}<span>when</span><b>${esc(due)}</b>${t.recur ? `<span>repeats</span><b>${esc(t.recur)}</b>` : ''}</div>
    ${t.notes ? `<div class="label">Briefing</div><div class="notes">${esc(t.notes)}</div>` : ''}
    ${pickers}</div>`;
}

// AGENT — character sheet + conversation
function winAgent() {
  const d = agentData(W.win.id);
  if (!d) return '<p class="muted">This agent left the floor.</p>';
  W.win.sub = d.name;
  const dept = deptOf(d), pj = W.state.projects.find(p => p.id === d.project);
  const quests = W.state.tasks.filter(t => t.assignee === d.name && t.status !== 'done');
  const me = W.owner;
  const thread = (W.state.messages || []).filter(m => m.kind !== 'event' && ((m.from === me && m.to === d.name) || (m.from === d.name && m.to === me) || (m.from === 'jean' && m.to === d.name) || (m.kind === 'request' && m.claimedBy === d.name))).slice(-30);
  const waitId = W.waiting.get(d.name);
  const waiting = waitId && !thread.some(m => m.from === d.name && m.at > (W.state.messages.find(x => x.id === waitId) || {}).at);
  if (!waiting) W.waiting.delete(d.name);
  const give = W.win.give ? (() => {
    const open = W.state.tasks.filter(t => t.status !== 'done' && !t.assignee);
    const mine = open.filter(t => t.project && t.project === d.project), rest = open.filter(t => !(t.project && t.project === d.project) && t.priority === 1);
    const opts = mine.concat(rest).slice(0, 14);
    return `<div class="label">Give a quest</div><div class="list" style="max-height:180px">${opts.map(t => `<div class="row" data-act="assign" data-id="${t.id}" data-to="${esc(d.name)}"><span class="t">${t.priority === 1 ? '!! ' : ''}${esc(t.title)}</span><span class="r">${esc(projName(t.project))}</span></div>`).join('') || '<p class="muted">No unassigned quests that fit.</p>'}</div>`;
  })() : '';
  return `<div class="split"><div>
      <div class="portrait">${spr(d.name, waiting ? 'talk' : statusOf(d) === 'working' ? 'typeA' : 'idle')}<div><div class="nm">${esc(d.name)}</div><div class="rl">${esc(d.role || 'no role yet')}</div>
        <div class="btns" style="margin-top:6px">${statusBadge(d)}${d.manager ? `<span class="badge mgr">${DEPTS[dept].name} MANAGER</span>` : ''}</div></div></div>
      <div class="stats"><span>floor</span><b>${DEPTS[dept].name.toLowerCase()}${d.department ? '' : ' <span class="muted">(guessed)</span>'}</b>
        ${pj ? `<span>project</span><b>${esc(pj.name)}</b>` : ''}<span>doing</span><b>${esc(d.doing ? d.doing.text : '—')}</b><span>seen</span><b>${ago(d.lastSeen)} ago</b><span>tool</span><b>${esc(d.kind || 'agent')}</b></div>
      <div class="label">Quests (${quests.length})</div>
      <div class="list" style="max-height:150px">${quests.map(t => `<div class="row" data-act="open" data-kind="quests" data-sel="${t.id}"><span class="t">${t.status === 'doing' ? '▸ ' : ''}${esc(t.title)}</span></div>`).join('') || '<p class="muted">No quests.</p>'}</div>
      <div class="btns"><button class="gbtn alt" data-act="give">${W.win.give ? 'Hide quests' : '+ Give a quest'}</button></div>${give}
    </div><div>
      <div class="label">Conversation</div>
      <div class="thread">${thread.map(m => `<div class="say ${m.from === me ? 'me' : ''}"><small>${m.from === me ? W.ownerName : esc(m.from)} · ${hhmm(m.at)}</small>${esc(m.kind === 'request' ? '🙋 ' + m.text : m.text)}</div>`).join('') || '<p class="muted">No messages yet. Say something.</p>'}
        ${waiting ? '<div class="say"><small>' + esc(d.name) + '</small>… typing (it answers on its next turn)</div>' : ''}</div>
      <form class="compose" data-act="send" data-to="${esc(d.name)}"><input data-keep="msg-${esc(d.name)}" placeholder="Message ${esc(d.name)}…" maxlength="600"><button class="gbtn" data-mode="send">Send</button><button class="gbtn alt" data-mode="ask" title="send and watch for the answer">Ask</button></form>
    </div></div>`;
}

// CREW — everyone on the floor
function winCrew() {
  const crew = crewList().sort((a, b) => (b.manager === true) - (a.manager === true) || ['working', 'idle', 'away'].indexOf(a.st) - ['working', 'idle', 'away'].indexOf(b.st));
  return `<div class="grid">${crew.map(a => `<div class="agentcard" data-act="open" data-kind="agent" data-id="${esc(a.name)}">${spr(a.name, a.st === 'working' ? 'typeA' : 'idle', 64, 56)}<div><div class="nm">${esc(a.name)}</div><div class="sub">${a.manager ? '👑 ' : ''}${DEPTS[a.dept].name.toLowerCase()} · ${esc(a.doing && a.st === 'working' ? a.doing.text : a.role || '—')}</div><div style="margin-top:3px">${statusBadge(a)}</div></div></div>`).join('') || '<p class="muted">Nobody checked in. Agents join with <code>jean hello</code>.</p>'}</div>`;
}

// PROJECTS
function winProjects() {
  const ps = liveProjects(), open = W.state.tasks.filter(t => t.status !== 'done'), td = todayStr();
  const sel = W.state.projects.find(p => p.id === W.win.sel) || ps[0];
  const stat = p => { const ts = open.filter(t => t.project === p.id); return { ts, od: ts.filter(t => t.scope === 'day' && t.date < td).length }; };
  const detail = p => { const { ts, od } = stat(p); const agents = crewList().filter(a => a.project === p.id);
    return `<div class="card"><div class="label">Project</div><div class="qtitle">${esc(p.name)}</div>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
      <div class="stats"><span>open</span><b>${ts.length}</b><span>overdue</span><b>${od}</b><span>agents</span><b>${agents.map(a => '@' + esc(a.name)).join(', ') || '<span class="muted">none right now</span>'}</b></div>
      <div class="label">Quests</div><div class="list" style="max-height:220px">${ts.slice(0, 40).map(t => `<div class="row" data-act="open" data-kind="quests" data-sel="${t.id}" data-tab="open"><span class="t">${t.priority === 1 ? '!! ' : ''}${esc(t.title)}</span><span class="r">${t.assignee ? '@' + esc(t.assignee) : ''}</span></div>`).join('') || '<p class="muted">No open quests.</p>'}</div>
      <div class="btns"><button class="gbtn alt" data-act="spot" data-kind="project" data-id="${p.id}">${isFocus('project', p.id) ? 'Stop spotlight' : 'Spotlight in the room'}</button></div></div>`; };
  return `<div class="split"><div class="list">${ps.map(p => { const { ts, od } = stat(p); return `<div class="row ${sel && sel.id === p.id ? 'on' : ''}" data-act="psel" data-id="${p.id}"><span class="t">${esc(p.name)}</span><span class="r">${ts.length} open${od ? ` · ${od} late` : ''}</span></div>`; }).join('') || '<p class="muted">No active projects.</p>'}</div><div>${sel ? detail(sel) : ''}</div></div>`;
}

// FLOORS — departments, their manager, agents and skills
function winDepts() {
  const k = W.win.tab || 'tech', z = DEPTS[k];
  const crew = crewList().filter(a => a.dept === k);
  const mgr = (W.state.agents || []).find(a => a.manager && a.department === k);
  const skills = skillsIn(k);
  return `<div class="tabs">${DEPT_KEYS.map(d => `<button class="${d === k ? 'on' : ''}" data-act="tab" data-tab="${d}">${DEPTS[d].name.toLowerCase()} (${crewList().filter(a => a.dept === d).length})</button>`).join('')}</div>
    <div class="split"><div>
      <div class="label">Floor manager</div>
      ${mgr ? `<div class="agentcard" data-act="open" data-kind="agent" data-id="${esc(mgr.name)}">${spr(mgr.name)}<div><div class="nm">👑 ${esc(mgr.name)}</div><div class="sub">${esc(mgr.role || '')}</div><div>${statusBadge(mgr)}</div></div></div>`
        : `<p class="muted">No manager yet. One agent can run ${z.name.toLowerCase()} for every project. Ask Claude: <code>jean agent manager &lt;name&gt; ${k}</code></p>`}
      <div class="label">On this floor (${crew.length})</div>
      <div class="list">${crew.map(a => `<div class="row" data-act="open" data-kind="agent" data-id="${esc(a.name)}"><span class="t">${a.manager ? '👑 ' : ''}${esc(a.name)}</span><span class="r">${STATUS_BADGE[a.st] ? STATUS_BADGE[a.st][1].toLowerCase() : ''}</span></div>`).join('') || '<p class="muted">Empty.</p>'}</div>
      <div class="btns"><button class="gbtn alt" data-act="spot" data-kind="dept" data-id="${k}">${isFocus('dept', k) ? 'Stop spotlight' : 'Spotlight this floor'}</button></div>
    </div><div>
      <div class="label">Skills on this floor (${skills.length})</div>
      <div class="list">${skills.map(s => `<div class="row" data-act="open" data-kind="playbook" data-sel="${s.id}"><span class="t">📘 ${esc(s.name)}</span><span class="r">${esc(s.tools.join(', '))}</span></div>`).join('') || '<p class="muted">No skills yet. Agents add them with <code>jean learn</code>.</p>'}</div>
    </div></div>`;
}

// PLAYBOOK — stack + skills
function winPlaybook() {
  const skills = W.state.skills || [], stack = W.state.stack || [];
  const sel = skills.find(k => k.id === W.win.sel) || skills[0];
  return `<div class="card"><div class="label">Stack — the defaults every agent uses</div><div class="stats">${stack.map(e => `<span>${esc(e.area)}</span><b>${esc(e.choice)}${e.notes ? ` <span class="muted">${esc(e.notes)}</span>` : ''}</b>`).join('') || '<span class="muted">none yet</span><b></b>'}</div></div>
    <div class="split" style="margin-top:10px"><div class="list">${skills.map(k => `<div class="row ${sel && sel.id === k.id ? 'on' : ''}" data-act="ksel" data-id="${k.id}"><span class="t">${esc(k.name)}</span><span class="r">${esc(DEPTS[k.dept] ? DEPTS[k.dept].name.toLowerCase() : k.dept)}</span></div>`).join('') || '<p class="muted">No skills yet.</p>'}</div>
    <div>${sel ? `<div class="card"><div class="label">Skill</div><div class="qtitle">${esc(sel.name)}</div>${sel.summary ? `<p>${esc(sel.summary)}</p>` : ''}
      <div class="label">Steps</div><div class="notes">${esc(sel.body || 'No steps written yet.')}</div>
      ${sel.install ? `<div class="label">Setup</div><div class="notes">${esc(sel.install)}</div>` : ''}
      <div class="label">Add to Claude Code</div><code>jean skill install ${sel.id.slice(2)}</code></div>` : ''}</div></div>`;
}

// RADIO — everything that was said
function winRadio() {
  const f = W.win.tab || 'all';
  const ms = (W.state.messages || []).filter(m => f === 'all' || (f === 'msg' && m.kind === 'msg') || (f === 'request' && m.kind === 'request') || (f === 'event' && m.kind === 'event')).slice(-120).reverse();
  return `<div class="tabs">${[['all', 'All'], ['msg', 'Messages'], ['request', 'Requests'], ['event', 'Activity']].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="list" style="max-height:60vh">${ms.map(m => m.kind === 'event'
      ? `<div class="muted">${hhmm(m.at)} · ${esc(m.from)} ${esc(clip(m.text, 110))}</div>`
      : `<div class="row" data-act="${m.kind === 'request' ? 'open' : 'open'}" data-kind="${m.kind === 'request' ? 'request' : agentData(m.from === W.owner ? m.to : m.from) ? 'agent' : 'radio'}" data-id="${esc(m.kind === 'request' ? m.id : m.from === W.owner ? m.to : m.from)}"><span class="r">${hhmm(m.at)}</span><span class="t"><b>${esc(m.from === W.owner ? W.ownerName : m.from)}</b> → ${esc(m.kind === 'request' ? 'everyone' : addr(m.to))}: ${esc(m.kind === 'request' ? '🙋 ' + m.text : m.text)}</span></div>`).join('') || '<p class="muted">Quiet.</p>'}</div>`;
}

// REQUEST — "who can do this?"
function winRequest() {
  const m = W.state.messages.find(x => x.id === W.win.id);
  if (!m) return '<p class="muted">Request not found.</p>';
  const replies = W.state.messages.filter(x => x.thread === m.id && x.kind !== 'event');
  if (!W.win.ranked) fetch(`/api/route?text=${encodeURIComponent(m.text)}`).then(r => r.json()).then(r => { if (W.win && W.win.id === m.id) { W.win.ranked = r; renderWin(); } }).catch(() => {});
  return `<div class="card"><div class="label">Request from ${esc(m.from === W.owner ? W.ownerName : m.from)} · ${hhmm(m.at)}</div><div class="qtitle">${esc(m.text)}</div>
    <div class="btns" style="margin:0">${m.claimedBy ? `<span class="badge done">TAKEN BY ${esc(m.claimedBy).toUpperCase()}</span>` : '<span class="badge open">WAITING FOR A HERO</span>'}</div></div>
    <div class="card"><div class="label">Who Jean thinks fits</div>${(W.win.ranked || []).map((r, k) => `<div class="rank">${k ? '' : '<span class="star">→</span>'}<b data-act="open" data-kind="agent" data-id="${esc(r.name)}" style="cursor:pointer">@${esc(r.name)}</b><span class="muted">score ${r.score} · ${esc(r.presence)}${r.why.length ? ' · ' + esc(r.why.join(', ')) : ''}</span></div>`).join('') || '<p class="muted">Thinking…</p>'}
      <p class="muted" style="margin-top:8px">The best fit was asked directly; everyone else saw it too. The first agent to run <code>jean claim ${m.id.slice(2)}</code> takes it, and it becomes their quest.</p></div>
    ${replies.length ? `<div class="card"><div class="label">Replies</div><div class="thread">${replies.map(r => `<div class="say"><small>${esc(r.from === 'jean' ? 'Jean-Claude' : r.from)} · ${hhmm(r.at)}</small>${esc(r.text)}</div>`).join('')}</div></div>` : ''}`;
}

// SYSTEM — the machine the crew runs on
function winSystem() {
  const s = W.sys;
  if (!s) { loadSystem(); return '<p class="muted">Reading the machine…</p>'; }
  W.win.sub = s.host;
  const gauge = (label, pct, sub) => `<div class="gauge"><span>${label}</span><div class="gbar ${pct >= 85 ? 'hot' : pct >= 65 ? 'warm' : ''}"><i style="width:${Math.min(100, pct || 0)}%"></i></div><b>${pct ?? '–'}%</b><small>${esc(sub || '')}</small></div>`;
  const running = s.docker.containers.filter(c => c.state === 'running'), paused = s.docker.containers.filter(c => c.state === 'paused');
  return `${s.busy ? `<div class="card hotcard">⚠ Busy: ${esc(s.hot.join(', '))}. Stop what you don't need.</div>` : ''}
    <div class="split"><div>
      <div class="label">Load</div>
      ${gauge('CPU', s.cpu, `load ${s.load} · ${s.cores} cores`)}${gauge('MEM', s.mem, `${s.memTotalGB} GB`)}${s.gpu ? gauge('GPU', s.gpu.util, s.gpu.name) : ''}
      <div class="label">Dev servers (${s.servers.length})</div>
      <div class="list" style="max-height:220px">${s.servers.map(x => `<div class="row"><span class="r">:${x.ports[0]}</span><span class="t">${esc(x.command)} · ${esc(x.project || x.cwd.split('/').pop() || '')}</span><button class="gbtn alt" data-act="sysstop" data-port="${x.ports[0]}">Stop</button></div>`).join('') || '<p class="muted">No dev servers running.</p>'}</div>
      <div class="label">Heaviest processes</div>
      <div class="muted">${s.top.slice(0, 5).map(p => `${esc(p.command)} ${p.cpu}%`).join(' · ')}</div>
    </div><div>
      <div class="label">Docker ${s.docker.available ? `· ${running.length} running · ${paused.length} paused` : '· not running'}</div>
      ${s.docker.available ? `<div class="btns" style="margin:0 0 8px">${running.length ? '<button class="gbtn alt" data-act="dock" data-action="pause-all">Pause all</button><button class="gbtn alt" data-act="dock" data-action="stop-all">Stop all</button>' : ''}${paused.length ? '<button class="gbtn alt" data-act="dock" data-action="unpause-all">Unpause all</button>' : ''}</div>
      <div class="list" style="max-height:300px">${running.concat(paused).map(c => `<div class="row"><span class="t">${esc(c.name)}</span><span class="r">${c.state === 'paused' ? 'paused' : c.cpu != null ? c.cpu + '%' : ''}</span>${c.state === 'paused' ? `<button class="gbtn alt" data-act="dock" data-action="unpause" data-name="${esc(c.name)}">Resume</button>` : `<button class="gbtn alt" data-act="dock" data-action="pause" data-name="${esc(c.name)}">Pause</button><button class="gbtn alt" data-act="dock" data-action="stop" data-name="${esc(c.name)}">Stop</button>`}</div>`).join('') || '<p class="muted">No containers running.</p>'}</div>` : ''}
    </div></div>
    <div class="btns"><button class="gbtn" data-act="syspause">⏸ Pause all development</button><span class="muted">stops every dev server (not Jean) and pauses every container · agents: <code>jean system</code></span></div>`;
}

// window actions
$('#win').addEventListener('click', async e => {
  const plug = W.win && PLUG.windows[W.win.kind];
  if (plug && plug.onClick && !e.target.closest('[data-act=close],[data-act=back]')) { try { plug.onClick(e.target, W.win); } catch (err) { console.error(err); } }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, w = W.win;
  if (a === 'close') return closeWin();
  if (a === 'back') return backWin();
  if (a === 'tab') { w.tab = el.dataset.tab; w.sel = null; return renderWin(true); }
  if (a === 'qsel' || a === 'psel' || a === 'ksel') { w.sel = el.dataset.id; return renderWin(); }
  if (a === 'give') { w.give = !w.give; return renderWin(); }
  if (a === 'sysstop') { if (!confirm(`Stop the dev server on :${el.dataset.port}?`)) return; try { const r = await post('/api/system/stop', { port: Number(el.dataset.port) }); toast(`stopped ${r.command} :${r.ports[0]}`); loadSystem(); } catch {} return; }
  if (a === 'dock') { const act = el.dataset.action, nm = el.dataset.name; if (/stop/.test(act) && !confirm(`docker ${act}${nm ? ' ' + nm : ''}?`)) return; el.disabled = true; try { const r = await post('/api/system/docker', { action: act, name: nm }); toast(`docker ${r.action}: ${r.containers.length} container${r.containers.length === 1 ? '' : 's'}`); loadSystem(); } catch { el.disabled = false; } return; }
  if (a === 'syspause') { if (!confirm('Pause all development? Every dev server (not Jean) stops and every container pauses.')) return; try { const r = await post('/api/system/pause', {}); toast(`paused: ${r.stopped.length} servers stopped, ${r.paused.length} containers paused`); loadSystem(); } catch {} return; }
  if (a === 'open') return openWin(el.dataset.kind, { id: el.dataset.id, sel: el.dataset.sel, tab: el.dataset.tab });
  if (a === 'spot') { const f = { kind: el.dataset.kind, id: el.dataset.id }; W.focus = isFocus(f.kind, f.id) ? null : f; return closeWin(); }
  if (a === 'assign') { try { await post(`/api/tasks/${el.dataset.id}/assign`, { to: el.dataset.to }); toast(`quest given to ${el.dataset.to}`); w.give = false; } catch {} return; }
  if (a === 'askcrew') { const t = W.state.tasks.find(x => x.id === el.dataset.id); try { const r = await post('/api/requests', { text: t.title }); openWin('request', { id: r.request.id }); } catch {} return; }
});
$('#win').addEventListener('submit', async e => {
  const f = e.target.closest('form[data-act=send]'); if (!f) return;
  e.preventDefault();
  const inp = f.querySelector('input'); const text = inp.value.trim(); if (!text) return;
  const mode = e.submitter && e.submitter.dataset.mode;
  try {
    const m = await post('/api/messages', { to: f.dataset.to, text });
    if (mode === 'ask') W.waiting.set(f.dataset.to, m.id);
    inp.value = ''; toast(mode === 'ask' ? `asked ${f.dataset.to} — the answer shows up here` : `sent to ${f.dataset.to}`);
  } catch {}
});
$('#winLayer').addEventListener('click', e => { if (e.target === $('#winLayer')) closeWin(); });
document.querySelectorAll('#hotbar button').forEach(b => b.addEventListener('click', () => { if (W.win && W.win.kind === b.dataset.win) return closeWin(); W.history = []; W.win = null; openWin(b.dataset.win); }));
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (W.win) closeWin(); else W.focus = null; return; }
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { s: 'system', q: 'quests', c: 'crew', p: 'projects', d: 'depts', b: 'playbook', r: 'radio', ...PLUG.keys };
  if (map[e.key]) { e.preventDefault(); if (W.win && W.win.kind === map[e.key]) closeWin(); else { W.history = []; W.win = null; openWin(map[e.key]); } }
  if (e.key === 't' || e.key === 'Enter') { e.preventDefault(); $('#chatInput').focus(); }
});

// ---------- the room is clickable: agents, the board, the TV, the ticker, the floors ----------
function toCanvas(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * CW / r.width, y: (ev.clientY - r.top) * CH / r.height }; }
function hit(pt) {
  const list = [...W.actors.values()].filter(a => a.rect && a.alpha > 0.3).sort((x, y) => (y.i + y.j) - (x.i + x.j));
  return list.find(a => pt.x >= a.rect.x && pt.x <= a.rect.x + a.rect.w && pt.y >= a.rect.y - 30 && pt.y <= a.rect.y + a.rect.h);
}
function wallThing(pt) { // invert the wall transforms
  const L = iso(0, ROWS), lu = pt.x - L.x, lv = pt.y - L.y + 0.5 * lu;
  const R = iso(0, 0), ru = pt.x - R.x, rv = pt.y - R.y - 0.5 * ru;
  const inL = (u0, w, v0, v1) => lu >= u0 && lu <= u0 + w && lv >= v0 && lv <= v1;
  const inR = (u0, u1, v0, v1) => ru >= u0 && ru <= u1 && rv >= v0 && rv <= v1 && pt.x >= R.x;
  if (inL(LW(10.6), 150, -160, -44)) return { kind: 'quests', label: 'Quest board', sub: 'open tasks' };
  if (inL(LW(3.6), 78, -126, -68)) return { kind: 'radio', label: 'Radio', sub: 'everything that was said' };
  if (inL(LW(12.0), 22, -100, -60)) return { kind: 'radio', tab: 'msg', label: `${W.ownerName}'s hotline`, sub: 'messages to you' };
  if (inL(LW(15.4), 44, -120, 0)) return { kind: 'depts', tab: 'external', label: 'API gate', sub: 'external agents' };
  if (inR(146, 210, -140, -86)) return { kind: 'depts', tab: 'tech', label: 'Tech floor', sub: 'code screen' };
  if (inR(446, 578, -156, -108)) return { kind: 'projects', label: 'Projects ticker', sub: 'every live project' };
  return null;
}
function floorAt(pt) { const dx = (pt.x - OX) / (TW / 2), dy = (pt.y - OY) / (TH / 2); return { i: (dx + dy) / 2, j: (dy - dx) / 2 }; }
cv.addEventListener('mousemove', ev => {
  const pt = toCanvas(ev), a = hit(pt), tip = $('#tip');
  if (!a && onWill(pt)) { const t = $('#tip'); t.innerHTML = `<b>☕ ${CREATOR.handle}</b><small>made Jean Clawd · click to buy him a coffee</small>`; t.hidden = false; t.style.left = Math.min(ev.clientX + 16, innerWidth - 310) + 'px'; t.style.top = Math.max(8, ev.clientY - 12) + 'px'; cv.style.cursor = 'pointer'; return; }
  const wr = W.whaleRect, onWhale = !a && wr && pt.x >= wr.x && pt.x <= wr.x + wr.w && pt.y >= wr.y && pt.y <= wr.y + wr.h;
  if (onWhale && W.sys) { const d = W.sys.docker, run = d.containers.filter(c => c.state === 'running'); $('#tip').innerHTML = `<b>🐳 Docker</b><small>${run.length} running · ${d.containers.filter(c => c.state === 'paused').length} paused · click for System</small>${run.slice(0, 5).map(c => esc(c.name)).join('<br>')}`; $('#tip').hidden = false; $('#tip').style.left = Math.min(ev.clientX + 16, innerWidth - 310) + 'px'; $('#tip').style.top = Math.max(8, ev.clientY - 12) + 'px'; cv.style.cursor = 'pointer'; return; }
  const thing = !a && wallThing(pt), tile = floorAt(pt), zone = !a && !thing && zoneAt(tile.i, tile.j);
  cv.style.cursor = a || thing || zone ? 'pointer' : 'default';
  if (a) tip.innerHTML = a.npc ? `<b>★ Jean-Claude</b><small>the host: announces finished work and passes on ${esc(W.ownerName)}'s messages</small>`
    : `<b>${esc(a.name)}</b><small>${esc((a.data && a.data.role) || 'agent')} · ${DEPTS[deptOf(a.data)].name.toLowerCase()} · ${a.status}${W.offers.has(a.name.toLowerCase()) ? ' · has a request waiting' : ''}</small>${a.data && a.data.doing ? esc(clip(a.data.doing.text, 90)) : 'click to talk'}`;
  else if (thing) tip.innerHTML = `<b>${esc(thing.label)}</b><small>${esc(thing.sub)} · click to open</small>`;
  else if (zone) tip.innerHTML = `<b>${DEPTS[zone].name}</b><small>${crewList().filter(x => x.dept === zone).length} here · ${skillsIn(zone).length} skills · click to open</small>`;
  else { tip.hidden = true; return; }
  tip.hidden = false;
  tip.style.left = Math.min(ev.clientX + 16, innerWidth - 310) + 'px'; tip.style.top = Math.max(8, ev.clientY - 12) + 'px';
});
cv.addEventListener('mouseleave', () => { $('#tip').hidden = true; });
cv.addEventListener('click', ev => {
  const pt = toCanvas(ev), a = hit(pt);
  $('#tip').hidden = true;
  if (a && !a.npc) { W.selected = a.name; return openWin('agent', { id: a.name }); }
  if (a && a.npc) return openWin('radio');
  if (!a && onWill(pt)) { window.open(CREATOR.coffee, '_blank', 'noopener'); return; }
  const wr = W.whaleRect; if (wr && pt.x >= wr.x && pt.x <= wr.x + wr.w && pt.y >= wr.y && pt.y <= wr.y + wr.h) return openWin('system');
  const thing = wallThing(pt); if (thing) return openWin(thing.kind, { tab: thing.tab });
  const tile = floorAt(pt), zone = zoneAt(tile.i, tile.j); if (zone) return openWin('depts', { tab: zone });
});
$('#labels').addEventListener('click', e => { W.labels = !W.labels; e.currentTarget.classList.toggle('on', W.labels); });
$('#replay').addEventListener('click', () => {
  const msgs = (W.state.messages || []).filter(m => m.kind === 'msg' || m.kind === 'request' || /^finished: /.test(m.text)).slice(-10);
  msgs.forEach((m, k) => setTimeout(() => handleMessage(m), k * 1600));
});

// ---------- boot ----------
async function loadSystem() {
  try {
    const s = await (await fetch('/api/system')).json();
    if (!s || s.error || s.cpu === undefined) return;
    const was = W.sys && W.sys.busy; W.sys = s; renderHudSystem();
    if (s.busy && !was) enqueue(HOST, { type: 'say', where: 'stage', text: `Machine's getting hot: ${s.hot.join(', ')}. Open System [S].`, kind: 'host' });
    if (W.win && W.win.kind === 'system') renderWin();
  } catch {}
}
setInterval(loadSystem, 10000);

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('system', () => loadSystem());
  let pending = null;
  const refresh = () => { clearTimeout(pending); pending = setTimeout(() => load().catch(() => {}), 120); };
  es.addEventListener('changed', refresh);
  es.addEventListener('message', refresh);
  es.onerror = () => { es.close(); setTimeout(connect, 2000); };
}
document.fonts && document.fonts.load('16px "VT323"').then(() => document.fonts.load('10px "Press Start 2P"')).then(() => { roomLayer = null; }).catch(() => {});
setInterval(() => { if (W.state) { sync(); renderPanels(); } }, 30000);   // presence decays over time
setInterval(() => { roomLayer = null; }, 10 * 60e3);                      // the sky follows the clock
load().then(() => { connect(); loadSystem(); requestAnimationFrame(loop); const api = dojoApi(); PLUG.ready.splice(0).forEach(fn => { try { fn(api); } catch (e) { console.error(e); } }); loadPlugins(); })
  .catch(() => { toast('Cannot reach Jean. Start it with: jean serve --bg'); requestAnimationFrame(loop); });

window.__dojo = W; // for debugging in the console
})();
