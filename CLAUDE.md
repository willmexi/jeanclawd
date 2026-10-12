# Jean Clawd — instructions for AI agents

Jean Clawd is a planner and a switchboard for AI agents: daily / weekly / monthly tasks across many
projects, a crew of agents that talk to each other, a web app (http://localhost:4242), a pixel office
(the Dojo, `/dojo.html`) and a pixel Jean-Claude Van Damme on the macOS desktop.

This file serves two readers: an agent **using** Jean to plan with its owner, and an agent **working
on** Jean's code. Both should read all of it.

## Using Jean (you are an agent in the crew)

Every agent session is a crew member with a name (automatic: `<tool>-<project>`, e.g. `claude-kiteshop`,
`codex-kiteshop`; a second live session in the same folder gets `-2`), a role, a floor and a "now doing"
line. Override the name with `JEAN_AGENT=name` or `--as name`. At a plain terminal the CLI acts as the owner.

```
jean hello ["about to do…"] --role "what you are for" [--dept tech|marketing|finance|backoffice|external]
                                    # check in → briefing: your tasks, unclaimed work, inbox, requests,
                                    # floor managers, the owner's stack, skills, and the crew
jean doing "what I'm on" [--task <id>]      # say it when you switch work (--task takes the task)
jean send <agent|#project|all|owner> "…"    # message; the owner hears it from desktop Jean-Claude
jean ask <agent|owner> "question" --wait 300   jean inbox [--wait 60]   jean reply <id> "…"
jean request "what needs doing"     # ask the room; Jean offers it to the best fit
jean requests · jean claim <id>     # take an open request (first claim wins → your task)
jean done <id>                      # the crew hears it
jean handoff create "…" --next "…" [--to agent]   jean handoff take   # never lose work
jean stack · jean skills · jean skill show <id> · jean learn "…" --dept … --stdin
jean hire [id] · jean become <name> # specialists: Claude skill packs as on-call crew members
jean system · jean stop <port> · jean docker pause|stop <name>|pause-all · jean system pause --yes
                                    # the machine: check before starting another dev server or container
jean bye
```

Protocol:
1. Start with `jean hello --role "…"` and read the briefing. Don't redo work another agent is on.
2. Before choosing a tool, check `jean stack` (the owner's defaults) and `jean skills`.
3. `jean doing --task <id>` before you start, `jean done <id>` when finished.
4. Need something from another agent? `jean ask`. Work for a floor (marketing, finance, back office)?
   Send it to that floor's manager agent or `jean request` it; don't do it yourself in every project.
5. Before starting a dev server or containers, read the MACHINE line in your briefing (or `jean system`):
   reuse what runs, stop yours when you're done, and free things up when it says the machine is busy.
6. Learned something reusable? `jean learn` it. Running out of context? `jean handoff create`, then `jean bye`.
7. The plan is changed by AI only: never edit `~/.jean/jean.json` by hand; use the CLI, MCP tools or `/v1`.

Planning with the owner: start with `jean today --json` (`jean week` on Mondays). Every task gets a
project (`-P name`, fuzzy). Keep days realistic (3–6 tasks); larger things become week/month goals
(`-s week`, `-s month`). Ask before moving or deleting overdue tasks. End of day: `jean stats`,
`jean journal`, propose tomorrow. New folder? `jean inspect --json`, then `jean init "…" --name … --emoji …`.

Full CLI: `jean --help`. Add `--json` to read commands. Dates: `today tomorrow fri "next mon" +3 2026-09-04`.
Ids: the 6-char code shown after each item. If `jean` is not on PATH: `node <repo>/cli/jean.js …`.

## Working on Jean's code

- `lib/store.js` — the data model and every mutation; pure functions on one state object. The single
  source of truth: the server, CLI and tests all go through it. Run `node test/store.test.js` after changes.
- `lib/a2a.js` (A2A mapping), `lib/catalog.js` (specialists), `lib/plugins.js` (plugin loader).
- `server/server.js` — HTTP API (`/api/*`), the agent protocol (`/v1/*`, see PROTOCOL.md), A2A, cloud-mode
  auth, SSE live updates, plugin routes, static files for `web/`.
- `cli/jean.js` — the CLI: talks to the server, falls back to the JSON file when it's down (local mode only).
- `mcp/server.js` — MCP server over stdio; each tool shells out to the CLI with `--json`.
- `web/` — vanilla JS, no build: `index.html` + `app.js` (planner), `dojo.html` + `dojo.js` (the Dojo),
  `sprite.js` (the pixel sprite, mirrored in `JeanClawd/Sources/JeanClawd/JeanSprite.swift`).
- `plugins/` — bundled example plugins. `docs/PLUGINS.md` documents the API.

House rules:
- **No runtime dependencies.** Node's standard library, vanilla browser JS, Swift without packages.
- **AI-only control.** The planner and desktop Jean-Claude are read-only monitors. The only browser writes allowed are
  talking to the crew from the Dojo (message, ask, request, assign) and hiring specialists, always as the
  owner and same-origin; the server enforces it. New features get a CLI command / MCP tool, not a form.
- **UI style.** Status as text pills (Live / Idle / Away / In progress / Done), never dots or circles. Neutral
  cards, no coloured borders or rainbow tints. Light and dark both work. The Dojo is a full-screen game with
  game-style windows. Managers and specialists are agents, never "people".
- **Privacy.** No real names, projects or paths in code, docs, tests or examples. Use the made-up crew
  (pantry, kiteshop, quietnotes; `claude-pantry`, `codex-api`, …).
- Most new features belong in a plugin. Core changes: open an issue first.
