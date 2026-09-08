# Narrative Styles Portal — Architecture

**Agents:** read this file before adding features. Extend these seams; do not break Editor, Automate, freeze/bake, or PNG export. See `.cursor/rules/architecture-first.mdc`.

Sports poster lab: design a **1080×1350 (4:5)** layout in the Editor, freeze it as JSON, then fill text/images in Automate and export PNG. There is no backend. The browser is the runtime.

This document describes the **vanilla JS app** in this folder and the **React shell** strangler in `react-editor/`. Vanilla `index.html` / `automate.html` remain the fallback until React parity soak is complete.

---

## 1. What the system does

Two human surfaces, one render engine:

| Surface | File | Job |
|---|---|---|
| **Editor** | `index.html` (vanilla) or `react-editor/` `/` | Place layers, drag geometry, colors, shapes, save a frozen template |
| **Automate** | `automate.html` (vanilla) or `react-editor/` `/automate` | Pick a frozen template, swap copy + images, export PNG |

Automate does **not** re-implement drawing. It loads the Editor in a headless iframe (`index.html?headless=1`) and talks to `window.__RENDER_API_V3__`. The React Editor uses `index.html?embed=1` (hides vanilla chrome; keeps `#stage`) and the same API plus editor bridge methods.

```
┌─────────────┐     iframe ?headless=1      ┌──────────────────────┐
│ automate.html│ ─────────────────────────► │ index.html (engine)  │
│  form UI     │   __RENDER_API_V3__        │  1080×1350 #stage    │
└─────────────┘   setPayload / exportPng    └──────────┬───────────┘
                                                       │
                         ┌─────────────────────────────┼─────────────────────────────┐
                         ▼                             ▼                             ▼
                templates/*.json              renderer/*.js                   html2canvas PNG
                manifest.json                 stories.players.js              localStorage bake
```

---

## 2. Repository layout

```
narrative-styles-portal/
├── index.html                 Editor + render engine (single-page app)
├── automate.html              Fill-and-export UI (iframe host)
├── architecture.md            This file
│
├── renderer/
│   ├── template-loader.js     Load JSON templates → TEMPLATES runtime
│   ├── render-engine.js       Story mapping, theme tokens, stat auto-fit
│   ├── photo-palette.js       Palette from player photo (ColorThief)
│   ├── magazine-header-colors.js  Text color from sampled photo behind headers
│   ├── theme-colors.js        ESM duplicate of theme helpers (not loaded by index.html)
│   └── index.html             Legacy redirect (stale; points at index_2.html)
│
├── templates/
│   ├── manifest.json          Seed files listed here are loaded
│   └── *.json                 Frozen layouts (layers, automation, defaults)
│
├── server/                    Express + MongoDB template API (port 8787)
│   └── server.js              GET/POST /api/templates — durable Save for Automate
│
├── assets/
│   ├── library.json           Sidebar asset catalog
│   ├── player/ background/ logo/ conference/ sponsor/ shape/
│
├── stories.players.js         Bundled sample stories (window.__BUNDLED_STORIES__)
├── stories.players.json       Same data as JSON (optional fetch)
│
└── react-editor/              React + Tailwind shell (strangler); iframe → engine
    ├── src/pages/             EditorPage, AutomatePage
    ├── src/engine/            usePosterEngine.js (API wait + subscribe)
    └── README.md              npm run dev; /portal/* proxy to this folder
```

Must be served over HTTP (not `file://`) so `fetch` can load `templates/manifest.json`. For the React app: `cd react-editor && npm run dev` (Vite serves parent files under `/portal/`).

---

## 2b. React shell (strangler)

```
react-editor (UI chrome)
    │  iframe ?embed=1 | ?headless=1
    ▼
index.html engine (#stage + paint/drag/bake)
    │  __RENDER_API_V3__
    ▼
templates / renderer / html2canvas
```

- **UI only:** Abyssale-like layout (layers | canvas | properties). No groups / Auto Layout / multi-format.
- **Do not** reimplement `render()` or pointer handles in React.
- Embed CSS: `body.embed` hides `#side` / banners; headless unchanged for Automate.
- Bridge extras: `subscribe`, `listLayers`, `selectLayer`, `setLayerGeometry`, `bakeTemplate`, `createTemplate`, `addTextField`, etc. (see `react-editor/README.md`).
- Cutover: use React when smoke checklist passes; keep vanilla URLs as rollback.

---

## 3. Boot sequence

