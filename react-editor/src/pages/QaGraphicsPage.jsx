import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createQaFolder,
  deleteQaFolder,
  listQaFolders,
  qaGraphicsStatus,
} from '../api/qaGraphicsApi.js'

/**
 * QA Graphics folder list — each folder is a separate spreadsheet (like Projects batches).
 * Does not affect Editor / Automate / Projects.
 */
export default function QaGraphicsPage({ Nav }) {
  const navigate = useNavigate()
  const [folders, setFolders] = useState([])
  const [db, setDb] = useState({ configured: false, connected: false, error: null })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const st = await qaGraphicsStatus()
    setDb(st)
    if (!st.connected) {
      setFolders([])
      setStatus(
        st.configured
          ? `Postgres not connected: ${st.error || 'check DB_* / server'}`
          : 'Postgres not configured — set DB_HOST / DB_NAME / DB_USER / DB_PASSWORD, then restart the API.',
      )
      return
    }
    const data = await listQaFolders()
    setFolders(data.folders || [])
    setDb(data.db || st)
    setStatus(
      data.folders?.length
        ? `${data.folders.length} folder(s)`
        : 'No folders yet — create one to start a sheet',
    )
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setBusy(true)
        await refresh()
      } catch (e) {
        if (!cancelled) setStatus(e.message || 'Failed to load folders')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onNewFolder() {
    const name = window.prompt('Name for this QA folder', '')
    if (name == null || !String(name).trim()) return
    setBusy(true)
    try {
      const st = await qaGraphicsStatus()
      setDb(st)
      if (!st.connected) {
        setStatus(
          st.configured
            ? `Cannot create folder — Postgres not connected (${st.error || 'unknown'})`
            : 'Cannot create folder — set DB_* on the API server, then restart',
        )
        return
      }
      const sheet = await createQaFolder(String(name).trim())
      navigate(`/qa-graphics/${encodeURIComponent(sheet.id)}`)
    } catch (e) {
      setStatus(e.message || 'Create folder failed')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(folder) {
    if (!folder?.id) return
    const ok = window.confirm(`Delete folder “${folder.name || folder.id}” and all its rows?`)
    if (!ok) return
    setBusy(true)
    try {
      await deleteQaFolder(folder.id)
      await refresh()
      setStatus(`Deleted “${folder.name || folder.id}”`)
    } catch (e) {
      setStatus(e.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-paper">QA Graphics Testing</div>
          <div className="truncate text-[11px] text-muted">
            Folders · each sheet saves separately
            {db.connected ? ' · Postgres connected' : ' · Postgres offline'}
          </div>
        </div>
        {Nav ? <Nav /> : null}
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/home" className="text-xs font-semibold text-dim hover:text-paper">
            ← Home
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={onNewFolder}
            className="rounded-full bg-blaze px-3.5 py-1.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50"
          >
            + New
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await refresh()
              } catch (e) {
                setStatus(e.message || 'Reload failed')
              } finally {
                setBusy(false)
              }
            }}
            className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-dim hover:text-paper"
          >
            Reload
          </button>
        </div>

        {status ? <p className="text-[12px] text-muted">{status}</p> : null}

        {!folders.length ? (
          <p className="text-[13px] text-muted">
            No QA folders yet. Click <b className="text-paper">New folder</b>, enter a name, then edit
            that sheet like a CSV.
          </p>
        ) : (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <div
                key={f.id}
                className="rounded-2xl border border-line bg-panel p-4 shadow-sm transition hover:border-blaze/40"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => navigate(`/qa-graphics/${encodeURIComponent(f.id)}`)}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
                    Folder
                  </div>
                  <div className="mt-1 text-lg font-semibold text-paper">{f.name || f.id}</div>
                  <p className="mt-2 text-[12px] text-muted">
                    {f.rowCount || 0} row{(f.rowCount || 0) === 1 ? '' : 's'}
                    {f.updatedAt
                      ? ` · updated ${new Date(f.updatedAt).toLocaleString()}`
                      : ''}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(f)}
                  className="mt-3 rounded border border-line px-2 py-1 text-[11px] text-dim hover:border-blaze hover:text-paper disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
