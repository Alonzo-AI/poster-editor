import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deleteAutomateSave, listAutomateSaves } from '../api/automateSavesApi.js'
import { teamOf } from '../lib/templateTeam.js'

const CAT_LABEL = {
  player: 'Player',
  team: 'Team',
  player_no_image: 'No image',
  nostalgia: 'Nostalgia',
}

/**
 * Gallery of posters saved from Automate — separate from CSV Projects.
 */
export default function AutomateSavesPage({ Nav }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [busyId, setBusyId] = useState(null)

  async function refresh() {
    const list = await listAutomateSaves()
    setItems(list || [])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatus('Loading Automate saves…')
        await refresh()
        if (!cancelled) setStatus('')
      } catch (e) {
        if (!cancelled) setStatus(e.message || 'Failed to load Automate saves')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const byCollege = useMemo(() => {
    const map = new Map()
    for (const p of items) {
      const { teamKey, teamLabel } = teamOf(p)
      if (!map.has(teamKey)) map.set(teamKey, { teamKey, teamLabel, items: [] })
      map.get(teamKey).items.push(p)
    }
    return [...map.values()].sort((a, b) => a.teamLabel.localeCompare(b.teamLabel))
  }, [items])

  async function onDelete(row) {
    if (!row?.id) return
    const ok = window.confirm(`Delete Automate save “${row.name || row.id}”?`)
    if (!ok) return
    setBusyId(row.id)
    try {
      await deleteAutomateSave(row.id)
      await refresh()
      setStatus(`Deleted “${row.name || row.id}”`)
    } catch (e) {
      setStatus(e.message || 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div>
          <div className="text-sm font-semibold text-paper">Automate saves</div>
          <div className="text-[11px] text-muted">
            Posters saved from Automate · separate from Projects & templates
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/automate" className="ui-btn text-[12px]">
            Open Automate
          </Link>
          {Nav ? <Nav /> : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6">
        {status ? <p className="mb-4 text-[12px] text-dim">{status}</p> : null}

        {!items.length ? (
          <p className="text-[13px] text-muted">
            No Automate saves yet. In Automate, fill a poster and click <strong>Save</strong> next
            to Export PNG.
          </p>
        ) : (
          <div className="space-y-8">
            {byCollege.map((group) => (
              <section key={group.teamKey}>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
                  {group.teamLabel}{' '}
                  <span className="font-normal text-muted">· {group.items.length}</span>
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {group.items.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => navigate(`/automate-saves/${encodeURIComponent(row.id)}`)}
                      >
                        <div className="truncate text-[13px] font-medium text-paper">
                          {row.name || row.id}
                        </div>
                        <div className="truncate text-[10px] text-muted">
                          {CAT_LABEL[row.category] || row.category || 'Player'}
                          {row.updatedAt
                            ? ` · ${new Date(row.updatedAt).toLocaleString()}`
                            : ''}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-dim hover:border-blaze hover:text-paper disabled:opacity-40"
                        disabled={busyId === row.id}
                        onClick={() => onDelete(row)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
