'use strict';

/*
 * ONE BALLOON — server
 *
 * There is exactly one balloon in the world and it lives here, in this process.
 * Browsers never simulate anything that matters; they draw what this file says.
 * A click is a request ("I tapped at 74, 108"), not a command. The server checks
 * whether that point actually touched the balloon before honouring it.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocketServer;
try {
  ({ WebSocketServer } = require('ws'));
} catch (err) {
  console.error('\nMissing dependency "ws". Run:  npm install\n');
  process.exit(1);
}

// Minimal .env loader (no dependency): reads KEY=VALUE lines, skips ones
// already set in the real environment.
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] || '').trim();
    if (/^(['"])(.*)\1$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch (err) {
  // No .env file — fine, fall back to defaults / real env vars.
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAVE_FILE = path.join(__dirname, 'state.json');

// ---------------------------------------------------------------------------
// World constants. These are in the same pixel space the client draws in
// (a 160x240 virtual screen), so there is no unit conversion anywhere.
// ---------------------------------------------------------------------------
const W = 160;
const H = 240;
const GROUND_Y = 214;      // y of the top of the grass
const CEIL_Y = 30;         // balloon can't go above this
const R = 9;               // balloon hit radius
const GRAB = 5;            // extra forgiveness on the hit test (fat fingers)

const GRAVITY = 17;        // px/s^2 at the start of a flight
const RAMP_SECONDS = 240;  // gravity doubles over this long, so runs must end
const BOOST_VY = -40;      // px/s the balloon is set to when someone saves it
const MAX_FALL = 70;       // px/s terminal velocity
const DRIFT = 15;          // max horizontal speed

const TICK_HZ = 30;
const SEND_HZ = 15;
const BOOST_COOLDOWN = 300; // ms between one person's successful saves
const MSG_BUDGET = 25;      // messages per second per socket before we ignore them
const RESPAWN_MS = 3500;
const MAX_CLIENTS = 500;

const BIRD_R = 6;               // bird hit radius
const BIRD_SPEED = 55;          // px/s, faster than the balloon's own drift
const BIRD_INTERVAL_MIN = 8000; // ms between hazard flybys
const BIRD_INTERVAL_MAX = 16000;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Persistent records
// ---------------------------------------------------------------------------
const records = {
  totalSaves: 0,
  flights: 0,
  bestFlightMs: 0,
  bestSaves: 0,
};

try {
  const disk = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  for (const k of Object.keys(records)) {
    if (Number.isFinite(disk[k])) records[k] = disk[k];
  }
  console.log('Loaded records:', records);
} catch {
  /* first run, no file yet */
}

let recordsDirty = false;
function persist() {
  if (!recordsDirty) return;
  recordsDirty = false;
  fs.writeFile(SAVE_FILE, JSON.stringify(records), (err) => {
    if (err) console.error('Could not write records:', err.message);
  });
}
setInterval(persist, 10000).unref();

// Shutdown needs a blocking write: process.exit() can fire before the async
// persist() above finishes, dropping whatever changed in the last <10s.
function persistSync() {
  if (!recordsDirty) return;
  recordsDirty = false;
  try {
    fs.writeFileSync(SAVE_FILE, JSON.stringify(records));
  } catch (err) {
    console.error('Could not write records:', err.message);
  }
}

// ---------------------------------------------------------------------------
// The balloon
// ---------------------------------------------------------------------------
const balloon = {
  x: W / 2,
  y: 95,
  vx: 7,
  vy: 0,
  alive: true,
  color: 0,
  bornAt: Date.now(),
  diedAt: 0,
  saves: 0,
  lastSaverTag: '',
};

// A bird crosses the sky every so often. It doesn't care about the balloon,
// but if their paths cross the balloon pops just like it hit the ground.
const bird = { active: false, x: 0, y: 0, vx: 0 };
let nextBirdAt = Date.now() + randBirdDelay();

function randBirdDelay() {
  return BIRD_INTERVAL_MIN + Math.random() * (BIRD_INTERVAL_MAX - BIRD_INTERVAL_MIN);
}

function spawnBird() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  bird.active = true;
  bird.vx = BIRD_SPEED * dir;
  bird.y = CEIL_Y + 15 + Math.random() * (GROUND_Y - CEIL_Y - 70);
  bird.x = dir === 1 ? -10 : W + 10;
}

function updateBird(dt) {
  const now = Date.now();
  if (!bird.active) {
    if (now >= nextBirdAt) spawnBird();
    return;
  }
  bird.x += bird.vx * dt;
  if (bird.x < -20 || bird.x > W + 20) {
    bird.active = false;
    nextBirdAt = now + randBirdDelay();
  }
}

function hitsBird() {
  const dx = balloon.x - bird.x;
  const dy = balloon.y - bird.y;
  const reach = R + BIRD_R;
  return dx * dx + dy * dy <= reach * reach;
}

function respawn() {
  balloon.x = W / 2;
  balloon.y = 95;
  balloon.vx = Math.random() < 0.5 ? -7 : 7;
  balloon.vy = 0;
  balloon.alive = true;
  balloon.color = (balloon.color + 1 + Math.floor(Math.random() * 5)) % 6;
  balloon.bornAt = Date.now();
  balloon.saves = 0;
  balloon.lastSaverTag = '';
  broadcast({ t: 'spawn', c: balloon.color });
}

