import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listDbTemplates } from '../api/templatesApi.js'
import { listProjects, saveProject } from '../api/projectsApi.js'
import { csvRowsToBulkRecords, generateUtsaBulkPosters } from '../lib/bulkUtsaGenerate.js'
import { fetchDbTemplate } from '../api/templatesApi.js'
import { teamOf } from '../lib/templateTeam.js'

const CATEGORY_LABEL = {
  player: 'Player',
  team: 'Team',
  player_no_image: 'No image',
  nostalgia: 'Nostalgia',
}

export default function ProjectsPage({ Nav }) {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [status, setStatus] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkLog, setBulkLog] = useState('')
  const bulkFileRef = useRef(null)

  const refresh = useCallback(async () => {
    const list = await listProjects()
    setProjects(list)
    return list
  }, [])

  useEffect(() => {
    refresh()
      .then(() => setStatus(''))
      .catch((e) => setStatus(e.message || 'Failed to load projects'))
  }, [refresh])

  const byCollege = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const { teamKey, teamLabel } = teamOf(p)
      if (!map.has(teamKey)) map.set(teamKey, { teamKey, teamLabel, items: [] })
      map.get(teamKey).items.push(p)
    }
    return [...map.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [projects])

  async function onBulkUtsaGenerate() {
    if (bulkBusy) return
    const file = bulkFileRef.current?.files?.[0]
    if (!file) {
      setBulkLog('Choose a CSV file first (UTSA text fields only).')
      return
    }
    setBulkBusy(true)
    setBulkLog('Reading CSV…')
    try {
      const text = await file.text()
      const { records, errors } = csvRowsToBulkRecords(text)
      if (!records.length) {
        setBulkLog(`No UTSA rows to generate.${errors.length ? `\n${errors.join('\n')}` : ''}`)
        return
      }
      const templates = await listDbTemplates({ lite: true })
      const lines = []
      if (errors.length) lines.push(...errors)
      lines.push(`Generating ${records.length} CSV row(s) into Projects (not templates)…`)
      setBulkLog(lines.join('\n'))

      const result = await generateUtsaBulkPosters({
        records,
        templates,
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
      lines.push(`Bases: ${result.baseCategories.join(', ') || '(none)'}`)
      setBulkLog(lines.join('\n'))
      setStatus(`Created ${result.created.length} UTSA projects`)
    } catch (e) {
      setBulkLog(`Bulk failed: ${e.message || e}`)
      setStatus(e.message || 'Bulk failed')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
        <div>
          <div className="text-sm font-medium text-paper">Projects</div>
          <div className="text-[11px] text-muted">
            Bulk posters by college · separate from Editor templates
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Nav ? <Nav /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        <section className="rounded-xl border border-dashed border-blaze/30 bg-panel p-4 shadow-sm">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
            Bulk generate (UTSA test)
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            Creates <strong className="font-medium text-dim">projects</strong> only — they will not
            appear in Editor Formats or Automate template lists. Uses UTSA / UTSA_2 / UTSA_3 bases.
          </p>
          <input
            ref={bulkFileRef}
            type="file"
            accept=".csv,text/csv"
            className="mt-3 block w-full text-[11px] text-dim file:mr-2 file:rounded file:border-0 file:bg-inset file:px-2 file:py-1 file:text-[11px] file:text-paper"
          />
          <button
            type="button"
            className="ui-btn ui-btn-primary mt-2 text-[12px]"
            disabled={bulkBusy}
            onClick={onBulkUtsaGenerate}
          >
            {bulkBusy ? 'Generating…' : 'Generate UTSA bulk projects'}
          </button>
          {bulkLog ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-inset p-2 text-[10px] text-dim">
              {bulkLog}
            </pre>
          ) : null}
        </section>

        {status ? <p className="text-[12px] text-dim">{status}</p> : null}

        {!byCollege.length ? (
          <p className="text-[13px] text-muted">No projects yet. Generate from a CSV above.</p>
        ) : (
          byCollege.map((group) => (
            <section key={group.teamKey}>
              <h2 className="mb-3 text-sm font-semibold text-paper">{group.teamLabel}</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((p) => (
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
          ))
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
