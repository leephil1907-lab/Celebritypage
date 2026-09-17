/**
 * server/bus.js — in-process event bus + Server-Sent Events.
 * Admin writes → publish() → every open public tab updates live (replaces BroadcastChannel demos).
 */
import { insert, all, run } from './db.js';

const clients = new Set();
let seq = Date.now() % 100000;
const replay = [];
const REPLAY_MAX = 40;

export function publish(event, payload = {}, { persist = true } = {}) {
  const id = ++seq;
  const msg = { id, event, payload, at: new Date().toISOString() };
  replay.push(msg);
  if (replay.length > REPLAY_MAX) replay.shift();
  if (persist) insert('outbox', { event, payload: JSON.stringify(payload) });
  for (const res of clients) write(res, msg);
  return msg;
}

function write(res, msg) {
  try {
    res.write(`id: ${msg.id}\nevent: ${msg.event}\ndata: ${JSON.stringify(msg.payload)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

export function stream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const last = Number(req.headers['last-event-id'] || req.query.last || 0);
  if (last) replay.filter((m) => m.id > last).forEach((m) => write(res, m));
  write(res, { id: 0, event: 'ready', payload: { at: new Date().toISOString(), clients: clients.size + 1 }, at: new Date().toISOString() });
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function heartbeat(ms = 20000) {
  const t = setInterval(() => {
    for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } }
  }, ms);
  t.unref?.();
  return () => clearInterval(t);
}

export const clientCount = () => clients.size;

export function outboxSince(id = 0, limit = 20) {
  return all(`SELECT * FROM outbox WHERE id > @id ORDER BY id DESC LIMIT ${Number(limit)}`, { id: Number(id) });
}
