/**
 * Postgres helper for QA Graphics Testing only.
 * Folder = one sheet (separate CSV-like table). Does not touch other DB tables
 * or Mongo / Editor / Automate / Projects.
 */
import pg from 'pg'

const { Pool } = pg

export const DEFAULT_QA_COLUMNS = [
  { id: 'game', key: 'game', label: 'GAME' },
  { id: 'opponent_score', key: 'opponent_score', label: 'opponent_score' },
  { id: 'story_class', key: 'story_class', label: 'STORY CLASS' },
  { id: 'entity', key: 'entity', label: 'ENTITY' },
  { id: 'core_story', key: 'core_story', label: 'CORE STORY' },
  { id: 'stat_value', key: 'stat_value', label: 'stat_value' },
  { id: 'stat_name', key: 'stat_name', label: 'stat_name' },
  { id: 'player_name', key: 'player_name', label: 'player_name' },
  { id: 'class_positon', key: 'class_positon', label: 'class_positon' },
  { id: 'rank', key: 'rank', label: 'rank' },
  { id: 'story', key: 'story', label: 'story' },
  { id: 'final_check', key: 'final_check', label: 'Final Check - Alonzo' },
  { id: 'canva_link', key: 'canva_link', label: 'CANVA LINK' },
  { id: 'poster_check', key: 'poster_check', label: 'Final Check - Samina' },
  { id: 'notes', key: 'notes', label: 'NOTES' },
]

let pool = null
let lastError = null
let ready = false

/** Build Postgres config from DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD. */
function pgConfig() {
  const url = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim()
  if (url) return { connectionString: url, source: 'DATABASE_URL' }

  const host = String(process.env.DB_HOST || '').trim()
  const user = String(process.env.DB_USER || '').trim()
  const database = String(process.env.DB_NAME || '').trim()
  const password = process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : ''
  const port = Number(process.env.DB_PORT || 5432) || 5432

  if (!host || !user || !database) return null

  const cfg = {
    host,
    port,
    user,
    password,
    database,
    source: 'DB_*',
  }
  const sslMode = String(process.env.DB_SSL || process.env.PGSSLMODE || '').trim().toLowerCase()
  if (sslMode === 'require' || sslMode === 'true' || sslMode === '1') {
    cfg.ssl = { rejectUnauthorized: false }
  } else if (
    host.includes('amazonaws.com') ||
    host.includes('rds.') ||
    host.includes('neon.tech') ||
    host.includes('supabase')
  ) {
    cfg.ssl = { rejectUnauthorized: false }
  }
  return cfg
}

export function qaPgStatus() {
  const cfg = pgConfig()
  return {
    configured: Boolean(cfg),
    connected: ready && !!pool,
    error: lastError,
    source: cfg?.source || null,
  }
}

export async function initQaPg() {
  const cfg = pgConfig()
  if (!cfg) {
    lastError = 'Set DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (or DATABASE_URL)'
    ready = false
    console.log('[qa-pg] skipped — set DB_* or DATABASE_URL to enable QA Graphics Testing saves')
    return false
  }
  try {
    if (pool) {
      try {
        await pool.end()
      } catch (_) {}
      pool = null
    }
    const { source, ...poolOpts } = cfg
    pool = new Pool({ ...poolOpts, max: 5 })
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_sheets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'Untitled',
          columns JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)
      // Older installs may lack name/created_at — additive only
      await client.query(`ALTER TABLE qa_sheets ADD COLUMN IF NOT EXISTS name TEXT`)
      await client.query(`ALTER TABLE qa_sheets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`)
      await client.query(`
        UPDATE qa_sheets
        SET name = COALESCE(NULLIF(TRIM(name), ''), id, 'Untitled')
        WHERE name IS NULL OR TRIM(name) = ''
      `)
      await client.query(`
        UPDATE qa_sheets SET created_at = COALESCE(created_at, updated_at, NOW())
        WHERE created_at IS NULL
      `)
      await client.query(`
        CREATE TABLE IF NOT EXISTS qa_rows (
          id TEXT PRIMARY KEY,
          sheet_id TEXT NOT NULL REFERENCES qa_sheets(id) ON DELETE CASCADE,
          team_key TEXT NOT NULL DEFAULT '',
          team_label TEXT NOT NULL DEFAULT '',
          values JSONB NOT NULL DEFAULT '{}'::jsonb,
          sort_order INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `)
      await client.query(`
        CREATE INDEX IF NOT EXISTS qa_rows_sheet_team
          ON qa_rows (sheet_id, team_key);
      `)
    } finally {
      client.release()
    }
    ready = true
    lastError = null
    console.log('[qa-pg] connected · via', source)
    return true
  } catch (err) {
    ready = false
    lastError = err.message || String(err)
    console.error('[qa-pg] connect failed:', lastError)
    if (pool) {
      try {
        await pool.end()
      } catch (_) {}
      pool = null
    }
    return false
  }
}

