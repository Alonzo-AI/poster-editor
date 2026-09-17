# External Stories API (additive — does not change Editor / Automate / Projects UI)

Base: `/api/external`  
Auth (all routes except `GET /health`):  
`Authorization: Bearer <EXTERNAL_API_TOKEN>` **or** `X-Api-Key: <EXTERNAL_API_TOKEN>`

Env on poster lab server:
- `EXTERNAL_API_TOKEN` — required to enable generate/list
- `PUBLIC_APP_ORIGIN` — e.g. `http://127.0.0.1:8518` (Edit links)

## Endpoints

### `GET /api/external/health`
No auth. Reports whether token is configured.

### `POST /api/external/generate`
Generate Projects from CSV or JSON rows (same bulk rules as Projects UI).

```json
{
  "mode": "college",
  "teamKey": "wisconsin",
  "teamLabel": "Wisconsin",
  "batchLabel": "Game day stories",
  "async": true,
  "csv": "player_name,stat_name,stat_value,story\nJane,Points,24,Clutch"
}
```

Or multi-college:

```json
{
  "mode": "multi",
  "async": true,
  "csv": "college,player_name,stat_name,stat_value\nWisconsin,Jane,Points,24\nRichmond,Alex,Rebounds,12"
}
```

Or `rows` instead of `csv`:

```json
{
  "mode": "college",
  "teamKey": "wisconsin",
  "rows": [{ "player_name": "Jane", "stat_name": "Points", "stat_value": "24" }]
}
```

- `async: true` (default) → `202` `{ jobId, statusUrl }`
- `async: false` → waits and returns posters in the response

### `GET /api/external/jobs/:jobId`
Poll until `status` is `done` or `error`. On done, `result.batchId` + `result.posters[]`.

### `GET /api/external/batches/:batchId`
List posters in a batch from DB (works after job memory clears).

Each poster includes:
- `id`, `name`, `category`, `teamKey`
- `staticImageUrl` — template bg/logo URL for Stories gallery (not a full PNG bake)
- `editUrl` — open Project Edit in poster lab, e.g. `{PUBLIC_APP_ORIGIN}/projects/{id}`

### `GET /api/external/posters/:id`
Single poster meta + `editUrl` + `staticImageUrl`.

## Stories portal flow

1. `POST /generate` with CSV  
2. Poll `GET /jobs/:jobId`  
3. Show gallery from `result.posters` or `GET /batches/:batchId`  
4. Edit → open `editUrl` in poster lab  

Writes **Projects** only — never Editor templates or Automate saves.
