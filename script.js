'use strict';

// ── Config (populated from setup screen) ───────────────────────────────────
const config = {
  rounds:   30,
  endless:  false,
  duration: 60,  // seconds per round
  sfx:      true,
  ticks:    true,
  gif:      true,
};

// ── Players ────────────────────────────────────────────────────────────────
let players = [];       // string[] — names from setup
let playerState = [];   // { name, drinks }[] — live game state

// ── State ──────────────────────────────────────────────────────────────────
let currentRound  = 1;
let secondsLeft   = config.duration;
let running       = false;
let intervalId    = null;
let tickStart     = null;
let audioCtx      = null;
let audioUnlocked = false;
let wakeLock      = null;
let totalShots    = 0;       // total completed rounds this session — for animation timing

// Round-end animation timing
const ALERT_MS         = 3000;   // GIF/flash visible window
const POUR_MS          = 3800;   // pour animation length (must match drinkViz CSS)
const BEER_COMPLETE_MS = 4200;   // chug + fly-to-shelf when 8th shot lands (after pour)
const SHOTS_PER_BEER   = 8;

// Shared state accessors for sub-modules (drinkViz.js)
window.BeerHour = {
  getAudioCtx: () => audioCtx,
  getConfig:   () => config,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
// Setup screen
const setupScreen     = document.getElementById('setup-screen');
const appDiv          = document.getElementById('app');
const roundsSlider    = document.getElementById('rounds-slider');
const roundsValueBadge= document.getElementById('rounds-value');
const sfxToggle       = document.getElementById('sfx-toggle');
const ticksToggle     = document.getElementById('ticks-toggle');
const gifToggle       = document.getElementById('gif-toggle');
const launchBtn       = document.getElementById('launch-btn');
const playerNameInput = document.getElementById('player-name-input');
const addPlayerBtn    = document.getElementById('add-player-btn');
const playerSetupList = document.getElementById('player-setup-list');

// Game screen
const roundNumber   = document.getElementById('round-number');
const roundTotal    = document.getElementById('round-total');
const timerDisplay  = document.getElementById('timer-display');
const timerRing     = document.getElementById('timer-ring');
const drinkAlert    = document.getElementById('drink-alert');
const drinkGif      = document.getElementById('drink-gif');
const progressBar   = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const ringProgress  = document.getElementById('ring-progress');
const startBtn      = document.getElementById('start-btn');
const pauseBtn      = document.getElementById('pause-btn');
const skipBtn       = document.getElementById('skip-btn');
const resetBtn      = document.getElementById('reset-btn');
const soundNotice   = document.getElementById('sound-notice');
const playerBoard   = document.getElementById('player-board');
const playerCards   = document.getElementById('player-cards');
const gameOverPanel = document.getElementById('game-over');
const gameOverMsg   = document.getElementById('game-over-msg');
const playAgainBtn  = document.getElementById('play-again-btn');
const backBtn       = document.getElementById('back-btn');
const drinkSound    = document.getElementById('drink-sound');
const drinkSound2   = document.getElementById('drink-sound-2');

// ring geometry: circumference = 2π × 88 ≈ 553
const RING_CIRC = 2 * Math.PI * 88;

// ── Setup Screen ───────────────────────────────────────────────────────────

// Rounds — preset buttons sync with slider
const roundPresetBtns = document.querySelectorAll('#round-presets .preset-btn');
roundPresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.endless) {
      config.endless = true;
      config.rounds = Infinity;
      roundPresetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roundsValueBadge.textContent = '∞';
      roundsSlider.disabled = true;
    } else {
      const val = parseInt(btn.dataset.value, 10);
      config.endless = false;
      syncRoundPresets(val);
      roundsSlider.value = Math.min(Math.max(val, 5), 120);
      roundsSlider.disabled = false;
      config.rounds = val;
    }
  });
});

roundsSlider.addEventListener('input', () => {
  const val = parseInt(roundsSlider.value, 10);
  config.endless = false;
  syncRoundPresets(val);
  config.rounds = val;
});

