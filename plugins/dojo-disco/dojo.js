// dojo-disco — an example Dojo plugin. Jean.onDojo gives you the room (docs/PLUGINS.md).
Jean.onDojo(dojo => {
  let until = 0, count = 0;
  dojo.onMessage(m => { if (m.kind === 'event' && /^finished: /.test(m.text)) { until = performance.now() + 6000; count++; } });
  dojo.onDraw((ctx, { t }) => {
    if (performance.now() > until) return;
    const x = 610, y = 140 + Math.sin(t * 3) * 4;
    ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y - 18); ctx.stroke();
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      if (i * i + j * j > 5) continue;
      ctx.fillStyle = `hsl(${(t * 120 + (i + j) * 40) % 360},80%,70%)`; ctx.fillRect(x + i * 7 - 3, y + j * 7 - 3, 6, 6);
    }
    ctx.globalAlpha = 0.12; ctx.fillStyle = `hsl(${(t * 90) % 360},90%,60%)`; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.globalAlpha = 1;
  });
  dojo.addWindow('disco', { title: 'Disco', render: () => `<p>The disco ball has dropped <b>${count}</b> time${count === 1 ? '' : 's'} since you opened the Dojo.</p><p class="muted">It drops when an agent finishes a task. Made with the plugin API: <code>plugins/dojo-disco/dojo.js</code>.</p>` });
  dojo.addHotbar({ kind: 'disco', label: 'Disco', key: 'x' });
});
