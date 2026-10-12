---
name: jean-init
description: Register the current folder as a Jean Clawd project and set up its plan. Use when the user says "jean init", "init jean", "add this project to jean", "register this repo", or starts work in a folder that has no .jean marker yet.
---

# /jean-init — register this folder and plan it

Do all of this yourself; only ask the user the questions in step 4.

1. **Inspect** — `jean inspect --json` (from the project folder). It returns the git remote, README title
   and summary, package.json name/description, language and hints. Skim the README or main entry file
   if the summary is empty or vague; you must be able to write one honest sentence about the project.

2. **Register** — pick the final values yourself and run:
   `jean init "one sentence: what this project is and does" --name <Name> --emoji <one emoji> [--repo <url>]`
   - Name: the product name (README title / package name), not a path slug. Keep existing casing (e.g. Kiteshop.IO).
   - Emoji: something that fits the project (🎰 casino, 🤖 bot, 🌐 site, 🍎 mac app, ⛓️ contracts…).
   - Repo: the git remote is linked automatically; pass `--repo` only if there is none and the user names one.
   - Already registered? `jean init` again just updates it; fine.

3. **Report** — tell the user exactly what you filled in, in one short block:
   name, emoji, description, repo link, folder. Ask them to correct anything wrong
   (`jean project describe "…"`, `jean project emoji 🚀`, `jean project repo <url>`).

4. **Plan it** — ask, in one message:
   - "What are the **tasks for today** on this project?" (optional)
   - "Any **goals for this week**?" (optional)
   - "What's the **goal for this month**?" (optional)
   Make clear all three are optional and they can answer in one line each or say "skip".

5. **File the answers** from inside the folder so the project attaches automatically:
   - today → `jean add "…" -p 1|2|3` (urgent ones get `-p 1`; keep today to 3–6 tasks)
   - week → `jean add "…" -s week`
   - month → `jean add "…" -s month`
   Then show `jean project` so they see the result, and stop.
