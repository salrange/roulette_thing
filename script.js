"use strict";
/* =========================================================
   PACHINKO — neon physics ball race
   Original geometry / code. Vanilla JS + Canvas2D, no deps.
   ========================================================= */

/* ---------------------------------------------------------
   1. CONSTANTS
   --------------------------------------------------------- */

const BOARD_W = 800;
const BOARD_H = 1400;

const MAX_PLAYERS = 10;
const MAX_NAME_LEN = 16;

const BALL_R = 9;
const GRAVITY = 780;          // px / s^2
const WALL_REST = 0.52;       // wall bounce restitution
const BUMPER_REST = 0.72;     // bumper bounce restitution (livelier)
const BALL_REST = 0.6;        // ball-vs-ball restitution
const AIR_DRAG = 0.999;       // per-substep velocity damping
const MAX_SPEED = 1400;

const FIXED_DT = 1 / 120;     // physics step (s)
const MAX_STEPS_PER_FRAME = 8;

const GOAL_CX = 400;
const GOAL_HALF_W = 55;
const GOAL_FLOOR_Y = 1330;
const GOAL_DONE_Y = 1352;

const MAX_PARTICLES = 300;

const HARD_CAP_SECONDS = 120;   // emergency failsafe — race is force-ended here
const PROGRESS_WINDOW = 9;      // seconds a ball may go without net downward progress
const MIN_PROGRESS_PX = 45;     // below this over PROGRESS_WINDOW, a ball is "stuck"

const NEON_HUE_NAMES = ["Red","Green","Blue","Cyan","Magenta","Yellow","Orange","Purple"];

/* ---------------------------------------------------------
   2. DOM REFS
   --------------------------------------------------------- */

const canvas = document.getElementById("boardCanvas");
const ctx = canvas.getContext("2d");
const playersForm = document.getElementById("playersForm");
const startBtn = document.getElementById("startBtn");
const formMsg = document.getElementById("formMsg");
const resultsList = document.getElementById("resultsList");
const statusLine = document.getElementById("statusLine");
const raceTimerEl = document.getElementById("raceTimer");
const soundToggle = document.getElementById("soundToggle");

/* ---------------------------------------------------------
   3. MAP GEOMETRY  (fixed — identical every race)
   --------------------------------------------------------- */

function seg(x1, y1, x2, y2, thickness) {
  return { x1, y1, x2, y2, thickness: thickness || 6 };
}
function bump(x, y, r) {
  return { x, y, r: r || 13 };
}
// Pulls each endpoint in along the segment's own line. Adjacent zigzag
// "teeth" must NOT share a vertex — a shared vertex is a symmetric V-notch,
// and a ball landing dead-center in one has no sideways force pushing it out
// (normal-only bounce physics just reflects it back in, forever). Keeping a
// real gap between teeth removes the trap at the geometry level.
function insetSeg(x1, y1, x2, y2, inset, thickness) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return seg(x1 + ux * inset, y1 + uy * inset, x2 - ux * inset, y2 - uy * inset, thickness);
}

