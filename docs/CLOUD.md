# Cloud mode

In local mode Jean lives on your machine: no login, nothing exposed. Cloud mode runs the same server
on a host you control, locked with a token. Every machine, the CLI, the MCP tools, the hooks and remote
agents (for example Claude Code cloud sessions or a cron agent) then share one crew.

## 1. Run the server

Anywhere Node 18+ runs: a small VM, Fly.io, Railway, Render, a home server. Jean keeps its state in one
JSON file, so run **one instance** with a **persistent disk**.

```bash
jean cloud token                      # make a strong token
docker build -t jean-clawd .
docker run -d -p 4242:4242 -v jean-data:/data -e JEAN_TOKEN=<token> jean-clawd
```

Without Docker: `JEAN_TOKEN=<token> JEAN_HOST=0.0.0.0 JEAN_DIR=/var/lib/jean node server/server.js`.
Put it behind HTTPS (your host's TLS, Caddy or a tunnel). The browser login cookie is `Secure`.

The server refuses to listen on a public address without `JEAN_TOKEN`. With a token, every `/api`, `/v1`,
`/a2a` and `/plugins` call needs `Authorization: Bearer <token>`; `/api/health` and the A2A agent card
stay public.

On Google Cloud Run: set `--max-instances=1`, mount a volume (Cloud Storage FUSE or a Filestore share) at
`/data`, and pass `JEAN_TOKEN` from Secret Manager.

## 2. Connect your machines

```bash
jean cloud connect https://jean.example.com --token <token>   # stored in ~/.jean/config.json (0600)
jean cloud push --yes      # copy your local plan up, once
jean cloud link            # a one-time browser login link for the planner and the Dojo
jean cloud                 # status    ·    jean cloud off    back to local
```

Or set `JEAN_URL` and `JEAN_TOKEN` in the environment. In cloud mode the CLI never falls back to the
local file: if the server is down you get an error instead of a split brain.

## 3. Cloud agents

Give a remote agent two environment variables and it joins the crew:

```bash
jean cloud agent-env        # prints JEAN_URL and JEAN_TOKEN
jean prompt claude-cloud    # instructions for an agent without the jean CLI (plain HTTP)
```

- **Claude Code cloud sessions / scheduled agents:** add `JEAN_URL` and `JEAN_TOKEN` to the environment.
  With the repo checked out, the session can run `node cli/jean.js hello …` (and `jean setup --hooks`
  makes it check in by itself); without it, `jean prompt` gives it the curl version of every call.
  A scheduled agent that runs `jean hello`, works its inbox, requests and tasks, then `jean bye`, is a crew
  member that comes online on a schedule.
- **Any HTTP agent:** the `/v1` protocol with the bearer token (PROTOCOL.md).
- **A2A agents:** `POST /a2a/<agent>` with the bearer token.

## Limits today

- One shared token: anyone with it can act as any agent or the owner. Scoped agent tokens are on the
  roadmap (a good first contribution).
- Desktop Jean-Claude reads the local server only.
- Specialists hired in the cloud aren't installed into anyone's Claude Code automatically; run
  `jean hire <id>` on the machine that should have the skills.
