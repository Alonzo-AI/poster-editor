/**
 * Migrate embedded base64 images in Mongo template JSON → S3, store /api/media URLs.
 *
 * Usage (from server/):
 *   node scripts/migrate-base64-to-s3.mjs              # dry-run
 *   APPLY=1 node scripts/migrate-base64-to-s3.mjs      # upload + write Mongo
 */

import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverDir, '.env') })

const APPLY = process.env.APPLY === '1'

const URI = process.env.MONGODB_URI
const DB = process.env.MONGODB_DB || 'narrative_styles'
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const S3_BUCKET = process.env.S3_BUCKET || ''

if (!URI) {
  console.error('Missing MONGODB_URI in server/.env')
  process.exit(1)
}

if (APPLY) {
  for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET']) {
    if (!process.env[k]) {
      console.error(`Missing ${k} in server/.env (required for APPLY)`)
      process.exit(1)
    }
  }
}

const s3 = APPLY
  ? new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  : null

const templateSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    category: String,
    frozen: Boolean,
    updatedAt: Date,
    createdAt: Date,
    json: mongoose.Schema.Types.Mixed,
  },
  { versionKey: false, collection: 'templates' },
)
const Template = mongoose.models.Template || mongoose.model('Template', templateSchema)

const DATA_URL_RE = /^data:image\/([a-z0-9+.-]+);base64,/i

function kb(n) {
  return `${(n / 1024).toFixed(1)}KB`
}

function mb(n) {
  return `${(n / (1024 * 1024)).toFixed(2)}MB`
}

function bytesOf(str) {
  return Buffer.byteLength(String(str || ''), 'utf8')
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'bin'
}

function extractSrc(meta) {
  if (!meta) return null
  if (typeof meta === 'string') return meta
  if (typeof meta === 'object' && typeof meta.src === 'string') return meta.src
  return null
}

function mediaUrl(key) {
  return `/api/media/${key
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')}`
}

function findBase64Images(json, templateId) {
  const hits = []
  const seenSrc = new Set()

  function add(pathLabel, src) {
    if (!src || typeof src !== 'string') return
    const m = src.match(DATA_URL_RE)
    if (!m) return
    if (seenSrc.has(src)) return
    seenSrc.add(src)
    const mimeType = m[1].toLowerCase()
    const ext = extFromMime(mimeType)
    const safePath = pathLabel.replace(/[^\w.-]+/g, '_').slice(0, 80)
    hits.push({
      path: pathLabel,
      src,
      mime: `image/${mimeType}`,
      ext,
      bytes: bytesOf(src),
      key: `migrated/${templateId}/${safePath}-${crypto.randomBytes(4).toString('hex')}.${ext}`,
    })
  }

  const images = json?.defaults?.images || {}
  for (const [slot, meta] of Object.entries(images)) {
    add(`defaults.images.${slot}`, extractSrc(meta))
  }

  const settingsImgs = json?.settings?.defaultImages || {}
  for (const [slot, meta] of Object.entries(settingsImgs)) {
    add(`settings.defaultImages.${slot}`, extractSrc(meta))
  }

  const walk = (node, pathParts) => {
    if (!node) return
    if (typeof node === 'string') {
      if (DATA_URL_RE.test(node)) add(pathParts.join('.') || '(root)', node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...pathParts, String(i)]))
      return
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, [...pathParts, k])
    }
  }
  walk(json, [])

  return hits
}

/** Replace every occurrence of old data-URL strings with media URLs (in-place). */
function replaceDataUrls(node, urlBySrc) {
  if (!node) return node
  if (typeof node === 'string') {
    return urlBySrc.has(node) ? urlBySrc.get(node) : node
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = replaceDataUrls(node[i], urlBySrc)
    return node
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = replaceDataUrls(node[k], urlBySrc)
    return node
  }
  return node
}

function summarizeJsonSize(json) {
  try {
    return bytesOf(JSON.stringify(json))
  } catch {
    return 0
  }
}

function dataUrlToBuffer(dataUrl) {
  const m = dataUrl.match(DATA_URL_RE)
  if (!m) throw new Error('Not a data:image URL')
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return {
    buffer: Buffer.from(b64, 'base64'),
    contentType: `image/${m[1].toLowerCase()}`,
  }
}

async function uploadHit(hit) {
  const { buffer, contentType } = dataUrlToBuffer(hit.src)
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: hit.key,
      Body: buffer,
      ContentType: contentType || hit.mime,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )
  return mediaUrl(hit.key)
}