function buildMap() {
  const walls = [];
  const bumpers = [];
  const L = 30, R = 770; // playfield inner bounds

  // --- Outer boundary (with a gap in the floor for the goal) ---
  walls.push(seg(L, 0, L, GOAL_FLOOR_Y, 10));
  walls.push(seg(R, 0, R, GOAL_FLOOR_Y, 10));
  walls.push(seg(L, GOAL_FLOOR_Y, GOAL_CX - GOAL_HALF_W, GOAL_FLOOR_Y, 10));
  walls.push(seg(GOAL_CX + GOAL_HALF_W, GOAL_FLOOR_Y, R, GOAL_FLOOR_Y, 10));

  // --- Start pegs (purely visual row marker, non-colliding) ---
  const startY = 70;
  const startXs = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    startXs.push(90 + i * ((710 - 90) / (MAX_PLAYERS - 1)));
  }

  // --- UPPER SECTION (y ~150-420): zigzag diagonals, bumpers, short barriers ---
  (function upperZigzag(y) {
    const segCount = 6;
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      const x1 = L + i * w, x2 = x1 + w;
      const dir = i % 2 === 0 ? 1 : -1;
      walls.push(insetSeg(x1, y - 32 * dir, x2, y + 32 * dir, 14, 6));
    }
  })(190);

  (function bumperRow(y, count, phase) {
    const spacing = (R - L) / (count + 1);
    for (let i = 1; i <= count; i++) {
      const x = L + i * spacing + (phase ? spacing / 2 : 0);
      bumpers.push(bump(Math.min(x, R - 20), y, 12));
    }
  })(285, 6, 0);

  (function barrierRow(y, segCount, gapIndex) {
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if (i === gapIndex) continue;
      walls.push(seg(L + i * w + 12, y, L + (i + 1) * w - 12, y, 6));
    }
  })(370, 4, 1);

  // --- MIDDLE SECTION (y ~420-960): 6 chaotic layers ---
  (function diagLayer(y, phase) {
    const segCount = 5;
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if ((i + phase) % 3 === 0) continue; // narrow-passage gap
      const x1 = L + i * w, x2 = x1 + w;
      const dir = (i + phase) % 2 === 0 ? 1 : -1;
      walls.push(insetSeg(x1, y - 28 * dir, x2, y + 28 * dir, 14, 6));
    }
  })(470, 0);

  (function bumperRow(y, count, phase) {
    const spacing = (R - L) / (count + 1);
    for (let i = 1; i <= count; i++) {
      const x = L + i * spacing + (phase ? spacing / 2 : 0);
      bumpers.push(bump(Math.min(x, R - 20), y, 12));
    }
  })(570, 7, 1);

  (function barrierRow(y, segCount, gapIndex) {
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if (i === gapIndex) continue;
      walls.push(seg(L + i * w + 12, y, L + (i + 1) * w - 12, y, 6));
    }
  })(670, 5, 2);

  (function diagLayer(y, phase) {
    const segCount = 5;
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if ((i + phase) % 3 === 0) continue;
      const x1 = L + i * w, x2 = x1 + w;
      const dir = (i + phase) % 2 === 0 ? 1 : -1;
      walls.push(insetSeg(x1, y + 28 * dir, x2, y - 28 * dir, 14, 6));
    }
  })(770, 1);

  (function bumperRow(y, count, phase) {
    const spacing = (R - L) / (count + 1);
    for (let i = 1; i <= count; i++) {
      const x = L + i * spacing + (phase ? spacing / 2 : 0);
      bumpers.push(bump(Math.min(x, R - 20), y, 11));
    }
  })(865, 8, 0);

  (function barrierRow(y, segCount, gapIndex) {
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if (i === gapIndex) continue;
      walls.push(seg(L + i * w + 12, y, L + (i + 1) * w - 12, y, 6));
    }
  })(955, 4, 3);

  // --- LOWER SECTION (y ~1030-1330): funnel toward single goal, asymmetric ---
  (function barrierRow(y, segCount, gapIndex) {
    const w = (R - L) / segCount;
    for (let i = 0; i < segCount; i++) {
      if (i === gapIndex) continue;
      walls.push(seg(L + i * w + 10, y, L + (i + 1) * w - 10, y, 6));
    }
  })(1040, 5, 2);

  bumpers.push(bump(300, 1110, 12));
  bumpers.push(bump(505, 1120, 12));
  bumpers.push(bump(400, 1160, 10));

  // funnel walls converge on the single goal gap — deliberately asymmetric
  walls.push(seg(80, 1195, GOAL_CX - GOAL_HALF_W, GOAL_FLOOR_Y, 10));
  walls.push(seg(722, 1180, GOAL_CX + GOAL_HALF_W, GOAL_FLOOR_Y, 10));

  bumpers.push(bump(363, 1258, 9));
  bumpers.push(bump(447, 1275, 8));

  return { walls, bumpers, startY, startXs };
}

const MAP = buildMap();

/* ---------------------------------------------------------
   4. STATE
   --------------------------------------------------------- */

let players = [];         // { name, color, hue }
let balls = [];           // active + finished balls
let particles = [];
let results = [];         // { rank, name, hue }
let raceState = "idle";   // idle | racing | done
let raceStartTime = 0;
let lastFrameTime = 0;
let accumulator = 0;
let staticCanvas = null;
let goalFlash = 0;        // 0..1 pulse boost when a ball scores

