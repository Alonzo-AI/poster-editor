import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  DEFAULT_QA_COLUMNS,
  emptyLocalSheet,
  loadQaSheet,
  newLocalRowId,
  qaGraphicsStatus,
  saveQaSheet,
} from '../api/qaGraphicsApi.js'
import { normalizeTeamKey, normalizeTeamLabel } from '../lib/templateTeam.js'

const CHECK_DROPDOWN_KEYS = new Set(['final_check', 'poster_check'])
const CHECK_OPTIONS = ['pass', 'fail', 'not sure', 'not done']
const UI_COLUMN_LABELS = {
  final_check: 'Final Check - Alonzo',
  poster_check: 'Final Check - Samina',
}
const WIDE_KEYS = new Set(['story', 'core_story', 'notes', 'canva_link'])
const MIN_COL_W = 72
const MAX_COL_W = 560
const DEFAULT_COL_W = 140
const WIDE_COL_W = 220
const CHECK_COL_W = 110
const ROW_H = 36

function normalizeCheckValue(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (CHECK_OPTIONS.includes(v)) return v
  return ''
}

function checkSelectClass(value) {
  const v = normalizeCheckValue(value)
  if (v === 'pass') return 'bg-emerald-950/40 text-emerald-200'
  if (v === 'fail') return 'bg-red-950/40 text-red-200'
  if (v === 'not sure') return 'bg-amber-950/40 text-amber-100'
  return 'bg-transparent text-paper'
}

function defaultWidthForKey(key) {
  if (CHECK_DROPDOWN_KEYS.has(key)) return CHECK_COL_W
  if (WIDE_KEYS.has(key)) return WIDE_COL_W
  return DEFAULT_COL_W
}

function widthsStorageKey(folderId) {
  return `qa.sheet.colWidths.${folderId || 'local'}`
}

function loadStoredWidths(folderId, cols) {
  try {
    const raw = localStorage.getItem(widthsStorageKey(folderId))
    const parsed = raw ? JSON.parse(raw) : null
    const map = parsed && typeof parsed === 'object' ? parsed : {}
    const out = {}
    for (const c of cols || []) {
      const w = Number(map[c.key])
      out[c.key] = Number.isFinite(w)
        ? Math.min(MAX_COL_W, Math.max(MIN_COL_W, w))
        : defaultWidthForKey(c.key)
    }
    return out
  } catch (_) {
    const out = {}
    for (const c of cols || []) out[c.key] = defaultWidthForKey(c.key)
    return out
  }
}

function saveStoredWidths(folderId, widths) {
  try {
    localStorage.setItem(widthsStorageKey(folderId), JSON.stringify(widths || {}))
  } catch (_) {}
}

/**
 * One QA folder spreadsheet — isolated from Editor / Automate / Projects.
 */
