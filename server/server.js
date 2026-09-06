/**
 * Template API — persist frozen poster JSON in MongoDB (local or Atlas).
 *
 * Env (see .env.example):
 *   MONGODB_URI  Atlas: mongodb+srv://USER:PASS@cluster.../narrative_styles?retryWrites=true&w=majority
 *                Local:  mongodb://127.0.0.1:27017/narrative_styles
 *   MONGODB_DB   default narrative_styles (forced even if URI path is missing)
 *   PORT         default 8787
 */
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'

const PORT = Number(process.env.PORT || 8787)
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/narrative_styles'

function redactUri(uri) {
  return String(uri).replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@')
}

function normalizeId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
}

const templateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ['player', 'team', 'player_no_image'],
      default: 'player',
      index: true,
    },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    frozen: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'templates' },
)

const Template = mongoose.model('Template', templateSchema)

function normalizeCategory(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (v === 'team' || v === 'team_poster') return 'team'
  if (
    v === 'player_no_image' ||
    v === 'player_noimage' ||
    v === 'no_image' ||
    v === 'player_without_image'
  ) {
    return 'player_no_image'
  }
  return 'player'
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '32mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    db: mongoose.connection.name || null,
  })
})

/** List templates (summary + full json for Automate inject). */
app.get('/api/templates', async (_req, res) => {
  try {
    const rows = await Template.find({}).sort({ updatedAt: -1 }).lean()
    res.json({
      templates: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: normalizeCategory(r.category ?? r.json?.category),
        frozen: r.frozen !== false,
        updatedAt: r.updatedAt,
        json: {
          ...(r.json || {}),
          category: normalizeCategory(r.category ?? r.json?.category),
        },
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

app.get('/api/templates/:id', async (req, res) => {
  try {
    const row = await Template.findOne({ id: normalizeId(req.params.id) }).lean()
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

/**
 * Upsert by template id — overwrites the same Mongo document's `json` field.
 * First Save creates; later Saves update in place (same id).
 */
async function upsertTemplateJson(rawJson, forcedId) {
  const json = rawJson && typeof rawJson === 'object' ? { ...rawJson } : {}
  const id = normalizeId(forcedId || json.id)
  if (!id) {
    const err = new Error('Template id required')
    err.status = 400
    throw err
  }
  const name = String(json.name || id).trim() || id
  const category = normalizeCategory(json.category ?? json.settings?.category)
  json.category = category

  if (!json.settings) json.settings = {}
  json.settings.freezeLayout = true
  if (!json.automation) json.automation = {}
  json.automation.freezeLayout = true
  json.id = id
  json.name = name
  json._bakeMeta = {
    ...(json._bakeMeta || {}),
    bakedAt: new Date().toISOString(),
    source: 'api',
  }

  const approx = Buffer.byteLength(JSON.stringify(json), 'utf8')
  if (approx > 15 * 1024 * 1024) {
    const err = new Error(
      `Template JSON is ~${Math.round(approx / 1e6)}MB (Mongo max 16MB). Remove large baked images and Save again.`,
    )
    err.status = 413
    throw err
  }

  const existed = !!(await Template.exists({ id }))
  console.log(
    `[api] ${existed ? 'update' : 'create'} id=${id} category=${category} ~${Math.round(approx / 1024)}KB db=${mongoose.connection.name}`,
  )

  const row = await Template.findOneAndUpdate(
    { id },
    {
      $set: {
        id,
        name,
        category,
        json,
        frozen: true,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true },
  ).lean()

  return {
    ok: true,
    id: row.id,
    name: row.name,
    category: normalizeCategory(row.category),
    updatedAt: row.updatedAt,
    db: mongoose.connection.name,
    created: !existed,
    updated: existed,
  }
}

app.post('/api/templates', async (req, res) => {
  try {
    const body = req.body || {}
    const json = body.json || body
    const result = await upsertTemplateJson(json, body.id)
    res.json(result)
  } catch (err) {
    console.error('[api] upsert failed:', err.message || err)
    res.status(err.status || 500).json({ error: err.message || String(err) })
  }
})

/** Overwrite one existing id (or create if missing) — same document, replaced json. */
app.put('/api/templates/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const json = body.json || body
    const result = await upsertTemplateJson(json, req.params.id)
    res.json(result)
  } catch (err) {
    console.error('[api] put failed:', err.message || err)
    res.status(err.status || 500).json({ error: err.message || String(err) })
  }
})

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const r = await Template.deleteOne({ id: normalizeId(req.params.id) })
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

async function main() {
  // Force DB name even if URI omits the path (Atlas default is "test")
  const dbName = process.env.MONGODB_DB || 'narrative_styles'
  console.log('[api] connecting…', redactUri(MONGODB_URI), '→ db', dbName)
  await mongoose.connect(MONGODB_URI, { dbName })
  console.log('[api] Mongo connected · db=', mongoose.connection.name)
  app.listen(PORT, () => {
    console.log(`[api] http://127.0.0.1:${PORT}`)
  })
}

main().catch((err) => {
  console.error('[api] failed to start:', err)
  process.exit(1)
})
