'use strict';

/* ── Drink Visualiser ──────────────────────────────────────────────────────
   1 completed round = 1 shot. 8 shots = 1 beer.
   Hooks (called from script.js):
     drinkViz.init()    — call in launchGame()
     drinkViz.onShot()  — call in onRoundEnd() AFTER the drink-alert hides
     drinkViz.reset()   — call in fullReset()

   On every shot a cartoon hand swoops in from a random viewport edge,
   pours into the mug, then leaves. On the 8th shot the full mug is
   chugged, drained, and the empty is either tossed or floated to the
   "Collection" shelf.
   ──────────────────────────────────────────────────────────────────────── */

const drinkViz = (() => {
  const SHOTS_PER_BEER = 8;
  const THROW_CHANCE   = 0.45;   // % of beers that get yeeted to the shelf

  // ── State ────────────────────────────────────────────────────────────────
  let shots          = 0;
  let completedBeers = 0;
  let busy           = false;    // pour/chug currently animating

  // ── DOM refs ─────────────────────────────────────────────────────────────
  let vizEl, mugWrapEl, mugLiquidEl, foamEl, pipsEl;
  let bcShelfEl, bcCountEl, bcStatusEl;
  let overlayEl, pourHandEl, chugHandEl, flyingMugEl, splashEl;

  // ── Cartoony SVGs ────────────────────────────────────────────────────────

  const MUG_SVG = `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <clipPath id="dv-liq-clip">
        <path d="M16,18 L84,18 L78,100 L22,100 Z"/>
      </clipPath>
      <linearGradient id="dv-liq-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffd860"/>
        <stop offset="1" stop-color="#e8891a"/>
      </linearGradient>
    </defs>
    <path d="M14,16 L86,16 L80,102 L20,102 Z" fill="#0f1a2c"/>
    <rect id="dv-liquid" x="13" y="18" width="74" height="84"
          fill="url(#dv-liq-grad)" clip-path="url(#dv-liq-clip)"
          style="transform-origin:50px 100px;transform:scaleY(0)"/>
    <g id="dv-foam" style="opacity:0;transition:opacity 0.4s">
      <ellipse cx="26" cy="18" rx="9"  ry="5.5" fill="#fff9e8"/>
      <ellipse cx="42" cy="14" rx="11" ry="6.5" fill="#fffdf0"/>
      <ellipse cx="58" cy="15" rx="10" ry="6"   fill="#fff9e8"/>
      <ellipse cx="73" cy="18" rx="8"  ry="5"   fill="#fffdf0"/>
    </g>
    <path d="M14,16 L86,16 L80,102 L20,102 Z"
          fill="none" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M86,32 C115,32 115,80 86,80"
          fill="none" stroke="#1a1a2e" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="14" y1="16" x2="86" y2="16" stroke="#1a1a2e" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="26" y1="28" x2="24" y2="88" stroke="rgba(255,255,255,0.22)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  // Hand gripping a small shot glass full of beer. The glass is drawn
  // vertically with its LEFT rim corner at SVG (38, 190) — which is the
  // CSS transform-origin so a CCW tilt pours from that rim. The hand+sleeve
  // is wrapped in a rotation group so the wrist visibly bends, giving the
  // glass a natural angle relative to the forearm.
  function handShotSvg(sleeveColor, cuffColor, wristTilt) {
    const tilt = (typeof wristTilt === 'number') ? wristTilt : 0;
    const gid  = `dv-shot-${Math.random().toString(36).slice(2, 8)}`;
    return `<svg viewBox="-22 -50 184 320" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      <defs>
        <clipPath id="${gid}-clip">
          <path d="M40,192 L96,192 L92,260 L44,260 Z"/>
        </clipPath>
        <linearGradient id="${gid}-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd860"/>
          <stop offset="1" stop-color="#e8881a"/>
        </linearGradient>
      </defs>

      <!-- Shot glass — wrapped in a group that wrist-flicks toward the entry
           side as the pour starts. Pivot is the LEFT rim (same as the
           element's pour pivot) so the stream stays anchored. -->
      <g class="dv-shot-glass">
        <!-- Glass tint behind the beer for a subtle "glassiness" -->
        <path d="M38,190 L98,190 L96,252 Q96,262 88,264 L48,264 Q40,262 40,252 Z"
              fill="rgba(220,235,250,0.14)"/>
        <!-- Beer fill (drains during pour-tilt via JS-driven opacity/transform) -->
        <rect class="dv-beer-fill" x="38" y="200" width="60" height="62"
              fill="url(#${gid}-grad)" clip-path="url(#${gid}-clip)"
              style="transform-origin:50% 100%;transform-box:fill-box;transition:transform 0.6s cubic-bezier(0.4,0,0.7,1),opacity 0.5s ease-in"/>
        <!-- Foam puffs floating on top of the beer -->
        <g class="dv-beer-foam" style="transition:opacity 0.4s ease">
          <ellipse cx="50" cy="200" rx="9"  ry="3"   fill="#fff9e8"/>
          <ellipse cx="68" cy="198" rx="11" ry="3.5" fill="#fffdf0"/>
          <ellipse cx="83" cy="200" rx="8"  ry="3"   fill="#fff9e8"/>
        </g>
        <!-- Body outline (drawn over the beer for crisp edges) -->
        <path d="M38,190 L98,190 L96,252 Q96,262 88,264 L48,264 Q40,262 40,252 Z"
              fill="none" stroke="#1a1a2e" stroke-width="5" stroke-linejoin="round"/>
        <!-- Rim opening (open top of the glass) -->
        <ellipse cx="68" cy="190" rx="30" ry="4"
                 fill="rgba(0,0,0,0.18)" stroke="#1a1a2e" stroke-width="4"/>
        <!-- Highlight stripe down the left side -->
        <line x1="46" y1="200" x2="44" y2="248"
              stroke="rgba(255,255,255,0.30)" stroke-width="3" stroke-linecap="round"/>
        <!-- Heavy base — shot glass thick bottom -->
        <rect x="42" y="262" width="52" height="12" rx="3"
              fill="rgba(220,235,250,0.18)" stroke="#1a1a2e" stroke-width="5" stroke-linejoin="round"/>
      </g>

      <!-- ── HAND + FOREARM, rotated around the back of the fist ────── -->
      <!-- Tilt = ${tilt}deg, pivot (70,116) gives the wrist a visible bend. -->
      <g transform="rotate(${tilt} 70 116)">
        <!-- Sleeve (extends offscreen above) -->
        <path d="M30,-60 L110,-60 L120,40 Q120,58 100,62 L40,62 Q20,58 20,40 Z"
              fill="${sleeveColor}" stroke="#1a1a2e" stroke-width="6" stroke-linejoin="round"/>
        <!-- Cuff -->
        <rect x="18" y="56" width="104" height="16" rx="4"
              fill="${cuffColor}" stroke="#1a1a2e" stroke-width="5"/>
        <line x1="20" y1="68" x2="120" y2="68" stroke="#1a1a2e" stroke-width="2.5" opacity="0.5"/>

        <!-- Back of fist -->
        <path d="M16,76 Q10,108 18,148 Q26,166 50,168 L92,168 Q116,166 124,148 Q132,108 124,76 Q70,68 16,76 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="6" stroke-linejoin="round"/>
        <!-- Knuckles -->
        <circle cx="40"  cy="118" r="6" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
        <circle cx="58"  cy="114" r="7" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
        <circle cx="80"  cy="114" r="7" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
        <circle cx="100" cy="118" r="6" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
        <!-- Creases below knuckles -->
        <path d="M36,128 Q40,135 44,128" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
        <path d="M54,124 Q58,132 64,124" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
        <path d="M76,124 Q80,132 86,124" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
        <path d="M96,128 Q100,135 104,128" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>

        <!-- Finger tips curling under the fist -->
        <path d="M30,164 Q26,180 36,186 Q46,188 50,176 L48,166 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M50,166 Q46,184 56,190 Q66,192 70,178 L66,166 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M70,166 Q66,184 76,190 Q86,192 90,178 L86,166 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M90,164 Q86,180 96,186 Q106,188 110,176 L108,166 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M34,180 Q40,184 46,180" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.4"/>
        <path d="M54,184 Q60,188 66,184" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.4"/>
        <path d="M74,184 Q80,188 86,184" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.4"/>
        <path d="M94,180 Q100,184 106,180" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.4"/>

        <!-- Thumb wrapping from the LEFT side -->
        <path d="M16,90 Q-4,108 -2,140 Q4,162 26,160 Q34,150 32,128 Q28,108 24,96 Z"
              fill="#ffd6a5" stroke="#1a1a2e" stroke-width="5" stroke-linejoin="round"/>
        <path d="M6,124 Q14,128 22,122" fill="none" stroke="#1a1a2e" stroke-width="2.5" opacity="0.5"/>
      </g>
    </svg>`;
  }

  // Hand grabbing the mug handle. Same fist-shape language as the bottle hand
  // for visual consistency. The SVG is positioned such that the thumb-side
  // overlays the mug's handle area on the right.
  function handMugSvg(sleeveColor, cuffColor) {
    return `<svg viewBox="-22 -50 184 280" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      <!-- Sleeve -->
      <path d="M30,-60 L110,-60 L120,38 Q120,56 100,60 L40,60 Q20,56 20,38 Z"
            fill="${sleeveColor}" stroke="#1a1a2e" stroke-width="6" stroke-linejoin="round"/>
      <rect x="18" y="54" width="104" height="16" rx="4"
            fill="${cuffColor}" stroke="#1a1a2e" stroke-width="5"/>
      <line x1="20" y1="66" x2="120" y2="66" stroke="#1a1a2e" stroke-width="2.5" opacity="0.5"/>

      <!-- Back of fist -->
      <path d="M16,74 Q10,106 18,146 Q26,164 50,166 L92,166 Q116,164 124,146 Q132,106 124,74 Q70,66 16,74 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="6" stroke-linejoin="round"/>
      <!-- Knuckles -->
      <circle cx="40" cy="116" r="6" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
      <circle cx="58" cy="112" r="7" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
      <circle cx="80" cy="112" r="7" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
      <circle cx="100" cy="116" r="6" fill="#f0c890" stroke="#1a1a2e" stroke-width="2.5"/>
      <!-- Creases -->
      <path d="M36,126 Q40,133 44,126" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
      <path d="M54,122 Q58,130 64,122" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
      <path d="M76,122 Q80,130 86,122" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>
      <path d="M96,126 Q100,133 104,126" fill="none" stroke="#1a1a2e" stroke-width="2" opacity="0.45"/>

      <!-- Curled fingers — wrapping THROUGH the mug handle. They loop down
           and back up, suggesting they pass through the handle's hole. -->
      <path d="M28,162 Q22,180 28,196 Q40,206 54,200 Q60,192 56,182 L52,168 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="M52,164 Q46,184 54,200 Q66,210 80,204 Q86,196 80,184 L74,166 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="M76,164 Q72,184 80,200 Q92,208 104,202 Q110,194 104,184 L98,166 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
      <path d="M100,162 Q96,180 104,194 Q116,200 124,192 Q128,182 122,172 L114,164 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>

      <!-- Thumb wraps around the top of the handle from the OUTSIDE -->
      <path d="M16,90 Q-4,108 -2,138 Q4,160 26,158 Q34,148 32,126 Q28,106 24,94 Z"
            fill="#ffd6a5" stroke="#1a1a2e" stroke-width="5" stroke-linejoin="round"/>
      <path d="M6,122 Q14,126 22,120" fill="none" stroke="#1a1a2e" stroke-width="2.5" opacity="0.5"/>
    </svg>`;
  }

  // The empty mug used both for the flying-empty animation AND the shelf.
  // Compact viewBox so it scales cleanly between sizes.
  const EMPTY_MUG_SVG = `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
    <path d="M14,16 L86,16 L80,102 L20,102 Z" fill="rgba(255,255,255,0.06)"/>
    <!-- thin sip residue at bottom -->
    <path d="M20,92 L80,92 L78,100 L22,100 Z" fill="rgba(245, 166, 35, 0.35)"/>
    <path d="M14,16 L86,16 L80,102 L20,102 Z"
          fill="none" stroke="#1a1a2e" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M86,32 C115,32 115,80 86,80"
          fill="none" stroke="#1a1a2e" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="14" y1="16" x2="86" y2="16" stroke="#1a1a2e" stroke-width="4.5" stroke-linecap="round"/>
    <line x1="26" y1="28" x2="24" y2="88" stroke="rgba(255,255,255,0.18)" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  // Sleeve palette — random per pour for variety
  const SLEEVE_COLORS = [
    ['#ff6b9c', '#d94d80'],   // pink
    ['#7b61ff', '#5a3fff'],   // purple
    ['#4caf50', '#2e8b3e'],   // green
    ['#3498db', '#1f6dad'],   // blue
    ['#ff9233', '#d96f1c'],   // orange
    ['#e74c3c', '#a93226'],   // red
    ['#1a1a2e', '#0a0a18'],   // black tux
  ];
  function pickSleeve() {
    return SLEEVE_COLORS[Math.floor(Math.random() * SLEEVE_COLORS.length)];
  }

  // ── Mug fill ─────────────────────────────────────────────────────────────

  function setLiquidLevel(frac, animated) {
    if (!mugLiquidEl) return;
    mugLiquidEl.style.transition = animated
      ? 'transform 0.55s cubic-bezier(0.34,1.56,0.64,1)'
      : 'none';
    mugLiquidEl.style.transform = `scaleY(${frac})`;
    if (foamEl) foamEl.style.opacity = frac >= 0.85 ? '1' : '0';
  }

  function updatePips() {
    if (!pipsEl) return;
    pipsEl.querySelectorAll('.dv-pip').forEach((pip, i) => {
      pip.classList.toggle('filled', i < shots);
    });
  }

  // ── Pour: cartoon hand swoops in from a random viewport edge ─────────────

  function entryVector() {
    const w = window.innerWidth, h = window.innerHeight;
    const dirs = [
      { x: 0,        y: -h - 200 },              // top
      { x: w + 200,  y: -h * 0.4 },              // top-right
      { x: w + 200,  y: 0 },                     // right
      { x: w + 200,  y: h * 0.4 },               // bottom-right
      { x: 0,        y: h + 200 },               // bottom
      { x: -w - 200, y: h * 0.4 },               // bottom-left
      { x: -w - 200, y: 0 },                     // left
      { x: -w - 200, y: -h * 0.4 },              // top-left
    ];
    return dirs[Math.floor(Math.random() * dirs.length)];
  }

  // How far above the mug rim the shot glass's pour-rim hovers during a pour.
  // Tall enough that the beer stream is clearly visible connecting them.
  const POUR_LIFT = 60;

  // Pour pivot (LEFT rim of the shot glass) in element-pixel coords.
  // viewBox `-22 -50 184 320`, element 130×226: SVG (38,190) → element (42.39, 169.5).
  const PIVOT_X      = 42.39;
  const PIVOT_Y      = 169.5;
  const SHOT_HAND_W  = 130;
  const SHOT_HAND_H  = 226;

  function triggerWonkyPour() {
    if (!pourHandEl || !mugWrapEl) return;

    // Random wrist bend so the glass isn't stiffly inline with the forearm
    const wristSign = Math.random() < 0.5 ? -1 : 1;
    const wristTilt = wristSign * (10 + Math.random() * 10);  // ±10°–±20°

    const [sleeve, cuff] = pickSleeve();
    pourHandEl.innerHTML = handShotSvg(sleeve, cuff, wristTilt);

    // Pin the LEFT rim (pivot) at (mugCx, mugTop - POUR_LIFT) — when the
    // element rotates CCW around its transform-origin, the pivot stays put
    // and beer pours from there straight into the mug below.
    const mugRect = mugWrapEl.getBoundingClientRect();
    const mugCx   = mugRect.left + mugRect.width / 2;
    const targetX = mugCx - PIVOT_X;
    const targetY = (mugRect.top - POUR_LIFT) - PIVOT_Y;

    pourHandEl.style.width           = `${SHOT_HAND_W}px`;
    pourHandEl.style.height          = `${SHOT_HAND_H}px`;
    pourHandEl.style.left            = `${targetX}px`;
    pourHandEl.style.top             = `${targetY}px`;
    pourHandEl.style.transformOrigin = `${PIVOT_X}px ${PIVOT_Y}px`;

    const v = entryVector();
    // Random base tilt during entry/exit & a slight x-jitter on landing
    const baseTilt = (Math.random() * 24) - 12;
    const xJitter  = (Math.random() * 26) - 13;
    pourHandEl.style.setProperty('--ex', `${v.x}px`);
    pourHandEl.style.setProperty('--ey', `${v.y}px`);
    pourHandEl.style.setProperty('--base-tilt', `${baseTilt}deg`);
    pourHandEl.style.setProperty('--x-jitter', `${xJitter}px`);

    // Restart animation
    pourHandEl.classList.remove('pouring');
    void pourHandEl.offsetWidth;
    pourHandEl.classList.add('pouring');

    // Stream/droplets/slosh align with the glass's tilt phase
    // (≈1.5s–3.0s of the 3.8s keyframe). Stream emerges from the LEFT rim
    // (which IS the transform-origin, so it's pinned at the spawn point).
    playPourSound();
    setTimeout(() => spawnStream(mugRect, xJitter), 1450);
    setTimeout(() => spawnDroplets(mugRect, xJitter, 18), 1500);
    setTimeout(() => mugWrapEl.classList.add('dv-mug-slosh'), 2000);
    setTimeout(() => mugWrapEl.classList.remove('dv-mug-slosh'), 2900);
    setTimeout(() => {
      shots = Math.min(shots, SHOTS_PER_BEER);
      setLiquidLevel(shots / SHOTS_PER_BEER, true);
      updatePips();
    }, 2100);

    // Glass flick — leans toward the side the hand entered from (linear
    // ramp during the pour-start phase). Pivots around the LEFT rim, so it
    // doesn't disturb the stream anchor.
    let entryDir;
    if      (v.x >  30) entryDir =  1;
    else if (v.x < -30) entryDir = -1;
    else                entryDir =  Math.random() < 0.5 ? -1 : 1;
    const flick = entryDir * (10 + Math.random() * 8);  // ±10°–±18°
    setTimeout(() => {
      const glassEl = pourHandEl.querySelector('.dv-shot-glass');
      if (glassEl) glassEl.style.transform = `rotate(${flick}deg)`;
    }, 1200);

    // Beer level in the shot glass drops as it pours out (cartoon: just
    // shrink + fade the fill, foam evaporates).
    setTimeout(() => {
      const fill = pourHandEl.querySelector('.dv-beer-fill');
      const foam = pourHandEl.querySelector('.dv-beer-foam');
      if (fill) {
        fill.style.transform = 'scaleY(0.05)';
        fill.style.opacity   = '0.55';
      }
      if (foam) foam.style.opacity = '0';
    }, 1700);

    // Sometimes the pour is messy — a few drops miss the mug and fly past it.
    if (Math.random() < 0.35) {
      setTimeout(() => spawnSpill(mugRect, xJitter), 1650);
    }
  }

  // Continuous beer stream visual — anchored at the bottle's spout, falling
  // into the mug. Lives ~1.3s, matching dv-stream-life.
  function spawnStream(mugRect, xJitter) {
    if (!overlayEl) return;
    const spoutX = mugRect.left + mugRect.width / 2 + (xJitter || 0);
    const spoutY = mugRect.top - POUR_LIFT;
    const h      = (mugRect.top + 8) - spoutY;   // spout → just inside mug
    const s      = document.createElement('div');
    s.className   = 'dv-stream';
    s.style.left   = `${spoutX - 7}px`;
    s.style.top    = `${spoutY}px`;
    s.style.height = `${h}px`;
    s.style.setProperty('--stream-h', `${h}px`);
    overlayEl.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }

  // Quick liquid droplets falling from the spout, splashing into the mug.
  function spawnDroplets(mugRect, xJitter, count) {
    if (!overlayEl) return;
    const cx = mugRect.left + mugRect.width / 2 + xJitter;
    const startY = mugRect.top - POUR_LIFT + 4;   // just below the spout lip
    const endY   = mugRect.top + 14;
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'dv-drop';
      const offset = (Math.random() * 18) - 9;
      d.style.left = `${cx + offset - 4}px`;
      d.style.top  = `${startY}px`;
      d.style.setProperty('--drop-dy', `${endY - startY}px`);
      d.style.animationDelay = `${i * 22}ms`;
      overlayEl.appendChild(d);
      setTimeout(() => d.remove(), 600 + i * 22);
    }
  }

  // Messy spill — drops fly sideways past the mug instead of falling in.
  // Direction biases away from the pour spout, so it reads as "missed the rim."
  function spawnSpill(mugRect, xJitter) {
    if (!overlayEl) return;
    const cx     = mugRect.left + mugRect.width / 2 + xJitter;
    const startY = mugRect.top - POUR_LIFT + 6;
    const dir    = Math.random() < 0.5 ? -1 : 1;       // left or right of the mug
    const count  = 3 + Math.floor(Math.random() * 3);   // 3–5 drops
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className  = 'dv-drop dv-drop-spill';
      d.style.left = `${cx - 4}px`;
      d.style.top  = `${startY}px`;
      const dx = dir * (60 + Math.random() * 80);                // 60–140 px sideways
      const dy = mugRect.height + 30 + Math.random() * 50;        // fall past mug
      d.style.setProperty('--drop-dx', `${dx}px`);
      d.style.setProperty('--drop-dy', `${dy}px`);
      d.style.animationDelay = `${i * 55}ms`;
      overlayEl.appendChild(d);
      setTimeout(() => d.remove(), 1100 + i * 55);
    }
  }

  // ── Beer complete: chug, drain, throw/place empty to shelf ───────────────

  function triggerBeerComplete() {
    if (!chugHandEl || !mugWrapEl) return;
    busy = true;

    const [sleeve, cuff] = pickSleeve();
    chugHandEl.innerHTML = handMugSvg(sleeve, cuff);

    const mugRect = mugWrapEl.getBoundingClientRect();
    const handW = 130, handH = 220;
    // Hand grips from the right side of the mug (over the handle area)
    const fromRight = Math.random() < 0.65;
    const targetX = fromRight
      ? mugRect.left + mugRect.width * 0.55
      : mugRect.left - handW + mugRect.width * 0.45;
    const targetY = mugRect.top - handH + mugRect.height * 0.55;

    chugHandEl.style.width  = `${handW}px`;
    chugHandEl.style.height = `${handH}px`;
    chugHandEl.style.left   = `${targetX}px`;
    chugHandEl.style.top    = `${targetY}px`;
    chugHandEl.style.setProperty('--mirror', fromRight ? '1' : '-1');
    const ex = fromRight ? window.innerWidth + 200 : -window.innerWidth - 200;
    chugHandEl.style.setProperty('--ex', `${ex}px`);

    chugHandEl.classList.remove('chugging');
    void chugHandEl.offsetWidth;
    chugHandEl.classList.add('chugging');

    // Mug tilts back as if being lifted to mouth
    mugWrapEl.classList.remove('dv-mug-chug');
    void mugWrapEl.offsetWidth;
    mugWrapEl.classList.add('dv-mug-chug');

    // Drain liquid mid-chug
    setTimeout(() => {
      shots = 0;
      setLiquidLevel(0, true);
      updatePips();
    }, 1000);

    playGlugSound();

    // After chug → spawn flying empty → throw or float to shelf
    setTimeout(() => {
      const willThrow = Math.random() < THROW_CHANCE;
      flyEmptyToShelf(mugRect, willThrow);
    }, 2050);
  }

  function flyEmptyToShelf(fromRect, willThrow) {
    if (!flyingMugEl || !bcShelfEl) return;

    flyingMugEl.innerHTML = EMPTY_MUG_SVG;

    // Hide the in-stage mug so the flying empty reads as the same mug
    // leaving the stage. It'll come back fresh when the empty has landed.
    if (mugWrapEl) {
      mugWrapEl.style.transition = 'opacity 0.18s';
      mugWrapEl.style.opacity    = '0';
    }

    // Compute target — the next slot inside the shelf, clamped to the
    // visible region so a thrown empty doesn't fly into a scrolled-off row.
    const shelfRect = bcShelfEl.getBoundingClientRect();
    const slotW = 38, slotH = 46;
    const cols  = Math.max(1, Math.floor((shelfRect.width - 8) / (slotW + 6)));
    const idx   = completedBeers - 1; // about-to-be-added (already incremented)
    const col   = idx % cols;
    const row   = Math.floor(idx / cols);
    const tx    = shelfRect.left + 6 + col * (slotW + 6);
    let   ty    = shelfRect.top  + 6 + row * (slotH + 6);
    const tyMax = shelfRect.bottom - slotH - 6;
    if (ty > tyMax) ty = tyMax;

    flyingMugEl.style.width  = `${fromRect.width}px`;
    flyingMugEl.style.height = `${fromRect.height}px`;
    flyingMugEl.style.left   = `${fromRect.left}px`;
    flyingMugEl.style.top    = `${fromRect.top}px`;

    const dx = tx - fromRect.left + (slotW - fromRect.width) / 2;
    const dy = ty - fromRect.top  + (slotH - fromRect.height) / 2;
    const peak = -Math.max(180, Math.abs(dy) * 0.6);
    const endScale = slotW / fromRect.width;

    flyingMugEl.style.setProperty('--fly-dx', `${dx}px`);
    flyingMugEl.style.setProperty('--fly-dy', `${dy}px`);
    flyingMugEl.style.setProperty('--fly-peak', `${peak}px`);
    flyingMugEl.style.setProperty('--fly-end-scale', endScale);
    flyingMugEl.style.setProperty('--fly-spin', willThrow ? `${720 + Math.random() * 360}deg` : '15deg');

    flyingMugEl.classList.remove('throwing', 'placing');
    void flyingMugEl.offsetWidth;
    flyingMugEl.classList.add(willThrow ? 'throwing' : 'placing');

    if (willThrow) playWhooshSound();

    const dur = willThrow ? 1150 : 1450;
    setTimeout(() => {
      flyingMugEl.classList.remove('throwing', 'placing');
      flyingMugEl.style.left = '-9999px';
      addEmptyToShelf();
      playClinkSound();
      // Bring the in-stage mug back, empty and ready for the next round
      if (mugWrapEl) mugWrapEl.style.opacity = '1';
      busy = false;
    }, dur);
  }

  // ── Shelf (collection of empties) ─────────────────────────────────────────

  function addEmptyToShelf() {
    if (!bcShelfEl) return;

    // Drop the placeholder if present
    const placeholder = bcShelfEl.querySelector('.bc-empty-placeholder');
    if (placeholder) placeholder.remove();

    const slot = document.createElement('span');
    slot.className = 'bc-slot bc-slot-new';
    slot.innerHTML = EMPTY_MUG_SVG;
    bcShelfEl.appendChild(slot);

    // Keep the latest empty in view if the shelf has overflowed
    bcShelfEl.scrollTop = bcShelfEl.scrollHeight;

    if (bcCountEl)  bcCountEl.textContent  = String(completedBeers);
    if (bcStatusEl) bcStatusEl.textContent = beerStatusText(completedBeers);
  }

  function beerStatusText(n) {
    if (n === 0) return 'no beers yet...';
    if (n === 1) return '1 beer down 🍺';
    if (n < 4)   return `${n} beers down — warming up 🍻`;
    if (n < 8)   return `${n} beers — getting silly 😵‍💫`;
    return `${n} beers — legend 👑`;
  }

  function rebuildShelf() {
    if (!bcShelfEl) return;
    bcShelfEl.innerHTML = '';
    if (completedBeers === 0) {
      const p = document.createElement('span');
      p.className = 'bc-empty-placeholder';
      p.textContent = 'no empties yet 🥺';
      bcShelfEl.appendChild(p);
    } else {
      for (let i = 0; i < completedBeers; i++) {
        const slot = document.createElement('span');
        slot.className = 'bc-slot';
        slot.innerHTML = EMPTY_MUG_SVG;
        bcShelfEl.appendChild(slot);
      }
    }
    if (bcCountEl)  bcCountEl.textContent  = String(completedBeers);
    if (bcStatusEl) bcStatusEl.textContent = beerStatusText(completedBeers);
  }

  // ── Sounds ───────────────────────────────────────────────────────────────

  function getCtx() { return window.BeerHour ? window.BeerHour.getAudioCtx() : null; }
  function sfxOn()  { return window.BeerHour ? window.BeerHour.getConfig().sfx : false; }

  function playPourSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();

    const dur    = 0.6;
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.9;

    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(380, ctx.currentTime + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.22, ctx.currentTime + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + dur + 0.05);
  }

  function playGlugSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;

    [440, 360, 290, 240, 200, 175].forEach((freq, i) => {
      const t   = t0 + i * 0.13;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.start(t); osc.stop(t + 0.13);
    });

    // belch
    const bt = t0 + 0.92;
    const b  = ctx.createOscillator();
    const bg = ctx.createGain();
    b.connect(bg); bg.connect(ctx.destination);
    b.type = 'sawtooth';
    b.frequency.setValueAtTime(160, bt);
    b.frequency.exponentialRampToValueAtTime(60, bt + 0.32);
    bg.gain.setValueAtTime(0, bt);
    bg.gain.linearRampToValueAtTime(0.55, bt + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.001, bt + 0.36);
    b.start(bt); b.stop(bt + 0.4);
  }

  function playWhooshSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();

    const dur    = 0.45;
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);

    const src  = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(2200, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + dur + 0.05);
  }

  function playClinkSound() {
    const ctx = getCtx();
    if (!ctx || !sfxOn()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;

    // Two short bell-like dings
    [1760, 2200].forEach((freq, i) => {
      const t   = t0 + i * 0.05;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t); osc.stop(t + 0.22);
    });
  }

  // ── Build pips ───────────────────────────────────────────────────────────

  function buildPips() {
    if (!pipsEl) return;
    pipsEl.innerHTML = '';
    for (let i = 0; i < SHOTS_PER_BEER; i++) {
      const pip = document.createElement('span');
      pip.className = 'dv-pip';
      pipsEl.appendChild(pip);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function init() {
    vizEl       = document.getElementById('drink-viz');
    mugWrapEl   = document.getElementById('dv-mug-wrap');
    pipsEl      = document.getElementById('dv-pips');
    bcShelfEl   = document.getElementById('bc-shelf');
    bcCountEl   = document.getElementById('bc-count');
    bcStatusEl  = document.getElementById('bc-status');
    overlayEl   = document.getElementById('dv-overlay');
    pourHandEl  = document.getElementById('dv-pour-hand');
    chugHandEl  = document.getElementById('dv-chug-hand');
    flyingMugEl = document.getElementById('dv-flying-mug');

    if (mugWrapEl) mugWrapEl.innerHTML = MUG_SVG;
    mugLiquidEl = document.getElementById('dv-liquid');
    foamEl      = document.getElementById('dv-foam');

    shots          = 0;
    completedBeers = 0;
    busy           = false;

    buildPips();
    setLiquidLevel(0, false);
    updatePips();
    rebuildShelf();
    if (pourHandEl)  pourHandEl.classList.remove('pouring');
    if (chugHandEl)  chugHandEl.classList.remove('chugging');
    if (mugWrapEl) {
      mugWrapEl.classList.remove('dv-mug-chug', 'dv-mug-slosh');
      mugWrapEl.style.opacity = '1';
    }
  }

  // Called AFTER the drink-alert hides, so the user actually sees it.
  function onShot() {
    shots++;
    triggerWonkyPour();

    if (shots >= SHOTS_PER_BEER) {
      shots = SHOTS_PER_BEER;
      completedBeers++;
      // Run chug after the pour fully exits the screen
      setTimeout(triggerBeerComplete, 4000);
    }
  }

  function reset() {
    shots          = 0;
    completedBeers = 0;
    busy           = false;
    if (!vizEl) return;
    setLiquidLevel(0, false);
    updatePips();
    rebuildShelf();
    if (pourHandEl)  pourHandEl.classList.remove('pouring');
    if (chugHandEl)  chugHandEl.classList.remove('chugging');
    if (mugWrapEl) {
      mugWrapEl.classList.remove('dv-mug-chug', 'dv-mug-slosh');
      mugWrapEl.style.opacity = '1';
    }
    if (flyingMugEl) {
      flyingMugEl.classList.remove('throwing', 'placing');
      flyingMugEl.style.left = '-9999px';
    }
  }

  return { init, onShot, reset };
})();