/* ---------------------------------------------------------
   5. AUDIO (Web Audio API, procedural, optional)
   --------------------------------------------------------- */

let audioCtx = null;
let soundOn = true;
let lastCollisionSoundAt = 0;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function tone(freq, dur, type, peak, delay) {
  if (!soundOn || !audioCtx) return;
  const t0 = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak == null ? 0.18 : peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxClick() { tone(760, 0.06, "square", 0.12); }
function sfxCollision(strength) {
  const now = performance.now();
  if (now - lastCollisionSoundAt < 55) return;
  lastCollisionSoundAt = now;
  const f = 180 + Math.min(strength, 1) * 220;
  tone(f, 0.05, "triangle", 0.10 * Math.min(1, 0.4 + strength));
}
function sfxGoal() {
  tone(660, 0.10, "sine", 0.16);
  tone(990, 0.12, "sine", 0.14, 0.05);
}
function sfxTimeout() { tone(340, 0.12, "triangle", 0.13); }
function sfxFinishAll() {
  tone(523, 0.14, "sine", 0.16, 0);
  tone(659, 0.14, "sine", 0.16, 0.09);
  tone(784, 0.22, "sine", 0.18, 0.18);
}

soundToggle.addEventListener("click", () => {
  ensureAudio();
  soundOn = !soundOn;
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  soundToggle.querySelector(".sound-label").textContent = soundOn ? "SOUND ON" : "SOUND OFF";
  if (soundOn) sfxClick();
});

/* ---------------------------------------------------------
   6. PLAYER FORM
   --------------------------------------------------------- */

function buildPlayerForm() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML =
      '<span class="player-num">' + String(i + 1).padStart(2, "0") + '</span>' +
      '<span class="player-swatch" data-swatch></span>' +
      '<input type="text" maxlength="' + MAX_NAME_LEN + '" placeholder="PLAYER ' + (i + 1) + '" data-player-input="' + i + '" />';
    frag.appendChild(row);
  }
  playersForm.appendChild(frag);
}
buildPlayerForm();

function readActivePlayers() {
  const inputs = playersForm.querySelectorAll("[data-player-input]");
  const list = [];
  inputs.forEach((input) => {
    const name = input.value.trim().slice(0, MAX_NAME_LEN);
    if (name.length > 0) list.push(name);
  });
  return list;
}

/* ---------------------------------------------------------
   7. COLOR GENERATION (even hue spread, randomized each race)
   --------------------------------------------------------- */

function generateColors(n) {
  const offset = Math.random() * 360;
  const order = [...Array(n).keys()];
  // shuffle draw order so hue assignment isn't tied to player index
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const hues = new Array(n);
  order.forEach((playerIdx, k) => {
    hues[playerIdx] = (offset + k * (360 / n)) % 360;
  });
  return hues.map((h) => ({
    hue: h,
    css: "hsl(" + h.toFixed(1) + ",95%,60%)",
    bright: "hsl(" + h.toFixed(1) + ",100%,78%)",
    dim: "hsl(" + h.toFixed(1) + ",90%,38%)",
  }));
}

/* ---------------------------------------------------------
   8. STATIC MAP RENDER (drawn once to an offscreen canvas)
   --------------------------------------------------------- */

