import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listDbTemplates, fetchDbTemplate, listTeamFolders } from '../api/templatesApi.js'
import { listProjects, saveProject } from '../api/projectsApi.js'
import {
  BULK_CATEGORIES,
  csvRowsToBulkRecords,
  csvRowsToMultiCollegeRecords,
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

function projectBatchDate(p) {
  if (p?.bulkBatchDate) return String(p.bulkBatchDate).slice(0, 10)
  // Legacy projects without stamp → folder by local created day (not UTC)
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

function localToday() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateFolderLabel(date) {
  if (!date || date === 'undated') return 'Undated'
  if (date === localToday()) return `Today · ${date}`
  return date
}

/**
 * Projects gallery only — date folders → college folders → posters.
 * Single-college CSV + multi-college CSV. Does not touch Editor or Automate.
 */
export default function ProjectsPage({ Nav }) {
  const navigate = useNavigate()
  const { batchDate: routeBatch, teamKey: routeTeamKey } = useParams()
  const openBatchDate = routeBatch ? String(routeBatch).trim().slice(0, 32) : null
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

  /** Root: date batch folders */
  const byDate = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const d = projectBatchDate(p)
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(p)
    }
    return [...map.entries()]
      .map(([date, items]) => {
        const colleges = new Set(items.map((p) => teamOf(p).teamKey))
        return { date, items, collegeCount: colleges.size, posterCount: items.length }
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  }, [projects])

  /** Inside a date: college folders */
  const collegesInBatch = useMemo(() => {
    if (!openBatchDate) return []
    const map = new Map()
    for (const p of projects) {
      if (projectBatchDate(p) !== openBatchDate) continue
      const { teamKey, teamLabel } = teamOf(p)
      if (!map.has(teamKey)) map.set(teamKey, { teamKey, teamLabel, items: [] })
      map.get(teamKey).items.push(p)
    }
    return [...map.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [projects, openBatchDate])

  const openCollege = useMemo(() => {
    if (!openTeamKey || !openBatchDate) return null
    return collegesInBatch.find((g) => g.teamKey === openTeamKey) || null
  }, [collegesInBatch, openTeamKey, openBatchDate])

  // If someone hits legacy /projects/team/:teamKey (no date), send them to date root.
  useEffect(() => {
    if (openTeamKey && !openBatchDate) {
      navigate('/projects', { replace: true })
    }
  }, [openTeamKey, openBatchDate, navigate])

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
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(
        `Generating ${records.length} CSV row(s) for “${selectedBulkTeam.teamLabel}” → Projects…`,
      )
      setBulkLog(lines.join('\n'))

      const result = await generateBulkPosters({
        records,
        templates,
        teamKey: selectedBulkTeam.teamKey,
        teamLabel: selectedBulkTeam.teamLabel,
        fetchTemplate: fetchDbTemplate,
        saveProject,
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
      lines.push(`Batch date folder: ${result.bulkBatchDate}`)
      setBulkLog(lines.join('\n'))
      setStatus(
        `Created ${result.created.length} project(s) for ${selectedBulkTeam.teamLabel}`,
      )
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
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(
        `Multi-college bulk · ${groups.length} college(s) · batch ${bulkBatchDate}`,
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
        `Done: ${result.created.length} projects · ${result.colleges.length} college folder(s) · batch ${result.bulkBatchDate}`,
      )
      for (const c of result.colleges) {
        lines.push(`  · ${c.teamLabel}: ${c.created} poster(s)`)
      }
      setMultiLog(lines.join('\n'))
      setStatus(
        `Created ${result.created.length} posters across ${result.colleges.length} colleges (${result.bulkBatchDate})`,
      )
      navigate(`/projects/batch/${encodeURIComponent(result.bulkBatchDate)}`)
    } catch (e) {
      setMultiLog(`Multi bulk failed: ${e.message || e}`)
      setStatus(e.message || 'Multi bulk failed')
    } finally {
      setMultiBusy(false)
    }
  }

  const atRoot = !openBatchDate && !openTeamKey
  const inBatch = !!openBatchDate && !openTeamKey
  const inCollege = !!openBatchDate && !!openTeamKey

  const headerTitle = inCollege
    ? openCollege?.teamLabel || openTeamKey
    : inBatch
      ? formatDateFolderLabel(openBatchDate)
      : 'Projects'

  const headerSub = inCollege
    ? `${openCollege?.items.length || 0} poster(s) · only ${openBatchDate}`
    : inBatch
      ? `${collegesInBatch.length} college(s) generated on ${openBatchDate}`
      : 'Date → college → posters (each day is separate)'

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
              to={`/projects/batch/${encodeURIComponent(openBatchDate)}`}
              className="ui-btn text-[12px]"
            >
              Colleges
            </Link>
          ) : null}
          {inBatch || inCollege ? (
            <Link to="/projects" className="ui-btn text-[12px]">
              All dates
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
                Pick a college, upload its CSV. Creates a <strong className="text-dim">date</strong>{' '}
                folder, then that college folder under it.
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
                One CSV with many <code className="text-dim">college</code> values. Creates today’s{' '}
                <strong className="text-dim">date folder</strong>, then a college folder for each
                team found in the CSV (teams must already have templates).
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
          !byDate.length ? (
            <p className="text-[13px] text-muted">No projects yet. Generate from a CSV above.</p>
          ) : (
            <section>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Date folders
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {byDate.map((g) => (
                  <button
                    key={g.date}
                    type="button"
                    onClick={() => navigate(`/projects/batch/${encodeURIComponent(g.date)}`)}
                    className="aspect-square rounded-2xl border border-line bg-panel p-4 text-left shadow-sm transition hover:border-blaze/40"
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-inset text-[11px] font-semibold text-dim">
                        DATE
                      </div>
                      <div>
                        <div className="truncate text-[15px] font-semibold text-paper">
                          {formatDateFolderLabel(g.date)}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">
                          {g.collegeCount} college{g.collegeCount === 1 ? '' : 's'} · {g.posterCount}{' '}
                          poster{g.posterCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        ) : null}

        {inBatch ? (
          !collegesInBatch.length ? (
            <p className="text-[13px] text-muted">No colleges in this date folder.</p>
          ) : (
            <section>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                College folders · {openBatchDate}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {collegesInBatch.map((group) => (
                  <button
                    key={group.teamKey}
                    type="button"
                    onClick={() =>
                      navigate(
                        `/projects/batch/${encodeURIComponent(openBatchDate)}/team/${encodeURIComponent(group.teamKey)}`,
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
                {openCollege?.items.length || 0} posters · {openBatchDate}
              </span>
            </div>
            {!openCollege?.items?.length ? (
              <p className="text-[13px] text-muted">No posters for this college on this date.</p>
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
          Editor and Automate routes are unchanged.
        </p>
      </div>
    </div>
  )
}