Scripts in `index.html`:

1. html2canvas (CDN)
2. `renderer/render-engine.js` → `PosterRenderEngine`
3. `renderer/template-loader.js` → `PosterTemplateLoader`
4. `renderer/photo-palette.js` → `PosterPhotoPalette`
5. `renderer/magazine-header-colors.js` → header sampling
6. `stories.players.js`
7. Inline editor (~5k lines): `state`, `render()`, inspector, bake, `__RENDER_API_V3__`

`init()`:

1. `loadState()` from `localStorage` key `posterEditor.v3` (skipped when `?headless=1`)
2. `PosterTemplateLoader.loadAll()` from `templates/manifest.json`
3. `restoreBakedTemplates()` from `posterEditor.v3.bakedTemplates`
4. Headless: `loadEditorSessionForAutomate()` (labels + layout styles)
5. Seed default images baked into the template JSON
6. `ensureLayout()` — do **not** freeze-reset in the Editor (so drags persist). Automate first paint / Reset uses `freeze_layout: true`; later fills use `preserve_layout: true` so export nudges stick
7. `refreshEditorUI()` + first `render()`

---

## 4. Runtime objects

### 4.1 `state` (session)

Held in `index.html`. Not a framework store.

| Field | Role |
|---|---|
| `template` | Active template id (`magazine`, `cc`, …) |
| `text` | Bind → string (`playerName`, `heroNumber`, …) |
| `colors` | Brand tokens (`primary`, `secondary`, derived `onPrimary`, …) |
| `templateImages` | templateId → slot (`player`, `background`, `logo`, `conference`, `sponsor`) → `{src, natW, natH, el}` |
| `layouts` | templateId → layerId → geometry/style overrides (x, y, w, h, fill, gradient, …) |
| `extraLayers` | Layers added in-session (shapes, duplicates) not yet in disk JSON |
| `fieldLabels` | Renamed Automate field labels |
| `selected` / `cropMode` / `zoom` | Editor chrome |

### 4.2 `TEMPLATES`

Empty object filled by the loader. Each entry is a **runtime template**:

```js
{
  name,
  _json,          // original disk JSON
  stageBg(),      // canvas CSS background, {{primary}} interpolated
  deco(),         // decorative HTML (vignettes, lines)
  get layers()    // id → layer def; may merge authoring + live layouts
}
```

Visible layers on the stage:

```
layersOf() = TEMPLATES[id].layers  ∪  state.extraLayers[id]
ensureLayout()[id]                 // per-layer geo the user can drag
```

`render()` walks `layersOf()`, skips `hidden`, paints `#stage`.

---

## 5. Template JSON (source of truth)

Disk files listed in `templates/manifest.json` seed the engine. Editor **Save** also upserts to Mongo via `server/` (`POST /api/templates`). React Editor/Automate call `injectRemoteTemplates` so DB templates appear without committing JSON to disk. localStorage bakes remain a session overlay. Formats **⋮** menu: **Copy template** (`duplicateTemplate` → new id + `PUT` Atlas) and **Delete** (`DELETE /api/templates/:id` + `removeRemoteTemplate`; disk seeds stay).

### 5.1 Shape of a file

```json
{
  "id": "magazine",
  "name": "Magazine",
  "canvas": { "width": 1080, "height": 1350, "background": "#E8E0D4" },
  "deco": { "html": "" },
  "textRules": { "autoFit": [], "stats": { "autoFit": false } },
  "settings": {
    "freezeLayout": true,
    "logo": { "opacity": 1, "scale": 1 },
    "brandColors": { "fromLogo": false },
    "playerImage": { "fit": "contain", "cropX": 0.5, "cropY": 0.4 }
  },
  "layers": [ /* see §6 */ ],
  "automation": {
    "freezeLayout": true,
    "swapFields": ["playerName", "heroNumber", "callout", "..."],
    "swapImages": ["player", "logo", "conference", "sponsor", "background"],
    "fieldLabels": { "heroNumber": "stat value" }
  },
  "defaults": { "images": { "player": { "src": "data:image/..." } } },
  "_bakeMeta": { "bakedAt": "...", "shapeCount": 1 }
}
```

A template is **frozen** when `settings.freezeLayout`, `automation.freezeLayout`, or `_bakeMeta` is set. Frozen templates keep Automate from running stock layout migrations (Salukis / Vapor / Magazine defaults).

