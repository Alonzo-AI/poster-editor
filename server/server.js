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
      enum: ['player', 'team', 'player_no_image', 'nostalgia'],
      default: 'player',
      index: true,
    },
    /** Team folder (second dimension under Formats). Empty / missing → Unassigned. */
    teamKey: { type: String, default: '__unassigned__', index: true },
    teamLabel: { type: String, default: 'Unassigned' },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    frozen: { type: Boolean, default: true },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'templates' },
)

const Template = mongoose.model('Template', templateSchema)

/** Persistent team folders (can exist with zero templates). */
const teamFolderSchema = new mongoose.Schema(
  {
    teamKey: { type: String, required: true, unique: true, index: true },
    teamLabel: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'team_folders' },
)
const TeamFolder = mongoose.model('TeamFolder', teamFolderSchema)

/**
 * Bulk / CSV generated posters — separate from Editor templates.
 * Editable via Projects UI (Automate-like tools); never listed as Formats templates.
 */
const projectSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ['player', 'team', 'player_no_image', 'nostalgia'],
      default: 'player',
      index: true,
    },
    teamKey: { type: String, default: '__unassigned__', index: true },
    teamLabel: { type: String, default: 'Unassigned' },
    sourceTemplateId: { type: String, default: null },
    json: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: 'projects' },
)
const Project = mongoose.model('Project', projectSchema)

const UNASSIGNED_TEAM_KEY = '__unassigned__'
const UNASSIGNED_TEAM_LABEL = 'Unassigned'

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
  if (v === 'nostalgia' || v === 'nostalgic') return 'nostalgia'
  return 'player'
}

function normalizeTeamKey(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!v || v === 'unassigned' || v === 'none' || v === 'null') return UNASSIGNED_TEAM_KEY
  return v
}

