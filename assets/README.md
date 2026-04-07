# Assets

Drop your custom media files here — Beer Hour will pick them up automatically.

## drink.gif

An animated GIF displayed on screen every time the "DRINK!" alert fires.

- **Filename:** `drink.gif` (exact name required)
- Any GIF will work — funny reaction GIFs are highly recommended 🍺
- If the file is missing, the DRINK alert still works, just without the GIF

## drink.mp3

A short audio clip that plays **at the same time** as the DRINK alert and GIF — think air horn, crowd cheer, party sound, etc.

- **Filename:** `drink.mp3` (exact name required)
- Plays once per round end, in sync with the GIF and "DRINK!" text
- If the file is missing, only the synthesized horn plays (still loud)
- MP3, OGG, or AAC all work — just rename to `drink.mp3`

## drink2.mp3

A **second audio track** that plays **in parallel** with `drink.mp3` — use it for a song, longer clip, or a layered sound effect.

- **Filename:** `drink2.mp3` (exact name required)
- Starts at exactly the same moment as `drink.mp3`
- Independent volume — both play at full volume simultaneously
- If the file is missing, only `drink.mp3` plays (no error)
