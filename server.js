const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
});
const wss = new WebSocketServer({ server, path: '/signal' });
const rooms = new Map();
function send(socket, data) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function roomBroadcast(room, data, except) {
  for (const peer of rooms.get(room)?.values() || []) if (peer.socket !== except) send(peer.socket, data);
}
wss.on('connection', (socket) => {
  socket.id = Math.random().toString(36).slice(2, 10);
  socket.room = null;
  socket.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'join') {
      const room = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
      if (!room) return send(socket, { type: 'error', message: 'Enter a room code first.' });
      if (!rooms.has(room)) rooms.set(room, new Map());
      const members = rooms.get(room);
      if (members.size >= 2) return send(socket, { type: 'error', message: 'This booth is full. Start a new room for another photo session.' });
      socket.room = room;
      const existing = [...members.values()].map(({ id, name }) => ({ id, name }));
      members.set(socket.id, { id: socket.id, name: String(msg.name || 'Guest').slice(0, 24), socket });
      send(socket, { type: 'joined', id: socket.id, room, peers: existing });
      roomBroadcast(room, { type: 'peer-joined', peer: { id: socket.id, name: String(msg.name || 'Guest').slice(0, 24) } }, socket);
      return;
    }
    if (msg.type === 'room-event' && socket.room) {
      if (msg.event === 'capture' || msg.event === 'effect') {
        roomBroadcast(socket.room, { type: 'room-event', event: msg.event, value: msg.value }, socket);
      }
      return;
    }
    if (msg.type === 'signal' && socket.room) {
      const recipient = rooms.get(socket.room)?.get(msg.to);
      if (recipient) send(recipient.socket, { type: 'signal', from: socket.id, description: msg.description, candidate: msg.candidate });
    }
  });
  socket.on('close', () => {
    if (!socket.room) return;
    const members = rooms.get(socket.room);
    const member = members?.get(socket.id);
    members?.delete(socket.id);
    roomBroadcast(socket.room, { type: 'peer-left', id: socket.id, name: member?.name || 'Guest' });
    if (members?.size === 0) rooms.delete(socket.room);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`Pastel Booth running at http://localhost:${PORT}`));