function buildStaticCanvas() {
  const c = document.createElement("canvas");
  c.width = BOARD_W;
  c.height = BOARD_H;
  const g = c.getContext("2d");

  g.clearRect(0, 0, BOARD_W, BOARD_H);

  // faint vertical funnel guide lines (atmosphere only)
  g.save();
  g.strokeStyle = "rgba(51,243,230,0.05)";
  g.lineWidth = 1;
  for (let x = 110; x < BOARD_W; x += 110) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, BOARD_H);
    g.stroke();
  }
  g.restore();

  // walls — glowing white
  g.lineCap = "round";
  MAP.walls.forEach((w) => {
    g.save();
    g.shadowColor = "rgba(238,246,255,0.9)";
    g.shadowBlur = 14;
    g.strokeStyle = "rgba(238,246,255,0.95)";
    g.lineWidth = w.thickness;
    g.beginPath();
    g.moveTo(w.x1, w.y1);
    g.lineTo(w.x2, w.y2);
    g.stroke();
    g.restore();
  });
  // crisp inner core line for definition
  MAP.walls.forEach((w) => {
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = Math.max(1.4, w.thickness * 0.28);
    g.beginPath();
    g.moveTo(w.x1, w.y1);
    g.lineTo(w.x2, w.y2);
    g.stroke();
  });

  // bumpers — glowing cyan/teal
  MAP.bumpers.forEach((b) => {
    g.save();
    g.shadowColor = "rgba(51,243,230,0.95)";
    g.shadowBlur = 18;
    const grad = g.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 1, b.x, b.y, b.r);
    grad.addColorStop(0, "rgba(220,255,252,0.95)");
    grad.addColorStop(0.5, "rgba(51,243,230,0.85)");
    grad.addColorStop(1, "rgba(20,120,115,0.9)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(200,255,250,0.9)";
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  });

  // start pegs (visual marker row)
  MAP.startXs.forEach((x) => {
    g.save();
    g.shadowColor = "rgba(238,246,255,0.6)";
    g.shadowBlur = 8;
    g.fillStyle = "rgba(238,246,255,0.35)";
    g.beginPath();
    g.arc(x, MAP.startY - 34, 3.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
  g.save();
  g.strokeStyle = "rgba(238,246,255,0.12)";
  g.setLineDash([4, 6]);
  g.beginPath();
  g.moveTo(30, MAP.startY - 16);
  g.lineTo(770, MAP.startY - 16);
  g.stroke();
  g.restore();

  return c;
}

/* ---------------------------------------------------------
   9. RESIZE / CANVAS SETUP
   --------------------------------------------------------- */

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = BOARD_W * dpr;
  canvas.height = BOARD_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
setupCanvas();
staticCanvas = buildStaticCanvas();
window.addEventListener("resize", () => {
  // backing-store resolution only needs to track dpr; CSS handles fit-scaling
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== BOARD_W * dpr) setupCanvas();
});

/* ---------------------------------------------------------
   10. RACE LIFECYCLE
   --------------------------------------------------------- */

function setStatus(text, mode) {
  statusLine.textContent = text;
  statusLine.classList.remove("is-live", "is-done");
  if (mode) statusLine.classList.add(mode);
}

function clearResultsUI() {
  resultsList.innerHTML = "";
}

function addResultRow(rank, name, colorCss) {
  const empty = resultsList.querySelector(".results-empty");
  if (empty) empty.remove();
  const li = document.createElement("li");
  li.className = "result-row";
  li.style.color = colorCss;
  const ordinal = rank === 1 ? "1ST" : rank === 2 ? "2ND" : rank === 3 ? "3RD" : rank + "TH";
  li.innerHTML =
    '<span class="result-rank">' + ordinal + '</span>' +
    '<span class="result-swatch" style="background:' + colorCss + '"></span>' +
    '<span class="result-name"></span>';
  li.querySelector(".result-name").textContent = name;
  resultsList.appendChild(li);
}

function startRace() {
  if (raceState === "racing") return;
  ensureAudio();
  sfxClick();

  const names = readActivePlayers();
  if (names.length === 0) {
    formMsg.textContent = "Enter at least one player name";
    return;
  }
  formMsg.textContent = "";

  // 1-4: reset state
  balls = [];
  particles = [];
  results = [];
  clearResultsUI();

  // 5-7: create balls with fresh colors at start positions
  const colors = generateColors(names.length);
  players = names.map((name, i) => ({ name, color: colors[i] }));

  const swatches = playersForm.querySelectorAll("[data-swatch]");
  const inputs = playersForm.querySelectorAll("[data-player-input]");
  let activeIdx = 0;
  inputs.forEach((input, i) => {
    const row = input.closest(".player-row");
    const name = input.value.trim();
    if (name.length > 0) {
      const c = colors[activeIdx];
      row.classList.add("is-active");
      swatches[i].style.color = c.css;
      swatches[i].style.background = c.css;
      activeIdx++;
    } else {
      row.classList.remove("is-active");
      swatches[i].style.background = "";
      swatches[i].style.color = "";
    }
  });

  const startXs = MAP.startXs.slice(0, players.length);
  // shuffle start slots so registration order has no positional advantage
  for (let i = startXs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [startXs[i], startXs[j]] = [startXs[j], startXs[i]];
  }

  players.forEach((p, i) => {
    balls.push({
      playerIdx: i,
      x: startXs[i] + (Math.random() - 0.5) * 6,
      y: MAP.startY + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 40,
      vy: 0,
      r: BALL_R,
      color: p.color,
      finished: false,
      trail: [],
      restJitter: 0.94 + Math.random() * 0.12,
      progressY: MAP.startY,
      progressT: 0,
      sample: { x: startXs[i], y: MAP.startY, t: 0 },
    });
  });

  // 8: go
  raceState = "racing";
  raceStartTime = performance.now();
  accumulator = 0;
  lastFrameTime = 0;
  startBtn.disabled = true;
  setStatus(players.length + " BALLS RACING…", "is-live");
  raceTimerEl.textContent = "TIME: 00:00";
  raceTimerEl.classList.remove("is-urgent");
  raceTimerEl.classList.add("is-live");
}

function formatRaceTime(seconds) {
  const clamped = Math.max(0, Math.min(HARD_CAP_SECONDS, seconds));
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return "TIME: " + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function finishBall(ball, timedOut) {
  if (ball.finished) return;
  ball.finished = true;
  const rank = results.length + 1;
  const player = players[ball.playerIdx];
  results.push({ rank, name: player.name, color: player.color });
  addResultRow(rank, player.name, player.color.css);

  if (timedOut) {
    // ranked by current progress, not a goal arrival — effect plays where it is
    spawnBurst(ball.x, ball.y, player.color, 14);
    spawnFloatingRank(rank, player.color, ball.x, ball.y - 14);
    sfxTimeout();
  } else {
    spawnBurst(GOAL_CX, GOAL_FLOOR_Y + 14, player.color, 26);
    spawnFloatingRank(rank, player.color, GOAL_CX, GOAL_FLOOR_Y - 10);
    goalFlash = 1;
    sfxGoal();
  }

  const remaining = balls.some((b) => !b.finished);
  if (!remaining) {
    raceState = "done";
    startBtn.disabled = false;
    raceTimerEl.classList.remove("is-live", "is-urgent");
    setStatus(timedOut ? "TIME LIMIT — RACE COMPLETE" : "RACE COMPLETE", "is-done");
    sfxFinishAll();
  }
}

// Emergency failsafe — see physicsStep's HARD_CAP_SECONDS check. Ranks
// whoever hasn't finished by current progress (further down = better) rather
// than leaving the race running indefinitely.
function forceEndRace() {
  const remaining = balls.filter((b) => !b.finished);
  remaining.sort((a, b) => b.y - a.y);
  remaining.forEach((ball) => finishBall(ball, true));
}

startBtn.addEventListener("click", startRace);

/* ---------------------------------------------------------
   11. PARTICLES
   --------------------------------------------------------- */

function spawnBurst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    const a = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 220;
    particles.push({
      kind: "spark",
      x, y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd - 40,
      life: 0.4 + Math.random() * 0.4,
      age: 0,
      color: color.bright,
      r: 1.5 + Math.random() * 2,
    });
  }
}

