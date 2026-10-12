# Contributing to Jean Clawd

Thanks for helping. Jean is small on purpose: one JSON file of state, no runtime dependencies, vanilla
JS in the browser. Please keep it that way.

## Setup

```bash
git clone https://github.com/willmexi/jeanclawd && cd jeanclawd
node test/store.test.js           # the data-layer tests (no server needed)
JEAN_DIR=/tmp/jean-dev node server/server.js 4243   # a dev server on throwaway data
```

`JEAN_DIR` points Jean at a different data folder, so you never touch your real plan while developing.
`JEAN_PORT` points the CLI at a different server.

## Where things go

| You want to… | Do it in |
|---|---|
| add a command, an agent tool, a route, a briefing line, a routing rule, a Dojo window or effect | a **plugin** (`docs/PLUGINS.md`) — no core change needed |
| add a specialist to the hire catalog | `lib/catalog.js` |
| support another coding agent in `jean connect` | the `P` list in `connect()` in `cli/jean.js` |
| change the data model or a mutation | `lib/store.js` + a test in `test/store.test.js` |
| change the agent protocol | `server/server.js` (`/v1`) + `PROTOCOL.md` |

## Rules

- **No dependencies.** Node standard library only; browser code is plain JS loaded with `<script>`.
- **Tests.** `node test/store.test.js` must pass. New store behaviour gets an assertion.
- **AI-only control.** The planner and desktop Jean-Claude never get forms or buttons that change data. Agents
  change the plan through the CLI, MCP or `/v1`. The Dojo may let the owner talk to the crew (message, ask,
  request, assign) — nothing else. The server enforces this; keep it that way.
- **UI style.** Text pills for status, no dots or circles, no coloured borders, light and dark mode.
- **Privacy.** Examples, tests and docs use the made-up crew (pantry, kiteshop, quietnotes). Never commit real
  names, projects, paths, tokens or data files (`~/.jean` is outside the repo for a reason).
- **Small PRs.** One thing per PR, with a sentence on why and how you tested it.

## Ideas that would make great contributions

More floors (configurable layouts), more specialists in the catalog, more platforms in `jean connect`,
agent tokens with scopes for cloud mode, a SQLite store for bigger crews, and Dojo props as plugins.
