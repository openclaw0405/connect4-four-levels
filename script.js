/* ── Constants ── */
const ROWS = 6, COLS = 7;
const HUMAN = 1, AI = 2;

/**
 * AI difficulty per level:
 *  1 – Rookie   : pure random
 *  2 – Beginner : blocks obvious wins only (depth 2)
 *  3 – Skilled  : minimax depth 4
 *  4 – Expert   : minimax depth 7 + opening book + double-threat heuristics
 */
const LEVEL_CONFIG = [
  { name: 'Rookie',   dotClass: 'd1', desc: 'Rookie AI — plays randomly',                   depth: 0 },
  { name: 'Beginner', dotClass: 'd2', desc: 'Beginner AI — blocks obvious threats',          depth: 2 },
  { name: 'Skilled',  dotClass: 'd3', desc: 'Skilled AI — thinks 4 moves ahead',             depth: 4 },
  { name: 'Expert',   dotClass: 'd4', desc: 'Expert AI — opening book + near-perfect play',  depth: 7 },
];

/* ══════════════════════════════════════
   RECORDS  (localStorage)
══════════════════════════════════════ */
const RECORDS_KEY = 'c4_records_v1';

function defaultRecords() {
  return { currentStreak: 0, maxStreak: 0, bestClearMs: null };
}

function loadRecords() {
  try { return { ...defaultRecords(), ...JSON.parse(localStorage.getItem(RECORDS_KEY)) }; }
  catch(e) { return defaultRecords(); }
}

function saveRecords(r) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch(e) {}
}

let records = loadRecords();
let clearStartTime = null; // set on first human move at level 0

/* ── State ── */
let level = 0;
let wins = 0;
let board = makeBoard();
let gameOver = false;
let busy = false;

/* ── DOM refs ── */
const boardEl      = document.getElementById('board');
const statusEl     = document.getElementById('status');
const levelEl      = document.getElementById('levelLabel');
const scoreEl      = document.getElementById('score');
const diffDot      = document.getElementById('diffDot');
const diffText     = document.getElementById('diffText');
const restartBtn   = document.getElementById('restartBtn');
const resetAllBtn  = document.getElementById('resetAllBtn');
const overlay      = document.getElementById('overlay');
const overlayIcon  = document.getElementById('overlayIcon');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText  = document.getElementById('overlayText');
const overlayBtn   = document.getElementById('overlayBtn');
const recStreak    = document.getElementById('recStreak');
const recMaxStreak = document.getElementById('recMaxStreak');
const recBestTime  = document.getElementById('recBestTime');

/* ══════════════════════════════════════
   WEB AUDIO  (oscillator-based, no external assets)
══════════════════════════════════════ */
let audioCtx = null;
let soundEnabled = true;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

async function unlockAudio() {
  try {
    const ctx = getAudio();
    if (ctx.state === 'suspended') await ctx.resume();
  } catch(e) {}
}

function playDrop() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudio();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.setValueAtTime(540, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(175, ctx.currentTime + 0.13);
    g.gain.setValueAtTime(0.22, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

function playWin() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudio();
    if (ctx.state === 'suspended') ctx.resume();
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.start(t); osc.stop(t + 0.42);
    });
  } catch(e) {}
}

/* ══════════════════════════════════════
   BOARD LOGIC
══════════════════════════════════════ */
function makeBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function clone(b) { return b.map(r => r.slice()); }

function availableRow(b, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (b[r][col] === 0) return r;
  return -1;
}

function drop(b, col, player) {
  const r = availableRow(b, col);
  if (r >= 0) b[r][col] = player;
  return r;
}

function validCols(b) {
  return [...Array(COLS).keys()].filter(c => b[0][c] === 0);
}

function isDraw(b) { return b[0].every(v => v !== 0); }

function findWin(b, player) {
  const check = (r, c, dr, dc) => {
    for (let i = 0; i < 4; i++) {
      const nr = r + i * dr, nc = c + i * dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || b[nr][nc] !== player) return null;
    }
    return [[r,c],[r+dr,c+dc],[r+2*dr,c+2*dc],[r+3*dr,c+3*dc]];
  };
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of dirs) { const res = check(r, c, dr, dc); if (res) return res; }
  return null;
}

