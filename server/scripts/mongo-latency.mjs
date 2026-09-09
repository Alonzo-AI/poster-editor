/**
 * Mongo + app latency probe for poster-editor.
 *
 * Usage (from server/):
 *   node scripts/mongo-latency.mjs
 *
 * Reports:
 *  A) Direct MongoDB Atlas timings (connect + queries)
 *  B) Application HTTP timings (/api/health, /api/templates?lite=1, full list, one id)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnv() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}

function ms(n) {
  return `${n.toFixed(1)} ms`
}

async function time(label, fn) {
  const t0 = performance.now()
  let result
  let err = null
  try {
    result = await fn()
  } catch (e) {
    err = e
  }
  const elapsed = performance.now() - t0
  return { label, elapsed, result, err }
}

function printRow(r, extra = '') {
  if (r.err) {
    console.log(`  FAIL  ${r.label.padEnd(42)} ${ms(r.elapsed)}  → ${r.err.message || r.err}`)
  } else {
    console.log(`  OK    ${r.label.padEnd(42)} ${ms(r.elapsed)}${extra}`)
  }
}

async function httpTimed(url) {
  const t0 = performance.now()
  const res = await fetch(url)
  const buf = Buffer.from(await res.arrayBuffer())
  const elapsed = performance.now() - t0
  let json = null
  try {
    json = JSON.parse(buf.toString('utf8'))
  } catch (_) {}
  return {
    status: res.status,
    bytes: buf.length,
    elapsed,
    json,
  }
}

loadEnv()

const URI = process.env.MONGODB_URI
const DB = process.env.MONGODB_DB || 'narrative_styles'
const API = process.env.API_BASE || 'http://127.0.0.1:8787'

if (!URI) {
  console.error('Missing MONGODB_URI in server/.env')
  process.exit(1)
}

const templateSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    category: String,
    frozen: Boolean,
    updatedAt: Date,
    json: mongoose.Schema.Types.Mixed,
  },
  { versionKey: false, collection: 'templates' },
)
const Template = mongoose.models.Template || mongoose.model('Template', templateSchema)

console.log('\n=== Poster Mongo / API latency probe ===')
console.log(`DB name: ${DB}`)
console.log(`API:     ${API}`)
console.log(`URI host: ${URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@').split('?')[0]}`)
console.log('')

// ---------- A) Direct Mongo ----------
console.log('A) Direct MongoDB (mongoose)')
const connect = await time('connect', () => mongoose.connect(URI, { dbName: DB }))
printRow(connect, connect.err ? '' : `  db=${mongoose.connection.name}`)

if (!connect.err) {
  const ping = await time('ping (admin.command)', async () => {
    await mongoose.connection.db.admin().command({ ping: 1 })
  })
  printRow(ping)

  const count = await time('countDocuments({})', () => Template.countDocuments({}))
  printRow(count, count.err ? '' : `  n=${count.result}`)

  const sizesAgg = await time('aggregate bsonSize per doc', async () => {
    return Template.aggregate([
      {
        $project: {
          id: 1,
          name: 1,
          bsonBytes: { $bsonSize: '$$ROOT' },
          jsonBytes: { $bsonSize: { $ifNull: ['$json', {}] } },
        },
      },
      { $sort: { bsonBytes: -1 } },
    ])
  })
  if (!sizesAgg.err) {
    const total = sizesAgg.result.reduce((a, r) => a + (r.bsonBytes || 0), 0)
    printRow(
      sizesAgg,
      `  n=${sizesAgg.result.length}  total~${(total / 1e6).toFixed(2)}MB`,
    )
    console.log('  Largest templates:')
    for (const r of sizesAgg.result.slice(0, 8)) {
      console.log(
        `    ${String(Math.round((r.bsonBytes || 0) / 1024)).padStart(5)}KB  ${r.id}`,
      )
    }
  } else {
    printRow(sizesAgg)
  }

  const lite = await time('find lite (meta projection)', async () => {
    const rows = await Template.find(
      {},
      { id: 1, name: 1, category: 1, frozen: 1, updatedAt: 1, 'json.category': 1 },
    )
      .sort({ updatedAt: -1 })
      .lean()
    return rows
  })
  printRow(
    lite,
    lite.err
      ? ''
      : `  n=${lite.result.length}  ~${Math.round(
          Buffer.byteLength(JSON.stringify(lite.result), 'utf8') / 1024,
        )}KB`,
  )

  // Skip dumping ALL json by default — ~30MB+ over Atlas is the known slow path.
  // Set FULL_DUMP=1 to measure it.
  if (process.env.FULL_DUMP === '1') {
    const full = await time('find FULL (all json fields)', async () => {
      const rows = await Template.find({}).sort({ updatedAt: -1 }).lean()
      return rows
    })
    printRow(
      full,
      full.err
        ? ''
        : `  n=${full.result.length}  ~${Math.round(
            Buffer.byteLength(JSON.stringify(full.result), 'utf8') / 1024,
          )}KB`,
    )
  } else {
    console.log('  SKIP  find FULL (set FULL_DUMP=1 to measure ~30MB dump)')
  }

  let sampleId = lite.result?.[0]?.id
  if (!sampleId && full.result?.[0]?.id) sampleId = full.result[0].id

  if (sampleId) {
    const one = await time(`findOne id=${sampleId}`, () =>
      Template.findOne({ id: sampleId }).lean(),
    )
    const size = one.result
      ? Math.round(Buffer.byteLength(JSON.stringify(one.result), 'utf8') / 1024)
      : 0
    printRow(one, one.err ? '' : `  ~${size}KB`)
  }

  // Warm second pass (connection already open — typical app path)
  console.log('  --- warm second pass (same connection) ---')
  for (const [label, fn] of [
    ['countDocuments (warm)', () => Template.countDocuments({})],
    [
      'find lite (warm)',
      () =>
        Template.find(
          {},
          { id: 1, name: 1, category: 1, frozen: 1, updatedAt: 1, 'json.category': 1 },
        )
          .sort({ updatedAt: -1 })
          .lean(),
    ],
    ['find FULL (warm)', () => Template.find({}).sort({ updatedAt: -1 }).lean()],
  ]) {
    const r = await time(label, fn)
    const extra =
      Array.isArray(r.result)
        ? `  n=${r.result.length}  ~${Math.round(
            Buffer.byteLength(JSON.stringify(r.result), 'utf8') / 1024,
          )}KB`
        : typeof r.result === 'number'
          ? `  n=${r.result}`
          : ''
    printRow(r, extra)
  }
}

await mongoose.disconnect().catch(() => {})

// ---------- B) Application HTTP ----------
console.log('\nB) Application HTTP (your API server)')
try {
  const health = await httpTimed(`${API}/api/health`)
  console.log(
    `  ${health.status === 200 ? 'OK' : 'FAIL'}    ${'GET /api/health'.padEnd(42)} ${ms(health.elapsed)}  mongo=${health.json?.mongo || '?'}`,
  )

  const liteHttp = await httpTimed(`${API}/api/templates?lite=1`)
  console.log(
    `  ${liteHttp.status === 200 ? 'OK' : 'FAIL'}    ${'GET /api/templates?lite=1'.padEnd(42)} ${ms(liteHttp.elapsed)}  n=${liteHttp.json?.templates?.length ?? '?'}  ~${Math.round(liteHttp.bytes / 1024)}KB`,
  )

  const fullHttp = await httpTimed(`${API}/api/templates`)
  console.log(
    `  ${fullHttp.status === 200 ? 'OK' : 'FAIL'}    ${'GET /api/templates (FULL)'.padEnd(42)} ${ms(fullHttp.elapsed)}  n=${fullHttp.json?.templates?.length ?? '?'}  ~${Math.round(fullHttp.bytes / 1024)}KB`,
  )

  const sampleId = liteHttp.json?.templates?.[0]?.id || fullHttp.json?.templates?.[0]?.id
  if (sampleId) {
    const oneHttp = await httpTimed(`${API}/api/templates/${encodeURIComponent(sampleId)}`)
    console.log(
      `  ${oneHttp.status === 200 ? 'OK' : 'FAIL'}    ${(`GET /api/templates/${sampleId}`).padEnd(42)} ${ms(oneHttp.elapsed)}  ~${Math.round(oneHttp.bytes / 1024)}KB`,
    )

    // 3 repeats for stability on the paths the app actually uses
    console.log('  --- 3× repeats (app paths) ---')
    for (const path of [
      '/api/templates?lite=1',
      `/api/templates/${encodeURIComponent(sampleId)}`,
    ]) {
      const times = []
      for (let i = 0; i < 3; i++) {
        const r = await httpTimed(`${API}${path}`)
        times.push(r.elapsed)
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      console.log(
        `  OK    ${(path + ' ×3').padEnd(42)} avg ${ms(avg)}  [${times.map((t) => t.toFixed(0)).join(', ')}]`,
      )
    }
  }
} catch (e) {
  console.log(`  FAIL  HTTP probe: ${e.message || e}`)
  console.log('  (Is the API running on 8787? npm run dev in server/)')
}

console.log('\nDone.\n')
