# Poster Editor — Architecture

**Agents: READ THIS FILE BEFORE ANY CODE CHANGE.**  
Treat it as the contract for Editor, Automate, Save, teams, fonts, canvas, and export.  
**Fix or add one thing without breaking others.** If a change touches Save, teams, fonts, bake, or `index.html` paint, re-check the invariants below.

Sports poster lab: design a **1080×1350 (4:5)** layout in the Editor, freeze it as JSON, fill text/images in Automate, export PNG.

Stack:

| Piece | Role |
|---|---|
| **Engine** | `index.html` — stage paint, drag, bake, `window.__RENDER_API_V3__` |
| **React UI** | `react-editor/` — Editor + Automate chrome (iframe → engine) |
| **API** | `server/` — Mongo Atlas templates/teams + S3 upload/media proxy (port **8787**) |
| **Vite UI** | typically **8518** (`react-editor`); proxies `/portal/*` to parent engine files |

Vanilla `index.html` / `automate.html` remain rollback. Prefer React for UI work.

---

## 0. Agent rules (do not violate)

### 0.1 Always

1. Read this file before editing.
2. Prefer the smallest change that fixes the request.
3. Keep Editor canvas, Automate fill/export, Save/bake, and team folders working.
4. Do not reimplement `render()` or pointer handles in React — call `__RENDER_API_V3__`.
5. After a fix, mentally check: **Save · Teams · Fonts · Canvas · Automate PNG**.

### 0.2 Hard invariants

| Invariant | Rule |
|---|---|
| **Canvas size** | Always **1080×1350**. Zoom is CSS only; export ignores zoom. |
| **Paint ownership** | Stage paint/drag/bake live in `index.html`. React is chrome only. |
| **Category ≠ college** | `category` = poster type (`player` \| `team` \| `player_no_image` \| `nostalgia_player` \| `nostalgia_team`). `teamKey` / `teamLabel` = **college folder**. Never conflate them. |
| **Save ≠ filter** | **Save** keeps the **active template’s** `teamKey` / `teamLabel` / `category`. Sidebar `formatTeamKey` / `formatCategory` are **filters only** — never use them to reassign ownership on Save. |
| **Create vs Save vs Move** | **+ Add** may use the selected college/category. **Save** never moves college. **Move to team** (or explicit meta PATCH) is the only college reassignment. |
| **Upsert by id** | `PUT/POST /api/templates` overwrites the same Mongo doc for that `id`. Do not invent a new id on normal Save. |
| **Fonts persist** | Selected fonts must survive Save/reload. Built-ins may use short keys (`disp` → Anton). **Remote/S3 fonts** must persist as the **full CSS stack** (never fuzzy-map names containing “anton” onto `disp`). |
| **Local fonts stay** | Files in `assets/fonts/` + existing `@font-face` / `F` / `FONT_OPTS` must keep working. Remote fonts **append**, do not replace. |
| **Automate freeze** | First paint / Reset → `freeze_layout`. Later fills → `preserve_layout: true`. Headless must not wipe Editor session storage. |
| **Export path** | PNG via html2canvas on `#stage`. Prefer real `<img>` and inline SVG for shapes. |
| **Private S3** | Bucket objects are served through `/api/media/...`, not public ACL assumptions. |
| **Projects ≠ templates** | Bulk / CSV posters live in Mongo `projects` (`/api/projects`). They must never be written to `templates` or appear in Editor Formats / Automate catalogs. `/` and `/automate` stay unchanged; landing is `/home`. |

### 0.3 Safe change map

| If you change… | Do not break… |
|---|---|
| Save / bake / `onBake` | Team ownership, category, canvas geo, image defaults, Automate freeze |
| Team folder UI | Save ownership, template ids, category filter |
| Fonts / `loadRemoteFonts` | Local `F`/`FONT_OPTS`, bake persistence, picker refresh |
| Layer drag / styles | Bake geo sync, lock, undo, export |
| Uploads / S3 | `/api/media` proxy, CORS for fonts, template image slots |
| Mongo schema | `teamKey`, `category`, upsert-by-`id` |

