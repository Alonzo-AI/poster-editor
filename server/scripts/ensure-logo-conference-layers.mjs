/**
 * Add missing logo + conference image layers to existing Mongo templates.
 * Does not change text, geometry of other layers, or baked images.
 *
 * Usage (from server/):
 *   node scripts/ensure-logo-conference-layers.mjs           # dry-run
 *   APPLY=1 node scripts/ensure-logo-conference-layers.mjs   # write Mongo
 */

import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverDir, '.env') })

const APPLY = process.env.APPLY === '1'
const URI = process.env.MONGODB_URI
const DB = process.env.MONGODB_DB || 'narrative_styles'

if (!URI) {
  console.error('Missing MONGODB_URI')
  process.exit(1)
}

const SLOT_DEFAULTS = {
  logo: { x: 48, y: 48, w: 160, h: 160, z: 21 },
  conference: { x: 860, y: 48, w: 160, h: 80, z: 21 },
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

function hasBind(layers, bind) {
  return (layers || []).some((l) => l && l.type === 'image' && l.bind === bind)
}

function uniqueLayerId(layers, base) {
  const used = new Set((layers || []).map((l) => l?.id).filter(Boolean))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

function ensureSlots(json) {
  if (!json || typeof json !== 'object') return { json, added: [] }
  const next = JSON.parse(JSON.stringify(json))
  if (!Array.isArray(next.layers)) next.layers = []
  const added = []

  for (const [bind, geo] of Object.entries(SLOT_DEFAULTS)) {
    if (hasBind(next.layers, bind)) continue
    const id = uniqueLayerId(next.layers, bind)
    next.layers.push({
      id,
      type: 'image',
      bind,
      x: geo.x,
      y: geo.y,
      w: geo.w,
      h: geo.h,
      z: geo.z,
      fit: 'contain',
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
    })
    added.push(bind)
  }

  if (!next.automation || typeof next.automation !== 'object') next.automation = {}
  if (!Array.isArray(next.automation.swapImages)) {
    next.automation.swapImages = ['player', 'logo', 'conference', 'sponsor', 'background']
  } else {
    for (const k of ['logo', 'conference']) {
      if (!next.automation.swapImages.includes(k)) next.automation.swapImages.push(k)
    }
  }

  if (added.length) {
    if (!next._bakeMeta || typeof next._bakeMeta !== 'object') next._bakeMeta = {}
    next._bakeMeta.logoConferenceEnsuredAt = new Date().toISOString()
    next._bakeMeta.logoConferenceAdded = added
  }

  return { json: next, added }
}

console.log(`\n=== Ensure logo/conference layers (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`)

await mongoose.connect(URI, { dbName: DB })
const idRows = await Template.find({}, { id: 1, name: 1 }).sort({ updatedAt: -1 }).lean()
console.log(`Templates: ${idRows.length}\n`)

let changed = 0
let updated = 0

for (const meta of idRows) {
  const row = await Template.findOne({ id: meta.id }).lean()
  if (!row?.json) continue
  const { json, added } = ensureSlots(row.json)
  if (!added.length) {
    console.log(`• ${row.id} — already has logo+conference`)
    continue
  }
  changed++
  console.log(`• ${row.id} — add: ${added.join(', ')}`)
  if (APPLY) {
    await Template.updateOne(
      { id: row.id },
      { $set: { json, updatedAt: new Date() } },
    )
    updated++
  }
}

console.log('\n--- Summary ---')
console.log(`Need updates: ${changed}`)
if (APPLY) console.log(`Mongo updated: ${updated}`)
else console.log('Dry run only. Re-run with APPLY=1 to write.')
console.log('')

await mongoose.disconnect().catch(() => {})
