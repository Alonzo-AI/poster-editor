/**
 * Isolated UTSA bulk-poster helpers (Automate test feature).
 * Does not change Editor Save / normal Automate fill paths.
 */

export const BULK_TEAM_KEY = 'utsa'
export const BULK_TEAM_LABEL = 'UTSA'
export const BULK_CATEGORIES = ['player', 'team', 'player_no_image', 'nostalgia']

/** Prefer real Editor bases — never clone prior utsa_bulk_* projects that leaked into templates. */
export const BULK_PREFERRED_BASE_IDS = {
  player: 'UTSA',
  team: 'UTSA_2',
  nostalgia: 'UTSA_3',
  player_no_image: null,
}

/** CSV header -> template bind / meta */
const HEADER_ALIASES = {
  college: 'college',
  team: 'college',
  team_name: 'college',
  teamname: 'college',
  category: 'category',
  type: 'category',
  poster_type: 'category',
  name: 'posterName',
  poster_name: 'posterName',
  postername: 'posterName',
  player_name: 'playerName',
  playername: 'playerName',
  player: 'playerName',
  stat_name: 'stat_name',
  statname: 'stat_name',
  'stat name': 'stat_name',
  stat_value: 'stat_value',
  statvalue: 'stat_value',
  'stat value': 'stat_value',
  story: 'story',
  class_position: 'class_position',
  classposition: 'class_position',
  'class position': 'class_position',
  opponent_score: 'opponent_score',
  opponentscore: 'opponent_score',
  'opponent score': 'opponent_score',
}

const CATEGORY_ALIASES = {
  player: 'player',
  player_poster: 'player',
  team: 'team',
  team_poster: 'team',
  player_no_image: 'player_no_image',
  player_noimage: 'player_no_image',
  no_image: 'player_no_image',
  noimage: 'player_no_image',
  'no image': 'player_no_image',
  'no player': 'player_no_image',
  nostalgia: 'nostalgia',
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function normalizeCategory(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return CATEGORY_ALIASES[k] || CATEGORY_ALIASES[String(raw || '').trim().toLowerCase()] || null
}

function isUtsaCollege(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return !v || v === 'utsa' || v === 'ut_sa'
}

/** Minimal CSV parser (quoted fields supported). */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cur)
      cur = ''
      continue
    }
    if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
      continue
    }
    if (ch === '\r') continue
    cur += ch
  }
  if (cur.length || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => String(c || '').trim()))
}

export function csvRowsToBulkRecords(csvText) {
  const table = parseCsv(csvText)
  if (!table.length) return { records: [], errors: ['CSV is empty'] }
  const headers = table[0].map(normHeader)
  const keys = headers.map((h) => HEADER_ALIASES[h] || HEADER_ALIASES[h.replace(/_/g, '')] || h)
  const records = []
  const errors = []

  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const raw = {}
    keys.forEach((k, idx) => {
      if (!k) return
      raw[k] = cells[idx] != null ? String(cells[idx]) : ''
    })
    if (!isUtsaCollege(raw.college)) {
      errors.push(`Row ${i + 1}: skipped (college "${raw.college || ''}" is not UTSA)`)
      continue
    }
    const fields = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'college' || k === 'category' || k === 'posterName') continue
      if (v == null || !String(v).trim()) continue
      fields[k] = String(v)
    }
    const category = raw.category ? normalizeCategory(raw.category) : null
    if (raw.category && !category) {
      errors.push(`Row ${i + 1}: unknown category "${raw.category}"`)
      continue
    }
    records.push({
      row: i + 1,
      posterName: String(raw.posterName || fields.playerName || fields.teamName || `UTSA row ${i}`).trim(),
      category, // null = generate all available categories
      fields,
    })
  }
  return { records, errors }
}

function slugPart(s) {
  return (
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'row'
  )
}

