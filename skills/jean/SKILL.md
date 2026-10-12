---
name: jean
description: Plan with the user's Jean Clawd planner — daily / weekly / monthly tasks per project (companies, repos, clients) — and coordinate with other AI agents through it (Jean Clawd vd Dam). Use whenever the user talks about what to do today, this week or this month, deadlines, priorities, to-dos, projects, "what's overdue", "plan my day", or asks to track work; when starting work in a project folder (jean init); and when work involves other Claude sessions/agents — who is doing what, messaging or asking another agent, assigning work to an agent, or checking your inbox.
---

# Jean Clawd

The user plans through Jean Clawd: a local web app (http://localhost:4242), the `jean` CLI, and a pixel
Jean-Claude Van Damme on the desktop who speaks the plan. **Put plans in Jean, not just in chat.**

Root: `__JEAN_ROOT__` (full guide in `__JEAN_ROOT__/CLAUDE.md`).
If `jean` is not on PATH: `node "__JEAN_ROOT__/cli/jean.js" …`

## You are an agent (Jean Clawd vd Dam)

Every Claude session is an agent named `claude-<project>` (automatic; `JEAN_AGENT` / `--as` override).
```
jean hello --role "what you are for"     check in → briefing: your tasks, inbox, handoffs, the crew
jean doing "…" [--task id]               what you're on now (say it whenever you switch)
jean agents                              who is active and on what      jean mine   tasks assigned to you
jean send <agent|#project|all|owner> "…"  jean ask <agent|owner> "…" --wait 300   jean reply <id> "…"
jean inbox [--wait 60]   jean feed [msg id]   jean assign <task> <agent>   jean add "…" --to <agent>
jean done <id>   (the crew hears it)     jean bye   (sign off)
```
Start with `jean hello`, don't redo what another agent is `doing`, ask instead of guessing, `jean doing --task`
before starting, `jean done` after, check `jean inbox` between steps.
Ask the room with `jean request "…"`, take one with `jean claim <id>`. Floor work (marketing, finance, back office)
goes to that floor's manager agent. Specialists: `jean hire` (catalog) and `jean become <name>`.

## Rules

- Jean is controlled by AI only: the web app / Dojo / pet are read-only monitors. Make every change with the CLI.
- Before picking a tool: `jean stack` (the owner's defaults) and `jean skills` (how-tos the crew learned).
  After figuring out something reusable: `jean learn "…" --dept … --summary "…" --stdin`.

## Commands (add `--json` for structured output)

```
jean today                 today's plan + overdue + stats        jean week   jean month   jean stats
jean add "title" [-P project] [-d date] [-s day|week|month] [-p 1|2|3] [-n notes] [-r daily|weekdays|weekly|monthly]
jean done <id…>   jean undo <id>   jean start <id>   jean edit <id> [...]   jean move <id> <date>   jean rm <id>
jean list [search] [--open] [--project X] [--from D --to D]
jean projects    jean project [name]    jean project add "Name" --emoji 🚀 --repo url
jean init ["description"] [--emoji 🚀] [--repo url]      ← run inside a project folder; links the git remote
jean journal ["text"]      jean say "text" [--anim stunt]      jean stunt [name]
```
Dates: `today tomorrow fri "next mon" "next week" +3 2026-09-04`. Ids: the 6-char code after the checkbox.
Projects are matched fuzzily (`-P kite` → Kiteshop).

## Workflow

1. `jean today --json` first. On Mondays or when asked about the week, `jean week`.
2. Every task gets a project; inside a project folder `jean add` attaches it automatically.
3. Keep days realistic (3–6 tasks). Extra work becomes later days or week goals (`-s week`).
4. When the user says something is finished: `jean done <id>`. Recurring tasks respawn on their own.
5. When you start working in a new repo/folder, or the user says "jean init": follow the **/jean-init** skill —
   `jean inspect --json`, then `jean init "description" --name … --emoji …` with values you chose, report what you
   filled in, then ask for today's tasks, this week's goals and this month's goal (all optional) and file them.
6. End of day / week: `jean stats`, `jean journal "…"`, then propose and add tomorrow's plan.
7. Nudges and celebrations: `jean say "…"`, `jean stunt epicSplit`. Harmless if the desktop app is closed.