function isWin(b, player) { return findWin(b, player) !== null; }

/* ══════════════════════════════════════
   AI — EVALUATION
══════════════════════════════════════ */
function scoreWindow(w, player) {
  const opp = player === AI ? HUMAN : AI;
  const pCount = w.filter(x => x === player).length;
  const oCount = w.filter(x => x === opp).length;
  const eCount = w.filter(x => x === 0).length;

  if (pCount === 4) return 10000;
  if (oCount === 4) return -10000;
  if (pCount === 3 && eCount === 1) return 8;
  if (pCount === 2 && eCount === 2) return 2;
  if (oCount === 3 && eCount === 1) return -7;
  if (oCount === 2 && eCount === 2) return -2;
  return 0;
}

function evaluate(b, player) {
  let score = 0;
  const cx = Math.floor(COLS / 2);
  // Centre & near-centre column preference
  for (let r = 0; r < ROWS; r++) {
    if (b[r][cx] === player) score += 4;
    if (cx > 0 && (b[r][cx-1] === player || b[r][cx+1] === player)) score += 2;
  }
  // Horizontal
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([b[r][c],b[r][c+1],b[r][c+2],b[r][c+3]], player);
  // Vertical
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      score += scoreWindow([b[r][c],b[r+1][c],b[r+2][c],b[r+3][c]], player);
  // Diagonal ↘
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([b[r][c],b[r+1][c+1],b[r+2][c+2],b[r+3][c+3]], player);
  // Diagonal ↗
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([b[r][c],b[r-1][c+1],b[r-2][c+2],b[r-3][c+3]], player);
  return score;
}

/* ── L4: count open 3-in-a-row threats (used for fork detection) ── */
function countThreats(b, player) {
  let n = 0;
  const chk = w => {
    if (w.filter(x => x === player).length === 3 && w.filter(x => x === 0).length === 1) n++;
  };
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++) chk([b[r][c],b[r][c+1],b[r][c+2],b[r][c+3]]);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS-4; r++) chk([b[r][c],b[r+1][c],b[r+2][c],b[r+3][c]]);
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++) chk([b[r][c],b[r+1][c+1],b[r+2][c+2],b[r+3][c+3]]);
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++) chk([b[r][c],b[r-1][c+1],b[r-2][c+2],b[r-3][c+3]]);
  return n;
}

function createsFork(b, col, player) {
  const nb = clone(b); drop(nb, col, player);
  return countThreats(nb, player) >= 2;
}