**Category** (`category` on JSON + Mongo): `player` | `team` | `player_no_image`. Missing / legacy docs default to **`player`** (Player poster). Editor Formats and Automate filter by category; **+ Add** creates a blank starter for the active tab; Save upserts `category` with the template.

### 5.2 Loader

`PosterTemplateLoader.loadAll()`:

1. Fetch `templates/manifest.json`
2. Fetch each listed file
3. Optionally merge `layouts/authoring/{id}.json` if present
4. `toRuntimeTemplate(json)` into `TEMPLATES[json.id]`
5. Apply `settings` (logo scale, vapor glass, authoring extras)

Template **id** is the JSON `id` field, not the filename (`coastal carolina.json` → `cc`).

---

## 6. Layer model

Every layer is a rectangle on the 1080×1350 stage plus a `type`.

| `type` | Bound to | Paint |
|---|---|---|
| `image` | `bind`: player / background / logo / conference / sponsor | Photo in `.imgcontent` (fit, zoom, crop, flip) |
| `text` | `bind`: playerName, heroNumber, callout, … | HTML + font autofit into a **fixed box** |
| `block` | optional `shape` + `clip` | SVG data-URL fill (solid or gradient) |
| `glass` | vapor_motion card | Frosted panel |

### 6.1 Text

- Box size is fixed (`g.w` / `g.h`). Font shrinks/grows (`fitTextToFixedBox`) like Canva autofit.
- `bind` maps to `state.text[bind]`. Empty user value stays empty (placeholder only if never set).
- Stats use `kind: "stat"` plus `stat1num` / `stat1label` binds.
- Color: role (`primary`) or hex, optional `gradient` (`linear` / `radial`).

### 6.2 Images

Slots: `player`, `background`, `logo`, `conference`, `sponsor`. Missing conference/sponsor/background skips the layer. Player still shows an empty placeholder.

**Smart crop (React):** After player upload, a modal uses the template player frame (`getImageFrame`, e.g. 560×1017). Drag/zoom to compose; **Remove background** runs in-browser `@imgly/background-removal` via `setImageCutout` (needs network on first model download). **Apply fit** → `applySmartCrop` bakes a cover crop (PNG if alpha) and sets `fit:contain`.

### 6.3 Shapes (`block`)

`SHAPE_PRESETS` in `index.html`: circle, square, rectangle, rounded, oval, triangle, diamond, parallelogram, pill, bar.

- Presets with polygons store CSS `clip` (`polygon(...)`).
- Live + export paint via CSS fill / SVG data URL (html2canvas drops CSS `clip-path`).
- Fill: solid role/hex, or **`gradient: { type, from, to, angle }`** (React Styles → Solid / Gradient).
- Selecting a shape then clicking another preset **morphs that layer in place**. Shift-click / empty canvas adds a new extra layer.

### 6.4 Z-order

CSS `z-index` from `g.z ?? def.z`. Typical: background `1`, player `12`, type `22`, shapes `~28–40`.

---

## 7. Render pipeline

```
render()
  ensureLayout()
  #stage background = template.stageBg()
  wipe DOM; inject deco HTML
  for each visible layer:
      position from layout geo
      paint by type (image / glass / block SVG / text)
      8 resize handles + rotate handle
      attachLayerEvents (drag / resize / rotate)
  syncInspector()
```

Geometry writes go to `state.layouts[templateId][layerId]`. On pointer-up, `syncLayerDefGeometry` copies x/y/w/h back onto the layer def so bake/export see the drag.

**Layer lock** (`g.locked`): select still works; move / resize / rotate / pan / arrow-nudge / z-order keys are blocked. Styles panel **Lock layer** toggles it; baked into JSON. Dashed selection + handles hidden while locked.

**Undo / redo**: layout-only stacks (`pushUndo` / `undo` / `redo`, max 50). Vanilla Ctrl/Cmd+Z already works. React Editor exposes **Undo** / **Redo** in the top bar via `__RENDER_API_V3__.undo|redo|pushUndo|getHistoryState`; snapshot includes `canUndo` / `canRedo`.

**Image filters** (photo layers): `imgBrightness`, `imgContrast`, `imgBlur`, `imgGrayscale`, optional `imgDuotone` + `imgDuotoneFrom` / `imgDuotoneTo` → CSS `filter` (+ color-blend overlay for duotone). Painted in `applyImageStyle`; baked when non-default. Styles panel **Filters** section; does not change crop/fit math.

**Editor vs Automate freeze**

