// A2A (Agent2Agent, https://a2a-protocol.org) mapping for Jean Clawd vd Dam.
// Every Jean agent is reachable as an A2A agent: an incoming SendMessage becomes a Jean
// message in that agent's inbox, and the A2A task is the Jean thread. The task completes
// when the agent replies (jean reply). Speaks A2A 1.0 (SendMessage / GetTask / CancelTask,
// TASK_STATE_*) and accepts the 0.x names (message/send, tasks/get, tasks/cancel).
// Pure functions over the store; no I/O here.
'use strict';
const store = require('./store');

const V1 = { send: 'SendMessage', get: 'GetTask', cancel: 'CancelTask' };
const LEGACY = { 'message/send': 'send', 'tasks/get': 'get', 'tasks/cancel': 'cancel' };
const ERR = { parse: -32700, invalid: -32602, method: -32601, notFound: -32001, unsupported: -32004 };

const legacyState = s => s.replace('TASK_STATE_', '').toLowerCase().replace('_', '-');

function card({ name, description, url, skills }) {
  return {
    name, description, version: '1.0.0',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    skills,
    // 0.x clients read these
    url, protocolVersion: '0.3.0', preferredTransport: 'JSONRPC',
  };
}

/** Agent card for one Jean agent (or the whole planner when name is empty). */
function agentCard(state, base, name) {
  if (!name) {
    return card({ name: 'Jean Clawd vd Dam', url: `${base}/a2a`,
      description: `${state.settings.ownerName || 'The owner'}'s planner and switchboard between AI agents. Send a message with metadata.to = an agent name, #project or all; default recipient is the owner.`,
      skills: [{ id: 'relay', name: 'Relay', description: 'Deliver a message to an agent, a project channel or the owner; the task completes when they reply.', tags: ['messaging', 'planning'] },
        ...store.listAgents(state).map(a => ({ id: a.name, name: a.name, description: a.role || 'agent', tags: ['agent'] }))] });
  }
  const a = store.findAgent(state, name);
  if (!a) return null;
  return card({ name: a.name, url: `${base}/a2a/${encodeURIComponent(a.name)}`,
    description: `${a.role || 'An agent'} — a member of Jean Clawd vd Dam. Messages land in its inbox; the task completes when it replies.`,
    skills: [{ id: 'message', name: `Message ${a.name}`, description: a.doing ? `Currently on: ${a.doing.text}` : 'Ask or tell this agent something.', tags: ['agent', 'messaging'] }] });
}

const textOf = msg => (msg.parts || []).map(p => p.text ?? (p.kind === 'text' ? p.text : p.data ? JSON.stringify(p.data) : p.url || '')).filter(Boolean).join('\n').trim();

function toA2AMessage(m, root, legacy) {
  const role = m.from === root.from ? 'ROLE_USER' : 'ROLE_AGENT';
  const out = { messageId: m.id, contextId: root.a2a?.contextId || root.id, taskId: root.id,
    role: legacy ? (role === 'ROLE_USER' ? 'user' : 'agent') : role,
    parts: [legacy ? { kind: 'text', text: m.text } : { text: m.text }], metadata: { from: m.from, at: m.at } };
  if (legacy) out.kind = 'message';
  return out;
}

/** The A2A task view of a Jean thread. */
function taskOf(state, root, { legacy = false, historyLength } = {}) {
  const thread = state.messages.filter(m => m.id === root.id || m.thread === root.id);
  const replies = thread.filter(m => m.id !== root.id && m.from !== root.from && m.kind !== 'event');
  const target = root.to;
  let st = 'TASK_STATE_SUBMITTED';
  if (root.canceled) st = 'TASK_STATE_CANCELED';
  else if (replies.length) st = 'TASK_STATE_COMPLETED';
  else if (root.readBy.includes(String(target).toLowerCase())) st = 'TASK_STATE_WORKING';
  const last = replies[replies.length - 1];
  let history = thread.map(m => toA2AMessage(m, root, legacy));
  if (historyLength !== undefined) history = history.slice(-Number(historyLength) || undefined);
  const task = {
    id: root.id, contextId: root.a2a?.contextId || root.id,
    status: { state: legacy ? legacyState(st) : st, timestamp: (last || root).at, ...(last ? { message: toA2AMessage(last, root, legacy) } : {}) },
    history,
    artifacts: last ? [{ artifactId: `${last.id}-reply`, name: 'reply', parts: [legacy ? { kind: 'text', text: last.text } : { text: last.text }] }] : [],
    metadata: { to: target, from: root.from },
  };
  if (legacy) task.kind = 'task';
  return task;
}