function spawnCollisionSpark(x, y, color) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push({
    kind: "spark",
    x, y,
    vx: (Math.random() - 0.5) * 80,
    vy: (Math.random() - 0.5) * 80,
    life: 0.18,
    age: 0,
    color: color,
    r: 1.2 + Math.random(),
  });
}

function spawnFloatingRank(rank, color, x, y) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  const ordinal = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : rank + "th";
  particles.push({
    kind: "text",
    x: x + (Math.random() - 0.5) * 30,
    y: y,
    vx: 0,
    vy: -55,
    life: 1.1,
    age: 0,
    color: color.bright,
    text: ordinal,
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "spark") { p.vx *= 0.94; p.vy = p.vy * 0.94 + GRAVITY * 0.3 * dt; }
  }
}

/* ---------------------------------------------------------
   12. PHYSICS
   --------------------------------------------------------- */

function resolveWall(ball, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((ball.x - w.x1) * dx + (ball.y - w.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = w.x1 + dx * t, cy = w.y1 + dy * t;
  const nx0 = ball.x - cx, ny0 = ball.y - cy;
  const dist = Math.hypot(nx0, ny0) || 0.0001;
  const minDist = ball.r + w.thickness / 2;
  if (dist < minDist) {
    const nx = nx0 / dist, ny = ny0 / dist;
    const pen = minDist - dist;
    ball.x += nx * pen;
    ball.y += ny * pen;
    const vDotN = ball.vx * nx + ball.vy * ny;
    if (vDotN < 0) {
      const rest = WALL_REST * ball.restJitter;
      ball.vx -= (1 + rest) * vDotN * nx;
      ball.vy -= (1 + rest) * vDotN * ny;
      // tangential jitter: a ball hitting dead-center in a symmetric V-notch
      // has zero sideways force otherwise and bounces in place indefinitely
      ball.vx += (Math.random() - 0.5) * 38;
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > 40) {
        sfxCollision(Math.min(1, speed / 500));
        if (Math.random() < 0.5) spawnCollisionSpark(cx, cy, ball.color.css);
      }
    }
  }
}

function resolveBumper(ball, b) {
  const nx0 = ball.x - b.x, ny0 = ball.y - b.y;
  const dist = Math.hypot(nx0, ny0) || 0.0001;
  const minDist = ball.r + b.r;
  if (dist < minDist) {
    const nx = nx0 / dist, ny = ny0 / dist;
    const pen = minDist - dist;
    ball.x += nx * pen;
    ball.y += ny * pen;
    const vDotN = ball.vx * nx + ball.vy * ny;
    if (vDotN < 0) {
      const rest = BUMPER_REST * ball.restJitter;
      ball.vx -= (1 + rest) * vDotN * nx;
      ball.vy -= (1 + rest) * vDotN * ny;
      ball.vx += (Math.random() - 0.5) * 38;
    } else {
      // graze — still add a little pep so balls don't hug bumpers
      ball.vx += nx * 20;
      ball.vy += ny * 20;
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    sfxCollision(Math.min(1, speed / 500));
    spawnCollisionSpark(b.x + nx * b.r, b.y + ny * b.r, "rgba(180,255,250,0.9)");
  }
}

function resolveBallBall(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const minDist = a.r + b.r;
  if (dist < minDist) {
    const nx = dx / dist, ny = dy / dist;
    const pen = (minDist - dist) / 2;
    a.x -= nx * pen; a.y -= ny * pen;
    b.x += nx * pen; b.y += ny * pen;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const rel = rvx * nx + rvy * ny;
    if (rel < 0) {
      const imp = -(1 + BALL_REST) * rel / 2;
      a.vx -= imp * nx; a.vy -= imp * ny;
      b.vx += imp * nx; b.vy += imp * ny;
      // several balls converging on the single goal throat at once can lock
      // into a stable "arch" (a real granular-flow effect) without this
      const jx = (Math.random() - 0.5) * 24;
      a.vx -= jx; b.vx += jx;
    }
  }
}

function physicsStep(dt) {
  for (const ball of balls) {
    if (ball.finished) continue;

    ball.vy += GRAVITY * dt;
    ball.vx *= AIR_DRAG;
    ball.vy *= AIR_DRAG;

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      ball.vx *= s; ball.vy *= s;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    for (const w of MAP.walls) resolveWall(ball, w);
    for (const b of MAP.bumpers) resolveBumper(ball, b);

    // hard safety clamp — balls must never escape the playfield
    if (ball.x < ball.r + 30) { ball.x = ball.r + 30; ball.vx = Math.abs(ball.vx) * 0.4; }
    if (ball.x > BOARD_W - ball.r - 30) { ball.x = BOARD_W - ball.r - 30; ball.vx = -Math.abs(ball.vx) * 0.4; }
    if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy) * 0.4; }

    // stuck-ball safety: only trips when a ball has made almost no net
    // downward progress over a several-second window — a ball that's
    // continuously moving down (even while bouncing a lot) is left alone.
    // The impulse is a firm, controlled kick, never a teleport.
    ball.progressT += dt;
    if (ball.progressT >= PROGRESS_WINDOW) {
      const delta = ball.y - ball.progressY;
      if (delta < MIN_PROGRESS_PX && ball.y < GOAL_FLOOR_Y - 20) {
        ball.vy += 480;
        ball.vx += (Math.random() - 0.5) * 360;
      }
      ball.progressY = ball.y;
      ball.progressT = 0;
    }

    // trail sampling
    ball.sample.t += dt;
    if (ball.sample.t > 0.02) {
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 9) ball.trail.shift();
      ball.sample.t = 0;
    }

    // goal detection
    if (!ball.finished && ball.y > GOAL_DONE_Y) {
      finishBall(ball);
    } else if (!ball.finished && ball.y > BOARD_H + 60) {
      // absolute fallback safety net — should be unreachable given geometry
      finishBall(ball);
    }
  }

  // ball vs ball
  for (let i = 0; i < balls.length; i++) {
    if (balls[i].finished) continue;
    for (let j = i + 1; j < balls.length; j++) {
      if (balls[j].finished) continue;
      resolveBallBall(balls[i], balls[j]);
    }
  }
}

