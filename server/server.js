/**
 * Template API — persist frozen poster JSON in MongoDB (local or Atlas).
 *
 * Env (see .env.example):
 *   MONGODB_URI  Atlas: mongodb+srv://USER:PASS@cluster.../narrative_styles?retryWrites=true&w=majority
 *                Local:  mongodb://127.0.0.1:27017/narrative_styles
 *   MONGODB_DB   default narrative_styles (forced even if URI path is missing)
 *   PORT         default 8787
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION / S3_BUCKET
 *   S3_PUBLIC_BASE_URL  optional CDN/base URL (no trailing slash)
 */
import 'dotenv/config'
import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import multer from 'multer'
import mongoose from 'mongoose'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const S3_BUCKET = process.env.S3_BUCKET || ''
const S3_PUBLIC_BASE_URL = String(process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '')

const s3Enabled = !!(
  S3_BUCKET &&
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY
)

const s3 = s3Enabled
  ? new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  : null

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'))
    }
    cb(null, true)
  },
})

function extFromMime(mime, fallback = 'bin') {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  }
  return map[String(mime || '').toLowerCase()] || fallback
}

function publicObjectUrl(key) {
  if (S3_PUBLIC_BASE_URL) return `${S3_PUBLIC_BASE_URL}/${key.split('/').map(encodeURIComponent).join('/')}`
  const encoded = key
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  if (AWS_REGION === 'us-east-1') {
    return `https://${S3_BUCKET}.s3.amazonaws.com/${encoded}`
  }
  return `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encoded}`
}

/** App-facing URL stored in Mongo — proxied by this API so private buckets work. */
function mediaUrl(key) {
  return `/api/media/${key
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')}`
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '32mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    db: mongoose.connection.name || null,
    s3: s3Enabled ? 'configured' : 'missing',
  })
})

/**
 * Stream an S3 object through the API (private bucket friendly).
 * Stored image src in template JSON looks like /api/media/uploads/...
 */
app.get(/^\/api\/media\/(.+)$/, async (req, res) => {
  try {
    if (!s3Enabled || !s3) {
      return res.status(503).json({ error: 'S3 is not configured' })
    }
    const key = decodeURIComponent(req.params[0] || '')
      .replace(/^\/+/, '')
      .replace(/\.\./g, '')
    if (!key) return res.status(400).json({ error: 'Missing object key' })

    const out = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
      }),
    )
    if (out.ContentType) res.setHeader('Content-Type', out.ContentType)
    if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength))
    res.setHeader('Cache-Control', out.CacheControl || 'public, max-age=31536000, immutable')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    // Body is a web stream / Node stream depending on SDK runtime
    const body = out.Body
    if (body && typeof body.pipe === 'function') {
      body.pipe(res)
      return
    }
    const bytes = Buffer.from(await body.transformToByteArray())
    res.end(bytes)
  } catch (e) {
    const code = e?.$metadata?.httpStatusCode || e?.name === 'NoSuchKey' ? 404 : 500
    console.error('[api] media get failed:', e.message || e)
    res.status(code === 404 ? 404 : 500).json({ error: e.message || String(e) })
  }
})

/**
 * Upload one image to S3. Returns { url, key, bucket } for storing in template JSON.
 * Existing Mongo docs with base64 are left alone — only new uploads use this path.
 */
app.post('/api/uploads', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      return res.status(status).json({ error: err.message || String(err) })
    }
    try {
      if (!s3Enabled || !s3) {
        return res.status(503).json({
          error:
            'S3 is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET in server/.env',
        })
      }
      const file = req.file
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'Missing file field (multipart form field name: file)' })
      }

      const folder = String(req.body?.folder || 'uploads')
        .trim()
        .replace(/[^a-zA-Z0-9/_-]+/g, '')
        .replace(/^\/+|\/+$/g, '') || 'uploads'
      const original = String(file.originalname || 'image')
        .split(/[/\\]/)
        .pop()
      const safeBase = original
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 60) || 'image'
      const ext = extFromMime(file.mimetype, (original.match(/\.([a-z0-9]+)$/i) || [])[1] || 'bin')
      const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeBase}.${ext}`

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype || 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )

      const s3Url = publicObjectUrl(key)
      // Prefer proxied URL so private buckets still render in the editor / export.
      const url = S3_PUBLIC_BASE_URL ? s3Url : mediaUrl(key)
      console.log(`[api] s3 upload ok key=${key} ~${Math.round(file.buffer.length / 1024)}KB`)
      res.json({
        ok: true,
        url,
        s3Url,
        key,
        bucket: S3_BUCKET,
        contentType: file.mimetype,
        bytes: file.buffer.length,
      })
    } catch (e) {
      console.error('[api] s3 upload failed:', e.message || e)
      res.status(500).json({ error: e.message || String(e) })
    }
  })
})

/** List templates. ?lite=1 → metadata only (fast). Full JSON is GET /api/templates/:id */
app.get('/api/templates', async (req, res) => {
  try {
    const lite =
      req.query.lite === '1' ||
      req.query.lite === 'true' ||
      req.query.summary === '1'
    if (lite) {
      const rows = await Template.find(
        {},
        {
          id: 1,
          name: 1,
          category: 1,
          frozen: 1,
          updatedAt: 1,
          'json.category': 1,
        },
      )
        .sort({ updatedAt: -1 })
        .lean()
      return res.json({
        templates: rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: normalizeCategory(r.category ?? r.json?.category),
          frozen: r.frozen !== false,
          updatedAt: r.updatedAt,
        })),
      })
    }
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] http://127.0.0.1:${PORT} (also 0.0.0.0:${PORT})`)
  })
}

main().catch((err) => {
  console.error('[api] failed to start:', err)
  process.exit(1)
})
