/**
 * Server-side bulk poster generation for Stories / external portals.
 * Mirrors react-editor bulk CSV logic — writes Projects only (never templates).
 */

const UNASSIGNED = '__unassigned__'
const BULK_CATEGORIES = ['player', 'team', 'player_no_image', 'nostalgia']

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
  nostalgia: 'nostalgia',
}

const BULK_PREFERRED_BASE_IDS = {
  utsa: {
    player: 'UTSA',
    team: 'UTSA_2',
    nostalgia: 'UTSA_3',
    player_no_image: null,
  },
}

const BULK_TEXT_ALIAS_GROUPS = [
  ['playerName', 'player_name', 'Player_name', 'Player_Name', 'player'],
  ['stat_value', 'Stat_Value', 'Stat_value', 'statValue', 'Stat', 'heroNumber', 'statvalue'],
  ['stat_name', 'Stat_Name', 'Stat_name', 'statName', 'heroDesc', 'stat_text', 'stat_subtext', 'stat_name_2'],
  ['story', 'Story', 'callout', 'subtext'],
  [
    'class_position',
    'class_positon',
    'class_osition',
    'Class_Position',
    'classPosition',
    'classposition',
  ],
  [
    'opponent_score',
    'Opponent_Score',
    'opponentScore',
    'date_and_opponen',
    'vs_and_date',
    'opponent_score_2',
  ],
  ['teamName', 'team_name', 'Team_Name'],
]

export function normalizeTeamKey(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!v || v === 'unassigned' || v === 'none' || v === 'null') return UNASSIGNED
  return v
}

export function normalizeTeamLabel(raw, key = UNASSIGNED) {
  const k = normalizeTeamKey(key)
  if (k === UNASSIGNED) return 'Unassigned'
  const label = String(raw ?? '').trim()
  if (label) return label
  return k
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function normalizeCategory(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return CATEGORY_ALIASES[k] || CATEGORY_ALIASES[String(raw || '').trim().toLowerCase()] || null
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
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

export function createBulkBatchId() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 8)
  return `run_${y}${m}${day}_${hh}${mm}${ss}_${rand}`
}

export function defaultBulkBatchLabel(customName = '') {
  const custom = String(customName || '').trim()
  if (custom) return custom.slice(0, 120)
  return `Bulk · ${new Date().toLocaleString()}`
}

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

/** Accept CSV string or array of row objects → normalized field maps. */
function rowsFromInput({ csv, rows }) {
  if (Array.isArray(rows) && rows.length) {
    return rows.map((r, i) => {
      const out = {}
      for (const [k, v] of Object.entries(r || {})) {
        const nk = HEADER_ALIASES[normHeader(k)] || normHeader(k)
        out[nk] = v != null ? String(v) : ''
      }
      out.__row = i + 1
      return out
    })
  }
  const table = parseCsv(csv)
  if (!table.length) return []
  const headers = table[0].map(normHeader)
  const keys = headers.map((h) => HEADER_ALIASES[h] || HEADER_ALIASES[h.replace(/_/g, '')] || h)
  const out = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const raw = { __row: i + 1 }
    keys.forEach((k, idx) => {
      if (!k) return
      raw[k] = cells[idx] != null ? String(cells[idx]) : ''
    })
    out.push(raw)
  }
  return out
}

function collegeMatchesSelected(rawCollege, teamKey, teamLabel) {
  const v = String(rawCollege || '').trim()
  if (!v) return true
  if (normalizeTeamKey(v) === normalizeTeamKey(teamKey)) return true
  const label = String(teamLabel || '')
    .trim()
    .toLowerCase()
  if (label && v.toLowerCase() === label) return true
  return false
}

function isBulkCloneId(id, teamKey) {
  const s = String(id || '')
  if (s.includes('_bulk_')) return true
  const tk = normalizeTeamKey(teamKey)
  if (tk && s.startsWith(`${tk}_bulk_`)) return true
  return false
}