### 0.4 Known footguns (already fixed once — do not reintroduce)

1. **Save falling back to `formatTeamKey` / stale React `snapshot.teamKey`** → templates land under the wrong college. Ownership must come from engine template / baked JSON / `listTemplates` for **that id** only.
2. **`fontKeyFromValue` substring `includes("anton")`** → remote “Anton Regular” became `disp` (Anton). Persist exact `F` key or full CSS stack via `fontToPersisted`.
3. **Remote fonts loaded after React mount** → picker empty until `notifyEditorBridge("remote-fonts")` / refresh `listFontOptions`.
4. **God file** `index.html` — many concerns share one file; touch the smallest region and re-test nearby behaviors.
5. **Automate shared `text` form** — never merge previous template fills into the next. Each template hydrates from its JSON (`defaults.text` / placeholders) or its own session cache; `setPayload` on switch must `applyTemplateTextFromPlaceholders` before overlaying payload keys.
6. **Automate catalog vs Editor** — Automate list is **Mongo-authoritative** (`mergeTemplateCatalog(..., { dbAuthority:true })`). Lite sync must still patch `teamKey`/`category` on hydrated templates. Headless sync may prune non-disk orphans; Editor embed must not (protects unsaved + Add).
7. **Project inject race** — `__RENDER_API_V3__` exists before `init()` finishes; `PosterTemplateLoader.loadAll()` clears `TEMPLATES`. Always `await ensureTemplatesLoaded()` (or `setPayload`) **before** `injectRemoteTemplates` for a project, then `setPayload({ template: id, freeze_layout:true })`.
8. **Bulk bases** — UTSA CSV bulk must clone `UTSA` / `UTSA_2` / `UTSA_3`, never prior `utsa_bulk_*` rows that may exist in `templates` from older tests.

---

## 1. What the system does

| Surface | Entry | Job |
|---|---|---|
| **Home** | `react-editor/` `/home` | Landing links to Editor, Automate, Projects |
| **Editor** | `react-editor/` `/` (iframe `index.html?embed=1`) | Layers, geometry, colors, shapes, fonts, Save frozen template |
| **Automate** | `react-editor/` `/automate` (iframe `?headless=1`) | Pick frozen template, swap copy/images, export PNG |
| **Projects** | `react-editor/` `/projects` · `/projects/:id` | CSV bulk posters in Mongo `projects` (not templates); Automate-like edit + Save |

```
react-editor (UI)
    │  iframe embed|headless
    ▼
index.html engine (#stage + __RENDER_API_V3__)
    │
    ├── templates/*.json (seeds)
    ├── Mongo via server/ (durable templates + team_folders + projects)
    ├── S3 via /api/uploads + /api/media (images + remote fonts)
    └── html2canvas PNG
```

---

## 2. Repository layout

```
poster-editor/
├── architecture.md            ← this file (agent contract)
├── index.html                 Engine: state, render, bake, fonts, __RENDER_API_V3__
├── automate.html              Vanilla Automate (rollback)
├── renderer/                  template-loader, render-engine, palettes
├── templates/                 Seed JSON + manifest.json
├── assets/
│   ├── fonts/                 Local @font-face fonts (always available)
│   ├── remote-fonts.json      Manifest of S3 remote fonts for the picker
│   └── library.json, player/, background/, logo/, …
├── s3-uploads/                Optional local college font drops (upload script source)
├── server/
│   ├── server.js              Express API :8787
│   ├── .env                   Mongo + AWS (do not commit secrets)
│   └── scripts/upload-drive-fonts-to-s3.mjs
└── react-editor/
    ├── src/pages/HomePage.jsx, EditorPage.jsx, AutomatePage.jsx,
    │         ProjectsPage.jsx, ProjectEditPage.jsx
    ├── src/lib/templateTeam.js, bulkUtsaGenerate.js
    ├── src/api/templatesApi.js, projectsApi.js, uploadsApi.js
    └── src/components/…       Properties, fonts, layers, studio panels
```

