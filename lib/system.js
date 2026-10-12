// The machine the crew runs on: dev servers (listening ports → process → project), CPU, memory, GPU,
// and Docker. Agents see a summary in their briefing; they (and the owner, from the Dojo) can stop a dev
// server, stop/pause containers, or pause all development. macOS first, Linux where the tools exist.
// Safety: only processes that listen on a port >= 1024, belong to this user, and look like dev
// servers can be stopped; never Jean itself, never system or desktop apps.
'use strict';
const os = require('os');
const { execFile } = require('child_process');

const sh = (cmd, args, timeout = 4000) => new Promise(resolve => {
  execFile(cmd, args, { timeout, maxBuffer: 4e6 }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')));
});

// What counts as a development server (by process name). Desktop apps that happen to listen
// (Spotify, AirPlay/ControlCenter, rapportd, Docker's own proxy…) are not dev servers.
const DEV = /^(node|nodejs|bun|deno|python\d?(\.\d+)?|Python|ruby|rails|puma|php|php-fpm|java|go|air|uvicorn|gunicorn|hypercorn|flask|django|next-server|vite|esbuild|webpack|nginx|caddy|postgres|postmaster|mysqld|mariadbd|redis-server|mongod|supabase|kong|dotnet|beam\.smp|elixir|cargo|rustc|ngrok|cloudflared|wrangler|firebase|java)$/i;
const NOT_DEV = /^(rapportd|ControlCe|ControlCenter|Spotify|com\.docke|com\.docker|Docker|figma_age|Dropbox|Raycast|Slack|Discord|zoom\.us|Code Helper|Cursor Helper|Electron|AirPlayXPC|sharingd|identitys|Google|Chrome)/i;

let gpuName = null;
let last = null;           // the last snapshot (briefings read this)
let selfPids = new Set([process.pid]);
const selfPorts = new Set();
function protect(pid) { if (pid) selfPids.add(Number(pid)); }
/** Jean's own port: whatever listens there is never stopped. */
function protectPort(port) { if (port) selfPorts.add(Number(port)); }

async function listening() {
  if (process.platform === 'win32') return [];
  const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcun'], 5000);
  const me = os.userInfo().username;
  const procs = new Map(); let cur = null;
  for (const line of out.split('\n')) {
    const k = line[0], v = line.slice(1);
    if (k === 'p') { cur = procs.get(v) || { pid: Number(v), ports: new Set() }; procs.set(v, cur); }
    else if (k === 'c' && cur) cur.command = v;
    else if (k === 'L' && cur) cur.user = v;
    else if (k === 'u' && cur) cur.uid = v;
    else if (k === 'n' && cur) { const m = v.match(/:(\d+)$/); if (m) cur.ports.add(Number(m[1])); }
  }
  const list = [...procs.values()].map(p => ({ ...p, ports: [...p.ports].sort((a, b) => a - b) }))
    .filter(p => p.ports.length && (!p.user || p.user === me));
  // working folders tell us which project a server belongs to
  if (list.length) {
    const cwd = await sh('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', list.map(p => p.pid).join(',')], 4000);
    let pid = null;
    for (const line of cwd.split('\n')) { if (line[0] === 'p') pid = Number(line.slice(1)); else if (line[0] === 'n' && pid) { const p = list.find(x => x.pid === pid); if (p) p.cwd = line.slice(1); } }
  }
  for (const p of list) {
    p.self = selfPids.has(p.pid) || p.ports.some(x => selfPorts.has(x));
    p.dev = !p.self && DEV.test(p.command || '') && !NOT_DEV.test(p.command || '') && p.ports.some(x => x >= 1024);
  }
  return list;
}

async function cpuMem() {
  const cores = os.cpus().length, load = os.loadavg()[0];
  let memUsed = 1 - os.freemem() / os.totalmem();
  if (process.platform === 'darwin') { // freemem ignores reclaimable cache on macOS: use vm_stat
    const vm = await sh('vm_stat', []);
    const page = Number((vm.match(/page size of (\d+)/) || [])[1] || 16384);
    const n = k => Number((vm.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1] || 0);
    const used = (n('Pages active') + n('Pages wired down') + n('Pages occupied by compressor')) * page;
    if (used) memUsed = Math.min(1, used / os.totalmem());
  }
  return { cores, load: Math.round(load * 10) / 10, cpu: Math.min(100, Math.round(100 * load / cores)), mem: Math.round(memUsed * 100), memTotalGB: Math.round(os.totalmem() / 2 ** 30) };
}

async function gpu() {
  if (process.platform === 'darwin') {
    const io = await sh('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']);
    const util = io.match(/"Device Utilization %"=(\d+)/);
    if (gpuName === null) gpuName = (await sh('sysctl', ['-n', 'machdep.cpu.brand_string'])).trim() || 'GPU';
    return util ? { name: `${gpuName} GPU`, util: Number(util[1]) } : null;
  }
  const n = await sh('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']);
  if (!n.trim()) return null;
  const [name, util, used, total] = n.split('\n')[0].split(',').map(s => s.trim());
  return { name, util: Number(util), memUsedMB: Number(used), memTotalMB: Number(total) };
}

async function topProcesses() {
  const out = process.platform === 'darwin' ? await sh('ps', ['-Ao', 'pid=,pcpu=,pmem=,comm=', '-r']) : await sh('ps', ['-eo', 'pid=,pcpu=,pmem=,comm=', '--sort=-pcpu']);
  return out.split('\n').filter(Boolean).slice(0, 6).map(l => { const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/); return m && { pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]), command: m[4].split('/').pop() }; }).filter(Boolean);
}