function expandBulkTextAliases(fields) {
  const textFields = { ...(fields || {}) }
  for (const group of BULK_TEXT_ALIAS_GROUPS) {
    let val = null
    for (const k of group) {
      if (textFields[k] != null && String(textFields[k]).trim() !== '') {
        val = textFields[k]
        break
      }
    }
    if (val == null) continue
    for (const k of group) {
      if (textFields[k] == null || String(textFields[k]).trim() === '') {
        textFields[k] = val
      }
    }
  }
  return textFields
}

function lookupBulkTextValue(textFields, bind) {
  if (!bind || !textFields) return null
  if (textFields[bind] != null) return textFields[bind]
  const lower = String(bind).toLowerCase()
  for (const [k, v] of Object.entries(textFields)) {
    if (String(k).toLowerCase() === lower && v != null) return v
  }
  return null
}

function applyTextToTemplateJson(json, fields) {
  const next = JSON.parse(JSON.stringify(json))
  if (!next.defaults || typeof next.defaults !== 'object') next.defaults = {}
  if (!next.defaults.text || typeof next.defaults.text !== 'object') next.defaults.text = {}
  const textFields = expandBulkTextAliases(fields)
  for (const [k, v] of Object.entries(textFields)) {
    next.defaults.text[k] = v
  }
  if (Array.isArray(next.layers)) {
    for (const layer of next.layers) {
      if (!layer || layer.type !== 'text' || !layer.bind) continue
      const direct = lookupBulkTextValue(textFields, layer.bind)
      if (direct != null) layer.placeholder = String(direct)
      if (layer.kind === 'stat') {
        const numVal = lookupBulkTextValue(textFields, layer.bind + 'num')
        const labelVal = lookupBulkTextValue(textFields, layer.bind + 'label')
        const numFromStat =
          numVal != null ? numVal : lookupBulkTextValue(textFields, 'stat_value')
        const labelFromStat =
          labelVal != null ? labelVal : lookupBulkTextValue(textFields, 'stat_name')
        if (numFromStat != null) layer.placeholderNum = String(numFromStat)
        if (labelFromStat != null) layer.placeholderLabel = String(labelFromStat)
      }
    }
  }
  return next
}

function stripPlayerImageForBulkProject(json) {
  if (!json || typeof json !== 'object') return json
  if (!json.defaults || typeof json.defaults !== 'object') json.defaults = {}
  const images =
    json.defaults.images && typeof json.defaults.images === 'object'
      ? { ...json.defaults.images }
      : {}
  images.player = null
  json.defaults.images = images
  if (json.settings?.defaultImages && typeof json.settings.defaultImages === 'object') {
    json.settings.defaultImages = { ...json.settings.defaultImages, player: null }
  }
  return json
}

/** Best-effort static image for Stories gallery (bg / logo). Not a full PNG render. */
export function extractStaticImageUrl(json) {
  if (!json || typeof json !== 'object') return null
  const imgs = json.defaults?.images || json.settings?.defaultImages || {}
  const pick = imgs.background || imgs.logo || imgs.conference || imgs.sponsor || null
  if (pick && typeof pick === 'string' && pick.trim()) return pick.trim()
  if (Array.isArray(json.layers)) {
    for (const bind of ['background', 'logo', 'conference']) {
      const layer = json.layers.find((l) => l?.type === 'image' && l.bind === bind)
      const src = layer?.src || layer?.url || layer?.placeholder
      if (src && typeof src === 'string' && src.trim()) return src.trim()
    }
  }
  return null
}

export function pickTeamBaseTemplates(templates, teamKey) {
  const tk = normalizeTeamKey(teamKey)
  const preferred = BULK_PREFERRED_BASE_IDS[tk] || {}
  const candidates = (templates || []).filter((t) => {
    const team = normalizeTeamKey(t.teamKey)
    return team === tk
  })
  const byCategory = new Map()
  for (const cat of BULK_CATEGORIES) {
    const preferredId = preferred[cat]
    const pick =
      (preferredId && candidates.find((t) => t.id === preferredId)) ||
      candidates.find(
        (t) => (t.category || 'player') === cat && !isBulkCloneId(t.id, tk),
      ) ||
      candidates.find((t) => (t.category || 'player') === cat)
    if (pick) byCategory.set(cat, pick)
  }
  return byCategory
}