function applyTextToTemplateJson(json, fields) {
  const next =
    typeof structuredClone === 'function'
      ? structuredClone(json)
      : JSON.parse(JSON.stringify(json))
  if (!next.defaults || typeof next.defaults !== 'object') next.defaults = {}
  if (!next.defaults.text || typeof next.defaults.text !== 'object') next.defaults.text = {}
  for (const [k, v] of Object.entries(fields || {})) {
    next.defaults.text[k] = v
  }
  if (Array.isArray(next.layers)) {
    for (const layer of next.layers) {
      if (!layer || layer.type !== 'text' || !layer.bind) continue
      if (fields[layer.bind] != null) layer.placeholder = String(fields[layer.bind])
      if (layer.kind === 'stat') {
        const numKey = layer.bind + 'num'
        const labelKey = layer.bind + 'label'
        if (fields[numKey] != null) layer.placeholderNum = String(fields[numKey])
        if (fields[labelKey] != null) layer.placeholderLabel = String(fields[labelKey])
      }
    }
  }
  return next
}

/**
 * Build new posters from CSV records using existing UTSA base templates.
 */
export async function generateUtsaBulkPosters({
  records,
  templates,
  fetchTemplate,
  saveProject,
  onProgress,
} = {}) {
  if (typeof saveProject !== 'function') {
    throw new Error('saveProject is required (projects collection — not templates)')
  }
  if (typeof fetchTemplate !== 'function') {
    throw new Error('fetchTemplate is required')
  }
  const byCategory = new Map()
  const candidates = (templates || []).filter((t) => {
    const team = String(t.teamKey || t.json?.teamKey || '').toLowerCase()
    return team === BULK_TEAM_KEY
  })
  for (const cat of BULK_CATEGORIES) {
    const preferredId = BULK_PREFERRED_BASE_IDS[cat]
    let pick =
      (preferredId && candidates.find((t) => t.id === preferredId)) ||
      candidates.find(
        (t) =>
          (t.category || t.json?.category || 'player') === cat &&
          !String(t.id || '').startsWith('utsa_bulk_'),
      ) ||
      candidates.find((t) => (t.category || t.json?.category || 'player') === cat)
    if (pick) byCategory.set(cat, pick)
  }

  const created = []
  const skipped = []
  const failed = []
  let n = 0

  for (const rec of records || []) {
    const cats = rec.category ? [rec.category] : BULK_CATEGORIES
    for (const cat of cats) {
      const base = byCategory.get(cat)
      if (!base) {
        skipped.push({
          row: rec.row,
          category: cat,
          reason: `No UTSA template for category "${cat}"`,
        })
        onProgress?.({ type: 'skip', row: rec.row, category: cat })
        continue
      }
      n += 1
      const id = `utsa_bulk_${cat}_${slugPart(rec.posterName)}_${Date.now().toString(36)}_${n}`
      const name = `${rec.posterName} · ${cat}`
      try {
        onProgress?.({ type: 'start', row: rec.row, category: cat, id, name })
        const full = await fetchTemplate(base.id)
        const srcJson = full?.json || full
        if (!srcJson || typeof srcJson !== 'object') throw new Error(`Missing JSON for ${base.id}`)
        const json = applyTextToTemplateJson(srcJson, rec.fields)
        json.id = id
        json.name = name
        json.category = cat
        json.teamKey = BULK_TEAM_KEY
        json.teamLabel = BULK_TEAM_LABEL
        if (!json.settings) json.settings = {}
        json.settings.freezeLayout = true
        if (!json.automation) json.automation = {}
        json.automation.freezeLayout = true
        json._bakeMeta = {
          ...(json._bakeMeta || {}),
          bakedAt: new Date().toISOString(),
          source: 'bulk-utsa-csv',
          sourceTemplate: base.id,
          csvRow: rec.row,
        }
        // Keep default images from source template — do not clear or replace
        // Persist as a Project (not an Editor/Automate template).
        const saved = await saveProject(json, {
          id,
          name,
          category: cat,
          teamKey: BULK_TEAM_KEY,
          teamLabel: BULK_TEAM_LABEL,
          sourceTemplateId: base.id,
        })
        created.push({
          id: saved.id || id,
          name,
          category: cat,
          row: rec.row,
          sourceId: base.id,
        })
        onProgress?.({ type: 'ok', row: rec.row, category: cat, id: saved.id || id, name })
      } catch (e) {
        failed.push({ row: rec.row, category: cat, error: e.message || String(e) })
        onProgress?.({ type: 'fail', row: rec.row, category: cat, error: e.message || String(e) })
      }
    }
  }

  return { created, skipped, failed, baseCategories: [...byCategory.keys()] }
}