- **Editor:** `switchTemplate` / `init` call `ensureLayout()` only. User drags stick across refresh via `localStorage`.
- **Automate:** first template paint (and **Reset layout**) uses `freeze_layout: true` → `resetLayoutFromTemplate`. Later copy/image updates pass `preserve_layout: true` so canvas drag/resize for **PNG export only** is kept. Headless never writes `posterEditor.v3`. Nudges are not Saved to Mongo; `resetAutomateLayout()` restores baked geometry.

---

## 8. Color system

```
Brand primary / secondary
        │
        ▼
PosterRenderEngine.enrichThemeColors()
        │  onPrimary, onContrast, calloutBg, onPhoto, …
        ▼
roleColor("primary") | hex | gradient { from, to, angle, type }
        │
        ├── text: color or background-clip:text
        └── shapes: SVG stops
```

Optional auto palettes:

- **From logo** — `settings.brandColors.fromLogo` or `state.autoPalette`
- **From player photo** — `PosterPhotoPalette` (ColorThief / bucket fallback)
- **Magazine / Salukis headers** — sample pixels under name/meta/eyebrow, pick light or dark type

`{{primary}}` / `{{secondary}}` in `canvas.background` and `deco.html` are interpolated by the loader.

**Text fill & stroke (Editor inspector)**

- Fill: role (`primary`, `white`, …) **or** `#RRGGBB` via Hex / swatch → stored on layer as `color`.
- Optional **gradient** (same `gradient: { type, from, to, angle }` as shapes) → CSS `background-clip: text` on `.txt-flow` (chip `bg` uses `backgroundColor` so it doesn’t wipe the fill). Baked on Save.
- Stroke: optional outline (`stroke` + `strokeW`) with the same role-or-hex pattern → `webkitTextStroke` at paint time; baked into frozen JSON when enabled.
- Effects (React Styles panel): **Drop** / **Glow** / **Echo** → CSS `text-shadow` via `shadowEffect`, `shadowDir`, `shadowOffset`, `shadowBlur`, `shadowOpacity`, `shadowColor`. Baked on Save; Automate keeps them frozen.

---

## 9. Persistence

| Store | Key | Contents |
|---|---|---|
| Editor session | `posterEditor.v3` | template, colors, text, layouts, extraLayers, fieldLabels, images |
| Baked templates | `posterEditor.v3.bakedTemplates` | Full JSON copies so Automate sees last Save without a disk write |
| Disk | `templates/*.json` + `manifest.json` | Seed / shareable source (git) |
| MongoDB | `narrative_styles.templates` | Durable Save from React Editor → listed dynamically in Automate |

**Save editor → template** (`buildFrozenTemplateJSON` + React `saveTemplateToDb`):

1. Merge template layers + extras + current geo
2. Set `freezeLayout: true`, `automation.swapFields` / `swapImages`
3. Embed durable default images (data URLs)
4. `PosterTemplateLoader.rebuildFromJson` (live)
5. Write `localStorage` bake map
6. React Editor: `POST /api/templates` (upsert); Automate refreshes via `GET /api/templates` + `injectRemoteTemplates`
7. Optionally download `{id}.json` for `templates/` (git / offline)

Quota: oversized images are dropped from session save; bake retries with player+background only. Mongo docs max ~16MB — huge embedded data-URLs can fail Save.

---

## 10. Automate + `__RENDER_API_V3__`

`automate.html` waits for the iframe API, then `listTemplates()` (frozen first). Each field/image change debounces `setPayload`.

```js
__RENDER_API_V3__ = {
  setPayload(payload),      // template, text, colors, images, freeze_layout, preserve_layout
  freezeCurrentLayout(),
  resetAutomateLayout(),    // re-apply baked positions (clears export-only nudges)
  getImageFrame(bind),      // template slot box size (player w×h)
  applySmartCrop(bind, opts), // bake cover crop to frame / or live cover+zoom
  listTemplates(),          // id, name, frozen, fields, images, automation
  getTemplateFields(id),
  bakeTemplate,             // bake + return { snapshot, json }
  injectRemoteTemplates,    // merge DB / remote JSON into TEMPLATES
  undo / redo / pushUndo / getHistoryState,  // layout history (React Undo/Redo)
  exportPng(),              // data URL
  exportPngBuffer(),
  render(),
  applyStory,
  loadImageFromUrl,
  getState(),
}
```

