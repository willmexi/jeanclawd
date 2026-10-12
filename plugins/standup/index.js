// standup — an example Jean plugin: one report, available as a CLI command, an MCP tool and a route.
const since = h => Date.now() - h * 3600e3;

function standup(state, hours = 24) {
  const lines = [];
  const agents = state.agents.filter(a => !a.offline);
  for (const a of agents) {
    const done = state.tasks.filter(t => t.assignee === a.name && t.doneAt && new Date(t.doneAt) > since(hours));
    const doing = a.doing ? a.doing.text : null;
    if (!done.length && !doing) continue;
    lines.push(`${a.name}${a.manager ? ` (${a.department} manager)` : ''}`);
    for (const t of done) lines.push(`  ✓ ${t.title}`);
    if (doing) lines.push(`  ▸ ${doing}`);
  }
  const open = state.messages.filter(m => m.kind === 'request' && !m.claimedBy);
  if (open.length) lines.push('', 'Waiting for someone:', ...open.map(m => `  🙋 ${m.text}`));
  return lines.length ? lines.join('\n') : 'Quiet: nothing finished and nobody on anything.';
}

module.exports = jean => {
  jean.command('standup', {
    usage: 'jean standup [--hours 24]',
    describe: 'what the crew finished, what it is on, what is waiting',
    run: async ({ state, flags, out }) => { const s = await state(); const text = standup(s, Number(flags.hours) || 24); out({ text }, text); },
  });
  jean.tool({ name: 'jean_standup', description: 'The crew standup: what every agent finished in the last day, what it is on, and open requests.',
    schema: { hours: { type: 'number', description: 'Look back this many hours (default 24)' } },
    run: (args, ctx) => ctx.jean(['standup', ...(args.hours ? ['--hours', String(args.hours)] : [])]) });
  jean.route('GET', '/today', (params, query, body, req, state) => ({ text: standup(state, Number(query.hours) || 24) }));
};
