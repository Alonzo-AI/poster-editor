/**
 * Template API — persist frozen poster JSON in MongoDB (local or Atlas).
 *
 * Env (see .env.example):
 *   MONGODB_URI  Atlas: mongodb+srv://USER:PASS@cluster.../narrative_styles?retryWrites=true&w=majority
 *                Local:  mongodb://127.0.0.1:27017/narrative_styles
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

const templateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    frozen: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
)

const Template = mongoose.model('Template', templateSchema)

const app = express()
app.use(cors())
app.use(express.json({ limit: '32mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
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
        frozen: r.frozen !== false,
        updatedAt: r.updatedAt,
        json: r.json,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

app.get('/api/templates/:id', async (req, res) => {
  try {
    const row = await Template.findOne({ id: req.params.id }).lean()
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json(row)
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

/** Upsert frozen template JSON (Editor Save). */
app.post('/api/templates', async (req, res) => {
  try {
    const body = req.body || {}
    const json = body.json || body
    const id = String(json.id || body.id || '')
      .trim()
      .replace(/[^\w-]+/g, '_')
    if (!id) return res.status(400).json({ error: 'Template id required' })
    const name = String(json.name || body.name || id).trim() || id

    // Ensure freeze flags so Automate treats it as locked layout
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

    const row = await Template.findOneAndUpdate(
      { id },
      {
        $set: {
          id,
          name,
          json,
          frozen: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    ).lean()

    res.json({
      ok: true,
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
    })
  } catch (err) {
    const msg = err.message || String(err)
    // Common: document > 16MB (embedded data-URL images)
    res.status(500).json({ error: msg })
  }
})

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const r = await Template.deleteOne({ id: req.params.id })
    if (!r.deletedCount) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

async function main() {
  console.log('[api] connecting…', redactUri(MONGODB_URI))
  await mongoose.connect(MONGODB_URI)
  console.log('[api] Mongo connected')
  app.listen(PORT, () => {
    console.log(`[api] http://127.0.0.1:${PORT}`)
  })
}

main().catch((err) => {
  console.error('[api] failed to start:', err)
  process.exit(1)
})
