# Plugins

Plugins add features to Jean without changing its core: CLI commands, MCP tools for agents, HTTP
routes, server events and timers, lines in every agent's briefing, request-routing rules, and windows,
hotbar buttons and effects in the Dojo or views in the planner.

```bash
jean plugins                 # what is installed (● on, ○ off, ✗ broken)
jean plugins new my-plugin   # scaffold ~/.jean/plugins/my-plugin
jean my-plugin               # the scaffold's example command, live
jean plugins disable standup # turn one off (restart the server to apply)
```

## Where plugins live

| Folder | What |
|---|---|
| `<jean>/plugins/` | bundled examples: `standup`, `dojo-disco` |
| `~/.jean/plugins/` | yours (follows `JEAN_DIR`) |
| `$JEAN_PLUGINS` | extra folders, separated by `:` |

A plugin with the same name in a later folder wins, so you can override a bundled one.

## The manifest: `jean.plugin.json`

```json
{
  "name": "standup",
  "version": "1.0.0",
  "description": "A daily standup for the crew",
  "main": "index.js",
  "web": { "dojo": ["dojo.js"], "app": ["app.js"] },
  "css": { "dojo": ["dojo.css"] }
}
```

`main` runs in Node (server, CLI and MCP processes). `web` and `css` files are served to the Dojo or the
planner; only files listed here are served.

## Node API: `module.exports = jean => { … }`

```js
module.exports = jean => {
  jean.name; jean.dir; jean.where;   // 'server' | 'cli' | 'mcp'
  jean.store;                        // lib/store.js (read helpers: listAgents, filterTasks, feed, routeRequest, …)

  // CLI: jean standup
  jean.command('standup', {
    usage: 'jean standup [--hours 24]', describe: 'what the crew did',
    run: async ({ args, flags, state, out, api, agentName }) => {
      const s = await state();                // the whole plan (from the server, or the file)
      out({ agents: s.agents.length }, `${s.agents.length} agents`);   // JSON with --json, text otherwise
    },
  });

  // MCP tool for every agent: ctx.jean([...]) runs the CLI and returns its JSON
  jean.tool({ name: 'jean_standup', description: 'The crew standup', schema: { hours: { type: 'number' } },
    run: (args, ctx) => ctx.jean(['standup']) });

  // HTTP route, mounted at /plugins/<name>/today. Writes from browsers are refused (AI-only control).
  jean.route('GET', '/today', (params, query, body, req, state) => ({ ok: true }));

  // server events and timers
  jean.on('message', (m, state) => {});     // every new message or request
  jean.on('changed', state => {});          // after every write
  jean.every(60 * 60e3, state => {});       // hourly (minimum 10 s)

  // every agent's briefing gets these lines
  jean.briefing((state, agentName) => ['STANDUP: 09:00 every day, run jean standup']);

  // nudge request routing: added to Jean's own score for each agent
  jean.routeScore((agent, text, state) => /video/.test(text) && agent.role?.includes('video') ? { score: 5, why: 'video' } : null);
};
```

Mutating state from a route or listener: change `state` through `jean.store` helpers; routes that are not
`GET` are persisted automatically.

## Browser API

### In the Dojo: `Jean.onDojo(dojo => { … })`

```js
Jean.onDojo(dojo => {
  dojo.state();                 // the plan
  dojo.toast('hello');          // a small game-style toast
  dojo.onMessage(m => {});      // every new message / event as it arrives
  dojo.onDraw((ctx, { t, iso, actors }) => {});   // draw on top of the room each frame (1220×800 canvas)
  dojo.addWindow('disco', { title: 'Disco', render: (win, state) => '<p>html</p>', onClick: (el, win) => {} });
  dojo.addHotbar({ kind: 'disco', label: 'Disco', key: 'x' });   // a button + key that opens the window
  dojo.open('quests');          // open any window
});
```

### In the planner: `Jean.onApp(app => { … })`

```js
Jean.onApp(app => {
  app.addView('burndown', { label: 'Burndown', title: 'Burndown', render: state => '<div class="card">…</div>' });
  app.toast('hello'); app.state(); app.refresh();
});
```

Keep plugin UI read-only in the planner (Jean's plan is changed by AI only) and use the house style:
text pills, no dots, neutral colours, light and dark.

## Examples

- `plugins/standup` — a command, an MCP tool and a route sharing one report.
- `plugins/dojo-disco` — a disco ball that drops in the Dojo when a task is finished, plus a window and a hotbar button.

## Sharing

A plugin is a folder: put it on GitHub and tell people to clone it into `~/.jean/plugins/`. Generally useful
ones are welcome upstream in `plugins/` — open a PR.
