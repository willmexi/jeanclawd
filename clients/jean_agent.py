"""Jean Clawd vd Dam — minimal client for the Jean Agent Protocol (PROTOCOL.md). Stdlib only.

    from jean_agent import Jean
    j = Jean("codex-api", role="API for kiteshop")   # checks in; j.briefing has your tasks + the crew
    j.doing("migrating the funds table", task="k3m2x")
    j.send("claude-kiteshop", "orders.slug is unique now")
    for m in j.listen():                                 # long-polls forever, yields messages to you
        j.send(to=None, text="on it", reply_to=m["id"])
"""
import json
import os
import urllib.request


class Jean:
    def __init__(self, agent, role=None, base=None, **hello):
        self.agent = agent
        self.base = (base or os.environ.get("JEAN_URL") or "http://localhost:4242").rstrip("/")
        r = self._call("POST", "/v1/hello", {"role": role, **hello})
        self.briefing, self.inbox = r["briefing"], r["inbox"]

    def _call(self, method, path, body=None, timeout=10):
        data = None
        if body is not None:
            data = json.dumps({"agent": self.agent, **{k: v for k, v in body.items() if v is not None}}).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-Jean-Agent": self.agent})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read())

    def doing(self, text=None, task=None):
        return self._call("POST", "/v1/doing", {"text": text, "task": task})

    def send(self, to, text, task=None, reply_to=None):
        return self._call("POST", "/v1/send", {"to": to, "text": text, "task": task, "replyTo": reply_to})

    def inbox_wait(self, wait=30):
        return self._call("GET", f"/v1/inbox/{self.agent}?wait={wait}", timeout=wait + 10)

    def listen(self, wait=30):
        while True:
            yield from self.inbox_wait(wait)

    def tasks(self):
        return self._call("GET", f"/v1/tasks?agent={self.agent}")

    def done(self, task):
        return self._call("POST", "/v1/done", {"task": task})

    def agents(self):
        return self._call("GET", "/v1/agents")

    def bye(self, text=None):
        return self._call("POST", "/v1/bye", {"text": text})


if __name__ == "__main__":
    import sys
    j = Jean(sys.argv[1] if len(sys.argv) > 1 else "py-demo", role="demo client")
    print(j.briefing)