function syncRoundPresets(val) {
  roundsValueBadge.textContent = val;
  roundPresetBtns.forEach(b => {
    b.classList.toggle('active', !b.dataset.endless && parseInt(b.dataset.value, 10) === val);
  });
}

// Duration — preset buttons only
const durationPresetBtns = document.querySelectorAll('#duration-presets .preset-btn');
durationPresetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    durationPresetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    config.duration = parseInt(btn.dataset.value, 10);
  });
});

// Players — setup
function addPlayer(name) {
  name = name.trim();
  if (!name) return;
  players.push(name);
  playerNameInput.value = '';
  renderPlayerSetupList();
}

function removePlayer(index) {
  players.splice(index, 1);
  renderPlayerSetupList();
}

function renderPlayerSetupList() {
  playerSetupList.innerHTML = '';
  players.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'player-setup-item';
    li.innerHTML = `
      <span class="player-setup-name">${escapeHtml(name)}</span>
      <button class="btn-remove-player" aria-label="Remove ${escapeHtml(name)}">✕</button>
    `;
    li.querySelector('.btn-remove-player').addEventListener('click', () => removePlayer(i));
    playerSetupList.appendChild(li);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

addPlayerBtn.addEventListener('click', () => addPlayer(playerNameInput.value));
playerNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer(playerNameInput.value);
});

// Launch button
launchBtn.addEventListener('click', () => {
  config.sfx   = sfxToggle.checked;
  config.ticks = ticksToggle.checked;
  config.gif   = gifToggle.checked;
  launchGame();
});

function launchGame() {
  currentRound = 1;
  secondsLeft  = config.duration;

  roundTotal.textContent = config.endless ? '' : `/ ${config.rounds}`;
  gameOverMsg.innerHTML  = config.endless
    ? `Session complete.<br/>Hope everyone played fair!`
    : `${config.rounds} rounds complete.<br/>Hope everyone played fair!`;

  // Init player state
  playerState = players.map(name => ({ name, drinks: 0 }));
  renderPlayerBoard();
  playerBoard.classList.toggle('hidden', playerState.length === 0);

  updateRoundDisplay();
  updateTimerDisplay();

  soundNotice.classList.toggle('hidden', audioUnlocked);

  setupScreen.classList.add('hidden');
  appDiv.classList.remove('hidden');

  if (typeof drinkViz !== 'undefined') drinkViz.init();
}

