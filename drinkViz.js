'use strict';

/* ── Drink Visualiser ──────────────────────────────────────────────────────
   1 completed round = 1 shot. 8 shots = 1 beer.
   Hooks (called from script.js):
     drinkViz.init()    — call in launchGame()
     drinkViz.onShot()  — call in onRoundEnd()
     drinkViz.reset()   — call in fullReset()
   ──────────────────────────────────────────────────────────────────────── */

const drinkViz = (() => {
  const SHOTS_PER_BEER = 8;

  let shots          = 0;
  let completedBeers = 0;
  let mugLiquidEl    = null;
  let pourArmEl      = null;
  let pipsEl         = null;
  let completedRowEl = null;
  let vizEl          = null;

  // ── SVG source strings ─────────────────────────────────────────────────────

  const MUG_SVG = `<svg viewBox="0 0 90 110" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="dv-liq-clip">
        <path d="M14,16 L76,16 L70,93 L20,93 Z"/>
      </clipPath>
    </defs>
    <path d="M12,14 L78,14 L72,95 L18,95 Z" fill="#1a2a3a"/>
    <rect id="dv-liquid" x="13" y="16" width="64" height="77"
          fill="#f5a623" clip-path="url(#dv-liq-clip)"
          style="transform-origin:45px 93px;transform:scaleY(0)"/>
    <g id="dv-foam" style="opacity:0;transition:opacity 0.4s">
      <ellipse cx="24" cy="16" rx="8"  ry="5"   fill="#fff9e8"/>
      <ellipse cx="38" cy="13" rx="10" ry="6"   fill="#fffdf0"/>
      <ellipse cx="52" cy="14" rx="9"  ry="5.5" fill="#fff9e8"/>
      <ellipse cx="65" cy="16" rx="7"  ry="4.5" fill="#fffdf0"/>
    </g>
    <path d="M12,14 L78,14 L72,95 L18,95 Z"
          fill="none" stroke="#4a6890" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M78,30 C104,30 104,72 78,72"
          fill="none" stroke="#4a6890" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="12" y1="14" x2="78" y2="14"
          stroke="#6a90b8" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="24" y1="26" x2="22" y2="82"
          stroke="rgba(255,255,255,0.07)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  const BOTTLE_SVG = `<svg viewBox="0 0 44 110" xmlns="http://www.w3.org/2000/svg">
    <path d="M12,38 C9,45 7,55 7,70 L7,98 C7,102 10,104 22,104 C34,104 37,102 37,98 L37,70 C37,55 35,45 32,38 Z"
          fill="#3d6e35"/>
    <rect x="17" y="16" width="10" height="24" rx="2" fill="#3d6e35"/>
    <rect x="14" y="8"  width="16" height="10" rx="3" fill="#c0392b"/>
    <rect x="10" y="56" width="24" height="28" rx="3" fill="#f0e040" opacity="0.9"/>
    <text x="22" y="75" text-anchor="middle" font-size="14" font-weight="900"
          fill="#1a1a2e" font-family="-apple-system,sans-serif">B</text>
    <line x1="11" y1="44" x2="10" y2="94"
          stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  const MINI_MUG_SVG = `<svg viewBox="0 0 30 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M4,4 L26,4 L24,30 L6,30 Z"
          fill="#f5a623" stroke="#c07a10" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M26,10 C34,10 34,22 26,22"
          fill="none" stroke="#c07a10" stroke-width="1.5" stroke-linecap="round"/>
    <ellipse cx="9"  cy="4" rx="3"   ry="2"   fill="#fffce8"/>
    <ellipse cx="16" cy="2" rx="4.5" ry="2.5" fill="#fffdf2"/>
    <ellipse cx="23" cy="4" rx="2.5" ry="2"   fill="#fffce8"/>
  </svg>`;

  // ── Fill level ─────────────────────────────────────────────────────────────

  function updateFill(animated) {
    if (!mugLiquidEl) return;
    const frac = shots / SHOTS_PER_BEER;
    mugLiquidEl.style.transition = animated
      ? 'transform 0.55s cubic-bezier(0.34,1.56,0.64,1)'
      : 'none';
    mugLiquidEl.style.transform = `scaleY(${frac})`;

    const foam = vizEl && vizEl.querySelector('#dv-foam');
    if (foam) foam.style.opacity = shots >= 6 ? '1' : '0';

    updatePips();
  }

  function updatePips() {
    if (!pipsEl) return;
    pipsEl.querySelectorAll('.dv-pip').forEach((pip, i) => {
      pip.classList.toggle('filled', i < shots);
    });
  }

  // ── Pour animation ─────────────────────────────────────────────────────────

  function triggerPour() {
    if (!pourArmEl) return;
    pourArmEl.classList.remove('pouring');
    void pourArmEl.offsetWidth; // force reflow so animation restarts
    pourArmEl.classList.add('pouring');
    playPourSound();
    setTimeout(() => updateFill(true), 700);
  }

  // ── Beer complete ──────────────────────────────────────────────────────────

  function triggerBeerComplete() {
    updateFill(false);
    updateCompletedRow();
    playGlugSound();

    const wrap = document.getElementById('dv-mug-wrap');
    if (wrap) {
      wrap.classList.remove('dv-mug-chug');
      void wrap.offsetWidth;
      wrap.classList.add('dv-mug-chug');
    }
  }

  // ── Completed row ──────────────────────────────────────────────────────────

  function updateCompletedRow() {
    if (!completedRowEl) return;
    if (completedBeers === 0) {
      completedRowEl.innerHTML = '<span class="dv-none-yet">no beers yet...</span>';
      return;
    }
    completedRowEl.innerHTML = '';
    for (let i = 0; i < completedBeers; i++) {
      const icon = document.createElement('span');
      icon.className = 'dv-beer-icon';
      if (i === completedBeers - 1) icon.classList.add('dv-beer-new');
      icon.innerHTML = MINI_MUG_SVG;
      completedRowEl.appendChild(icon);
    }
  }

  // ── Sounds ─────────────────────────────────────────────────────────────────

  function getCtx()  { return window.BeerHour ? window.BeerHour.getAudioCtx() : null; }
  function sfxOn()   { return window.BeerHour ? window.BeerHour.getConfig().sfx : false; }

  function playPourSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();

    const dur    = 0.55;
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src  = ctx.createBufferSource();
    src.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0,    ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.22, ctx.currentTime + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    src.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + dur + 0.05);
  }

  function playGlugSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = ctx.currentTime;

    // descending glug pops
    [440, 360, 290, 240, 200].forEach((freq, i) => {
      const t   = t0 + i * 0.11;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.09);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.start(t); osc.stop(t + 0.12);
    });

    // bass thunk
    const bt = t0 + 0.62;
    const b  = ctx.createOscillator();
    const bg = ctx.createGain();
    b.connect(bg); bg.connect(ctx.destination);
    b.type = 'sine';
    b.frequency.setValueAtTime(110, bt);
    b.frequency.exponentialRampToValueAtTime(50, bt + 0.28);
    bg.gain.setValueAtTime(0, bt);
    bg.gain.linearRampToValueAtTime(0.8, bt + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.001, bt + 0.32);
    b.start(bt); b.stop(bt + 0.36);

    // cheeky "BEER!" ding
    [[523, 0.72], [659, 0.84], [784, 0.96]].forEach(([freq, dt]) => {
      const t   = t0 + dt;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.start(t); osc.stop(t + 0.15);
    });
  }

  // ── DOM build ──────────────────────────────────────────────────────────────

  function buildPips() {
    if (!pipsEl) return;
    pipsEl.innerHTML = '';
    for (let i = 0; i < SHOTS_PER_BEER; i++) {
      const pip = document.createElement('span');
      pip.className = 'dv-pip';
      pipsEl.appendChild(pip);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    vizEl          = document.getElementById('drink-viz');
    pourArmEl      = document.getElementById('dv-pour-arm');
    pipsEl         = document.getElementById('dv-pips');
    completedRowEl = document.getElementById('dv-completed-row');

    const mugWrap    = document.getElementById('dv-mug-wrap');
    const bottleWrap = document.getElementById('dv-bottle-wrap');
    if (mugWrap)    mugWrap.innerHTML    = MUG_SVG;
    if (bottleWrap) bottleWrap.innerHTML = BOTTLE_SVG;

    mugLiquidEl = document.getElementById('dv-liquid');

    shots          = 0;
    completedBeers = 0;

    buildPips();
    updateFill(false);
    updateCompletedRow();
    if (pourArmEl) pourArmEl.classList.remove('pouring');
  }

  function onShot() {
    shots++;
    triggerPour();
    if (shots >= SHOTS_PER_BEER) {
      shots = 0;
      completedBeers++;
      setTimeout(triggerBeerComplete, 1050);
    }
  }

  function reset() {
    shots          = 0;
    completedBeers = 0;
    if (!vizEl) return;
    updateFill(false);
    updateCompletedRow();
    if (pourArmEl) pourArmEl.classList.remove('pouring');
    const wrap = document.getElementById('dv-mug-wrap');
    if (wrap) wrap.classList.remove('dv-mug-chug');
  }

  return { init, onShot, reset };
})();
