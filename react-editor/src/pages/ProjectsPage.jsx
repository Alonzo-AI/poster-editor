import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listDbTemplates, fetchDbTemplate, listTeamFolders } from '../api/templatesApi.js'
import { listProjects, saveProject } from '../api/projectsApi.js'
import {
  BULK_CATEGORIES,
  csvRowsToBulkRecords,
  generateBulkPosters,
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

/**
 * Projects gallery only — college folders → posters + any-team CSV bulk.
 * Does not touch Editor or Automate.
 */
export default function ProjectsPage({ Nav }) {
  const navigate = useNavigate()
  const { teamKey: routeTeamKey } = useParams()
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
  const bulkFileRef = useRef(null)

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
    return remote || []
  }, [])

  useEffect(() => {
    refresh()
      .then(() => setStatus(''))
      .catch((e) => setStatus(e.message || 'Failed to load projects'))
    loadTeamSources().catch(() => {})
  }, [refresh, loadTeamSources])

  /** Colleges that actually have Editor templates (usable as bulk bases). */
  const bulkTeamOptions = useMemo(() => {
    const fromTpl = collectTeamOptions(templateCatalog).filter(
      (t) => t.teamKey !== UNASSIGNED_TEAM_KEY,
    )
    const map = new Map(fromTpl.map((t) => [t.teamKey, t.teamLabel]))
    for (const t of extraTeams) {
      if (t.teamKey === UNASSIGNED_TEAM_KEY) continue
      // Only list folder if it already has templates, or keep if already in map
      if (!map.has(t.teamKey)) {
        const hasTpl = templateCatalog.some(
          (x) => teamOf(x).teamKey === t.teamKey,
        )
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

  const byCollege = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const { teamKey, teamLabel } = teamOf(p)
      if (!map.has(teamKey)) map.set(teamKey, { teamKey, teamLabel, items: [] })
      map.get(teamKey).items.push(p)
    }
    return [...map.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [projects])

  const openGroup = useMemo(() => {
    if (!openTeamKey) return null
    return byCollege.find((g) => g.teamKey === openTeamKey) || null
  }, [byCollege, openTeamKey])

  async function onBulkGenerate() {
    if (bulkBusy) return
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
        templates = (await loadTeamSources()) || templateCatalog
      } catch (_) {}
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(
        `Generating ${records.length} CSV row(s) for “${selectedBulkTeam.teamLabel}” → Projects…`,
      )
      if (availableCategories.length) {
        lines.push(`Base categories: ${availableCategories.join(', ')}`)
      } else {
        lines.push('Warning: no base templates found for this college.')
      }
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
      lines.push(`Bases used: ${result.baseCategories.join(', ') || '(none)'}`)
      setBulkLog(lines.join('\n'))
      setStatus(
        `Created ${result.created.length} project(s) for ${selectedBulkTeam.teamLabel}`,
      )
      navigate(`/projects/team/${encodeURIComponent(selectedBulkTeam.teamKey)}`)
    } catch (e) {
      setBulkLog(`Bulk failed: ${e.message || e}`)
      setStatus(e.message || 'Bulk failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const insideFolder = !!openTeamKey

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-paper">
            {insideFolder ? openGroup?.teamLabel || openTeamKey : 'Projects'}
          </div>
          <div className="truncate text-[11px] text-muted">
            {insideFolder
              ? `${openGroup?.items.length || 0} poster(s) · CSV bulk for this college`
              : 'College folders · separate from Editor templates'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {insideFolder ? (
            <Link to="/projects" className="ui-btn text-[12px]">
              All folders
            </Link>
          ) : null}
          {Nav ? <Nav /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        {!insideFolder ? (
          <section className="rounded-xl border border-dashed border-blaze/30 bg-panel p-4 shadow-sm">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
              Bulk generate (CSV)
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              Pick a college that already has templates in the DB. CSV text fields clone those
              templates into <strong className="font-medium text-dim">projects</strong> only — never
              Editor / Automate lists.
            </p>

            <label className="mt-3 block text-[11px] text-dim">
              College / team
              <select
                className="ui-input mt-1 w-full text-[12px]"
                value={bulkTeamKey}
                onChange={(e) => setBulkTeamKey(normalizeTeamKey(e.target.value))}
                disabled={bulkBusy || !bulkTeamOptions.length}
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
                Bases for <strong className="text-dim">{selectedBulkTeam.teamLabel}</strong>:{' '}
                {availableCategories.length
                  ? availableCategories.map((c) => CATEGORY_LABEL[c] || c).join(', ')
                  : 'none found — add templates in Editor first'}
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
              disabled={bulkBusy || !selectedBulkTeam || !availableCategories.length}
              onClick={onBulkGenerate}
            >
              {bulkBusy
                ? 'Generating…'
                : `Generate projects${selectedBulkTeam ? ` · ${selectedBulkTeam.teamLabel}` : ''}`}
            </button>
            {bulkLog ? (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-inset p-2 text-[10px] text-dim">
                {bulkLog}
              </pre>
            ) : null}
          </section>
        ) : null}

        {status ? <p className="text-[12px] text-dim">{status}</p> : null}

        {!insideFolder ? (
          !byCollege.length ? (
            <p className="text-[13px] text-muted">No projects yet. Generate from a CSV above.</p>
          ) : (
            <section>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                College folders
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {byCollege.map((group) => (
                  <button
                    key={group.teamKey}
                    type="button"
                    onClick={() => navigate(`/projects/team/${encodeURIComponent(group.teamKey)}`)}
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
        ) : !openGroup ? (
          <div>
            <p className="text-[13px] text-muted">No posters in this folder yet.</p>
            <Link to="/projects" className="mt-3 inline-block text-[12px] text-blaze hover:underline">
              Back to folders
            </Link>
          </div>
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-paper">{openGroup.teamLabel}</h2>
              <span className="text-[11px] text-muted">{openGroup.items.length} posters</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {openGroup.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}`)}
                  className="rounded-xl border border-line bg-panel p-4 text-left shadow-sm transition hover:border-blaze/40"
                >
                  <div className="truncate text-[13px] font-semibold text-paper">{p.name}</div>
                  <div className="mt-1 text-[11px] text-muted">
                    {CATEGORY_LABEL[p.category] || p.category} · {p.id}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

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