`setPayload` image aliases: `player_image` / `playerImageUrl`, `logo_url`, `conference_logo`, `sponsor_logo`, `background_image`.

Pass `preserve_layout: true` on Automate fill updates so drag/resize of text and images stay for **PNG export only** (not written to Atlas / bake). Template switch or `resetAutomateLayout()` restores baked geometry.

React Automate loads file templates from the iframe, then merges Mongo via `GET /api/templates` → `injectRemoteTemplates`. Use **Refresh** on Automate if you Saved in another tab.

Export: park `#stage` off-screen at native 1080×1350, `html2canvas` scale 2, download PNG. Clipped shapes already have SVG `<img>` children so clip-path is not required.

---

## 11. Stories

`PosterRenderEngine.mapStoryToText(story)` maps a sports story record onto binds:

`player_name` → `playerName`, `hero_stat_number` → `heroNumber`, `stat_line_1` → `stat1num`, sport abbreviation, etc.

**Stories update copy only** in the Editor — they do not overwrite brand `primary` / `secondary` (that used to make role-colored text jump when changing Stories). Use `applyStory(story, { applyColors:true })` only if you explicitly want story team colors. Automate still sends its own `colors` via `setPayload`.

Editor can cycle bundled stories; Automate can pass `payload.story`.

---

## 12. Asset library

`assets/library.json` catalogs files under `assets/`. Clicking a card:

- **player / background / logo / conference / sponsor** → load into that image slot
- **shape** with `preset` → `addShapeLayer(preset)` (editable block)
- **shape** without preset → floating `image` layer (`shape_img_*`)
- **effect** → full-canvas overlay layer (`effect_*`) from `assets/effects/` (drag/resize like any image)

---

## 13. Constraints (intentional)

- **Canvas is always 1080×1350.** Zoom is CSS transform on `#stage`; export ignores zoom.
- **No server.** Serve static files; JSON load requires HTTP.
- **JSON-only templates.** `manifest.json` is the allow-list.
- **Paint stays in the engine HTML.** Shared math lives in `renderer/`; stage paint/drag/bake live in `index.html`. React only wraps chrome via iframe + `__RENDER_API_V3__`.
- **html2canvas is the PNG path.** Prefer DOM the library can rasterize (inline SVG images for shapes, real `<img>` for photos).
- **Vanilla remains rollback.** Prefer `react-editor` for UI work after soak; keep `index.html` / `automate.html` until cutover is explicit.

---

## 13b. Migration progress

```
- [x] Phase 0 baseline checklist (react-editor/SMOKE_CHECKLIST.md)
- [x] Phase 1 embed mode + bridge
- [x] Phase 2 React JS + Tailwind Abyssale shell + StageHost
- [x] Phase 3 Editor actions via bridge
- [x] Phase 4 Automate React page
- [x] Phase 5 architecture + README; vanilla rollback retained
```

---

## 14. How to extend

**New template**

1. Duplicate a JSON under `templates/`, unique `id`
2. Add the filename to `templates/manifest.json`
3. Refresh Editor

**New template (in Editor)**

React **+ Create template** → `__RENDER_API_V3__.createTemplate({ name, category })` builds a blank 1080×1350 for that category (`player` / `team` / `player_no_image`). Edit, then **Save** to upsert Atlas (includes `category`).

**New text field**

React **+ Add text field** → `__RENDER_API_V3__.addTextField({ label })` adds a `type:"text"` layer with a new `bind` (also listed in Automate after Save). Or hand-edit JSON layers the same way.

**Rename / delete text field**

React **Text fields** panel → **Rename** (`renameTextField(bind, label)`) updates `automation.fieldLabels` + layer labels. **Remove** (`deleteTextField(bind)`) permanently drops the layer(s), bind, and swapFields entry from the live template JSON. **Save** then upserts Atlas without that field (Automate list refreshes after sync).

**New shape preset**

Add an entry to `SHAPE_PRESETS` (w/h, radius, optional `clip` polygon). Optionally add an SVG + `library.json` row.

**New font**

Add `@font-face` (file under `assets/fonts/`), a key on `F` / `FONT_OPTS` in `index.html`, and the same key in `renderer/template-loader.js` `FONT_KEYS` so bake/load round-trips. Existing families stay Google Fonts.

**Headless / pipeline**

Load `index.html?headless=1` and call `__RENDER_API_V3__.setPayload` then `exportPng`. Comment at top of `index.html`: this lab API is **not** the production `POST /posters/render` path.