function collectTeamsWithTemplates(templates) {
  const map = new Map()
  for (const t of templates || []) {
    const tk = normalizeTeamKey(t.teamKey)
    if (!tk || tk === UNASSIGNED) continue
    const label = normalizeTeamLabel(t.teamLabel, tk)
    if (!map.has(tk)) map.set(tk, label)
  }
  return map
}

export function resolveCollegeToTeam(rawCollege, templates = [], folders = []) {
  const raw = String(rawCollege || '').trim()
  if (!raw) return null
  const key = normalizeTeamKey(raw)
  const fromTpl = collectTeamsWithTemplates(templates)
  if (fromTpl.has(key)) {
    return { teamKey: key, teamLabel: fromTpl.get(key) }
  }
  const rawLower = raw.toLowerCase()
  for (const [tk, label] of fromTpl.entries()) {
    if (String(label).toLowerCase() === rawLower) return { teamKey: tk, teamLabel: label }
    if (normalizeTeamKey(label) === key) return { teamKey: tk, teamLabel: label }
  }
  for (const f of folders || []) {
    const tk = normalizeTeamKey(f.teamKey)
    const label = normalizeTeamLabel(f.teamLabel, tk)
    if (tk === key || String(label).toLowerCase() === rawLower) {
      if (fromTpl.has(tk)) return { teamKey: tk, teamLabel: fromTpl.get(tk) || label }
    }
  }
  return null
}

function rawToRecord(raw, teamLabel) {
  const fields = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'college' || k === 'category' || k === 'posterName' || k === '__row') continue
    if (v == null || !String(v).trim()) continue
    fields[k] = String(v)
  }
  const category = raw.category ? normalizeCategory(raw.category) : null
  return {
    row: raw.__row || 0,
    posterName: String(
      raw.posterName || fields.playerName || fields.teamName || `${teamLabel} row ${raw.__row || ''}`,
    ).trim(),
    category,
    categoryError: raw.category && !category ? raw.category : null,
    fields,
  }
}

export function parseCollegeBulkInput({ csv, rows, teamKey, teamLabel }) {
  const tk = normalizeTeamKey(teamKey)
  const label = normalizeTeamLabel(teamLabel, tk)
  const rawRows = rowsFromInput({ csv, rows })
  const records = []
  const errors = []
  if (!rawRows.length) return { records, errors: ['CSV/rows empty'], teamKey: tk, teamLabel: label }

  for (const raw of rawRows) {
    if (!collegeMatchesSelected(raw.college, tk, label)) {
      errors.push(`Row ${raw.__row}: skipped (college "${raw.college || ''}" ≠ “${label}”)`)
      continue
    }
    const rec = rawToRecord(raw, label)
    if (rec.categoryError) {
      errors.push(`Row ${raw.__row}: unknown category "${rec.categoryError}"`)
      continue
    }
    records.push(rec)
  }
  return { records, errors, teamKey: tk, teamLabel: label }
}

export function parseMultiCollegeBulkInput({ csv, rows, templates, folders }) {
  const batchId = createBulkBatchId()
  const rawRows = rowsFromInput({ csv, rows })
  const errors = []
  const byTeam = new Map()
  if (!rawRows.length) {
    return { groups: [], errors: ['CSV/rows empty'], bulkBatchDate: batchId }
  }

  for (const raw of rawRows) {
    if (!String(raw.college || '').trim()) {
      errors.push(`Row ${raw.__row}: skipped (college required for multi-college)`)
      continue
    }
    const resolved = resolveCollegeToTeam(raw.college, templates, folders)
    if (!resolved) {
      errors.push(`Row ${raw.__row}: skipped (no templates for college "${raw.college}")`)
      continue
    }
    const rec = rawToRecord(raw, resolved.teamLabel)
    if (rec.categoryError) {
      errors.push(`Row ${raw.__row}: unknown category "${rec.categoryError}"`)
      continue
    }
    if (!byTeam.has(resolved.teamKey)) {
      byTeam.set(resolved.teamKey, {
        teamKey: resolved.teamKey,
        teamLabel: resolved.teamLabel,
        records: [],
      })
    }
    byTeam.get(resolved.teamKey).records.push(rec)
  }
  return { groups: [...byTeam.values()], errors, bulkBatchDate: batchId }
}