Run: API `cd server && node server.js` (8787); UI `cd react-editor && npm run dev`.

---

## 3. Boot sequence (engine)

1. html2canvas → `renderer/*` → `stories.players.js` → inline editor in `index.html`
2. `init()`:
   - `loadState()` (`posterEditor.v3`; skipped if `headless`)
   - `PosterTemplateLoader.loadAll()` from `templates/manifest.json`
   - `restoreBakedTemplates()`
   - `loadRemoteFonts()` from `assets/remote-fonts.json` → inject `@font-face`, append `FONT_OPTS`, `notifyEditorBridge("remote-fonts")`
   - seed images, `ensureLayout()`, first `render()`
3. React mounts iframe, waits for API, `subscribe`s, syncs Mongo templates via `injectRemoteTemplates`

---

## 4. Runtime objects

### 4.1 `state` (session, in `index.html`)

| Field | Role |
|---|---|
| `template` | Active template id |
| `text` | bind → string |
| `colors` | Brand tokens |
| `templateImages` | templateId → slot → image |
| `layouts` | templateId → layerId → geo/style (incl. `font` CSS stack) |
| `extraLayers` | In-session shapes/dupes not yet baked |
| `fieldLabels` | Automate field renames |
| `lockTemplateFonts` | When true, paint uses template def fonts |

### 4.2 `TEMPLATES`

Loader + Save fill `TEMPLATES[id]` with `{ name, _json, stageBg, deco, layers }`.  
`layersOf()` = template layers ∪ `extraLayers`.  
`render()` paints visible layers onto `#stage`.

`_json` holds durable fields including **`category`**, **`teamKey`**, **`teamLabel`**.

---

## 5. Template JSON + college folders

### 5.1 Dimensions

```
Team folder (teamKey)          ← college, e.g. east_carolina
  └── Category (category)      ← player | team | player_no_image | nostalgia_player | nostalgia_team
        └── Template (id)      ← slug id, upsert target
```

- Missing team → **`Unassigned`** (`__unassigned__`).
- Missing category → **`player`**.
- Empty team folders persist in Mongo collection **`team_folders`** (`GET/PUT/POST /api/teams`).

### 5.2 Ownership rules (Save)

| Action | Sets college from |
|---|---|
| **+ Add / createTemplate** | UI `formatTeamKey` + `formatCategory` |
| **Save / bakeTemplate** | **Only** active template (`templateTeamOf` / baked `_json` / `listTemplates` for that id) |
| **Move to team** | Explicit destination `teamKey` |
| **Rename team** | PATCH members’ `teamLabel`; **keep `teamKey` stable** |

**Forbidden on Save:** `formatTeamKey`, `formatCategory`, or stale React `snapshot.team*` as ownership source.

Engine bake (`bakeEditorIntoTemplate`) re-stamps:

```js
json.teamKey / teamLabel ← templateTeamOf(state.template)
json.category ← template category
```

React `EditorPage.onBake` must not override those with the sidebar filter.

### 5.3 Shape (essentials)

```json
{
  "id": "my_poster",
  "name": "My Poster",
  "category": "player",
  "teamKey": "east_carolina",
  "teamLabel": "East Carolina",
  "canvas": { "width": 1080, "height": 1350, "background": "#E8E0D4" },
  "settings": { "freezeLayout": true },
  "layers": [],
  "automation": {
    "freezeLayout": true,
    "swapFields": [],
    "swapImages": ["player", "logo", "conference", "sponsor", "background"],
    "fieldLabels": {}
  },
  "defaults": { "images": {}, "text": {} }
}
```

Frozen when `settings.freezeLayout`, `automation.freezeLayout`, or `_bakeMeta` is set.

---

## 6. Layer model