function normalizeTeamLabel(raw, key = UNASSIGNED_TEAM_KEY) {
  const k = normalizeTeamKey(key)
  if (k === UNASSIGNED_TEAM_KEY) return UNASSIGNED_TEAM_LABEL
  const label = String(raw ?? '').trim()
  if (label) return label
  return k
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function teamFieldsFromJson(json = {}) {
  const teamKey = normalizeTeamKey(
    json.teamKey ?? json.settings?.teamKey ?? json.team ?? json.teamName,
  )
  const teamLabel = normalizeTeamLabel(
    json.teamLabel ?? json.settings?.teamLabel ?? json.teamName,
    teamKey,
  )
  return { teamKey, teamLabel }
}

async function upsertTeamFolder(teamKeyIn, teamLabelIn) {
  const teamKey = normalizeTeamKey(teamKeyIn)
  if (teamKey === UNASSIGNED_TEAM_KEY) return null
  const teamLabel = normalizeTeamLabel(teamLabelIn, teamKey)
  const row = await TeamFolder.findOneAndUpdate(
    { teamKey },
    {
      $set: { teamKey, teamLabel, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true },
  ).lean()
  return { teamKey: row.teamKey, teamLabel: row.teamLabel }
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

/** List persisted team folders (including empty ones). */
app.get('/api/teams', async (_req, res) => {
  try {
    const rows = await TeamFolder.find({}, { teamKey: 1, teamLabel: 1, updatedAt: 1 })
      .sort({ teamLabel: 1 })
      .lean()
    res.json({
      teams: rows.map((r) => ({
        teamKey: normalizeTeamKey(r.teamKey),
        teamLabel: normalizeTeamLabel(r.teamLabel, r.teamKey),
        updatedAt: r.updatedAt,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

/** Create / update a team folder (no templates required). */
app.put('/api/teams/:teamKey', async (req, res) => {
  try {
    const key = normalizeTeamKey(req.params.teamKey || req.body?.teamKey)
    if (key === UNASSIGNED_TEAM_KEY) {
      return res.status(400).json({ error: 'Cannot save Unassigned as a team folder' })
    }
    const team = await upsertTeamFolder(key, req.body?.teamLabel ?? req.body?.name ?? key)
    res.json({ ok: true, team })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

app.post('/api/teams', async (req, res) => {
  try {
    const key = normalizeTeamKey(req.body?.teamKey || req.body?.name)
    if (key === UNASSIGNED_TEAM_KEY) {
      return res.status(400).json({ error: 'Cannot save Unassigned as a team folder' })
    }
    const team = await upsertTeamFolder(key, req.body?.teamLabel ?? req.body?.name ?? key)
    res.json({ ok: true, team })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
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
    // Fonts need CORS for @font-face / canvas export in some browsers
    if (/\.(ttf|otf|woff2?)$/i.test(key) || String(out.ContentType || '').startsWith('font/')) {
      res.setHeader('Access-Control-Allow-Origin', '*')
    }
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
          teamKey: 1,
          teamLabel: 1,
          frozen: 1,
          updatedAt: 1,
          'json.category': 1,
          'json.teamKey': 1,
          'json.teamLabel': 1,
        },
      )
        .sort({ updatedAt: -1 })
        .lean()
      return res.json({
        templates: rows.map((r) => {
          const team = teamFieldsFromJson({
            teamKey: r.teamKey ?? r.json?.teamKey,
            teamLabel: r.teamLabel ?? r.json?.teamLabel,
          })
          return {
            id: r.id,
            name: r.name,
            category: normalizeCategory(r.category ?? r.json?.category),
            teamKey: team.teamKey,
            teamLabel: team.teamLabel,
            frozen: r.frozen !== false,
            updatedAt: r.updatedAt,
          }
        }),
      })
    }
    const rows = await Template.find({}).sort({ updatedAt: -1 }).lean()
    res.json({
      templates: rows.map((r) => {
        const category = normalizeCategory(r.category ?? r.json?.category)
        const team = teamFieldsFromJson({
          teamKey: r.teamKey ?? r.json?.teamKey,
          teamLabel: r.teamLabel ?? r.json?.teamLabel,
          ...(r.json || {}),
        })
        return {
          id: r.id,
          name: r.name,
          category,
          teamKey: team.teamKey,
          teamLabel: team.teamLabel,
          frozen: r.frozen !== false,
          updatedAt: r.updatedAt,
          json: {
            ...(r.json || {}),
            category,
            teamKey: team.teamKey,
            teamLabel: team.teamLabel,
          },
        }
      }),
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
  const team = teamFieldsFromJson(json)
  json.category = category
  json.teamKey = team.teamKey
  json.teamLabel = team.teamLabel
  try {
    await upsertTeamFolder(team.teamKey, team.teamLabel)
  } catch (_) {}

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
    `[api] ${existed ? 'update' : 'create'} id=${id} category=${category} team=${team.teamKey} ~${Math.round(approx / 1024)}KB db=${mongoose.connection.name}`,
  )

  const row = await Template.findOneAndUpdate(
    { id },
    {
      $set: {
        id,
        name,
        category,
        teamKey: team.teamKey,
        teamLabel: team.teamLabel,
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
    teamKey: normalizeTeamKey(row.teamKey),
    teamLabel: normalizeTeamLabel(row.teamLabel, row.teamKey),
    updatedAt: row.updatedAt,
    db: mongoose.connection.name,
    created: !existed,
    updated: existed,
  }
}

/**
 * Metadata-only update (name / team folder). Does not re-bake, freeze, or rewrite layers.
 */
async function patchTemplateMeta(rawId, patch = {}) {
  const id = normalizeId(rawId)
  if (!id) {
    const err = new Error('Template id required')
    err.status = 400
    throw err
  }
  const row = await Template.findOne({ id }).lean()
  if (!row) {
    const err = new Error('Not found')
    err.status = 404
    throw err
  }
  const json = row.json && typeof row.json === 'object' ? { ...row.json } : { id, name: row.name }
  const $set = { updatedAt: new Date() }

  if (patch.name != null) {
    const name = String(patch.name).trim() || id
    json.name = name
    $set.name = name
  }
  if (patch.teamKey != null || patch.teamLabel != null) {
    const team = teamFieldsFromJson({
      ...json,
      teamKey: patch.teamKey != null ? patch.teamKey : json.teamKey,
      teamLabel: patch.teamLabel != null ? patch.teamLabel : json.teamLabel,
    })
    json.teamKey = team.teamKey
    json.teamLabel = team.teamLabel
    $set.teamKey = team.teamKey
    $set.teamLabel = team.teamLabel
    try {
      await upsertTeamFolder(team.teamKey, team.teamLabel)
    } catch (_) {}
  }
  json.id = id
  $set.json = json

  const updated = await Template.findOneAndUpdate({ id }, { $set }, { new: true }).lean()
  return {
    ok: true,
    id: updated.id,
    name: updated.name,
    category: normalizeCategory(updated.category),
    teamKey: normalizeTeamKey(updated.teamKey),
    teamLabel: normalizeTeamLabel(updated.teamLabel, updated.teamKey),
    updatedAt: updated.updatedAt,
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

/** Rename template or edit team folder fields without touching layout/images. */
app.patch('/api/templates/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const result = await patchTemplateMeta(req.params.id, {
      name: body.name,
      teamKey: body.teamKey,
      teamLabel: body.teamLabel,
    })
    res.json(result)
  } catch (err) {
    console.error('[api] patch meta failed:', err.message || err)
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

async function upsertProjectJson(rawJson, forcedId, meta = {}) {
  const json = rawJson && typeof rawJson === 'object' ? { ...rawJson } : {}
  const id = normalizeId(forcedId || json.id || meta.id)
  if (!id) {
    const err = new Error('Project id required')
    err.status = 400
    throw err
  }
  const name = String(meta.name || json.name || id).trim() || id
  const category = normalizeCategory(meta.category ?? json.category ?? json.settings?.category)
  const team = teamFieldsFromJson({
    teamKey: meta.teamKey ?? json.teamKey,
    teamLabel: meta.teamLabel ?? json.teamLabel,
    ...json,
  })
  json.id = id
  json.name = name
  json.category = category
  json.teamKey = team.teamKey
  json.teamLabel = team.teamLabel
  if (!json.settings) json.settings = {}
  json.settings.freezeLayout = true
  if (!json.automation) json.automation = {}
  json.automation.freezeLayout = true

  const approx = Buffer.byteLength(JSON.stringify(json), 'utf8')
  if (approx > 15 * 1024 * 1024) {
    const err = new Error(
      `Project JSON is ~${Math.round(approx / 1e6)}MB (Mongo max 16MB). Remove large images and Save again.`,
    )
    err.status = 413
    throw err
  }

  const existed = !!(await Project.exists({ id }))
  const row = await Project.findOneAndUpdate(
    { id },
    {
      $set: {
        id,
        name,
        category,
        teamKey: team.teamKey,
        teamLabel: team.teamLabel,
        sourceTemplateId: meta.sourceTemplateId ?? json._bakeMeta?.sourceTemplate ?? null,
        json,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true },
  ).lean()

  console.log(
    `[api] project ${existed ? 'update' : 'create'} id=${id} team=${team.teamKey} category=${category}`,
  )

  return {
    ok: true,
    id: row.id,
    name: row.name,
    category: normalizeCategory(row.category),
    teamKey: normalizeTeamKey(row.teamKey),
    teamLabel: normalizeTeamLabel(row.teamLabel, row.teamKey),
    sourceTemplateId: row.sourceTemplateId || null,
    updatedAt: row.updatedAt,
    created: !existed,
    updated: existed,
  }
}

app.get('/api/projects', async (_req, res) => {
  try {
    const rows = await Project.find(
      {},
      {
        id: 1,
        name: 1,
        category: 1,
        teamKey: 1,
        teamLabel: 1,
        sourceTemplateId: 1,
        updatedAt: 1,
        createdAt: 1,
      },
    )
      .sort({ updatedAt: -1 })
      .lean()
    res.json({
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: normalizeCategory(r.category),
        teamKey: normalizeTeamKey(r.teamKey),
        teamLabel: normalizeTeamLabel(r.teamLabel, r.teamKey),
        sourceTemplateId: r.sourceTemplateId || null,
        updatedAt: r.updatedAt,
        createdAt: r.createdAt,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

app.get('/api/projects/:id', async (req, res) => {
  try {
    const row = await Project.findOne({ id: normalizeId(req.params.id) }).lean()
    if (!row) return res.status(404).json({ error: 'Not found' })
    const json =
      row.json && typeof row.json === 'object' ? { ...row.json } : { id: row.id, name: row.name }
    json.id = row.id
    json.name = row.name
    json.category = normalizeCategory(row.category)
    json.teamKey = normalizeTeamKey(row.teamKey)
    json.teamLabel = normalizeTeamLabel(row.teamLabel, row.teamKey)
    res.json({
      id: row.id,
      name: row.name,
      category: json.category,
      teamKey: json.teamKey,
      teamLabel: json.teamLabel,
      sourceTemplateId: row.sourceTemplateId || null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      json,
    })
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) })
  }
})

app.put('/api/projects/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const json = body.json || body
    const result = await upsertProjectJson(json, req.params.id, {
      name: body.name,
      category: body.category,
      teamKey: body.teamKey,
      teamLabel: body.teamLabel,
      sourceTemplateId: body.sourceTemplateId,
    })
    res.json(result)
  } catch (err) {
    console.error('[api] project put failed:', err.message || err)
    res.status(err.status || 500).json({ error: err.message || String(err) })
  }
})

app.post('/api/projects', async (req, res) => {
  try {
    const body = req.body || {}
    const json = body.json || body
    const result = await upsertProjectJson(json, body.id || json.id, {
      name: body.name,
      category: body.category,
      teamKey: body.teamKey,
      teamLabel: body.teamLabel,
      sourceTemplateId: body.sourceTemplateId,
    })
    res.json(result)
  } catch (err) {
    console.error('[api] project post failed:', err.message || err)
    res.status(err.status || 500).json({ error: err.message || String(err) })
  }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const r = await Project.deleteOne({ id: normalizeId(req.params.id) })
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
