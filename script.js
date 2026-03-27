'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const TOTAL_ROUNDS   = 60;
const ROUND_DURATION = 60; // seconds

// ── State ──────────────────────────────────────────────────────────────────
let currentRound   = 1;
let secondsLeft    = ROUND_DURATION;
let running        = false;
let intervalId     = null;
let tickStart      = null;   // performance.now() snapshot at last tick
let audioCtx       = null;
let audioUnlocked  = false;
let wakeLock       = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const roundNumber    = document.getElementById('round-number');
const timerDisplay   = document.getElementById('timer-display');
const drinkAlert     = document.getElementById('drink-alert');
const progressBar    = document.getElementById('progress-bar');
const progressLabel  = document.getElementById('progress-label');
const ringProgress   = document.getElementById('ring-progress');
const startBtn       = document.getElementById('start-btn');
const pauseBtn       = document.getElementById('pause-btn');
const resetBtn       = document.getElementById('reset-btn');
const soundNotice    = document.getElementById('sound-notice');
const gameOverPanel  = document.getElementById('game-over');
const playAgainBtn   = document.getElementById('play-again-btn');

// ring geometry: circumference = 2π * 88 ≈ 553
const RING_CIRC = 2 * Math.PI * 88;

// ── Audio ──────────────────────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioUnlocked = true;
  } catch (e) {
    audioUnlocked = false;
  }
}

function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * Play a short "drink!" beep: two short tones.
 */
function playBeep() {
  if (!audioCtx || !audioUnlocked) return;
  resumeAudio();

  const schedule = [
    { freq: 880, start: 0,    dur: 0.12 },
    { freq: 660, start: 0.15, dur: 0.18 },
  ];

  schedule.forEach(({ freq, start, dur }) => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type      = 'sine';
    osc.frequency.value = freq;

    const t = audioCtx.currentTime + start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.6, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.start(t);
    osc.stop(t + dur + 0.02);
  });
}

// ── Screen wake lock ───────────────────────────────────────────────────────
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) { /* not available or denied – silently ignore */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// Re-acquire wake lock when page becomes visible again (Safari may release it)
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

  // ring: full at ROUND_DURATION, empty at 0
  const fraction = secondsLeft / ROUND_DURATION;
  ringProgress.style.strokeDashoffset = RING_CIRC * (1 - fraction);

  // colour shift: green → amber → red as time runs out
  if (fraction > 0.5) {
    ringProgress.style.stroke = '#f5a623';
  } else if (fraction > 0.2) {
    ringProgress.style.stroke = '#ff8c00';
  } else {
    ringProgress.style.stroke = '#ff4757';
  }
}

function updateRoundDisplay() {
  roundNumber.textContent = currentRound;
  const completed = currentRound - 1;
  const pct = (completed / TOTAL_ROUNDS) * 100;
  progressBar.style.setProperty('--progress', `${pct}%`);
  progressLabel.textContent = `${completed} / ${TOTAL_ROUNDS} rounds`;
}

function showDrinkAlert() {
  drinkAlert.classList.remove('hidden');
  // Vibrate if supported (Android; iOS ignores this quietly)
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
  // Flash background as fallback visual cue
  document.body.classList.remove('flash-alert');
  // force reflow to restart animation
  void document.body.offsetWidth;
  document.body.classList.add('flash-alert');

  setTimeout(() => {
    drinkAlert.classList.add('hidden');
  }, 2500);
}

// ── Timer core ─────────────────────────────────────────────────────────────
/**
 * Drift-corrected tick using performance.now().
 * Instead of trusting setInterval to fire exactly every second,
 * we measure actual elapsed time and advance the counter accordingly.
 */
function tick() {
  const now     = performance.now();
  const elapsed = Math.floor((now - tickStart) / 1000);

  if (elapsed < 1) return; // hasn't been a full second yet

  // Advance by however many whole seconds have actually elapsed
  tickStart += elapsed * 1000;
  secondsLeft -= elapsed;

  if (secondsLeft <= 0) {
    secondsLeft = 0;
    updateTimerDisplay();
    onRoundEnd();
  } else {
    updateTimerDisplay();
  }
}

function onRoundEnd() {
  playBeep();
  showDrinkAlert();

  if (currentRound >= TOTAL_ROUNDS) {
    endGame();
    return;
  }

  currentRound++;
  secondsLeft = ROUND_DURATION;
  updateRoundDisplay();
  updateTimerDisplay();
  // tick continues via interval
}

function startTimer() {
  if (running) return;
  initAudio();
  resumeAudio();
  requestWakeLock();

  running   = true;
  tickStart = performance.now();

  // Use a tight interval (250 ms) so we never miss a second boundary
  intervalId = setInterval(tick, 250);

  startBtn.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
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
  pauseBtn.onclick = resumeTimer;
}

function resumeTimer() {
  if (running) return;
  resumeAudio();
  requestWakeLock();

  running   = true;
  tickStart = performance.now();
  intervalId = setInterval(tick, 250);

  pauseBtn.textContent = 'Pause';
  pauseBtn.onclick = pauseTimer;
}

function resetTimer() {
  running = false;
  clearInterval(intervalId);
  intervalId = null;
  releaseWakeLock();

  currentRound = 1;
  secondsLeft  = ROUND_DURATION;

  drinkAlert.classList.add('hidden');
  gameOverPanel.classList.add('hidden');

  startBtn.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');

  pauseBtn.textContent = 'Pause';
  pauseBtn.onclick = pauseTimer;

  updateRoundDisplay();
  updateTimerDisplay();

  // Show sound notice only if audio hasn't been unlocked yet
  if (!audioUnlocked) {
    soundNotice.classList.remove('hidden');
  }
}

function endGame() {
  running = false;
  clearInterval(intervalId);
  intervalId = null;
  releaseWakeLock();

  // Final progress
  progressBar.style.setProperty('--progress', '100%');
  progressLabel.textContent = `${TOTAL_ROUNDS} / ${TOTAL_ROUNDS} rounds`;

  startBtn.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  resetBtn.classList.add('hidden');

  setTimeout(() => {
    gameOverPanel.classList.remove('hidden');
  }, 2800); // wait for "Drink!" alert to fade
}

// ── Button wiring ──────────────────────────────────────────────────────────
startBtn.addEventListener('click', startTimer);
pauseBtn.addEventListener('click', pauseTimer);
resetBtn.addEventListener('click', resetTimer);
playAgainBtn.addEventListener('click', resetTimer);

// ── Init ───────────────────────────────────────────────────────────────────
updateRoundDisplay();
updateTimerDisplay();
soundNotice.classList.remove('hidden');