| `type` | Role |
|---|---|
| `image` | Slots: player, background, logo, conference, sponsor |
| `text` | `bind` → `state.text`; autofit in fixed box; font/color/stroke/effects |
| `block` | Shapes (`SHAPE_PRESETS`); solid or gradient fill |
| `glass` | Frosted panels (legacy vapor) |

Also: layer **lock**, **duplicate** (text gets new bind), **remove**, **z-order** / drag-reorder (`reorderLayers` + React `LayerList`), rotate, undo/redo (layout stacks).

Text fonts: `resolveFontValue` expands short keys via `F[...]`; paint uses CSS `font-family` stacks.

---

## 7. Fonts

### 7.1 Local

- Files: `assets/fonts/`
- Wired: `@font-face` + `F` + `FONT_OPTS` in `index.html`
- Also mirrored in `renderer/template-loader.js` `FONT_KEYS` for load round-trip of **short keys**

### 7.2 Remote (college / Drive → S3)

- S3 prefix: `fonts/remote/<college>/...`
- Manifest: `assets/remote-fonts.json`
- Loader: `loadRemoteFonts()` — appends `@font-face` + picker entries; notifies `remote-fonts`
- Upload: `server/scripts/upload-drive-fonts-to-s3.mjs`  
  `FONTS_SRC=... S3_FONT_PREFIX=fonts/remote/ node scripts/upload-drive-fonts-to-s3.mjs`  
  Skips basenames already in `assets/fonts`; merges manifest; keys by college folder
- Served via `/api/media/fonts/remote/...`
- Variable Figtree: expanded to Light–Black (+ italic) faces in the picker

### 7.3 Persistence

- `fontToPersisted(font)`: exact match in `F` → short key; else **keep CSS stack**
- `fontKeyFromValue`: fuzzy match only on **primary family name** (e.g. family `anton`, not `anton regular`)
- Save paths: `layerDefToJson`, `applySessionLayoutsToTemplateDefs` must use `fontToPersisted`
- React font panels refresh on `remote-fonts` (hard-refresh after new manifest uploads)

---

## 8. Render pipeline

```
render()
  ensureLayout()
  paint #stage + deco
  each visible layer → geo + type paint + handles
  syncInspector / notifyEditorBridge
```

- Geometry → `state.layouts`; pointer-up syncs onto defs for bake.
- Editor: drags persist (`ensureLayout`, localStorage). Do not freeze-reset on every Editor paint.
- Automate: freeze on first paint/Reset; `preserve_layout` on later fills.

---

## 9. Persistence & API

| Store | Contents |
|---|---|
| `posterEditor.v3` | Editor session (not headless) |
| `posterEditor.v3.bakedTemplates` | Session bake overlay |
| `templates/*.json` | Git seeds |
| Mongo `templates` | Durable Save |
| Mongo `team_folders` | Empty-capable college folders |
| S3 | Uploaded images + `fonts/remote/**` |

### 9.1 Save pipeline

1. `buildFrozenTemplateJSON` — layers + geo + defaults + freeze flags + **team/category lock**
2. Rebuild live `TEMPLATES[id]`
3. localStorage bake map
4. React: `saveTemplateToDb` → `PUT/POST /api/templates/:id` (upsert)
5. `injectRemoteTemplates(..., { sync:false })` for that id only

### 9.2 Server routes (`server/server.js`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health |
| GET/POST/PUT | `/api/teams` | Team folders |
| GET/POST/PUT/PATCH/DELETE | `/api/templates` | Template CRUD / meta |
| GET/POST/PUT/DELETE | `/api/projects` | Bulk posters (separate collection; never Formats) |
| POST | `/api/uploads` | Multipart → S3 |
| GET | `/api/media/*` | Private S3 proxy (images + fonts) |

Env: `MONGODB_URI`, `MONGODB_DB`, `AWS_*`, `S3_BUCKET`, `PORT`.

---

## 10. `__RENDER_API_V3__` (selected)