export default function QaGraphicsFolderPage({ Nav }) {
  const { folderId: rawId } = useParams()
  const folderId = String(rawId || '').trim()

  const [folderName, setFolderName] = useState('')
  const [columns, setColumns] = useState(() => DEFAULT_QA_COLUMNS.map((c) => ({ ...c })))
  const [rows, setRows] = useState([])
  const [colWidths, setColWidths] = useState(() => loadStoredWidths(folderId, DEFAULT_QA_COLUMNS))
  const [db, setDb] = useState({ configured: false, connected: false, error: null })
  const [teamFilter, setTeamFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [sheetMinimized, setSheetMinimized] = useState(false)
  const [sheetMaximized, setSheetMaximized] = useState(false)
  const resizeRef = useRef(null)

  const syncWidthsForColumns = useCallback(
    (cols) => {
      setColWidths((prev) => {
        const next = { ...prev }
        for (const c of cols || []) {
          if (next[c.key] == null) next[c.key] = defaultWidthForKey(c.key)
        }
        saveStoredWidths(folderId, next)
        return next
      })
    },
    [folderId],
  )

  async function refreshFromDb() {
    if (!folderId) {
      setStatus('Missing folder id')
      return null
    }
    const st = await qaGraphicsStatus()
    setDb(st)
    if (!st.connected) {
      setStatus(
        st.configured
          ? `Postgres not connected: ${st.error || 'check DB_* / server'}`
          : 'Postgres not configured — edits stay local until DB_* are set and the API restarts.',
      )
      return null
    }
    const sheet = await loadQaSheet(folderId)
    setFolderName(sheet.name || folderId)
    const nextCols =
      Array.isArray(sheet.columns) && sheet.columns.length
        ? sheet.columns
        : DEFAULT_QA_COLUMNS.map((c) => ({ ...c }))
    setColumns(nextCols)
    setColWidths(loadStoredWidths(folderId, nextCols))
    setRows(Array.isArray(sheet.rows) ? sheet.rows : [])
    setDb(sheet.db || st)
    setDirty(false)
    setStatus(`Loaded “${sheet.name || folderId}”`)
    return sheet
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setBusy(true)
        await refreshFromDb()
      } catch (e) {
        if (!cancelled) {
          const local = emptyLocalSheet(folderId)
          setFolderName(local.name)
          setColumns(local.columns)
          setColWidths(loadStoredWidths(folderId, local.columns))
          setRows(local.rows)
          setStatus(e.message || 'Could not load sheet — working locally')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [folderId])

  useEffect(() => {
    if (!sheetMaximized) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setSheetMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetMaximized])

  const teamOptions = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const key = normalizeTeamKey(row.teamKey || row.values?.entity || row.values?.team || '')
      if (!key || key === '__unassigned__') continue
      const label =
        normalizeTeamLabel(
          row.teamLabel || row.values?.entity || row.values?.team || key,
          key,
        ) || key
      if (!map.has(key)) map.set(key, label)
    }
    return [...map.entries()]
      .map(([teamKey, teamLabel]) => ({ teamKey, teamLabel }))
      .sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [rows])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      const key = normalizeTeamKey(row.teamKey || row.values?.entity || row.values?.team || '')
      if (teamFilter !== 'all' && key !== teamFilter) return false
      if (!q) return true
      const blob = [row.teamLabel, row.teamKey, ...Object.values(row.values || {})]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [rows, teamFilter, search])

  const tableWidth = useMemo(() => {
    let w = 48 + 56 // # + delete
    for (const c of columns) w += colWidths[c.key] || defaultWidthForKey(c.key)
    return w
  }, [columns, colWidths])

  function markDirty() {
    setDirty(true)
  }

  function onCellChange(rowId, colKey, value) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r
        const values = { ...(r.values || {}), [colKey]: value }
        let teamKey = r.teamKey
        let teamLabel = r.teamLabel
        if (colKey === 'entity' || colKey === 'team') {
          teamKey = normalizeTeamKey(value)
          teamLabel = normalizeTeamLabel(value, teamKey)
        }
        return { ...r, values, teamKey, teamLabel }
      }),
    )
    markDirty()
  }

  function onAddRow() {
    const values = {}
    for (const c of columns) values[c.key] = ''
    if (teamFilter !== 'all') {
      const opt = teamOptions.find((t) => t.teamKey === teamFilter)
      values.entity = opt?.teamLabel || teamFilter
    }
    setRows((prev) => [
      ...prev,
      {
        id: newLocalRowId(),
        teamKey: teamFilter !== 'all' ? teamFilter : '',
        teamLabel: values.entity || '',
        values,
        sortOrder: prev.length,
      },
    ])
    markDirty()
    setStatus('Row added (local) — Save to persist')
  }

  function onDeleteRow(rowId) {
    if (!window.confirm('Delete this row?')) return
    setRows((prev) => prev.filter((r) => r.id !== rowId))
    markDirty()
  }

  function onAddColumn() {
    const label = window.prompt('New column name', '')
    if (label == null || !String(label).trim()) return
    const raw = String(label).trim()
    const key =
      raw
        .toLowerCase()
        .replace(/[^\w]+/g, '_')
        .replace(/^_|_$/g, '') || `col_${columns.length + 1}`
    if (columns.some((c) => c.key === key)) {
      setStatus(`Column “${key}” already exists`)
      return
    }
    const col = { id: key, key, label: raw }
    setColumns((prev) => [...prev, col])
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        values: { ...(r.values || {}), [key]: '' },
      })),
    )
    syncWidthsForColumns([...columns, col])
    markDirty()
    setStatus(`Column “${raw}” added — Save to persist`)
  }

  function startColResize(e, colKey) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[colKey] || defaultWidthForKey(colKey)
    resizeRef.current = { colKey, startX, startW }

    const onMove = (ev) => {
      const drag = resizeRef.current
      if (!drag) return
      const next = Math.min(
        MAX_COL_W,
        Math.max(MIN_COL_W, drag.startW + (ev.clientX - drag.startX)),
      )
      setColWidths((prev) => {
        const updated = { ...prev, [drag.colKey]: next }
        saveStoredWidths(folderId, updated)
        return updated
      })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  async function onSave() {
    if (!folderId) return
    setBusy(true)
    try {
      const st = await qaGraphicsStatus()
      setDb(st)
      if (!st.connected) {
        setStatus(
          st.configured
            ? `Cannot save — Postgres not connected (${st.error || 'unknown'})`
            : 'Cannot save — set DB_* on the API server, then restart',
        )
        return
      }
      const sheet = await saveQaSheet(folderId, {
        name: folderName,
        columns,
        rows,
      })
      setFolderName(sheet.name || folderName)
      setColumns(sheet.columns || columns)
      setRows(sheet.rows || [])
      setDb(sheet.db || st)
      setDirty(false)
      setStatus(`Saved “${sheet.name || folderId}” · ${sheet.rows?.length ?? 0} row(s)`)
    } catch (e) {
      setStatus(e.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function onReload() {
    setBusy(true)
    try {
      await refreshFromDb()
    } catch (e) {
      setStatus(e.message || 'Reload failed')
    } finally {
      setBusy(false)
    }
  }

  function renderSheetTable() {
    return (
      <div className="h-full min-h-0 overflow-auto rounded-xl border border-line bg-panel">
        <table
          className="border-collapse text-left text-[13px]"
          style={{ tableLayout: 'fixed', width: tableWidth }}
        >
          <colgroup>
            <col style={{ width: 48 }} />
            {columns.map((col) => (
              <col
                key={col.key}
                style={{ width: colWidths[col.key] || defaultWidthForKey(col.key) }}
              />
            ))}
            <col style={{ width: 56 }} />
          </colgroup>
          <thead>
            <tr className="bg-inset">
              <th className="sticky left-0 top-0 z-20 border-b border-r border-line bg-inset px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="relative sticky top-0 z-10 border-b border-r border-line bg-inset px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim"
                  title="Drag the right edge to resize"
                >
                  <span className="block truncate pr-2">
                    {UI_COLUMN_LABELS[col.key] || col.label || col.key}
                  </span>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={(e) => startColResize(e, col.key)}
                    className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize hover:bg-blaze/40"
                  />
                </th>
              ))}
              <th className="sticky top-0 z-10 border-b border-line bg-inset px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim">
                Del
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="px-4 py-10 text-center text-sm text-dim"
                >
                  No rows yet — click <b className="text-paper">Add row</b>, edit cells, then{' '}
                  <b className="text-paper">Save</b>.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, idx) => (
                <tr key={row.id} className="hover:bg-inset/40" style={{ height: ROW_H }}>
                  <td className="sticky left-0 z-10 border-b border-r border-line bg-panel px-2 text-[11px] text-dim">
                    {idx + 1}
                  </td>
                  {columns.map((col) => {
                    const w = colWidths[col.key] || defaultWidthForKey(col.key)
                    return (
                      <td
                        key={col.key}
                        className="overflow-hidden border-b border-r border-line p-0 align-top focus-within:overflow-visible focus-within:relative focus-within:z-10"
                        style={{ height: ROW_H, width: w }}
                      >
                        {CHECK_DROPDOWN_KEYS.has(col.key) ? (
                          <select
                            value={normalizeCheckValue(row.values?.[col.key])}
                            onChange={(e) => onCellChange(row.id, col.key, e.target.value)}
                            className={`box-border block h-9 w-full truncate border-0 px-2 text-[12px] outline-none focus:bg-inset/60 ${checkSelectClass(row.values?.[col.key])}`}
                          >
                            <option value="">—</option>
                            {CHECK_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <textarea
                            rows={1}
                            value={row.values?.[col.key] ?? ''}
                            title={row.values?.[col.key] || ''}
                            onChange={(e) => onCellChange(row.id, col.key, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                // Enter alone: stay single-commit (no new line)
                                e.preventDefault()
                                e.currentTarget.blur()
                                return
                              }
                              // Shift+Enter: allow newline inside the cell
                            }}
                            className="box-border block h-9 w-full resize-none overflow-auto whitespace-pre-wrap break-words border-0 bg-transparent px-2 py-1.5 text-[12px] leading-snug text-paper outline-none focus:h-24 focus:bg-inset/60"
                          />
                        )}
                      </td>
                    )
                  })}
                  <td className="border-b border-line px-1 text-center">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(row.id)}
                      className="rounded-md px-2 py-1 text-[11px] font-semibold text-dim hover:bg-inset hover:text-paper"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-paper">
            {folderName || folderId || 'QA folder'}
          </div>
          <div className="truncate text-[11px] text-muted">
            QA sheet · {db.connected ? 'Postgres connected' : 'local / not saved'}
            {dirty ? ' · unsaved changes' : ''}
          </div>
        </div>
        {Nav ? <Nav /> : null}
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel/80 px-4 py-3">
        <Link to="/qa-graphics" className="text-xs font-semibold text-dim hover:text-paper">
          ← All folders
        </Link>
        <label className="flex items-center gap-2 text-xs text-dim">
          Category
          <select
            className="rounded-lg border border-line bg-inset px-2 py-1.5 text-xs text-paper"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="all">All Teams</option>
            {teamOptions.map((t) => (
              <option key={t.teamKey} value={t.teamKey}>
                {t.teamLabel}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-inset px-3 py-1.5 text-xs text-paper placeholder:text-dim"
        />
        <button
          type="button"
          disabled={busy}
          onClick={onAddRow}
          className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-paper hover:border-blaze/40"
        >
          Add row
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAddColumn}
          className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-paper hover:border-blaze/40"
        >
          Add column
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReload}
          className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-dim hover:text-paper"
        >
          Reload
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="rounded-full bg-blaze px-3.5 py-1.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setSheetMinimized((v) => !v)
            if (!sheetMinimized) setSheetMaximized(false)
          }}
          className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-dim hover:text-paper"
          title={sheetMinimized ? 'Expand sheet' : 'Minimize sheet'}
        >
          {sheetMinimized ? 'Expand' : 'Minimize'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSheetMaximized(true)
            setSheetMinimized(false)
          }}
          className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-dim hover:text-paper"
          title="Maximize sheet"
        >
          Maximize
        </button>
      </div>

      {status ? (
        <div className="shrink-0 border-b border-line px-4 py-2 text-[12px] text-muted">{status}</div>
      ) : null}

      {sheetMinimized ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-dim">
          Sheet minimized — click <b className="mx-1 text-paper">Expand</b> or{' '}
          <b className="mx-1 text-paper">Maximize</b> to show it again.
        </div>
      ) : (
        <main className="min-h-0 flex-1 overflow-hidden p-4">{renderSheetTable()}</main>
      )}

      {sheetMaximized ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-ink/95 p-3 backdrop-blur-sm">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-paper">
              {folderName || folderId} · fullscreen
            </div>
            <button
              type="button"
              onClick={() => setSheetMaximized(false)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-paper hover:border-blaze/40"
            >
              Exit maximize (Esc)
            </button>
          </div>
          <div className="min-h-0 flex-1">{renderSheetTable()}</div>
        </div>
      ) : null}
    </div>
  )
}
