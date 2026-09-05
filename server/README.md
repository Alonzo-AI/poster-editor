# Template API (MongoDB / Atlas)

Saves Editor templates permanently so Automate can load them without downloading JSON into `templates/`.

## MongoDB Atlas (recommended)

1. In [MongoDB Atlas](https://cloud.mongodb.com/): create a free cluster → **Database Access** (user + password) → **Network Access** (add your current IP, or `0.0.0.0/0` for quick local testing).
2. **Connect → Drivers** → copy the SRV URI. It looks like:

```
mongodb+srv://USER:<password>@CLUSTER.mongodb.net/?retryWrites=true&w=majority
```

3. Put the DB name in the path (`narrative_styles`) and replace `<password>` (URL-encode special characters, e.g. `@` → `%40`):

```
mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/narrative_styles?retryWrites=true&w=majority
```

4. Configure the API:

```bash
cd narrative-styles-portal/server
cp .env.example .env
# edit .env → set MONGODB_URI to your Atlas string
npm install
npm run dev
```

5. Confirm: `curl http://127.0.0.1:8787/api/health` → `"mongo":"connected"`.

6. Start the React app (proxies `/api` → 8787):

```bash
cd narrative-styles-portal/react-editor
npm run dev
```

Editor **Save** writes to Atlas; Automate lists those templates after Refresh / a few seconds.

## Local Mongo (optional)

Leave `MONGODB_URI` unset, or set:

```
MONGODB_URI=mongodb://127.0.0.1:27017/narrative_styles
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Mongo status |
| GET | `/api/templates` | List + full JSON |
| GET | `/api/templates/:id` | One template |
| POST | `/api/templates` | Upsert frozen JSON from Editor Save |
| DELETE | `/api/templates/:id` | Remove |

## Notes

- Never commit `.env` (password lives there). `.env.example` is the safe template.
- Disk `templates/*.json` still seed the engine; DB templates are merged on top.
- Very large embedded data-URL images can hit Mongo’s 16MB doc limit — trim images or use smaller uploads if Save fails.
