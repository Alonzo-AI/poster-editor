# Smoke checklist (vanilla baseline)

Vanilla remains the default entry until React parity: open `index.html` and `automate.html` via a local HTTP server (not `file://`).

## Editor (`index.html`)

- [ ] Templates load from `templates/manifest.json`
- [ ] Switch template; layers appear on 1080×1350 stage
- [ ] Drag / resize / rotate a layer; refresh keeps Editor positions (localStorage)
- [ ] Text autofit stays inside fixed box
- [ ] Add shape; fill/gradient in inspector; Save bake
- [ ] Asset library loads into player / logo / etc. slots
- [ ] Export PNG downloads

## Automate (`automate.html`)

- [ ] Iframe engine starts (`?headless=1`)
- [ ] Template chips list; frozen templates preferred
- [ ] Edit text / colors / images → live preview
- [ ] Export PNG; layout stays frozen from editor Save

## React path (after migration)

- [x] `cd react-editor && npm i && npm run dev`
- [x] Editor: layers list ↔ stage selection sync
- [x] Property change updates stage
- [x] Save / Export PNG work through embed bridge
- [x] `/automate` fill + export matches vanilla Automate
- [x] Stories / image slots / asset library wired via bridge
