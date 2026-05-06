# 🍺 Power Hour

A simple, mobile-first drinking game timer that runs entirely in your browser — no app store, no Xcode, no backend.

## What it does

- Press **Start** to begin a 60-minute session
- Runs **60 rounds**, each exactly **1 minute** long
- Shows a large countdown timer (`MM:SS`) and the current round
- At the end of every minute:
  - Plays a short beep sound
  - Flashes a bold **"DRINK!"** alert on screen
  - Automatically starts the next round
- After 60 rounds: stops and shows **"Game Over"**
- **Pause / Resume** and **Reset** buttons are available once the timer starts
- Progress bar tracks how far through the 60 rounds you are
- Tries to keep the screen awake while the timer runs (where supported)

---

## Running it locally

No build step needed — just open `index.html` in any browser.

```bash
git clone https://github.com/benkoreneff/beer-hour.git
cd beer-hour
open index.html          # macOS
# or just drag index.html into your browser
```

For the best local experience with a live-reload server:

```bash
npx serve .
# then open http://localhost:3000
```

---

## Deploying with GitHub Pages

1. Push the repo to GitHub (already done if you cloned this).
2. Go to **Settings → Pages** in your GitHub repo.
3. Under **Source**, select `Deploy from a branch`.
4. Choose `main` branch, `/ (root)` folder, and click **Save**.
5. GitHub will publish the site at:
   ```
   https://<your-username>.github.io/<repo-name>/
   ```
6. Wait ~30 seconds, then open that URL on your iPhone.

---

## Using it on iPhone

1. Open the GitHub Pages URL in **Safari**.
2. Tap the **Share** button (box with arrow) → **Add to Home Screen**.
3. Give it a name (e.g. "Power Hour") and tap **Add**.
4. Open it from your Home Screen — it runs full-screen like a native app.
5. Tap **Start** and enjoy.

> **Tip:** The very first tap on **Start** also unlocks the audio engine.
> After that, the beep will play on every round end.

---

## Sound on iPhone — known limitations

| Situation | Behaviour |
|-----------|-----------|
| App opened in Safari normally | Sound plays after the first user tap (Start) |
| App saved to Home Screen (standalone mode) | Same — sound works after first tap |
| iPhone is on **Silent mode** | Beep is muted; the visual "DRINK!" flash still works |
| Low Power Mode / locked screen | Screen may dim; wake-lock is best-effort only |
| Vibration | Not supported on iPhone Safari; Android devices will vibrate |

### How it's handled

- **Audio context** is created and resumed on the first user interaction (the Start button), satisfying Safari's autoplay policy.
- If sound can't play for any reason:
  - A large red **"DRINK!"** text flashes on screen
  - The background flashes red as an additional visual cue
- No third-party audio libraries are used — just the native Web Audio API.

---

## Repo structure

```
beer-hour/
├── index.html      # App shell & markup
├── style.css       # All styles (dark theme, responsive)
├── script.js       # Timer logic, audio, wake-lock
├── manifest.json   # PWA manifest (Home Screen support)
├── icons/
│   ├── icon.svg    # Source icon (edit as you like)
│   ├── icon-192.png  # Add these PNGs to enable the custom icon
│   ├── icon-512.png  #   (see icons/README.txt)
│   └── README.txt
└── README.md
```

---

## Technical notes

- **Drift correction** — the timer uses `performance.now()` snapshots instead of counting `setInterval` fires, so the countdown stays accurate even if the browser throttles background tabs.
- **Wake Lock API** — the app requests a screen wake lock when the timer is running, so your screen won't dim mid-game. This is re-acquired automatically if you switch apps and come back.
- **PWA** — `manifest.json` enables "Add to Home Screen" with a custom name, splash screen colour, and standalone display mode.
- **No frameworks** — plain HTML, CSS, and vanilla JS. Easy to read and modify.
