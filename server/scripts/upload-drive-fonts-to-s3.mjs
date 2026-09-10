/**
 * Upload retrieved Google Drive fonts to S3 and write a local manifest
 * for the editor. Skips basenames already in assets/fonts.
 *
 * Usage (from server/):
 *   node scripts/upload-drive-fonts-to-s3.mjs
 *
 * Env: AWS_* + S3_BUCKET from server/.env (same as other upload scripts).
 * Optional:
 *   FONTS_SRC=/tmp/drive-fonts
 *   S3_FONT_PREFIX=fonts/remote/
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(serverDir, '..')
dotenv.config({ path: path.join(serverDir, '.env') })

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION = 'us-east-1',
  S3_BUCKET,
} = process.env

for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in server/.env`)
    process.exit(1)
  }
}

const SRC = process.env.FONTS_SRC || '/tmp/drive-fonts'
const PREFIX = (process.env.S3_FONT_PREFIX || 'fonts/remote/').replace(/^\/+/, '').replace(/\/?$/, '/')
const EXISTING_DIR = path.join(rootDir, 'assets', 'fonts')
const MANIFEST_OUT = path.join(rootDir, 'assets', 'remote-fonts.json')

const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2'])

function mimeFor(ext) {
  const e = ext.toLowerCase()
  if (e === '.ttf') return 'font/ttf'
  if (e === '.otf') return 'font/otf'
  if (e === '.woff') return 'font/woff'
  if (e === '.woff2') return 'font/woff2'
  return 'application/octet-stream'
}

function formatFor(ext) {
  const e = ext.toLowerCase()
  if (e === '.ttf') return 'truetype'
  if (e === '.otf') return 'opentype'
  if (e === '.woff') return 'woff'
  if (e === '.woff2') return 'woff2'
  return 'truetype'
}

/** Normalize for duplicate detection against local assets. */
function baseKey(filename) {
  return path
    .basename(filename)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_-]+/g, '')
    .replace(/\.(ttf|otf|woff2?)$/i, '')
    .replace(/1$/, '') // "ARIALBD 1" ≈ ARIALBD
}

function prettyFamily(filename) {
  let stem = path.basename(filename).replace(/\.(ttf|otf|woff2?)$/i, '')
  stem = stem
    .replace(/^fonnts\.com-/i, '')
    .replace(/^Fontspring-DEMO-/i, '')
    .replace(/^DEMO-/i, '')
  // Proxima Nova family naming
  stem = stem
    .replace(/^proximanovaexcn/i, 'Proxima Nova Extra Condensed ')
    .replace(/^proximanovacond/i, 'Proxima Nova Condensed ')
    .replace(/^proximanova/i, 'Proxima Nova ')
  return stem
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function guessWeight(name) {
  const s = name.toLowerCase()
  if (s.includes('thin')) return 100
  if (s.includes('extralight') || s.includes('ultralight')) return 200
  if (s.includes('light') || s.includes('lgt')) return 300
  if (s.includes('medium') || s.includes('mdm')) return 500
  if (s.includes('semibold') || s.includes('demi')) return 600
  if (s.includes('extrabold') || s.includes('ultrabold')) return 800
  if (s.includes('black') || s.includes('heavy') || s.includes('blk')) return 900
  if (s.includes('bold') || s.includes('bd')) return 700
  return 400
}

function guessStyle(name) {
  const s = name.toLowerCase()
  return s.includes('italic') || s.includes('oblique') || /(^|[^a-z])itl?([^a-z]|$)/.test(s)
    ? 'italic'
    : 'normal'
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (FONT_EXT.has(path.extname(ent.name).toLowerCase())) out.push(p)
  }
  return out
}

const existingKeys = new Set(
  fs.existsSync(EXISTING_DIR)
    ? fs.readdirSync(EXISTING_DIR).filter((f) => FONT_EXT.has(path.extname(f).toLowerCase())).map(baseKey)
    : [],
)