/* ══════════════════════════════════════
   AI — MINIMAX WITH ALPHA-BETA
══════════════════════════════════════ */
function minimax(b, depth, alpha, beta, maximizing) {
  if (isWin(b, AI))    return { score: 100000 + depth };
  if (isWin(b, HUMAN)) return { score: -100000 - depth };
  const cols = validCols(b);
  if (cols.length === 0 || depth === 0) return { score: evaluate(b, AI) };

  // Prefer centre columns for move ordering (improves pruning)
  const ordered = [...cols].sort((a, b2) => Math.abs(a - 3) - Math.abs(b2 - 3));
  let bestCol = ordered[0];

  if (maximizing) {
    let best = -Infinity;
    for (const c of ordered) {
      const nb = clone(b); drop(nb, c, AI);
      const { score } = minimax(nb, depth - 1, alpha, beta, false);
      if (score > best) { best = score; bestCol = c; }
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return { score: best, col: bestCol };
  } else {
    let best = Infinity;
    for (const c of ordered) {
      const nb = clone(b); drop(nb, c, HUMAN);
      const { score } = minimax(nb, depth - 1, alpha, beta, true);
      if (score < best) { best = score; bestCol = c; }
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return { score: best, col: bestCol };
  }
}

/* ══════════════════════════════════════
   AI — LEVEL 4 OPENING BOOK
   Preferred column sequences by AI move index (0-based).
   Applied only when total pieces on board ≤ 6.
══════════════════════════════════════ */
const OPENING_PREF = [
  [3],             // AI's 1st move: always centre
  [3, 2, 4],       // AI's 2nd move: centre or adjacent
  [3, 2, 4, 1, 5], // AI's 3rd move: central area
];

function openingMove() {
  const total = board.flat().filter(v => v !== 0).length;
  if (total > 6) return null;
  const aiMoves = board.flat().filter(v => v === AI).length;
  if (aiMoves >= OPENING_PREF.length) return null;
  for (const c of OPENING_PREF[aiMoves]) {
    if (availableRow(board, c) >= 0) return c;
  }
  return null;
}

/* ══════════════════════════════════════
   AI — PICK MOVE BY DIFFICULTY
══════════════════════════════════════ */
function pickMove() {
  const cfg = LEVEL_CONFIG[level];
  const cols = validCols(board);

  // Level 1: random
  if (cfg.depth === 0) return cols[Math.floor(Math.random() * cols.length)];

  // Levels 2-4: always snap-win or snap-block
  for (const c of cols) { const nb = clone(board); drop(nb, c, AI);    if (isWin(nb, AI))    return c; }
  for (const c of cols) { const nb = clone(board); drop(nb, c, HUMAN); if (isWin(nb, HUMAN)) return c; }

  // Level 2: random among remaining
  if (cfg.depth === 2) return cols[Math.floor(Math.random() * cols.length)];

  // Level 4 extra heuristics (before full minimax)
  if (level === 3) {
    // 1. Opening book
    const ob = openingMove();
    if (ob !== null) return ob;

    // 2. Fork offense: create a double threat
    for (const c of cols) if (createsFork(board, c, AI))    return c;

    // 3. Fork defense: block opponent's double threat
    for (const c of cols) if (createsFork(board, c, HUMAN)) return c;
  }

  // Levels 3-4: full minimax
  return minimax(board, cfg.depth, -Infinity, Infinity, true).col;
}

/* ══════════════════════════════════════
   RECORDS UI
══════════════════════════════════════ */
function renderRecords() {
  recStreak.textContent    = String(records.currentStreak);
  recMaxStreak.textContent = String(records.maxStreak);
  if (records.bestClearMs !== null) {
    const s = Math.floor(records.bestClearMs / 1000);
    const m = Math.floor(s / 60);
    recBestTime.textContent = m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  } else {
    recBestTime.textContent = '—';
  }
}

/* ══════════════════════════════════════
   RENDERING
══════════════════════════════════════ */
function render(winCells = null) {
  const winSet = winCells
    ? new Set(winCells.map(([r, c]) => r * COLS + c))
    : new Set();

  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('button');
      const val = board[r][c];
      cell.className = 'cell' +
        (val === HUMAN ? ' red' : val === AI ? ' yellow' : '');
      if (winSet.has(r * COLS + c)) cell.classList.add('win-flash');
      if (val !== 0) cell.classList.add('taken');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label',
        `Column ${c + 1}${val === HUMAN ? ', you' : val === AI ? ', AI' : ''}`);
      cell.onclick = () => humanMove(c);
      boardEl.appendChild(cell);
    }
  }
  levelEl.textContent = `${level + 1} / 4`;
  scoreEl.textContent = String(wins);
}

