'use strict';

/*
 * ONE BALLOON — client
 *
 * Draws a 160x240 virtual screen, scaled (via image-rendering: pixelated) to
 * fill the available space. The server owns the balloon; this file predicts
 * a few frames ahead to hide latency and then eases back onto whatever the
 * server said.
 */

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const W = 160;
const H = 240;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

function fitCanvas() {
  const body = getComputedStyle(document.body);
  const stage = getComputedStyle(cv.parentElement);
  const paddingV = parseFloat(body.paddingTop) + parseFloat(body.paddingBottom);
  const paddingH = parseFloat(body.paddingLeft) + parseFloat(body.paddingRight);
  const gap = parseFloat(body.rowGap || body.gap) || 0;
  const stageBorderV = parseFloat(stage.borderTopWidth) + parseFloat(stage.borderBottomWidth);
  const stageBorderH = parseFloat(stage.borderLeftWidth) + parseFloat(stage.borderRightWidth);

  // .hud, .stage, .hud are the three flex children stacked in body, so their
  // real rendered heights (not a guessed constant) tell us what's left for
  // the canvas — this stays correct as the surrounding chrome changes.
  let hudHeight = 0;
  document.querySelectorAll('.hud').forEach((h) => { hudHeight += h.getBoundingClientRect().height; });

  const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const availW = window.innerWidth - paddingH - stageBorderH;
  const availH = viewportH - paddingV - stageBorderV - hudHeight - gap * 2;

  const scale = Math.max(1, Math.min(availW / W, availH / H));
  cv.style.width = W * scale + 'px';
  cv.style.height = H * scale + 'px';
}
window.addEventListener('resize', fitCanvas);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);
fitCanvas();

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  ink: '#141026',
  sky: ['#1d2a63', '#2b4a8f', '#3f6cc4', '#5aa3e0', '#7cc2ee', '#a8ddf7'],
  cloud: '#f2f7ff',
  cloudShade: '#bcd4f0',
  sun: '#ffe08a',
  grass: '#4fbb4a',
  grassDk: '#2e7a30',
  dirt: '#8a5a2b',
  dirtDk: '#5c3a1a',
  hill: '#2a5f8f',
  white: '#ffffff',
  gold: '#ffd75e',
  danger: '#ff5a5a',
  string: '#e8e8f4',
};

// Each balloon gets one of these for its whole flight.
const SKINS = [
  { m: '#e04a4a', d: '#8f2222', h: '#ff9e9e' },
  { m: '#4a8ae0', d: '#22508f', h: '#a8d2ff' },
  { m: '#57c24a', d: '#2b7a22', h: '#b4f0a8' },
  { m: '#e0c44a', d: '#8f7a22', h: '#fff3a8' },
  { m: '#b45ae0', d: '#6b228f', h: '#e6b0ff' },
  { m: '#e08a3a', d: '#8f5218', h: '#ffcf99' },
];

const CROWD = ['#ff8ab0', '#8affa0', '#ffd75e', '#8ac6ff', '#d98aff', '#ffab6b', '#7fecdc', '#ff7f7f'];

// ---------------------------------------------------------------------------
// Sprites. '.' is transparent; letters index the current skin.
// ---------------------------------------------------------------------------
const BALLOON = [
  '....#####....',
  '..##mmmmm##..',
  '.#mhhmmmmmm#.',
  '#mhhhmmmmmmm#',
  '#mhhhmmmmmmm#',
  '#mmhhmmmmmmd#',
  '#mmmmmmmmmmd#',
  '#mmmmmmmmmdd#',
  '#mmmmmmmmmdd#',
  '.#mmmmmmmdd#.',
  '.#mmmmmmmdd#.',
  '..#mmmmmdd#..',
  '...#mmmdd#...',
  '....#mdd#....',
  '.....#d#.....',
  '......#......',
];
const BW = 13;
const BH = 16;

// 3x5 bitmap font. Enough glyphs for the HUD and nothing more.
const FONT = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001111',
  A: '111101111101101', B: '110101110101110', C: '111100100100111',
  D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '111100101101111', H: '101101111101101', I: '111010010010111',
  J: '001001001101111', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '111101101101111',
  P: '111101111100100', Q: '111101101111001', R: '111101110101101',
  S: '111100111001111', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  ' ': '000000000000000', '.': '000000000000010', ':': '000010000010000',
  '-': '000000111000000', '+': '000010111010000', '!': '010010010000010',
  '?': '111001011000010', '/': '001001010100100', "'": '010010000000000',
};

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------
function px(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

function sprite(rows, x, y, map) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let run = 0;
    let runChar = '.';
    for (let c = 0; c <= row.length; c++) {
      const ch = row[c] || '.';
      if (ch === runChar) { run++; continue; }
      if (runChar !== '.' && run > 0) {
        const col = map[runChar];
        if (col) rect(x + c - run, y + r, run, 1, col);
      }
      runChar = ch;
      run = 1;
    }
  }
}

