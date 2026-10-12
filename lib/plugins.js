// Plugins: extend Jean without touching the core. See docs/PLUGINS.md.
//
// A plugin is a folder with a jean.plugin.json manifest:
//   { "name": "standup", "version": "1.0.0", "description": "…",
//     "main": "index.js",              // optional Node module: module.exports = jean => { … }
//     "web": { "dojo": ["dojo.js"], "app": ["app.js"] },   // optional browser scripts
//     "css": { "dojo": ["dojo.css"], "app": ["app.css"] } } // optional stylesheets
//
// Folders searched, in order (a later one with the same name wins):
//   <jean>/plugins/*          bundled examples
//   ~/.jean/plugins/*         yours (JEAN_DIR/plugins)
//   $JEAN_PLUGINS             extra folders, separated by ":"
// Turn one off without deleting it: jean plugins disable <name>  (settings.plugins[name] = false).
'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

function dirs() {
  const list = [path.join(ROOT, 'plugins'), path.join(store.DATA_DIR, 'plugins')];
  if (process.env.JEAN_PLUGINS) list.push(...process.env.JEAN_PLUGINS.split(':').filter(Boolean));
  return list;
}

/** Every plugin on disk (enabled or not), with its manifest. */
function discover(settings = {}) {
  const found = new Map();
  for (const base of dirs()) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name), file = path.join(dir, 'jean.plugin.json');
      if (!fs.existsSync(file)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!NAME_RE.test(m.name || '')) throw new Error('name must be lowercase letters, digits and dashes');
        found.set(m.name, { ...m, dir, source: base.startsWith(ROOT) ? 'bundled' : 'user', enabled: (settings.plugins || {})[m.name] !== false });
      } catch (err) { found.set(e.name, { name: e.name, dir, error: `bad jean.plugin.json: ${err.message}`, enabled: false }); }
    }
  }
  return [...found.values()];
}

/**
 * Load enabled plugins for one process. `where` is 'server' | 'cli' | 'mcp'. Each plugin's main()
 * gets the same API everywhere; registrations that don't apply to this process are kept but unused.
 */
function load(where, settings = {}) {
  const reg = { commands: new Map(), tools: [], routes: [], listeners: [], timers: [], plugins: [] };
  for (const p of discover(settings)) {
    if (!p.enabled || p.error) { reg.plugins.push(p); continue; }
    const api = {
      name: p.name, dir: p.dir, where, store,
      log: (...a) => { if (where === 'server') console.log(`[${p.name}]`, ...a); },
      /** CLI command: jean <name> … */
      command(name, def) { if (!NAME_RE.test(name)) throw new Error(`bad command name ${name}`); reg.commands.set(name, { ...def, plugin: p.name }); },
      /** MCP tool. run(args, ctx) — ctx.jean([...cli args]) runs the jean CLI and returns its JSON. */
      tool(def) { if (!/^[a-z0-9_]+$/.test(def.name || '')) throw new Error('tool name: lowercase, digits, _'); reg.tools.push({ ...def, plugin: p.name }); },
      /** HTTP route, mounted under /plugins/<plugin>/… handler(params, query, body, req) → JSON */
      route(method, sub, handler) { reg.routes.push({ method: method.toUpperCase(), path: `/plugins/${p.name}${sub.startsWith('/') ? sub : '/' + sub}`, handler, plugin: p.name }); },
      /** Server events: 'message' (every new message), 'changed' (after any write). */
      on(event, fn) { reg.listeners.push({ event, fn, plugin: p.name }); },
      /** Run fn(state) every ms on the server. */
      every(ms, fn) { reg.timers.push({ ms: Math.max(10e3, Number(ms) || 60e3), fn, plugin: p.name }); },
      /** Extra lines in every agent's briefing: fn(state, agentName) → string[] */
      briefing(fn) { store.extensions.briefing.push(fn); },
      /** Adjust request routing: fn(agent, text, state) → { score, why } (added to Jean's own score) */
      routeScore(fn) { store.extensions.routeScore.push(fn); },
    };
    try {
      if (p.main) require(path.join(p.dir, p.main))(api);
      reg.plugins.push({ ...p, loaded: true });
    } catch (err) {
      reg.plugins.push({ ...p, loaded: false, error: err.message });
      if (where === 'server') console.error(`plugin ${p.name} failed to load: ${err.message}`);
    }
  }
  return reg;
}

/** Browser assets of enabled plugins for a page ('dojo' | 'app'): [{ name, scripts:[url], styles:[url] }] */
function webAssets(settings, page) {
  return discover(settings).filter(p => p.enabled && !p.error && ((p.web || {})[page] || (p.css || {})[page])).map(p => ({
    name: p.name,
    scripts: ((p.web || {})[page] || []).map(f => `/plugins/${p.name}/${f}`),
    styles: ((p.css || {})[page] || []).map(f => `/plugins/${p.name}/${f}`),
  }));
}

/** Resolve a static file of a plugin, only if the manifest lists it (no browsing the plugin folder). */
function webFile(settings, name, file) {
  const p = discover(settings).find(x => x.name === name && x.enabled && !x.error);
  if (!p) return null;
  const listed = [...Object.values(p.web || {}), ...Object.values(p.css || {})].flat();
  if (!listed.includes(file)) return null;
  const full = path.join(p.dir, file);
  return full.startsWith(p.dir + path.sep) ? full : null;
}

/** Scaffold a new plugin in ~/.jean/plugins/<name>. */
function scaffold(name) {
  if (!NAME_RE.test(name)) throw new Error('plugin names: lowercase letters, digits and dashes');
  const dir = path.join(store.DATA_DIR, 'plugins', name);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'jean.plugin.json'), JSON.stringify({ name, version: '0.1.0', description: 'What this plugin adds to Jean', main: 'index.js', web: { dojo: ['dojo.js'] } }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'index.js'), `// ${name}: a Jean plugin. Docs: docs/PLUGINS.md in the Jean repo.
module.exports = jean => {
  // jean ${name}  — a CLI command
  jean.command('${name}', {
    usage: 'jean ${name}',
    describe: 'Say hello from the ${name} plugin',
    run: async ({ state, out }) => {
      const s = await state();
      out({ agents: s.agents.length }, \`hello from ${name}: \${s.agents.length} agents in the crew\`);
    },
  });
  // the same as an MCP tool, for every agent
  jean.tool({ name: '${name.replace(/-/g, '_')}_hello', description: 'Say hello from the ${name} plugin', schema: {}, run: (args, ctx) => ctx.jean(['${name}']) });
  // a line in every agent's briefing
  jean.briefing((state, agent) => [\`${name.toUpperCase()}: hello \${agent}\`]);
};
`);
  fs.writeFileSync(path.join(dir, 'dojo.js'), `// ${name}: runs in the Dojo. Jean.onDojo gives you the room: see docs/PLUGINS.md.
Jean.onDojo(dojo => {
  dojo.toast('${name} plugin loaded');
});
`);
  return dir;
}

module.exports = { dirs, discover, load, webAssets, webFile, scaffold };
