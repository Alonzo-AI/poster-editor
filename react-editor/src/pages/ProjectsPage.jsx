import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listDbTemplates, fetchDbTemplate, listTeamFolders } from '../api/templatesApi.js'
import {
  listProjects,
  saveProject,
  renameProjectBatch,
  deleteProjectBatch,
} from '../api/projectsApi.js'
import {
  BULK_CATEGORIES,
  createBulkBatchId,
  csvRowsToBulkRecords,
  csvRowsToMultiCollegeRecords,
  defaultBulkBatchLabel,
  generateBulkPosters,
  generateMultiCollegeBulkPosters,
  pickTeamBaseTemplates,
} from '../lib/bulkUtsaGenerate.js'
import {
  UNASSIGNED_TEAM_KEY,
  collectTeamOptions,
  normalizeTeamKey,
  normalizeTeamLabel,
  teamOf,
} from '../lib/templateTeam.js'

const CATEGORY_LABEL = {
  player: 'Player',
  team: 'Team',
  player_no_image: 'No image',
  nostalgia: 'Nostalgia',
}

/** Stable folder id stored on each project (per CSV run, or legacy YYYY-MM-DD). */
function projectBatchId(p) {
  if (p?.bulkBatchDate) return String(p.bulkBatchDate).trim().slice(0, 64)
  if (p?.createdAt) {
    const d = new Date(p.createdAt)
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  }
  return 'undated'
}

function projectBatchLabel(p, batchId) {
  const label = String(p?.bulkBatchLabel || '').trim()
  if (label) return label
  const id = batchId || projectBatchId(p)
  if (!id || id === 'undated') return 'Undated'
  if (/^\d{4}-\d{2}-\d{2}$/.test(id)) return id
  return defaultBulkBatchLabel(id.replace(/^run_/, '').replace(/_/g, ' '))
}

function promptBatchFolderName(defaultName) {
  const name = window.prompt('Name for this bulk folder', defaultName || defaultBulkBatchLabel())
  if (name == null) return null
  const trimmed = String(name).trim()
  return trimmed || defaultBulkBatchLabel()
}

/**
 * Projects gallery — batch folders (one per CSV generate) → college → posters.
 * Does not touch Editor, Automate, or Automate saves.
 */