function textWidth(str) {
  return str.length * 4 - 1;
}

function text(str, x, y, color) {
  const s = String(str).toUpperCase();
  let cx = x | 0;
  for (const ch of s) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (glyph[r * 3 + c] === '1') px(cx + c, y + r, color);
        }
      }
    }
    cx += 4;
  }
}

function textCenter(str, y, color) {
  text(str, Math.round((W - textWidth(String(str))) / 2), y, color);
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function clock(ms) {
  const total = Math.floor(ms / 1000);
  return pad(Math.floor(total / 60), 2) + ':' + pad(total % 60, 2);
}

// ---------------------------------------------------------------------------
// Network state
// ---------------------------------------------------------------------------
const net = {
  x: W / 2, y: 95, vx: 0, vy: 0, g: 17,
  alive: true, color: 0, saves: 0, flightMs: 0, respawnMs: 0,
  players: 1, stampedAt: performance.now(),
};

// What we actually draw. It chases the prediction instead of teleporting.
const view = { x: W / 2, y: 95, squash: 0 };

let world = { GROUND_Y: 214, CEIL_Y: 30, R: 9 };
let myId = 0;
let connected = false;
let ws = null;
let retry = 0;

const els = {
  status: document.getElementById('status'),
  tag: document.getElementById('tag'),
  best: document.getElementById('best'),
  total: document.getElementById('total'),
  sound: document.getElementById('sound'),
};

function setStatus(label, live) {
  els.status.textContent = label;
  els.status.dataset.live = live ? '1' : '0';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);

  ws.onopen = () => {
    connected = true;
    retry = 0;
    setStatus('Live', true);
  };

  ws.onclose = () => {
    connected = false;
    setStatus('Reconnecting', false);
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 400 * retry);
  };

  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
}

const HYPE = ['NICE', 'YES', 'FUCK YEA', "THAT'S WHAT'S UP", 'YOU GO GIRL'];
function randomHype() {
  return HYPE[Math.floor(Math.random() * HYPE.length)];
}

function handle(m) {
  switch (m.t) {
    case 'hello':
      myId = m.id;
      world = m.world;
      els.tag.textContent = m.tag;
      showRecords(m.r);
      break;

    case 's':
      net.x = m.x; net.y = m.y; net.vx = m.vx; net.vy = m.vy; net.g = m.g;
      net.alive = !!m.a; net.color = m.c; net.saves = m.n;
      net.flightMs = m.ms; net.respawnMs = m.rs; net.players = m.p;
      net.stampedAt = performance.now();
      break;

    case 'save':
      if (m.by !== myId) {
        // Our own save already played on click, so don't double up.
        net.vy = -40;
        beep('save');
      }
      view.squash = 1;
      sparkle(m.x, m.y, SKINS[net.color].h, 10);
      floaters.push({ x: m.x, y: m.y - 14, text: m.by === myId ? randomHype() : m.tag, life: 1, gold: m.by === myId });
      els.total.textContent = m.total.toLocaleString();
      break;

    case 'miss':
      if (m.by === myId) puff(m.x, m.y);
      break;

    case 'burst':
      confetti(m.x, m.y, SKINS[net.color].m, 34);
      shake = 7;
      lastRun = { ms: m.ms, saves: m.saves, record: m.rec };
      beep('burst');
      showRecords(m.r);
      break;

    case 'spawn':
      net.color = m.c;
      lastRun = null;
      beep('spawn');
      break;
  }
}

function showRecords(r) {
  if (!r) return;
  els.best.textContent = clock(r.bestFlightMs) + ' / ' + r.bestSaves + ' saves';
  els.total.textContent = r.totalSaves.toLocaleString();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function toWorld(ev) {
  const r = cv.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * W,
    y: ((ev.clientY - r.top) / r.height) * H,
  };
}

let localCooldown = 0;

cv.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  unlockAudio();
  const p = toWorld(ev);

  if (connected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: 'tap', x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  }

  // Optimistic feedback. If the server disagrees, the correction below
  // pulls us back within a couple of frames and nobody notices.
  const dx = p.x - view.x;
  const dy = p.y - view.y;
  const reach = world.R + 5;
  const now = performance.now();
  if (net.alive && dx * dx + dy * dy <= reach * reach && now - localCooldown > 300) {
    localCooldown = now;
    net.vy = -40;
    net.y = view.y;
    net.x = view.x;
    net.stampedAt = now;
    view.squash = 1;
    sparkle(p.x, p.y, SKINS[net.color].h, 8);
    beep('save');
  } else {
    puff(p.x, p.y);
    beep('miss');
  }
});