function requirePool() {
  if (!pool || !ready) {
    const err = new Error(lastError || 'Postgres not connected for QA Graphics')
    err.status = 503
    throw err
  }
  return pool
}

function newId(prefix = 'row') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeFolderId(raw) {
  let id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!id) id = `folder_${Date.now().toString(36)}`
  if (/^\d/.test(id)) id = `f_${id}`
  return id.slice(0, 64)
}

function normalizeColumn(raw, fallbackKey = 'col') {
  const key =
    String(raw?.key || raw?.id || fallbackKey)
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_|_$/g, '') || fallbackKey
  const id = String(raw?.id || key).trim() || key
  const label = String(raw?.label || key).trim() || key
  return { id, key, label }
}

function mapRow(r) {
  return {
    id: r.id,
    teamKey: r.team_key || '',
    teamLabel: r.team_label || '',
    values: r.values && typeof r.values === 'object' ? r.values : {},
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  }
}

export async function listQaFolders() {
  const db = requirePool()
  const res = await db.query(`
    SELECT s.id, s.name, s.updated_at, s.created_at,
           (SELECT COUNT(*)::int FROM qa_rows r WHERE r.sheet_id = s.id) AS row_count
    FROM qa_sheets s
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
  `)
  return {
    folders: res.rows.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      rowCount: r.row_count || 0,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    })),
    db: qaPgStatus(),
  }
}

export async function createQaFolder({ name } = {}) {
  const db = requirePool()
  const folderName = String(name || '').trim() || 'Untitled'
  let id = normalizeFolderId(folderName)
  const existing = await db.query(`SELECT id FROM qa_sheets WHERE id = $1`, [id])
  if (existing.rows[0]) {
    id = normalizeFolderId(`${folderName}_${Date.now().toString(36)}`)
  }
  await db.query(
    `
    INSERT INTO qa_sheets (id, name, columns, updated_at, created_at)
    VALUES ($1, $2, $3::jsonb, NOW(), NOW())
  `,
    [id, folderName, JSON.stringify(DEFAULT_QA_COLUMNS)],
  )
  return getQaSheet(id)
}