function updateHUD() {
  const cfg = LEVEL_CONFIG[level];
  diffDot.className = `diff-dot ${cfg.dotClass}`;
  diffText.textContent = cfg.desc;

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`);
    el.classList.remove('active', 'done');
    if (i - 1 < level)   el.classList.add('done');
    if (i - 1 === level) el.classList.add('active');
    const line = document.getElementById(`line-${i}`);
    if (line) line.classList.toggle('done', i - 1 < level);
  }
}

/* ══════════════════════════════════════
   GAME FLOW
══════════════════════════════════════ */
function humanMove(col) {
  if (gameOver || busy) return;
  const r = availableRow(board, col);
  if (r < 0) return;

  // Start full-clear timer on very first move of a fresh run at level 0
  if (level === 0 && clearStartTime === null) clearStartTime = Date.now();

  drop(board, col, HUMAN);
  playDrop();
  render();
  const newCell = boardEl.children[r * COLS + col];
  newCell.classList.add('drop-in');

  const win = findWin(board, HUMAN);
  if (win) { render(win); playWin(); return endGame('human'); }
  if (isDraw(board)) return endGame('draw');

  busy = true;
  statusEl.textContent = 'AI thinking…';
  setTimeout(doAIMove, 360);
}

function doAIMove() {
  const col = pickMove();
  const r = drop(board, col, AI);
  playDrop();
  render();
  const newCell = boardEl.children[r * COLS + col];
  newCell.classList.add('drop-in');

  const win = findWin(board, AI);
  if (win) { render(win); busy = false; return endGame('ai'); }
  if (isDraw(board)) { busy = false; return endGame('draw'); }

  busy = false;
  statusEl.textContent = 'Your turn';
}

function endGame(result) {
  gameOver = true;

  if (result === 'draw') {
    records.currentStreak = 0;
    saveRecords(records); renderRecords();
    statusEl.textContent = 'Draw!';
    showOverlay('🤝', "It's a Draw!", 'Nobody wins this round. Try again!', 'Play Again', resetLevel);
    return;
  }

  if (result === 'ai') {
    records.currentStreak = 0;
    clearStartTime = null; // reset timer on loss
    saveRecords(records); renderRecords();
    statusEl.textContent = 'AI wins!';
    showOverlay('😵', 'AI Wins!',
      `The ${LEVEL_CONFIG[level].name} AI beat you! Give it another shot.`,
      'Try Again', resetLevel);
    return;
  }

  // Human wins
  wins++;
  records.currentStreak++;
  if (records.currentStreak > records.maxStreak) records.maxStreak = records.currentStreak;
  saveRecords(records); renderRecords();
  statusEl.textContent = 'You win!';

  if (level < 3) {
    showOverlay('🎉', `Level ${level + 1} Cleared!`,
      `Great play! Ready for Level ${level + 2}: ${LEVEL_CONFIG[level + 1].name}?`,
      'Next Level', () => { level++; updateHUD(); resetLevel(); });
  } else {
    // Champion — record full-clear time
    if (clearStartTime !== null) {
      const elapsed = Date.now() - clearStartTime;
      if (records.bestClearMs === null || elapsed < records.bestClearMs) {
        records.bestClearMs = elapsed;
      }
    }
    clearStartTime = null;
    saveRecords(records); renderRecords();

    showOverlay('🏆', 'Champion!',
      `You beat all 4 levels! Streak: ${records.currentStreak} 🔥`,
      'Play Again', () => { level = 0; wins = 0; updateHUD(); resetLevel(); });
  }
}

/* ══════════════════════════════════════
   OVERLAY MODAL
══════════════════════════════════════ */
function showOverlay(icon, title, text, btnLabel, cb) {
  overlayIcon.textContent  = icon;
  overlayTitle.textContent = title;
  overlayText.textContent  = text;
  overlayBtn.textContent   = btnLabel;
  overlay.classList.remove('hidden');
  overlayBtn.onclick = () => { overlay.classList.add('hidden'); cb(); };
}

/* ══════════════════════════════════════
   RESET
══════════════════════════════════════ */
function resetLevel() {
  board = makeBoard();
  gameOver = false;
  busy = false;
  statusEl.textContent = 'Your turn';
  render();
}

/* ══════════════════════════════════════
   ARROW BUTTONS
══════════════════════════════════════ */
document.querySelectorAll('.arrow-btn').forEach(btn => {
  btn.addEventListener('click', () => humanMove(Number(btn.dataset.col)));
});

/* ══════════════════════════════════════
   CONTROLS
══════════════════════════════════════ */
restartBtn.onclick = resetLevel;
resetAllBtn.onclick = () => {
  level = 0; wins = 0;
  clearStartTime = null;
  records = defaultRecords();
  saveRecords(records); renderRecords();
  updateHUD();
  resetLevel();
};

/* ── Init ── */
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('touchstart', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

updateHUD();
resetLevel();
renderRecords();