function burst(cause) {
  const flightMs = Date.now() - balloon.bornAt;
  balloon.alive = false;
  balloon.diedAt = Date.now();
  balloon.vx = 0;
  balloon.vy = 0;

  // Clear the bird so it can't clip the next balloon the instant it spawns.
  bird.active = false;
  nextBirdAt = Date.now() + randBirdDelay();

  records.flights += 1;
  const recordFlight = flightMs > records.bestFlightMs;
  const recordSaves = balloon.saves > records.bestSaves;
  if (recordFlight) records.bestFlightMs = flightMs;
  if (recordSaves) records.bestSaves = balloon.saves;
  recordsDirty = true;
  persist();

  broadcast({
    t: 'burst',
    x: round1(balloon.x),
    y: round1(balloon.y),
    ms: flightMs,
    saves: balloon.saves,
    rec: recordFlight || recordSaves,
    r: records,
    cause: cause || 'ground',
  });
}

function step(dt) {
  updateBird(dt);

  if (!balloon.alive) {
    if (Date.now() - balloon.diedAt >= RESPAWN_MS) respawn();
    return;
  }

  balloon.vy = Math.min(balloon.vy + gravityNow() * dt, MAX_FALL);
  balloon.y += balloon.vy * dt;

  // A little wandering so it is never in the same place twice.
  balloon.vx = clamp(balloon.vx + (Math.random() - 0.5) * 7 * dt, -DRIFT, DRIFT);
  balloon.x += balloon.vx * dt;

  const left = R + 2;
  const right = W - R - 2;
  if (balloon.x < left) {
    balloon.x = left;
    balloon.vx = Math.abs(balloon.vx);
  } else if (balloon.x > right) {
    balloon.x = right;
    balloon.vx = -Math.abs(balloon.vx);
  }

  if (balloon.y < CEIL_Y) {
    balloon.y = CEIL_Y;
    if (balloon.vy < 0) balloon.vy *= -0.25;
  }

  if (balloon.y + R >= GROUND_Y) {
    burst('ground');
    return;
  }

  if (bird.active && hitsBird()) burst('bird');
}

// Gravity creeps up over a flight. Without this, a busy day would mean the
// balloon never comes down and there is no game left to play.
function gravityNow() {
  const secs = (Date.now() - balloon.bornAt) / 1000;
  return GRAVITY * (1 + Math.min(secs / RAMP_SECONDS, 1));
}

// ---------------------------------------------------------------------------
// HTTP: serve ./public
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/health') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ ok: true, players: clients.size, records }));
    return;
  }

  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------------------------------------------------------------------------
// WebSockets
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, maxPayload: 1024 });
const clients = new Map(); // ws -> player

let nextId = 1;
const TAG_CHARS = '234789ABCDEFHJKLMNPRSTUVWXYZ';
function makeTag() {
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)];
  }
  return s;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, 'Too many players');
    return;
  }

  const player = {
    id: nextId++,
    tag: makeTag(),
    lastBoost: 0,
    saves: 0,
    budget: MSG_BUDGET,
    alive: true,
  };
  clients.set(ws, player);

  ws.send(JSON.stringify({
    t: 'hello',
    id: player.id,
    tag: player.tag,
    world: { W, H, GROUND_Y, CEIL_Y, R },
    r: records,
    c: balloon.color,
  }));

  ws.on('message', (raw) => {
    if (player.budget <= 0) return;
    player.budget -= 1;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || msg.t !== 'tap') return;

    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < 0 || x > W || y < 0 || y > H) return;

    tryBoost(player, x, y);
  });

  ws.on('pong', () => { player.alive = true; });
  ws.on('error', () => ws.terminate());
  ws.on('close', () => { clients.delete(ws); });
});

function tryBoost(player, x, y) {
  if (!balloon.alive) return;

  const now = Date.now();
  if (now - player.lastBoost < BOOST_COOLDOWN) return;

  const dx = x - balloon.x;
  const dy = y - balloon.y;
  const reach = R + GRAB;
  if (dx * dx + dy * dy > reach * reach) {
    broadcast({ t: 'miss', x: round1(x), y: round1(y), by: player.id });
    return;
  }

  player.lastBoost = now;
  player.saves += 1;
  balloon.saves += 1;
  balloon.lastSaverTag = player.tag;
  records.totalSaves += 1;
  recordsDirty = true;

  // Set, don't add. Otherwise a crowd stacks impulses and pins it to the ceiling.
  balloon.vy = BOOST_VY;
  // Nudge sideways away from where the finger landed, for a bit of chaos.
  balloon.vx = clamp(balloon.vx - dx * 1.1, -DRIFT, DRIFT);

  broadcast({
    t: 'save',
    x: round1(x),
    y: round1(y),
    by: player.id,
    tag: player.tag,
    n: balloon.saves,
    total: records.totalSaves,
  });
}

// Drop sockets that stopped answering, and refill the per-second message budget.
setInterval(() => {
  for (const [ws, player] of clients) {
    if (!player.alive) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    player.alive = false;
    player.budget = MSG_BUDGET;
    if (ws.readyState === ws.OPEN) ws.ping();
  }
}, 1000);

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  step(dt);
}, 1000 / TICK_HZ);

setInterval(() => {
  broadcast({
    t: 's',
    x: round1(balloon.x),
    y: round1(balloon.y),
    vx: round1(balloon.vx),
    vy: round1(balloon.vy),
    g: round1(gravityNow()),
    a: balloon.alive ? 1 : 0,
    c: balloon.color,
    n: balloon.saves,
    ms: balloon.alive ? Date.now() - balloon.bornAt : 0,
    rs: balloon.alive ? 0 : Math.max(0, RESPAWN_MS - (Date.now() - balloon.diedAt)),
    p: clients.size,
    b: bird.active ? { x: round1(bird.x), y: round1(bird.y), vx: round1(bird.vx) } : null,
  });
}, 1000 / SEND_HZ);

server.listen(PORT, () => {
  console.log(`One Balloon is up on http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    persistSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