function renderPlayerBoard() {
  playerCards.innerHTML = '';
  playerState.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <span class="player-card-name">${escapeHtml(p.name)}</span>
      <button class="btn-remove-drink" aria-label="Remove drink for ${escapeHtml(p.name)}">−</button>
      <span class="player-card-count" id="drink-count-${i}">${p.drinks}</span>
      <button class="btn-add-drink" aria-label="Add drink for ${escapeHtml(p.name)}">+</button>
      <button class="btn-clear-debt" aria-label="Clear debt for ${escapeHtml(p.name)}">Clear</button>
    `;
    card.querySelector('.btn-add-drink').addEventListener('click', () => {
      playerState[i].drinks++;
      document.getElementById(`drink-count-${i}`).textContent = playerState[i].drinks;
    });
    card.querySelector('.btn-remove-drink').addEventListener('click', () => {
      if (playerState[i].drinks > 0) {
        playerState[i].drinks--;
        document.getElementById(`drink-count-${i}`).textContent = playerState[i].drinks;
      }
    });
    card.querySelector('.btn-clear-debt').addEventListener('click', () => {
      playerState[i].drinks = 0;
      document.getElementById(`drink-count-${i}`).textContent = 0;
    });
    playerCards.appendChild(card);
  });
}

// Back button → return to setup
backBtn.addEventListener('click', () => {
  if (running) pauseTimer();
  appDiv.classList.add('hidden');
  gameOverPanel.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  fullReset();
});

// Play Again → return to setup
playAgainBtn.addEventListener('click', () => {
  appDiv.classList.add('hidden');
  gameOverPanel.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  fullReset();
});

// ── Audio ──────────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioUnlocked = true;
  } catch (_) {
    audioUnlocked = false;
  }
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, startOffset, dur, gainVal = 0.5, type = 'sine') {
  if (!audioCtx || !audioUnlocked || !config.sfx) return;
  resumeAudio();

  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.type = type;
  osc.frequency.value = freq;

  const t = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(gainVal, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Soft tick for last 5 seconds */
function playCountdownTick() {
  if (!config.sfx || !config.ticks) return;
  playTone(660, 0, 0.07, 0.25);
}

/** Louder, higher tick for the final second */
function playFinalTick() {
  if (!config.sfx || !config.ticks) return;
  playTone(1100, 0, 0.1, 0.45);
}

/** Big 3-tone horn for "drink!" moment */
function playDrinkHorn() {
  if (!config.sfx) return;
  resumeAudio();
  [
    { freq: 880,  start: 0,    dur: 0.14, gain: 0.65 },
    { freq: 1100, start: 0.17, dur: 0.14, gain: 0.65 },
    { freq: 1320, start: 0.34, dur: 0.32, gain: 0.75 },
  ].forEach(({ freq, start, dur, gain }) => playTone(freq, start, dur, gain));
}

/** Ascending fanfare for game over */
function playGameOverFanfare() {
  if (!config.sfx) return;
  resumeAudio();
  [
    { freq: 523,  start: 0,    dur: 0.14 },
    { freq: 659,  start: 0.18, dur: 0.14 },
    { freq: 784,  start: 0.36, dur: 0.14 },
    { freq: 1047, start: 0.55, dur: 0.45 },
  ].forEach(({ freq, start, dur }) => playTone(freq, start, dur, 0.5));
}

// ── Drink sounds ───────────────────────────────────────────────────────────
// Both play simultaneously when the DRINK alert fires.
// Silently no-ops if either file is missing.
drinkSound.src  = 'assets/drink.mp3';
drinkSound2.src = 'assets/drink2.mp3';

function playDrinkSound() {
  drinkSound.currentTime  = 0;
  drinkSound2.currentTime = 0;
  drinkSound.play().catch(() => {});
  drinkSound2.play().catch(() => {});
}

// ── Screen wake lock ───────────────────────────────────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) { /* denied or unavailable – ignore */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (running && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(secondsLeft);

  const fraction = secondsLeft / config.duration;
  ringProgress.style.strokeDashoffset = RING_CIRC * (1 - fraction);

  if (fraction > 0.5) {
    ringProgress.style.stroke = '#f5a623';
    timerRing.classList.remove('urgent');
  } else if (fraction > 0.15) {
    ringProgress.style.stroke = '#ff8c00';
    timerRing.classList.remove('urgent');
  } else {
    ringProgress.style.stroke = '#ff4757';
    timerRing.classList.add('urgent');
  }
}

function updateRoundDisplay() {
  roundNumber.textContent = currentRound;
  const completed = currentRound - 1;
  if (config.endless) {
    progressBar.style.setProperty('--progress', '0%');
    progressLabel.textContent = `${completed} rounds`;
  } else {
    const pct = (completed / config.rounds) * 100;
    progressBar.style.setProperty('--progress', `${pct}%`);
    progressLabel.textContent = `${completed} / ${config.rounds} rounds`;
  }
}

function showDrinkAlert() {
  drinkAlert.classList.remove('hidden');
  drinkGif.style.display = config.gif ? 'block' : 'none';
  timerRing.classList.remove('urgent');

  playDrinkSound();

  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  document.body.classList.remove('flash-alert');
  void document.body.offsetWidth;
  document.body.classList.add('flash-alert');

  setTimeout(() => drinkAlert.classList.add('hidden'), ALERT_MS);
}

// ── Timer core ─────────────────────────────────────────────────────────────
/**
 * Drift-corrected tick: measures actual elapsed ms so setInterval jitter
 * doesn't accumulate over a 60-round session.
 */
function tick() {
  const now     = performance.now();
  const elapsed = Math.floor((now - tickStart) / 1000);
  if (elapsed < 1) return;

  tickStart   += elapsed * 1000;
  secondsLeft -= elapsed;

  if (secondsLeft <= 0) {
    secondsLeft = 0;
    updateTimerDisplay();
    onRoundEnd();
    return;
  }

  // Countdown sound cues for the last 5 seconds
  if (secondsLeft <= 5) {
    if (secondsLeft === 1) {
      playFinalTick();
    } else {
      playCountdownTick();
    }
  }

  updateTimerDisplay();
}

function onRoundEnd() {
  playDrinkHorn();
  showDrinkAlert();

  totalShots++;
  const willCompleteBeer = totalShots % SHOTS_PER_BEER === 0;

  // Defer the pour animation until AFTER the GIF/alert hides — otherwise
  // it plays underneath the fullscreen overlay and the user never sees it.
  setTimeout(() => {
    if (typeof drinkViz !== 'undefined') drinkViz.onShot();
  }, ALERT_MS);

  if (!config.endless && currentRound >= config.rounds) {
    endGame(willCompleteBeer);
    return;
  }

  currentRound++;
  secondsLeft = config.duration;
  updateRoundDisplay();
  updateTimerDisplay();
}

function startTimer() {
  if (running) return;
  initAudio();
  resumeAudio();
  requestWakeLock();

  running   = true;
  tickStart = performance.now();
  intervalId = setInterval(tick, 250);

  startBtn.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  skipBtn.classList.remove('hidden');
  resetBtn.classList.remove('hidden');
  soundNotice.classList.add('hidden');
}

function pauseTimer() {
  if (!running) return;
  running = false;
  clearInterval(intervalId);
  intervalId = null;
  releaseWakeLock();

  pauseBtn.textContent = 'Resume';
}

function resumeTimer() {
  if (running) return;
  resumeAudio();
  requestWakeLock();

  running   = true;
  tickStart = performance.now();
  intervalId = setInterval(tick, 250);

  pauseBtn.textContent = 'Pause';
}

function fullReset() {
  running = false;
  clearInterval(intervalId);
  intervalId = null;
  releaseWakeLock();

  currentRound = 1;
  secondsLeft  = config.duration;
  totalShots   = 0;
  playerState  = [];

  drinkAlert.classList.add('hidden');
  timerRing.classList.remove('urgent');
  playerBoard.classList.add('hidden');
  if (typeof drinkViz !== 'undefined') drinkViz.reset();

  startBtn.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  skipBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');

  pauseBtn.textContent = 'Pause';
}

function resetTimer() {
  fullReset();
  updateRoundDisplay();
  updateTimerDisplay();
  if (!audioUnlocked) soundNotice.classList.remove('hidden');
}

function endGame(willCompleteBeer = false) {
  running = false;
  clearInterval(intervalId);
  intervalId = null;
  releaseWakeLock();
  playGameOverFanfare();

  progressBar.style.setProperty('--progress', '100%');
  progressLabel.textContent = config.endless
    ? `${currentRound} rounds`
    : `${config.rounds} / ${config.rounds} rounds`;

  startBtn.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  skipBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');

  // Wait long enough for the pour (and chug+throw, if applicable) to play
  // before slapping the game-over panel over the screen.
  const wait = ALERT_MS + POUR_MS + (willCompleteBeer ? BEER_COMPLETE_MS : 600);
  setTimeout(() => gameOverPanel.classList.remove('hidden'), wait);
}

// ── Button wiring ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', () => {
  if (running) pauseTimer();
  else resumeTimer();
});
skipBtn.addEventListener('click', () => {
  if (!running) return;
  secondsLeft = 0;
  updateTimerDisplay();
  onRoundEnd();
  tickStart = performance.now(); // reset drift so next tick starts clean
});
resetBtn.addEventListener('click', resetTimer);

// ── Drink GIF ──────────────────────────────────────────────────────────────
// Attempt to load — show only if the file actually exists
drinkGif.addEventListener('load', () => {
  drinkGif.style.display = 'block';
});
drinkGif.addEventListener('error', () => {
  drinkGif.style.display = 'none';
});
drinkGif.src = 'assets/drink.gif';