const allFiles = walk(SRC)
// Prefer file without trailing " 1" when both exist.
// Key by college folder + basename so each school keeps its own copies on S3.
function teamSlugFor(file) {
  const team = path.relative(SRC, path.dirname(file)).split(path.sep)[0] || 'misc'
  return (
    String(team)
      .toLowerCase()
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '') || 'misc'
  )
}
const byKey = new Map()
for (const file of allFiles) {
  const teamSlug = teamSlugFor(file)
  const key = `${teamSlug}__${baseKey(file)}`
  const prev = byKey.get(key)
  if (!prev) {
    byKey.set(key, file)
    continue
  }
  const preferNew = !/\s1\./i.test(path.basename(file)) && /\s1\./i.test(path.basename(prev))
  if (preferNew) byKey.set(key, file)
}

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

const manifest = []
let uploaded = 0
let skippedExisting = 0
let skippedS3 = 0
let failed = 0

for (const [id, file] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const base = path.basename(file)
  const localKey = baseKey(file)
  if (existingKeys.has(localKey)) {
    skippedExisting++
    console.log(`skip local-dup  ${base}`)
    continue
  }

  const ext = path.extname(base).toLowerCase()
  const safeName = base.replace(/\s+/g, '_').replace(/[^\w.\-]+/g, '')
  const teamSlug = teamSlugFor(file)
  // Keep nested family folders under the college (e.g. figtree/static/…)
  const relDir = path.relative(SRC, path.dirname(file))
  const subParts = relDir
    .split(path.sep)
    .slice(1)
    .map((p) =>
      String(p)
        .toLowerCase()
        .replace(/[^\w]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
  const objectKey = [PREFIX.replace(/\/$/, ''), teamSlug, ...subParts, safeName].filter(Boolean).join('/')
  const family = prettyFamily(base)
  const url = `/api/media/${objectKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

  try {
    let exists = false
    try {
      await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: objectKey }))
      exists = true
    } catch (_) {
      exists = false
    }

    if (!exists) {
      const body = fs.readFileSync(file)
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: objectKey,
          Body: body,
          ContentType: mimeFor(ext),
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      )
      uploaded++
      console.log(`upload  ${objectKey}  (${Math.round(body.length / 1024)}KB)`)
    } else {
      skippedS3++
      console.log(`exists  ${objectKey}`)
    }

    manifest.push({
      id,
      family,
      label: family,
      file: safeName,
      team: teamSlug,
      key: objectKey,
      url,
      format: formatFor(ext),
      weight: guessWeight(base),
      style: guessStyle(base),
    })
  } catch (e) {
    failed++
    console.error(`FAIL  ${base}: ${e.message || e}`)
  }
}

manifest.sort((a, b) => a.label.localeCompare(b.label))

// Merge with any existing remote manifest so prior uploads stay registered
let merged = manifest
try {
  if (fs.existsSync(MANIFEST_OUT)) {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_OUT, 'utf8'))
    const prevFonts = Array.isArray(prev?.fonts) ? prev.fonts : []
    const byId = new Map()
    for (const f of prevFonts) {
      if (f?.id) byId.set(f.id, f)
      else if (f?.key) byId.set(f.key, f)
    }
    for (const f of manifest) {
      byId.set(f.id || f.key, f)
    }
    merged = [...byId.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }
} catch (e) {
  console.warn('manifest merge skipped:', e.message || e)
}

fs.writeFileSync(
  MANIFEST_OUT,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: SRC,
      count: merged.length,
      fonts: merged,
    },
    null,
    2,
  ),
)

console.log('---')
console.log(`uploaded=${uploaded} skippedLocal=${skippedExisting} alreadyOnS3=${skippedS3} failed=${failed}`)
console.log(`manifest=${MANIFEST_OUT} entries=${merged.length} (this run ${manifest.length})`)
