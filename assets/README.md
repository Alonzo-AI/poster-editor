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
  library.json   → Catalog shown in the editor
```

## Shapes

Use **Shapes (Canva-style)** in the sidebar to place editable shapes (circle, square, rectangle, rounded, oval, triangle, diamond, parallelogram, pill, bar). Those are live layers you can resize, recolor, and rotate.

SVG copies also live in `assets/shape/` and `assets/conference/` for the Asset library.

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
