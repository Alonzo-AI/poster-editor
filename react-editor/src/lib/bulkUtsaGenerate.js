/**
 * Projects-only bulk CSV → projects collection.
 * Clones Editor templates for a selected college; never writes templates.
 */

import { normalizeTeamKey, normalizeTeamLabel } from './templateTeam.js'

export const BULK_CATEGORIES = ['player', 'team', 'player_no_image', 'nostalgia']

/** Known preferred base template ids for UTSA (legacy). Other teams use first non-bulk template per category. */
export const BULK_PREFERRED_BASE_IDS = {
  utsa: {
    player: 'UTSA',
    team: 'UTSA_2',
    nostalgia: 'UTSA_3',
    player_no_image: null,
  },
}

/** @deprecated use selected team — kept for callers that still import the constant */
export const BULK_TEAM_KEY = 'utsa'
export const BULK_TEAM_LABEL = 'UTSA'

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

function collegeMatchesSelected(rawCollege, teamKey, teamLabel) {
  const v = String(rawCollege || '').trim()
  if (!v) return true // empty college column → use UI selection
  const key = normalizeTeamKey(v)
  if (key === normalizeTeamKey(teamKey)) return true
  const label = String(teamLabel || '')
    .trim()
    .toLowerCase()
  if (label && v.toLowerCase() === label) return true
  // Also accept spaced labels vs keys (e.g. "East Carolina" vs east_carolina)
  if (normalizeTeamKey(v) === normalizeTeamKey(teamKey)) return true
  return false
}

function isBulkCloneId(id, teamKey) {
  const s = String(id || '')
  if (s.includes('_bulk_')) return true
  const tk = normalizeTeamKey(teamKey)
  if (tk && s.startsWith(`${tk}_bulk_`)) return true
  if (s.startsWith('utsa_bulk_')) return true
  return false
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

/**
 * Parse CSV into bulk records for the selected college.
 * @param {string} csvText
 * @param {{ teamKey: string, teamLabel?: string }} team
 */
export function csvRowsToBulkRecords(csvText, team = {}) {
  const teamKey = normalizeTeamKey(team.teamKey || BULK_TEAM_KEY)
  const teamLabel = normalizeTeamLabel(team.teamLabel, teamKey)
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
    if (!collegeMatchesSelected(raw.college, teamKey, teamLabel)) {
      errors.push(
        `Row ${i + 1}: skipped (college "${raw.college || ''}" ≠ selected “${teamLabel}”)`,
      )
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
      posterName: String(
        raw.posterName || fields.playerName || fields.teamName || `${teamLabel} row ${i}`,
      ).trim(),
      category, // null = generate all available categories
      fields,
    })
  }
  return { records, errors, teamKey, teamLabel }
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
 * Pick one base template per category for a college (never prior bulk clones).
 */
export function pickTeamBaseTemplates(templates, teamKey) {
  const tk = normalizeTeamKey(teamKey)
  const preferred = BULK_PREFERRED_BASE_IDS[tk] || {}
  const candidates = (templates || []).filter((t) => {
    const team = normalizeTeamKey(t.teamKey || t.json?.teamKey)
    return team === tk
  })
  const byCategory = new Map()
  for (const cat of BULK_CATEGORIES) {
    const preferredId = preferred[cat]
    const pick =
      (preferredId && candidates.find((t) => t.id === preferredId)) ||
      candidates.find(
        (t) =>
          (t.category || t.json?.category || 'player') === cat &&
          !isBulkCloneId(t.id, tk),
      ) ||
      candidates.find((t) => (t.category || t.json?.category || 'player') === cat)
    if (pick) byCategory.set(cat, pick)
  }
  return byCategory
}

/**
 * Build new Projects from CSV records using the selected team's templates.
 */
export async function generateBulkPosters({
  records,
  templates,
  teamKey,
  teamLabel,
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
  const tk = normalizeTeamKey(teamKey)
  if (!tk || tk === '__unassigned__') {
    throw new Error('Select a college/team that has templates in the database')
  }
  const label = normalizeTeamLabel(teamLabel, tk)
  const byCategory = pickTeamBaseTemplates(templates, tk)

  const created = []
  const skipped = []
  const failed = []
  let n = 0
  const teamSlug = slugPart(tk)

  for (const rec of records || []) {
    const cats = rec.category ? [rec.category] : BULK_CATEGORIES
    for (const cat of cats) {
      const base = byCategory.get(cat)
      if (!base) {
        skipped.push({
          row: rec.row,
          category: cat,
          reason: `No “${label}” template for category "${cat}"`,
        })
        onProgress?.({ type: 'skip', row: rec.row, category: cat })
        continue
      }
      n += 1
      const id = `${teamSlug}_bulk_${cat}_${slugPart(rec.posterName)}_${Date.now().toString(36)}_${n}`
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
        json.teamKey = tk
        json.teamLabel = label
        if (!json.settings) json.settings = {}
        json.settings.freezeLayout = true
        if (!json.automation) json.automation = {}
        json.automation.freezeLayout = true
        json._bakeMeta = {
          ...(json._bakeMeta || {}),
          bakedAt: new Date().toISOString(),
          source: 'bulk-csv',
          sourceTemplate: base.id,
          csvRow: rec.row,
          teamKey: tk,
        }
        const saved = await saveProject(json, {
          id,
          name,
          category: cat,
          teamKey: tk,
          teamLabel: label,
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

  return {
    created,
    skipped,
    failed,
    baseCategories: [...byCategory.keys()],
    teamKey: tk,
    teamLabel: label,
  }
}

/** @deprecated prefer generateBulkPosters — UTSA wrapper for older call sites */
export async function generateUtsaBulkPosters(opts = {}) {
  return generateBulkPosters({
    ...opts,
    teamKey: opts.teamKey || BULK_TEAM_KEY,
    teamLabel: opts.teamLabel || BULK_TEAM_LABEL,
  })
}