console.log(`\n=== Migrate base64 → S3 (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`)
console.log(
  APPLY
    ? 'Mode: APPLY — will upload to S3 and update Mongo JSON'
    : 'Mode: DRY RUN — no S3 uploads, no Mongo writes',
)
console.log(`DB: ${DB}`)
if (APPLY) console.log(`Bucket: ${S3_BUCKET}  region=${AWS_REGION}`)
console.log('')

await mongoose.connect(URI, { dbName: DB })

const idRows = await Template.find({}, { id: 1, name: 1, category: 1, updatedAt: 1 })
  .sort({ updatedAt: -1 })
  .lean()
console.log(`Templates scanned: ${idRows.length}\n`)

let templatesWithBase64 = 0
let totalHits = 0
let totalBase64Bytes = 0
let totalJsonBytesBefore = 0
let totalJsonBytesAfter = 0
let uploaded = 0
let updatedDocs = 0
let failures = 0
const perTemplate = []

for (const meta of idRows) {
  const row = await Template.findOne({ id: meta.id }).lean()
  if (!row) continue

  // Deep clone so APPLY can mutate safely
  let json
  try {
    json = row.json && typeof row.json === 'object' ? JSON.parse(JSON.stringify(row.json)) : {}
  } catch {
    json = {}
  }

  const beforeBytes = summarizeJsonSize(json)
  totalJsonBytesBefore += beforeBytes
  const hits = findBase64Images(json, row.id || 'unknown')

  if (!hits.length) {
    totalJsonBytesAfter += beforeBytes
    continue
  }

  templatesWithBase64++
  totalHits += hits.length
  totalBase64Bytes += hits.reduce((a, h) => a + h.bytes, 0)

  console.log(`\n• ${row.id}  (${row.name || row.id})  ${hits.length} image(s)  JSON ${kb(beforeBytes)}`)

  const urlBySrc = new Map()
  let templateOk = true

  for (const h of hits) {
    process.stdout.write(`  - ${h.path}  ${kb(h.bytes)}  ${h.mime}`)
    if (!APPLY) {
      console.log('  → would upload')
      continue
    }
    try {
      const url = await uploadHit(h)
      urlBySrc.set(h.src, url)
      uploaded++
      console.log(`  → ${url}`)
    } catch (e) {
      failures++
      templateOk = false
      console.log(`  → FAIL ${e.message || e}`)
    }
  }

  if (APPLY && templateOk && urlBySrc.size) {
    replaceDataUrls(json, urlBySrc)
    if (!json._bakeMeta || typeof json._bakeMeta !== 'object') json._bakeMeta = {}
    json._bakeMeta.s3MigratedAt = new Date().toISOString()
    json._bakeMeta.s3MigratedImages = urlBySrc.size

    const afterBytes = summarizeJsonSize(json)
    totalJsonBytesAfter += afterBytes

    await Template.updateOne(
      { id: row.id },
      {
        $set: {
          json,
          updatedAt: new Date(),
        },
      },
    )
    updatedDocs++
    console.log(`  Saved Mongo  ${kb(beforeBytes)} → ${kb(afterBytes)}`)
  } else if (!APPLY) {
    const afterEst = Math.max(0, beforeBytes - hits.reduce((a, h) => a + h.bytes, 0) + hits.length * 96)
    totalJsonBytesAfter += afterEst
    console.log(`  Est. after ~${kb(afterEst)}`)
  } else {
    // failed — keep original size in after tally
    totalJsonBytesAfter += beforeBytes
    console.log('  Skipped Mongo write (upload failure)')
  }

  perTemplate.push({ id: row.id, hits: hits.length, beforeBytes })
}

console.log('\n--- Summary ---')
console.log(`Templates total:           ${idRows.length}`)
console.log(`Templates needing migrate: ${templatesWithBase64}`)
console.log(`Base64 image slots:        ${totalHits}`)
console.log(`Embedded image bytes:      ${mb(totalBase64Bytes)}`)
console.log(`All JSON before:           ${mb(totalJsonBytesBefore)}`)
console.log(`All JSON after:            ${mb(totalJsonBytesAfter)}`)
console.log(`Savings:                   ${mb(Math.max(0, totalJsonBytesBefore - totalJsonBytesAfter))}`)
if (APPLY) {
  console.log(`Uploaded to S3:            ${uploaded}`)
  console.log(`Mongo docs updated:        ${updatedDocs}`)
  console.log(`Failures:                  ${failures}`)
  console.log('\nAPPLY complete.')
} else {
  console.log('\nDry run complete. No changes were written.')
  console.log('Run with APPLY=1 to migrate.')
}
console.log('')

await mongoose.disconnect().catch(() => {})
process.exit(failures ? 1 : 0)