cv.addEventListener('contextmenu', (ev) => ev.preventDefault());

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
const parts = [];
const floaters = [];
let shake = 0;
let lastRun = null;

function sparkle(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 14 + Math.random() * 26;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, life: 0.5, g: 40, color });
  }
}

function puff(x, y) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    parts.push({ x, y, vx: Math.cos(a) * 10, vy: Math.sin(a) * 10, life: 0.3, g: 0, color: '#9fb0e0' });
  }
}

function confetti(x, y, color, n) {
  const skin = SKINS[net.color];
  const cols = [skin.m, skin.d, skin.h, C.white];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 20 + Math.random() * 55;
    parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 30,
      life: 1.1,
      g: 90,
      color: cols[(Math.random() * cols.length) | 0],
    });
  }
}

// ---------------------------------------------------------------------------
// Sound: three square-wave voices, no assets.
// ---------------------------------------------------------------------------
let audio = null;
let soundOn = true;

function unlockAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audio = new AC();
  }
  if (audio && audio.state === 'suspended') audio.resume();
}

els.sound.addEventListener('click', () => {
  soundOn = !soundOn;
  els.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
  els.sound.setAttribute('aria-pressed', String(soundOn));
  if (soundOn) unlockAudio();
});

function tone(freq, to, dur, vol, type) {
  if (!audio || !soundOn) return;
  const t0 = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (to && to !== freq) osc.frequency.linearRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function beep(kind) {
  if (kind === 'save') tone(520, 880, 0.09, 0.07);
  else if (kind === 'miss') tone(150, 110, 0.05, 0.03);
  else if (kind === 'burst') { tone(320, 60, 0.35, 0.09, 'sawtooth'); tone(180, 40, 0.4, 0.06); }
  else if (kind === 'spawn') { tone(400, 660, 0.12, 0.05); }
  else if (kind === 'warn') tone(240, 200, 0.06, 0.035);
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------
const clouds = [];
for (let i = 0; i < 5; i++) {
  clouds.push({
    x: Math.random() * W,
    y: 34 + Math.random() * 110,
    speed: 1.5 + Math.random() * 3,
    w: 10 + ((Math.random() * 8) | 0),
  });
}

function drawCloud(c) {
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  const w = c.w;
  rect(x + 3, y, w - 6, 1, C.cloud);
  rect(x + 1, y + 1, w - 2, 1, C.cloud);
  rect(x, y + 2, w, 1, C.cloud);
  rect(x + 1, y + 3, w - 2, 1, C.cloudShade);
}

function drawSky() {
  const bands = C.sky;
  const h = Math.ceil(world.GROUND_Y / bands.length);
  for (let i = 0; i < bands.length; i++) {
    rect(0, i * h, W, h, bands[i]);
  }
  // Ordered dither between bands so the gradient reads as 8-bit, not smooth.
  for (let i = 1; i < bands.length; i++) {
    const y = i * h;
    for (let x = 0; x < W; x++) {
      if ((x + i) % 2 === 0) px(x, y - 1, bands[i]);
      if (x % 2 === 0) px(x, y, bands[i - 1]);
    }
  }
  // Sun
  rect(122, 20, 12, 12, C.sun);
  rect(120, 22, 16, 8, C.sun);
  rect(121, 21, 14, 10, C.sun);
}

function drawGround(t) {
  const g = world.GROUND_Y;

  // Distant hills
  for (let x = 0; x < W; x++) {
    const hh = 6 + Math.round(4 * Math.sin(x / 19) + 3 * Math.sin(x / 7 + 1.3));
    rect(x, g - hh, 1, hh, C.hill);
  }

  rect(0, g, W, 3, C.grass);
  rect(0, g + 3, W, H - g - 3, C.dirt);
  for (let x = 0; x < W; x++) {
    if ((x * 7919) % 5 === 0) px(x, g - 1, C.grass);
    if ((x * 104729) % 11 === 0) px(x, g + 3, C.grassDk);
    if ((x * 31337) % 17 === 0) px(x, g + 8 + ((x * 13) % 12), C.dirtDk);
  }

  // The crowd: one little person per connected player. This is the whole
  // point of the game made visible.
  const shown = Math.min(net.players, 26);
  for (let i = 0; i < shown; i++) {
    const seed = (i * 2654435761) % 4294967296;
    const x = 4 + ((seed >>> 8) % (W - 10));
    const col = CROWD[i % CROWD.length];
    const wave = Math.sin(t / 320 + i) > 0.6 ? 1 : 0;
    const y = g - 5;
    px(x + 1, y, col);          // head
    rect(x, y + 1, 3, 2, col);  // body
    px(x, y + 3, col);          // legs
    px(x + 2, y + 3, col);
    if (wave) { px(x - 1, y, col); px(x + 3, y, col); }
  }
}

function drawBalloon(t) {
  const skin = SKINS[net.color] || SKINS[0];
  const map = { '#': C.ink, m: skin.m, d: skin.d, h: skin.h };

  const squash = view.squash;
  const x = Math.round(view.x) - ((BW / 2) | 0);
  const y = Math.round(view.y) - 7 + Math.round(squash * 2);

  // String, wobbling with horizontal speed
  const sway = Math.sin(t / 200) * (1 + Math.abs(net.vx) / 8);
  for (let i = 0; i < 7; i++) {
    px(Math.round(view.x + Math.sin(t / 180 + i / 2) * sway * 0.5), y + BH + i, C.string);
  }

  sprite(BALLOON, x, y, map);

  // A squashed balloon reads as "just got hit" without any extra sprite.
  if (squash > 0.05) {
    rect(x - 1, y + 5, BW + 2, 1, skin.m);
  }
}

function drawHud(t) {
  rect(0, 0, W, 13, 'rgba(10,12,30,0.72)');
  rect(0, 13, W, 1, C.ink);

  text('SAVES ' + pad(net.saves, 3), 4, 4, C.white);

  const flight = clock(net.flightMs);
  text(flight, W - 4 - textWidth(flight), 4, net.alive ? C.gold : C.danger);

  const who = pad(net.players, 2) + ' HERE';
  text(who, Math.round((W - textWidth(who)) / 2), 4, C.white);

  // Danger band along the ground when the balloon is running out of room.
  const room = world.GROUND_Y - view.y;
  if (net.alive && room < 52) {
    const blink = Math.sin(t / 90) > 0;
    if (blink) {
      rect(0, world.GROUND_Y - 12, W, 1, C.danger);
      textCenter('LOW!', world.GROUND_Y - 20, C.danger);
    }
  }
}

function drawGameOver() {
  rect(0, 92, W, 56, 'rgba(10,12,30,0.86)');
  rect(0, 92, W, 1, C.danger);
  rect(0, 147, W, 1, C.danger);

  textCenter('THE BALLOON POPPED', 100, C.danger);
  if (lastRun) {
    textCenter('IT FLEW ' + clock(lastRun.ms), 112, C.white);
    textCenter(lastRun.saves + ' SAVES', 121, C.white);
    if (lastRun.record) textCenter('NEW RECORD!', 131, C.gold);
    else textCenter('NEXT ONE IN ' + Math.ceil(net.respawnMs / 1000), 131, C.gold);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let prev = performance.now();
let warnAt = 0;

function frame(now) {
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  // Predict where the server's balloon is right now, then ease toward it.
  const since = Math.min((now - net.stampedAt) / 1000, 0.6);
  let px_ = net.x + net.vx * since;
  let py_ = net.y + net.vy * since + 0.5 * net.g * since * since;
  py_ = Math.max(world.CEIL_Y, Math.min(py_, world.GROUND_Y - world.R));
  px_ = Math.max(world.R + 2, Math.min(px_, W - world.R - 2));

  const ease = 1 - Math.pow(0.0008, dt);
  view.x += (px_ - view.x) * ease;
  view.y += (py_ - view.y) * ease;
  view.squash = Math.max(0, view.squash - dt * 5);

  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > W + 4) { c.x = -c.w - 4; c.y = 34 + Math.random() * 110; }
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt * 0.9;
    f.y -= dt * 14;
    if (f.life <= 0) floaters.splice(i, 1);
  }

  // Ticking warning as the ground gets close.
  if (net.alive && world.GROUND_Y - view.y < 40 && now - warnAt > 420) {
    warnAt = now;
    beep('warn');
  }

  // --- draw ---
  ctx.save();
  if (shake > 0) {
    shake -= dt * 40;
    ctx.translate((Math.random() * 4 - 2) | 0, (Math.random() * 4 - 2) | 0);
  }

  rect(-4, -4, W + 8, H + 8, C.sky[0]);
  drawSky();
  for (const c of clouds) drawCloud(c);
  drawGround(now);

  if (net.alive) drawBalloon(now);

  for (const p of parts) px(p.x, p.y, p.color);
  for (const f of floaters) {
    if (f.life > 0.25 || Math.sin(now / 60) > 0) {
      text(f.text, Math.round(f.x - textWidth(f.text) / 2), Math.round(f.y), f.gold ? C.gold : C.white);
    }
  }

  drawHud(now);
  if (!net.alive) drawGameOver();
  if (!connected) {
    rect(0, 110, W, 20, 'rgba(10,12,30,0.9)');
    textCenter('RECONNECTING', 118, C.danger);
  }

  ctx.restore();
  requestAnimationFrame(frame);
}

connect();
requestAnimationFrame(frame);