export default function ProjectsPage({ Nav }) {
  const navigate = useNavigate()
  const { batchDate: routeBatch, teamKey: routeTeamKey } = useParams()
  const openBatchId = routeBatch ? String(routeBatch).trim().slice(0, 64) : null
  const openTeamKey = routeTeamKey
    ? String(routeTeamKey)
        .trim()
        .replace(/[^\w-]+/g, '_')
    : null

  const [projects, setProjects] = useState([])
  const [templateCatalog, setTemplateCatalog] = useState([])
  const [extraTeams, setExtraTeams] = useState([])
  const [bulkTeamKey, setBulkTeamKey] = useState('')
  const [status, setStatus] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkLog, setBulkLog] = useState('')
  const [multiBusy, setMultiBusy] = useState(false)
  const [multiLog, setMultiLog] = useState('')
  const [folderBusyId, setFolderBusyId] = useState(null)
  const bulkFileRef = useRef(null)
  const multiFileRef = useRef(null)

  const refresh = useCallback(async () => {
    const list = await listProjects()
    setProjects(list)
    return list
  }, [])

  const loadTeamSources = useCallback(async () => {
    const [remote, folders] = await Promise.all([
      listDbTemplates({ lite: true }),
      listTeamFolders().catch(() => []),
    ])
    setTemplateCatalog(remote || [])
    setExtraTeams(
      (folders || []).map((t) => ({
        teamKey: normalizeTeamKey(t.teamKey),
        teamLabel: normalizeTeamLabel(t.teamLabel, t.teamKey),
      })),
    )
    return { templates: remote || [], folders: folders || [] }
  }, [])

  useEffect(() => {
    refresh()
      .then(() => setStatus(''))
      .catch((e) => setStatus(e.message || 'Failed to load projects'))
    loadTeamSources().catch(() => {})
  }, [refresh, loadTeamSources])

  const bulkTeamOptions = useMemo(() => {
    const fromTpl = collectTeamOptions(templateCatalog).filter(
      (t) => t.teamKey !== UNASSIGNED_TEAM_KEY,
    )
    const map = new Map(fromTpl.map((t) => [t.teamKey, t.teamLabel]))
    for (const t of extraTeams) {
      if (t.teamKey === UNASSIGNED_TEAM_KEY) continue
      if (!map.has(t.teamKey)) {
        const hasTpl = templateCatalog.some((x) => teamOf(x).teamKey === t.teamKey)
        if (hasTpl) map.set(t.teamKey, t.teamLabel)
      }
    }
    return [...map.entries()]
      .map(([teamKey, teamLabel]) => ({ teamKey, teamLabel }))
      .sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [templateCatalog, extraTeams])

  useEffect(() => {
    if (!bulkTeamKey && bulkTeamOptions.length) {
      const utsa = bulkTeamOptions.find((t) => t.teamKey === 'utsa')
      setBulkTeamKey(utsa?.teamKey || bulkTeamOptions[0].teamKey)
    } else if (
      bulkTeamKey &&
      bulkTeamOptions.length &&
      !bulkTeamOptions.some((t) => t.teamKey === bulkTeamKey)
    ) {
      setBulkTeamKey(bulkTeamOptions[0].teamKey)
    }
  }, [bulkTeamOptions, bulkTeamKey])

  const selectedBulkTeam = useMemo(
    () => bulkTeamOptions.find((t) => t.teamKey === bulkTeamKey) || null,
    [bulkTeamOptions, bulkTeamKey],
  )

  const availableCategories = useMemo(() => {
    if (!bulkTeamKey) return []
    const bases = pickTeamBaseTemplates(templateCatalog, bulkTeamKey)
    return BULK_CATEGORIES.filter((c) => bases.has(c))
  }, [templateCatalog, bulkTeamKey])

  /** Root: one folder per CSV generate run */
  const byBatch = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const id = projectBatchId(p)
      if (!map.has(id)) {
        map.set(id, {
          id,
          label: projectBatchLabel(p, id),
          items: [],
          updatedAt: p.updatedAt || p.createdAt || '',
        })
      }
      const g = map.get(id)
      g.items.push(p)
      if (p.bulkBatchLabel) g.label = String(p.bulkBatchLabel).trim() || g.label
      const ts = p.updatedAt || p.createdAt || ''
      if (ts && String(ts) > String(g.updatedAt || '')) g.updatedAt = ts
    }
    return [...map.values()]
      .map((g) => {
        const colleges = new Set(g.items.map((p) => teamOf(p).teamKey))
        return {
          ...g,
          collegeCount: colleges.size,
          posterCount: g.items.length,
        }
      })
      .sort((a, b) => String(b.updatedAt || b.id).localeCompare(String(a.updatedAt || a.id)))
  }, [projects])

  const openBatchMeta = useMemo(
    () => byBatch.find((b) => b.id === openBatchId) || null,
    [byBatch, openBatchId],
  )

  const collegesInBatch = useMemo(() => {
    if (!openBatchId) return []
    const map = new Map()
    for (const p of projects) {
      if (projectBatchId(p) !== openBatchId) continue
      const { teamKey, teamLabel } = teamOf(p)
      if (!map.has(teamKey)) map.set(teamKey, { teamKey, teamLabel, items: [] })
      map.get(teamKey).items.push(p)
    }
    return [...map.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [projects, openBatchId])

  const openCollege = useMemo(() => {
    if (!openTeamKey || !openBatchId) return null
    return collegesInBatch.find((g) => g.teamKey === openTeamKey) || null
  }, [collegesInBatch, openTeamKey, openBatchId])

  useEffect(() => {
    if (openTeamKey && !openBatchId) {
      navigate('/projects', { replace: true })
    }
  }, [openTeamKey, openBatchId, navigate])

  async function onRenameBatch(batch) {
    if (!batch?.id || folderBusyId) return
    const next = window.prompt('Rename batch folder', batch.label || batch.id)
    if (next == null) return
    const label = String(next).trim()
    if (!label) return
    setFolderBusyId(batch.id)
    try {
      await renameProjectBatch(batch.id, label)
      await refresh()
      setStatus(`Renamed folder to “${label}”`)
    } catch (e) {
      setStatus(e.message || 'Rename failed')
    } finally {
      setFolderBusyId(null)
    }
  }

  async function onDeleteBatch(batch) {
    if (!batch?.id || folderBusyId) return
    const ok = window.confirm(
      `Delete folder “${batch.label || batch.id}” and all ${batch.posterCount} poster(s) inside?\n\nThis cannot be undone.`,
    )
    if (!ok) return
    setFolderBusyId(batch.id)
    try {
      const res = await deleteProjectBatch(batch.id)
      await refresh()
      setStatus(`Deleted folder · ${res.deleted || 0} poster(s) removed`)
      if (openBatchId === batch.id) navigate('/projects')
    } catch (e) {
      setStatus(e.message || 'Delete folder failed')
    } finally {
      setFolderBusyId(null)
    }
  }

  async function onBulkGenerate() {
    if (bulkBusy || multiBusy) return
    if (!selectedBulkTeam) {
      setBulkLog('Select a college/team that has templates in the database.')
      return
    }
    const file = bulkFileRef.current?.files?.[0]
    if (!file) {
      setBulkLog('Choose a CSV file first (text fields only).')
      return
    }
    const folderName = promptBatchFolderName(
      defaultBulkBatchLabel(`${selectedBulkTeam.teamLabel} bulk`),
    )
    if (folderName == null) return

    setBulkBusy(true)
    setBulkLog('Reading CSV…')
    try {
      const text = await file.text()
      const { records, errors } = csvRowsToBulkRecords(text, {
        teamKey: selectedBulkTeam.teamKey,
        teamLabel: selectedBulkTeam.teamLabel,
      })
      if (!records.length) {
        setBulkLog(
          `No rows to generate for “${selectedBulkTeam.teamLabel}”.${
            errors.length ? `\n${errors.join('\n')}` : ''
          }`,
        )
        return
      }
      let templates = templateCatalog
      try {
        const loaded = await loadTeamSources()
        templates = loaded.templates || templateCatalog
      } catch (_) {}
      const bulkBatchDate = createBulkBatchId()
      const bulkBatchLabel = folderName
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(
        `Folder “${bulkBatchLabel}” · ${records.length} CSV row(s) for “${selectedBulkTeam.teamLabel}”…`,
      )
      setBulkLog(lines.join('\n'))

      const result = await generateBulkPosters({
        records,
        templates,
        teamKey: selectedBulkTeam.teamKey,
        teamLabel: selectedBulkTeam.teamLabel,
        fetchTemplate: fetchDbTemplate,
        saveProject,
        bulkBatchDate,
        bulkBatchLabel,
        onProgress: (ev) => {
          if (ev.type === 'skip') lines.push(`Skip row ${ev.row} / ${ev.category}`)
          else if (ev.type === 'ok') lines.push(`OK ${ev.category}: ${ev.name}`)
          else if (ev.type === 'fail') {
            lines.push(`FAIL row ${ev.row} / ${ev.category}: ${ev.error}`)
          }
          setBulkLog(lines.join('\n'))
        },
      })

      await refresh()
      lines.push('---')
      lines.push(
        `Done: ${result.created.length} projects · ${result.skipped.length} skipped · ${result.failed.length} failed`,
      )
      lines.push(`Batch folder: ${result.bulkBatchLabel || result.bulkBatchDate}`)
      setBulkLog(lines.join('\n'))
      setStatus(`Created ${result.created.length} project(s) in “${result.bulkBatchLabel}”`)
      navigate(
        `/projects/batch/${encodeURIComponent(result.bulkBatchDate)}/team/${encodeURIComponent(selectedBulkTeam.teamKey)}`,
      )
    } catch (e) {
      setBulkLog(`Bulk failed: ${e.message || e}`)
      setStatus(e.message || 'Bulk failed')
    } finally {
      setBulkBusy(false)
    }
  }

  async function onMultiCollegeGenerate() {
    if (bulkBusy || multiBusy) return
    const file = multiFileRef.current?.files?.[0]
    if (!file) {
      setMultiLog('Choose a multi-college CSV (college column required on every row).')
      return
    }
    const folderName = promptBatchFolderName(defaultBulkBatchLabel('Multi-college bulk'))
    if (folderName == null) return

    setMultiBusy(true)
    setMultiLog('Reading multi-college CSV…')
    try {
      const text = await file.text()
      let templates = templateCatalog
      let folders = extraTeams
      try {
        const loaded = await loadTeamSources()
        templates = loaded.templates || templateCatalog
        folders = loaded.folders || extraTeams
      } catch (_) {}

      const { groups, errors, bulkBatchDate } = csvRowsToMultiCollegeRecords(text, {
        templates,
        folders,
      })
      if (!groups.length) {
        setMultiLog(
          `No colleges to generate.${errors.length ? `\n${errors.join('\n')}` : ''}`,
        )
        return
      }
      const bulkBatchLabel = folderName
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(
        `Folder “${bulkBatchLabel}” · ${groups.length} college(s)`,
      )
      for (const g of groups) {
        lines.push(`  · ${g.teamLabel}: ${g.records.length} row(s)`)
      }
      setMultiLog(lines.join('\n'))

      const result = await generateMultiCollegeBulkPosters({
        groups,
        templates,
        fetchTemplate: fetchDbTemplate,
        saveProject,
        bulkBatchDate,
        bulkBatchLabel,
        onProgress: (ev) => {
          if (ev.type === 'college') {
            lines.push(`— ${ev.teamLabel} (${ev.rows} rows)`)
          } else if (ev.type === 'skip') {
            lines.push(`Skip ${ev.teamKey} row ${ev.row} / ${ev.category}`)
          } else if (ev.type === 'ok') {
            lines.push(`OK ${ev.teamKey} ${ev.category}: ${ev.name}`)
          } else if (ev.type === 'fail') {
            lines.push(`FAIL ${ev.teamKey} row ${ev.row}: ${ev.error}`)
          }
          setMultiLog(lines.join('\n'))
        },
      })

      await refresh()
      lines.push('---')
      lines.push(
        `Done: ${result.created.length} projects · ${result.colleges.length} college folder(s)`,
      )
      for (const c of result.colleges) {
        lines.push(`  · ${c.teamLabel}: ${c.created} poster(s)`)
      }
      setMultiLog(lines.join('\n'))
      setStatus(
        `Created ${result.created.length} posters in “${result.bulkBatchLabel || result.bulkBatchDate}”`,
      )
      navigate(`/projects/batch/${encodeURIComponent(result.bulkBatchDate)}`)
    } catch (e) {
      setMultiLog(`Multi bulk failed: ${e.message || e}`)
      setStatus(e.message || 'Multi bulk failed')
    } finally {
      setMultiBusy(false)
    }
  }

  const atRoot = !openBatchId && !openTeamKey
  const inBatch = !!openBatchId && !openTeamKey
  const inCollege = !!openBatchId && !!openTeamKey

  const headerTitle = inCollege
    ? openCollege?.teamLabel || openTeamKey
    : inBatch
      ? openBatchMeta?.label || openBatchId
      : 'Projects'

  const headerSub = inCollege
    ? `${openCollege?.items.length || 0} poster(s) · ${openBatchMeta?.label || openBatchId}`
    : inBatch
      ? `${collegesInBatch.length} college(s) in this bulk folder`
      : 'Each CSV generate → its own folder → colleges → posters'

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-paper">{headerTitle}</div>
          <div className="truncate text-[11px] text-muted">{headerSub}</div>
        </div>
        <div className="flex items-center gap-2">
          {inCollege ? (
            <Link
              to={`/projects/batch/${encodeURIComponent(openBatchId)}`}
              className="ui-btn text-[12px]"
            >
              Colleges
            </Link>
          ) : null}
          {inBatch || inCollege ? (
            <Link to="/projects" className="ui-btn text-[12px]">
              All folders
            </Link>
          ) : null}
          {Nav ? <Nav /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        {atRoot ? (
          <>
            <section className="rounded-xl border border-dashed border-blaze/30 bg-panel p-4 shadow-sm">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Bulk generate · one college
              </h2>
              <p className="mt-1 text-[12px] text-muted">
                Each generate creates a <strong className="text-dim">new folder</strong> (not by
                calendar date), then that college under it.
              </p>
              <label className="mt-3 block text-[11px] text-dim">
                College / team
                <select
                  className="ui-input mt-1 w-full text-[12px]"
                  value={bulkTeamKey}
                  onChange={(e) => setBulkTeamKey(normalizeTeamKey(e.target.value))}
                  disabled={bulkBusy || multiBusy || !bulkTeamOptions.length}
                >
                  {!bulkTeamOptions.length ? (
                    <option value="">No teams with templates</option>
                  ) : (
                    bulkTeamOptions.map((t) => (
                      <option key={t.teamKey} value={t.teamKey}>
                        {t.teamLabel}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {selectedBulkTeam ? (
                <p className="mt-2 text-[11px] text-muted">
                  Bases:{' '}
                  {availableCategories.length
                    ? availableCategories.map((c) => CATEGORY_LABEL[c] || c).join(', ')
                    : 'none'}
                </p>
              ) : null}
              <input
                ref={bulkFileRef}
                type="file"
                accept=".csv,text/csv"
                className="mt-3 block w-full text-[11px] text-dim file:mr-2 file:rounded file:border-0 file:bg-inset file:px-2 file:py-1 file:text-[11px] file:text-paper"
              />
              <button
                type="button"
                className="ui-btn ui-btn-primary mt-2 text-[12px]"
                disabled={
                  bulkBusy || multiBusy || !selectedBulkTeam || !availableCategories.length
                }
                onClick={onBulkGenerate}
              >
                {bulkBusy ? 'Generating…' : 'Generate for selected college'}
              </button>
              {bulkLog ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-inset p-2 text-[10px] text-dim">
                  {bulkLog}
                </pre>
              ) : null}
            </section>

            <section className="rounded-xl border border-dashed border-line bg-panel p-4 shadow-sm">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Bulk CSV · multiple colleges
              </h2>
              <p className="mt-1 text-[12px] text-muted">
                One CSV with many <code className="text-dim">college</code> values. Creates a{' '}
                <strong className="text-dim">new folder</strong> for this run, then a college folder
                for each team (teams must already have templates).
              </p>
              <input
                ref={multiFileRef}
                type="file"
                accept=".csv,text/csv"
                className="mt-3 block w-full text-[11px] text-dim file:mr-2 file:rounded file:border-0 file:bg-inset file:px-2 file:py-1 file:text-[11px] file:text-paper"
              />
              <button
                type="button"
                className="ui-btn ui-btn-primary mt-2 text-[12px]"
                disabled={bulkBusy || multiBusy}
                onClick={onMultiCollegeGenerate}
              >
                {multiBusy ? 'Generating…' : 'Generate multi-college projects'}
              </button>
              {multiLog ? (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-inset p-2 text-[10px] text-dim">
                  {multiLog}
                </pre>
              ) : null}
            </section>
          </>
        ) : null}

        {status ? <p className="text-[12px] text-dim">{status}</p> : null}

        {atRoot ? (
          !byBatch.length ? (
            <p className="text-[13px] text-muted">No projects yet. Generate from a CSV above.</p>
          ) : (
            <section>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Bulk folders
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {byBatch.map((g) => (
                  <div
                    key={g.id}
                    className="rounded-2xl border border-line bg-panel p-4 shadow-sm transition hover:border-blaze/40"
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/batch/${encodeURIComponent(g.id)}`)}
                      className="w-full text-left"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-inset text-[11px] font-semibold text-dim">
                        RUN
                      </div>
                      <div className="mt-3 truncate text-[15px] font-semibold text-paper">
                        {g.label}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        {g.collegeCount} college{g.collegeCount === 1 ? '' : 's'} · {g.posterCount}{' '}
                        poster{g.posterCount === 1 ? '' : 's'}
                      </div>
                    </button>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:border-blaze hover:text-paper disabled:opacity-40"
                        disabled={folderBusyId === g.id}
                        onClick={() => onRenameBatch(g)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-[11px] text-red-400 hover:border-red-400/50 disabled:opacity-40"
                        disabled={folderBusyId === g.id}
                        onClick={() => onDeleteBatch(g)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        ) : null}

        {inBatch ? (
          !collegesInBatch.length ? (
            <p className="text-[13px] text-muted">No colleges in this folder.</p>
          ) : (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                  College folders · {openBatchMeta?.label || openBatchId}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-line px-2 py-1 text-[11px] text-dim hover:border-blaze hover:text-paper"
                    disabled={!openBatchMeta || folderBusyId === openBatchId}
                    onClick={() => openBatchMeta && onRenameBatch(openBatchMeta)}
                  >
                    Rename folder
                  </button>
                  <button
                    type="button"
                    className="rounded border border-line px-2 py-1 text-[11px] text-red-400 hover:border-red-400/50"
                    disabled={!openBatchMeta || folderBusyId === openBatchId}
                    onClick={() => openBatchMeta && onDeleteBatch(openBatchMeta)}
                  >
                    Delete folder
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {collegesInBatch.map((group) => (
                  <button
                    key={group.teamKey}
                    type="button"
                    onClick={() =>
                      navigate(
                        `/projects/batch/${encodeURIComponent(openBatchId)}/team/${encodeURIComponent(group.teamKey)}`,
                      )
                    }
                    className="aspect-square rounded-2xl border border-line bg-panel p-4 text-left shadow-sm transition hover:border-blaze/40"
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-inset text-lg text-dim">
                        ▣
                      </div>
                      <div>
                        <div className="truncate text-[15px] font-semibold text-paper">
                          {group.teamLabel}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">
                          {group.items.length} poster{group.items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        ) : null}

        {inCollege ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-paper">{openCollege?.teamLabel}</h2>
              <span className="text-[11px] text-muted">
                {openCollege?.items.length || 0} posters · {openBatchMeta?.label || openBatchId}
              </span>
            </div>
            {!openCollege?.items?.length ? (
              <p className="text-[13px] text-muted">No posters for this college in this folder.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {openCollege.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}`)}
                    className="rounded-xl border border-line bg-panel p-4 text-left shadow-sm transition hover:border-blaze/40"
                  >
                    <div className="truncate text-[13px] font-semibold text-paper">{p.name}</div>
                    <div className="mt-1 text-[11px] text-muted">
                      {CATEGORY_LABEL[p.category] || p.category}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <p className="pb-6 text-[11px] text-muted">
          <Link className="text-blaze hover:underline" to="/home">
            Back to home
          </Link>
          {' · '}
          Editor, Automate, and Saves are unchanged.
        </p>
      </div>
    </div>
  )
}