async function docker() {
  const ps = await sh('docker', ['ps', '-a', '--format', '{{json .}}'], 5000);
  if (!ps.trim()) {
    const ver = await sh('docker', ['version', '--format', '{{.Server.Version}}'], 3000);
    return { available: !!ver.trim(), containers: [] };
  }
  const containers = ps.split('\n').filter(Boolean).map(l => { try { const c = JSON.parse(l); return { id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports }; } catch { return null; } }).filter(Boolean);
  if (containers.some(c => c.state === 'running')) {
    const st = await sh('docker', ['stats', '--no-stream', '--format', '{{json .}}'], 8000);
    for (const l of st.split('\n').filter(Boolean)) { try { const s = JSON.parse(l); const c = containers.find(x => x.name === s.Name); if (c) { c.cpu = parseFloat(s.CPUPerc) || 0; c.mem = s.MemUsage; } } catch {} }
  }
  return { available: true, containers };
}

/** Everything at once. projects: [{ id, name, path }] to tag servers with their project. */
async function snapshot(projects = []) {
  const [procs, cm, g, top, d] = await Promise.all([listening(), cpuMem(), gpu(), topProcesses(), docker()]);
  const byPath = projects.filter(p => p.path).sort((a, b) => b.path.length - a.path.length);
  const servers = procs.filter(p => p.dev).map(p => {
    const pj = p.cwd && byPath.find(x => p.cwd === x.path || p.cwd.startsWith(x.path + '/'));
    return { pid: p.pid, command: p.command, ports: p.ports, cwd: p.cwd || '', project: pj ? pj.name : '', projectId: pj ? pj.id : '' };
  });
  const running = d.containers.filter(c => c.state === 'running');
  const hot = [];
  if (cm.cpu >= 85) hot.push(`CPU ${cm.cpu}%`);
  if (cm.mem >= 88) hot.push(`memory ${cm.mem}%`);
  if (g && g.util >= 85) hot.push(`GPU ${g.util}%`);
  if (servers.length >= 8) hot.push(`${servers.length} dev servers`);
  if (running.length >= 10) hot.push(`${running.length} containers`);
  last = { at: new Date().toISOString(), host: os.hostname().replace(/\.local$/, ''), ...cm, gpu: g, servers, others: procs.filter(p => !p.dev).map(p => ({ pid: p.pid, command: p.command, ports: p.ports, self: p.self })), top, docker: d, busy: hot.length > 0, hot };
  return last;
}

function cached() { return last; }

/** One or two lines for an agent's briefing. */
function briefingLines(s = last) {
  if (!s) return [];
  const servers = s.servers.slice(0, 8).map(x => `:${x.ports[0]} ${x.project || x.command}`).join(', ');
  const running = s.docker.containers.filter(c => c.state === 'running');
  return [`MACHINE (${s.host}): CPU ${s.cpu}% · memory ${s.mem}%${s.gpu ? ` · GPU ${s.gpu.util}%` : ''} · ${s.servers.length} dev server${s.servers.length === 1 ? '' : 's'}${servers ? ` (${servers})` : ''} · Docker ${s.docker.available ? `${running.length} running` : 'off'}`,
    s.busy ? `⚠ The machine is busy (${s.hot.join(', ')}). Stop what you don't need: jean system · jean stop <port> · jean docker pause <name> · jean system pause --yes` : 'Before starting a dev server, check jean system: reuse one that already runs; stop yours when you are done.'];
}

/** Stop a dev server by port or pid. Refuses anything that isn't a dev server owned by this user. */
async function stopServer(ref) {
  const procs = await listening();
  const n = Number(String(ref).replace(/^:/, ''));
  const p = procs.find(x => x.pid === n) || procs.find(x => x.ports.includes(n));
  if (!p) throw new Error(`nothing is listening on ${ref}`);
  if (p.self) throw new Error(`:${p.ports[0]} is Jean itself`);
  if (!p.dev) throw new Error(`${p.command} (:${p.ports.join(', :')}) is not a dev server, so Jean won't stop it`);
  process.kill(p.pid, 'SIGTERM');
  await new Promise(r => setTimeout(r, 1500));
  let alive = true; try { process.kill(p.pid, 0); } catch { alive = false; }
  if (alive) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
  return { stopped: p.pid, command: p.command, ports: p.ports };
}

/** docker stop|pause|unpause|start <name>, or stop-all / pause-all */
async function dockerAction(action, name) {
  if (!['stop', 'pause', 'unpause', 'start', 'stop-all', 'pause-all', 'unpause-all'].includes(action)) throw new Error('docker action: stop | pause | unpause | start | stop-all | pause-all | unpause-all');
  const d = await docker();
  if (!d.available) throw new Error('Docker is not running');
  let targets;
  if (action.endsWith('-all')) {
    const want = action === 'unpause-all' ? 'paused' : 'running';
    targets = d.containers.filter(c => c.state === want).map(c => c.name);
    action = action.replace('-all', '');
  } else {
    const c = d.containers.find(x => x.name === name || x.id.startsWith(name || '-'));
    if (!c) throw new Error(`no container "${name}"`);
    targets = [c.name];
  }
  if (!targets.length) return { action, containers: [] };
  await sh('docker', [action, ...targets], 60000);
  return { action, containers: targets };
}

/** Pause development: stop every dev server (not Jean) and pause every running container. */
async function pauseAll() {
  const s = await snapshot();
  const stopped = [];
  for (const x of s.servers) { try { await stopServer(x.pid); stopped.push(`${x.command} :${x.ports[0]}`); } catch {} }
  const paused = s.docker.available ? (await dockerAction('pause-all')).containers : [];
  return { stopped, paused };
}

module.exports = { snapshot, cached, briefingLines, stopServer, dockerAction, pauseAll, protect, protectPort };
