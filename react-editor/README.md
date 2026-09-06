# React Poster Lab (strangler)

React + Tailwind + JavaScript shell around the existing vanilla stage engine.

## Run

```bash
cd narrative-styles-portal/react-editor
npm install
npm run dev
```

Open http://127.0.0.1:5173/

- `/` — Editor (Abyssale-style: layers left, canvas center, properties right)
- `/automate` — Automate fill + PNG export

The canvas is an iframe to `/portal/index.html?embed=1` (Editor) or `?headless=1` (Automate). Vite serves the parent portal folder under `/portal/*` and proxies `/api` → `http://127.0.0.1:8787`.

## Persist templates (Mongo)

You no longer need to download JSON into `templates/` for Automate to see edits.

1. Start Mongo + API (see [`../server/README.md`](../server/README.md)):

```bash
cd narrative-styles-portal/server && npm i && npm run dev
```

2. In Editor: set **Save as id / name** → **Save**. Status should say `Saved to DB`.
3. Open **Automate** (or hit **Refresh**) — the template chip appears and stays frozen for fill/export.

**Download** still exports a file for git/`templates/manifest.json` if you want a seed on disk.

## Engine bridge

`window.__RENDER_API_V3__` (existing Automate API) plus editor helpers:

- `subscribe`, `getEditorSnapshot`, `listLayers`, `selectLayer`
- `switchTemplate`, `setTextValue`, `setBrandColors`, `setLayerGeometry`
- `addShape`, `listShapePresets`, `addTextField`, `listTextFields`, `renameTextField`, `deleteTextField`, `createTemplate`
- `bakeTemplate` (returns `{ snapshot, json }`)
- `injectRemoteTemplates` (merge DB JSON into the live engine)
- `zoomFit` / `zoomIn` / `zoomOut` / `toggleFrameGuide` / `deselect`
- existing `setPayload`, `exportPng`, `listTemplates`, …

## Rollback

Vanilla remains the live fallback:

- Editor: `narrative-styles-portal/index.html`
- Automate: `narrative-styles-portal/automate.html`

See [SMOKE_CHECKLIST.md](./SMOKE_CHECKLIST.md).

## Stack

- React 19, Vite 8, Tailwind 4, react-router-dom
- No second paint engine — drag / autofit / bake / html2canvas stay in `index.html`