function rpcError(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

/**
 * Handle one A2A JSON-RPC request addressed to `target` (an agent name, or '' for the planner).
 * `from` is the caller's name if known (X-Jean-Agent header). Mutates state; caller persists.
 * Returns { response, changed }.
 */
function handleRpc(state, target, req, from) {
  if (!req || req.jsonrpc !== '2.0' || !req.method) return { response: rpcError(req && req.id, -32600, 'Invalid Request') };
  const op = Object.entries(V1).find(([, v]) => v === req.method)?.[0] || LEGACY[req.method];
  const legacy = !!LEGACY[req.method];
  if (!op) return { response: rpcError(req.id, ERR.method, 'Method not found') };
  const p = req.params || {};
  const ok = result => ({ jsonrpc: '2.0', id: req.id, result });
  const findRoot = id => { const m = store.findMessage(state, id); return m ? (m.thread ? store.findMessage(state, m.thread) : m) : null; };

  if (op === 'send') {
    const msg = p.message;
    const text = msg && textOf(msg);
    if (!text) return { response: rpcError(req.id, ERR.invalid, 'params.message with a text part is required') };
    const meta = msg.metadata || {};
    const sender = meta.from || from || `a2a-${String(msg.contextId || 'guest').replace(/[^\w-]/g, '').slice(0, 12) || 'guest'}`;
    const prior = msg.taskId ? findRoot(msg.taskId) : null;
    if (msg.taskId && !prior) return { response: rpcError(req.id, ERR.notFound, `Task not found: ${msg.taskId}`) };
    // A follow-up on an existing task goes to the other side of that thread.
    const to = prior ? (sender.toLowerCase() === prior.from.toLowerCase() ? prior.to : prior.from) : (target || meta.to || store.ownerKey(state));
    if (target && !prior && !store.findAgent(state, target)) return { response: rpcError(req.id, ERR.notFound, `No agent "${target}" in Jean`) };
    const m = store.sendMessage(state, { from: sender, to, replyTo: prior ? prior.id : undefined, text, task: meta.task, project: meta.project });
    const caller = store.findAgent(state, sender);
    if (caller && caller.kind === 'claude' && !caller.role) caller.kind = 'a2a-client';
    const root = prior || m;
    if (!prior) root.a2a = { contextId: msg.contextId || root.id, messageId: msg.messageId || null };
    const task = taskOf(state, root, { legacy });
    return { response: ok(legacy ? task : { task }), changed: true, message: m };
  }
  const root = p.id ? findRoot(p.id) : null;
  if (!root) return { response: rpcError(req.id, ERR.notFound, `Task not found: ${p.id}`) };
  if (op === 'get') { const task = taskOf(state, root, { legacy, historyLength: p.historyLength }); return { response: ok(task) }; }
  if (op === 'cancel') {
    const t = taskOf(state, root);
    if (['TASK_STATE_COMPLETED', 'TASK_STATE_CANCELED'].includes(t.status.state)) return { response: rpcError(req.id, ERR.unsupported, 'Task is already in a terminal state') };
    root.canceled = true;
    return { response: ok(taskOf(state, root, { legacy })), changed: true };
  }
}

/** Build an outbound SendMessage request (Jean → external A2A agent). */
function outboundSend(m, contextId, remoteTaskId) {
  return { jsonrpc: '2.0', id: m.id, method: 'SendMessage', params: {
    message: { messageId: m.id, contextId, ...(remoteTaskId ? { taskId: remoteTaskId } : {}), role: 'ROLE_USER', parts: [{ text: m.text }], metadata: { from: m.from } },
    configuration: { acceptedOutputModes: ['text/plain'] } } };
}

/** Read a SendMessage / GetTask result from any A2A version → { taskId, done, text } */
function readResult(result) {
  if (!result) return { done: false };
  const r = result.task || result.message || result;
  if (r.parts && !r.status) return { done: true, text: textOf(r) };                    // a direct Message reply
  const state = String(r.status?.state || '').toUpperCase().replace(/-/g, '_').replace(/^(?!TASK_STATE_)/, 'TASK_STATE_');
  const terminal = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED'].includes(state);
  let text = r.status?.message ? textOf(r.status.message) : '';
  if (!text && r.artifacts?.length) text = r.artifacts.map(a => textOf(a)).filter(Boolean).join('\n');
  if (terminal && !text) text = `(${state.replace('TASK_STATE_', '').toLowerCase()})`;
  return { taskId: r.id, contextId: r.contextId, done: terminal, text, state };
}

/** From a fetched agent card: the JSON-RPC endpoint and a short description. */
function endpointFromCard(c) {
  const iface = (c.supportedInterfaces || c.additionalInterfaces || []).find(i => /jsonrpc/i.test(i.protocolBinding || i.transport || ''));
  return { url: (iface && iface.url) || c.url, name: c.name, description: c.description || '' };
}

module.exports = { agentCard, handleRpc, taskOf, outboundSend, readResult, endpointFromCard, textOf };