export async function renameQaFolder(sheetId, name) {
  const db = requirePool()
  const id = normalizeFolderId(sheetId)
  const folderName = String(name || '').trim()
  if (!folderName) {
    const err = new Error('Folder name required')
    err.status = 400
    throw err
  }
  const r = await db.query(
    `UPDATE qa_sheets SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id, folderName],
  )
  if (!r.rows[0]) {
    const err = new Error('Folder not found')
    err.status = 404
    throw err
  }
  return getQaSheet(id)
}

export async function deleteQaFolder(sheetId) {
  const db = requirePool()
  const id = normalizeFolderId(sheetId)
  const r = await db.query(`DELETE FROM qa_sheets WHERE id = $1 RETURNING id`, [id])
  if (!r.rows[0]) {
    const err = new Error('Folder not found')
    err.status = 404
    throw err
  }
  return { ok: true, id }
}

export async function getQaSheet(sheetId) {
  const db = requirePool()
  const id = normalizeFolderId(sheetId)
  const sheetRes = await db.query(
    `SELECT id, name, columns, updated_at, created_at FROM qa_sheets WHERE id = $1`,
    [id],
  )
  if (!sheetRes.rows[0]) {
    const err = new Error('Folder not found')
    err.status = 404
    throw err
  }
  const sheet = sheetRes.rows[0]
  const columns = Array.isArray(sheet.columns) && sheet.columns.length
    ? sheet.columns
    : DEFAULT_QA_COLUMNS
  const rowsRes = await db.query(
    `
    SELECT id, team_key, team_label, values, sort_order, updated_at, created_at
    FROM qa_rows
    WHERE sheet_id = $1
    ORDER BY sort_order ASC, created_at ASC
  `,
    [id],
  )
  return {
    id: sheet.id,
    name: sheet.name || sheet.id,
    columns,
    rows: rowsRes.rows.map(mapRow),
    updatedAt: sheet.updated_at,
    createdAt: sheet.created_at,
    db: qaPgStatus(),
  }
}

export async function saveQaSheet(sheetId, { columns, rows, name } = {}) {
  const db = requirePool()
  const id = normalizeFolderId(sheetId)
  const exists = await db.query(`SELECT id, name FROM qa_sheets WHERE id = $1`, [id])
  if (!exists.rows[0]) {
    const err = new Error('Folder not found — create a folder first')
    err.status = 404
    throw err
  }
  const nextColumns = Array.isArray(columns)
    ? columns.map((c, i) => normalizeColumn(c, `col_${i + 1}`))
    : DEFAULT_QA_COLUMNS
  const nextRows = Array.isArray(rows) ? rows : []
  const folderName =
    name != null && String(name).trim()
      ? String(name).trim()
      : exists.rows[0].name || id

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `
      UPDATE qa_sheets
      SET columns = $2::jsonb, name = $3, updated_at = NOW()
      WHERE id = $1
    `,
      [id, JSON.stringify(nextColumns), folderName],
    )
    await client.query(`DELETE FROM qa_rows WHERE sheet_id = $1`, [id])
    for (let i = 0; i < nextRows.length; i++) {
      const row = nextRows[i] || {}
      const rowId = String(row.id || '').trim() || newId('row')
      const teamKey = String(row.teamKey ?? row.team_key ?? '').trim()
      const teamLabel = String(row.teamLabel ?? row.team_label ?? '').trim()
      const values =
        row.values && typeof row.values === 'object' && !Array.isArray(row.values)
          ? row.values
          : {}
      await client.query(
        `
        INSERT INTO qa_rows (id, sheet_id, team_key, team_label, values, sort_order, updated_at, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
      `,
        [rowId, id, teamKey, teamLabel, JSON.stringify(values), Number(row.sortOrder ?? i) || i],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (_) {}
    throw err
  } finally {
    client.release()
  }
  return getQaSheet(id)
}

export async function addQaColumn(sheetId, { key, label } = {}) {
  const sheet = await getQaSheet(sheetId)
  const base = String(key || label || `col_${sheet.columns.length + 1}`)
  const col = normalizeColumn({ key: base, label: label || base }, `col_${sheet.columns.length + 1}`)
  if (sheet.columns.some((c) => c.key === col.key)) {
    const err = new Error(`Column “${col.key}” already exists`)
    err.status = 409
    throw err
  }
  const columns = [...sheet.columns, col]
  const db = requirePool()
  await db.query(
    `UPDATE qa_sheets SET columns = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [sheet.id, JSON.stringify(columns)],
  )
  return getQaSheet(sheet.id)
}

export async function addQaRow(sheetId, { teamKey = '', teamLabel = '', values = {} } = {}) {
  const sheet = await getQaSheet(sheetId)
  const db = requirePool()
  const id = newId('row')
  const sortRes = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM qa_rows WHERE sheet_id = $1`,
    [sheet.id],
  )
  const sortOrder = Number(sortRes.rows[0]?.next) || 0
  const vals = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
  await db.query(
    `
    INSERT INTO qa_rows (id, sheet_id, team_key, team_label, values, sort_order)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6)
  `,
    [id, sheet.id, String(teamKey || ''), String(teamLabel || ''), JSON.stringify(vals), sortOrder],
  )
  return getQaSheet(sheet.id)
}