export async function generateBulkPosters({
  records,
  templates,
  teamKey,
  teamLabel,
  fetchTemplate,
  saveProject,
  onProgress,
  bulkBatchDate = null,
  bulkBatchLabel = null,
  editUrlFor = null,
} = {}) {
  if (typeof saveProject !== 'function') throw new Error('saveProject required')
  if (typeof fetchTemplate !== 'function') throw new Error('fetchTemplate required')
  const tk = normalizeTeamKey(teamKey)
  if (!tk || tk === UNASSIGNED) {
    throw new Error('teamKey required (college with templates in DB)')
  }
  const label = normalizeTeamLabel(teamLabel, tk)
  const byCategory = pickTeamBaseTemplates(templates, tk)
  const batchDate = bulkBatchDate || createBulkBatchId()
  const batchLabel = bulkBatchLabel || defaultBulkBatchLabel()
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
        stripPlayerImageForBulkProject(json)
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
          source: 'external-api',
          sourceTemplate: base.id,
          csvRow: rec.row,
          teamKey: tk,
          bulkBatchDate: batchDate,
          bulkBatchLabel: batchLabel,
          playerImage: null,
        }
        const saved = await saveProject(json, {
          id,
          name,
          category: cat,
          teamKey: tk,
          teamLabel: label,
          sourceTemplateId: base.id,
          bulkBatchDate: batchDate,
          bulkBatchLabel: batchLabel,
        })
        const posterId = saved.id || id
        const staticImageUrl = extractStaticImageUrl(json)
        created.push({
          id: posterId,
          name,
          category: cat,
          row: rec.row,
          sourceId: base.id,
          teamKey: tk,
          teamLabel: label,
          bulkBatchDate: batchDate,
          bulkBatchLabel: batchLabel,
          staticImageUrl,
          editUrl: typeof editUrlFor === 'function' ? editUrlFor(posterId) : null,
        })
        onProgress?.({ type: 'ok', row: rec.row, category: cat, id: posterId, name })
      } catch (e) {
        failed.push({
          row: rec.row,
          category: cat,
          teamKey: tk,
          error: e.message || String(e),
        })
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
    bulkBatchDate: batchDate,
    bulkBatchLabel: batchLabel,
  }
}

export async function generateMultiCollegeBulkPosters({
  groups,
  templates,
  fetchTemplate,
  saveProject,
  onProgress,
  bulkBatchDate = null,
  bulkBatchLabel = null,
  editUrlFor = null,
} = {}) {
  const batchDate = bulkBatchDate || createBulkBatchId()
  const batchLabel = bulkBatchLabel || defaultBulkBatchLabel()
  const created = []
  const skipped = []
  const failed = []
  const colleges = []

  for (const g of groups || []) {
    const result = await generateBulkPosters({
      records: g.records,
      templates,
      teamKey: g.teamKey,
      teamLabel: g.teamLabel,
      fetchTemplate,
      saveProject,
      onProgress,
      bulkBatchDate: batchDate,
      bulkBatchLabel: batchLabel,
      editUrlFor,
    })
    created.push(...result.created)
    skipped.push(...result.skipped)
    failed.push(...result.failed)
    colleges.push({
      teamKey: result.teamKey,
      teamLabel: result.teamLabel,
      created: result.created.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    })
  }

  return {
    created,
    skipped,
    failed,
    colleges,
    bulkBatchDate: batchDate,
    bulkBatchLabel: batchLabel,
  }
}
