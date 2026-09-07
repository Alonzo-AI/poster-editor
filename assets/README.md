# Poster assets

Drop images here and list them in `library.json` so they show up in the **Asset library** sidebar.

```
assets/
  player/        → Player cutouts / portraits
  background/    → Full-canvas backgrounds
  logo/          → Team marks
  conference/    → Conference logos + shape SVGs
  sponsor/       → Sponsor marks
  shape/         → Canva-style shape SVGs
  effects/       → Overlay PNGs (shadows, blurs, etc.)
  library.json   → Catalog shown in the editor
  fonts/         → Local @font-face files (e.g. Avenir Regular)
```

## Shapes

Use **Shapes (Canva-style)** in the sidebar to place editable shapes (circle, square, rectangle, rounded, oval, triangle, diamond, parallelogram, pill, bar). Those are live layers you can resize, recolor, and rotate.

SVG copies also live in `assets/shape/` and `assets/conference/` for the Asset library.

## Effects

Put overlay PNGs in `assets/effects/` and list them in `library.json` with `"slot": "effect"`. Clicking one drops a full-canvas overlay you can drag/resize.

## library.json entry

```json
{
  "id": "my-player-1",
  "name": "My Player",
  "slot": "player",
  "src": "assets/player/my-player.png",
  "tags": ["player"]
}
```

`slot` must be one of: `player`, `background`, `logo`, `conference`, `sponsor`.
