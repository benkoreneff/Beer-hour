# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running locally

No build step. Open `index.html` directly in a browser, or use a live-reload server:

```bash
npx serve .
# open http://localhost:3000
```

There are no tests, no linter, and no package.json.

## Architecture

Five files make up the entire app. Script load order in `index.html` is significant:

1. `spotify.js` — loaded first, exposes `spotify` global
2. `drinkViz.js` — loaded second, exposes `drinkViz` global
3. `script.js` — loaded last, orchestrates everything

### `script.js`
Main game controller. Owns the timer loop (drift-corrected via `performance.now()`), Web Audio API synthesis, Wake Lock, setup screen, player tab, and game-over panel. Exposes a `window.BeerHour` bridge so sub-modules can access shared state without circular deps:
- `window.BeerHour.getAudioCtx()` — the shared AudioContext
- `window.BeerHour.getConfig()` — game config object (includes `sfx` flag)

Key integration points where sub-modules are called:
- `launchGame()` → `drinkViz.init()`, `spotify.reset()`
- `onRoundEnd()` → `drinkViz.onShot()`, `spotify.playNextTrack()`
- `pauseTimer()` → `spotify.pausePlayback()`
- `resumeTimer()` → `spotify.resumePlayback()`
- `fullReset()` → `drinkViz.reset()`, `spotify.stopPlayback()`

### `drinkViz.js`
IIFE module. Tracks shots (1 per round) and beers (1 per 8 shots). Renders an animated SVG mug that fills up, a pour-arm animation, shot pips, and a completed-beer icon row. All SVG is generated as inline strings — no external assets. Sound is synthesised via the shared AudioContext from `window.BeerHour.getAudioCtx()`.

Public API: `drinkViz.init()`, `drinkViz.onShot()`, `drinkViz.reset()`

### `spotify.js`
PKCE OAuth flow against the Spotify Web API. Tokens stored in `localStorage`. Exposes the `spotify` object with `enabled`, `tracks[]`, and async playback methods. The Client ID (`SP_CLIENT_ID`) is hardcoded at the top of this file — update it if registering a new Spotify app. Tracks start playback at 30% of their duration to jump past intros.

### `style.css`
Single stylesheet. CSS custom properties defined on `:root` — use these vars for any colour or radius changes. The `#drink-viz` section at the bottom controls the visualiser layout.

### Assets
- `assets/drink.gif` — fullscreen overlay GIF shown at round end (6 s)
- `assets/drink.mp3` / `assets/drink2.mp3` — played simultaneously at round end
- Missing asset files are silently ignored (load/error handlers in `script.js`)

## Key behaviours to preserve

- **Audio unlock**: `AudioContext` is created on the first user tap (Start button) to satisfy Safari's autoplay policy. Never create it before a user gesture.
- **Drift correction**: the timer uses `performance.now()` snapshots, not interval counts. Don't replace this with a simple counter.
- **`drink-alert` overlay**: shown for exactly 6 000 ms then hidden. The pour animation in `drinkViz` is a separate, smaller in-page animation triggered at the same time.
