# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub:
**[Report a vulnerability](https://github.com/willmexi/jeanclawd/security/advisories/new)**.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply
within a few days, and credit in the fix if you'd like it.

## What's in scope

- **Cloud mode:** the `JEAN_TOKEN` bearer auth, the browser login cookie, and the refusal to bind to a
  public address without a token.
- **The browser-write guard:** the planner and Dojo are read-only; only same-origin "talk" routes may write.
  Anything that lets a web page change the plan, or run commands, is a bug.
- **The machine controls:** `jean stop` / `jean docker` must only touch the owner's dev servers and
  containers, never Jean itself or system processes.
- **The protocol:** `/v1`, A2A and MCP: impersonating another agent, reading another agent's inbox, or
  reaching files outside Jean's data folder.

## Good to know

- **Plugins are code.** A plugin in `~/.jean/plugins` runs with your permissions, like any npm package.
  Only install plugins you trust; that is by design, not a vulnerability.
- **Local mode trusts your machine.** Without `JEAN_TOKEN`, anything that can reach `127.0.0.1:4242` can
  use the API. Don't expose a local-mode server to a network; use cloud mode with a token instead.