/* ---------------------------------------------------------
   13. RENDER
   --------------------------------------------------------- */

function drawGoal(t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const flashBoost = goalFlash;
  const r = 30 + pulse * 6 + flashBoost * 14;

  ctx.save();
  ctx.translate(GOAL_CX, GOAL_FLOOR_Y + 6);

  const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(51,243,230," + (0.75 + flashBoost * 0.2) + ")");
  grad.addColorStop(0.7, "rgba(255,63,216," + (0.35 + flashBoost * 0.2) + ")");
  grad.addColorStop(1, "rgba(255,63,216,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, GOAL_HALF_W + 6, r, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(238,246,255,0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(51,243,230,0.9)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.ellipse(0, 0, GOAL_HALF_W, 14 + pulse * 3, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawBall(ball) {
  // trail
  for (let i = 0; i < ball.trail.length; i++) {
    const p = ball.trail[i];
    const a = (i + 1) / (ball.trail.length + 1);
    ctx.beginPath();
    ctx.fillStyle = ball.color.dim;
    ctx.globalAlpha = a * 0.35;
    ctx.arc(p.x, p.y, ball.r * (0.4 + a * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.shadowColor = ball.color.css;
  ctx.shadowBlur = 16;
  const grad = ctx.createRadialGradient(
    ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, 0.5,
    ball.x, ball.y, ball.r
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.35, ball.color.bright);
  grad.addColorStop(1, ball.color.dim);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    const life = 1 - p.age / p.life;
    if (p.kind === "spark") {
      ctx.globalAlpha = Math.max(0, life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "text") {
      ctx.globalAlpha = Math.max(0, life);
      ctx.fillStyle = p.color;
      ctx.font = "700 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillText(p.text, p.x, p.y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function render(t) {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.drawImage(staticCanvas, 0, 0);

  drawGoal(t);
  for (const ball of balls) if (!ball.finished) drawBall(ball);
  drawParticles();

  if (goalFlash > 0) goalFlash = Math.max(0, goalFlash - 0.04);
}

/* ---------------------------------------------------------
   14. MAIN LOOP
   --------------------------------------------------------- */

function loop(now) {
  const t = now / 1000;
  if (!lastFrameTime) lastFrameTime = now;
  let frameDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  frameDt = Math.min(frameDt, 0.05);

  if (raceState === "racing") {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      physicsStep(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }

    const elapsed = (now - raceStartTime) / 1000;
    raceTimerEl.textContent = formatRaceTime(elapsed);
    raceTimerEl.classList.toggle("is-urgent", elapsed >= HARD_CAP_SECONDS - 15);

    // hard failsafe — see forceEndRace(). The race must never run forever.
    if (elapsed >= HARD_CAP_SECONDS && raceState === "racing") {
      forceEndRace();
    }
  }

  updateParticles(frameDt);
  render(t);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

/* ---------------------------------------------------------
   15. INIT UI STATE
   --------------------------------------------------------- */

setStatus("ENTER PLAYERS AND PRESS START");