```js
setPayload / freezeCurrentLayout / resetAutomateLayout / ensureTemplatesLoaded
listTemplates          // includes category, teamKey, teamLabel
createTemplate({ name, category, teamKey, teamLabel })
bakeTemplate / duplicateTemplate / removeRemoteTemplate
injectRemoteTemplates(list, { sync, persist })
patchTemplateMeta / reorderLayers
listFontOptions / loadRemoteFonts (via init)
subscribe / getEditorSnapshot / patchLayerStyle / previewTextStyle
exportPng / exportPngBuffer
undo / redo / pushUndo / getHistoryState
```

Automate image aliases: `player_image`, `logo_url`, `conference_logo`, `sponsor_logo`, `background_image`.

---

## 11. React UI notes

- **Formats panel:** team dropdown → category → template list; **+ Add**, Copy, Delete, Move, Rename team.
- **Save (`onBake`):** ownership from baked JSON + live `listTemplates` entry for **that id** only.
- **Font picker:** `listFontOptions`; refresh on `remote-fonts`; do not default-display Anton when value is a custom stack.
- **Eyedropper:** `EyeDropper` API; call `.open()` in the same click turn.
- **Projects:** `/projects` date folders → college folders → posters; single-college CSV + multi-college CSV; Save → `/api/projects` only. Do not change `/` or `/automate`.
- Do not add a second renderer in React.

---

## 12. Color, assets, stories

- Brand via `enrichThemeColors`; roles or hex; text/shape gradients supported.
- `assets/library.json` → slots / shapes / effects.
- Stories map copy binds only unless `applyColors:true`.

---

## 13. Constraints

- Canvas **1080×1350** only.
- Paint stays in the engine; React wraps via iframe + API.
- html2canvas is the PNG path.
- Mongo doc ~16MB max — prefer S3 URLs over huge data-URLs in JSON.
- Vanilla remains rollback until explicit cutover.

---

## 14. How to extend (without collateral damage)

**New college folder**  
UI “new team” → `POST /api/teams`. Create templates with that `teamKey`.

**New template**  
`createTemplate({ name, category, teamKey, teamLabel })` then Edit → **Save** (keeps that team).

**Move template**  
Only via Move-to-team / meta PATCH — not via Save or filter change.

**New local font**  
File in `assets/fonts/` + `@font-face` + `F`/`FONT_OPTS` + `FONT_KEYS` in template-loader.

**New remote/college fonts**  
Drop under `s3-uploads/s3/<College>/...` (or Drive extract) → run upload script → hard-refresh Editor. Do not remove local fonts.

**New text field / shape**  
Existing bridge helpers (`addTextField`, `SHAPE_PRESETS`). Save to persist.

**Headless pipeline**  
`index.html?headless=1` → `setPayload` → `exportPng`. Lab API is not production `POST /posters/render`.

---

## 15. Regression checklist (run mentally after every change)

- [ ] Automate: fill text on template A → switch to B → B shows B’s JSON values (not A’s)
- [ ] Automate: switch A → B → back to A → A session values still there (export-only; not DB)
- [ ] Create template under College A / category player → appears under A
- [ ] Switch filter to College B → Save → template **still under A**
- [ ] Move to B → Save → stays under B
- [ ] Player vs Team **category** does not change college
- [ ] Pick remote font → Save → reload → same font (not Anton)
- [ ] Local fonts still in picker
- [ ] Canvas drag/resize still bakes
- [ ] Automate: fill text/image → export PNG; Reset restores bake
- [ ] Undo/redo still works for layout

---

## 16. Migration progress

```
- [x] React Editor + Automate shell
- [x] Mongo durable Save + injectRemoteTemplates
- [x] Team folders (teamKey) + categories
- [x] S3 uploads + /api/media proxy
- [x] Remote fonts (S3 + remote-fonts.json)
- [x] Save ownership lock (college ≠ sidebar filter)
- [x] Font persistence for remote stacks
- [x] Automate catalog Mongo-authoritative + UTSA CSV bulk test (Automate-only; clones bases, text-only)
- [ ] Keep architecture.md updated when invariants change
```
