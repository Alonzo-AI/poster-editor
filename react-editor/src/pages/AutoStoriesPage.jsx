import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  autoStoriesStatus,
  loadAutoStorySamples,
  runAutoStories,
} from '../api/autoStoriesApi.js'

/**
 * Split pasted plain text into story objects.
 * 1. story…  2. story…  | blank-line blocks | long lines
 */
function parsePlainStories(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const numbered = text.split(/\n(?=\s*\d+[.)]\s+)/)
  if (numbered.length > 1) {
    const out = []
    for (let i = 0; i < numbered.length; i++) {
      const chunk = numbered[i].trim().replace(/^\s*\d+[.)]\s*/, '').trim()
      if (chunk) out.push({ id: `p${i + 1}`, text: chunk })
    }
    if (out.length) return out
  }

  const paras = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
  if (paras.length > 1) {
    return paras.map((t, i) => ({ id: `p${i + 1}`, text: t }))
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length > 1 && lines.every((l) => l.length > 40)) {
    return lines.map((t, i) => ({ id: `p${i + 1}`, text: t }))
  }

  return [{ id: 'p1', text }]
}

function parseStoriesFromInput(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw)
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.stories)) return data.stories
      if (data && typeof data === 'object' && (data.text || data.story || data.content)) {
        return [data]
      }
    } catch (_) {
      /* fall through */
    }
  }
  return parsePlainStories(raw)
}

function storiesToPlainDisplay(stories) {
  return (stories || [])
    .map((s, i) => {
      const t = String(s.text || s.story || s.content || s.body || '').trim()
      return t ? `${i + 1}. ${t}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Auto select stories → LLM extract → new QA Graphics folder.
 * Isolated from Editor / Automate / Projects.
 */
export default function AutoStoriesPage({ Nav }) {
  const navigate = useNavigate()
  const [statusInfo, setStatusInfo] = useState(null)
  const [storiesText, setStoriesText] = useState('')
  const [storyCount, setStoryCount] = useState(0)
  const [status, setStatus] = useState('')
  const [log, setLog] = useState('')
  const [busy, setBusy] = useState(false)

  async function refreshStatus() {
    const st = await autoStoriesStatus()
    setStatusInfo(st)
    return st
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refreshStatus()
      } catch (e) {
        if (!cancelled) setStatus(e.message || 'Could not load status')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function updateText(next) {
    setStoriesText(next)
    try {
      const s = parseStoriesFromInput(next)
      setStoryCount(s.filter((x) => x && String(x.text || x.story || '').trim()).length)
    } catch (_) {
      setStoryCount(0)
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const stories = parseStoriesFromInput(text)
        const display = storiesToPlainDisplay(stories) || text
        updateText(display)
        setStatus(`Loaded ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} from file`)
      } catch (err) {
        setStatus(err.message || 'Could not read file')
      }
    }
    reader.readAsText(file)
  }

  async function onLoadSamples() {
    setBusy(true)
    try {
      const data = await loadAutoStorySamples()
      const stories = data.stories || []
      updateText(storiesToPlainDisplay(stories))
      setStatus(`Loaded ${stories.length} sample stor${stories.length === 1 ? 'y' : 'ies'}`)
    } catch (e) {
      setStatus(e.message || 'Failed to load samples')
    } finally {
      setBusy(false)
    }
  }

  async function onRun() {
    setBusy(true)
    setLog('')
    try {
      const st = await refreshStatus()
      if (!st?.postgres?.connected) {
        setStatus('Postgres not connected — set DB_* on the API server, then restart')
        return
      }
      if (!st?.llm?.configured) {
        setStatus('OPENROUTER_API_KEY not set on the API server (.env), then restart')
        return
      }

      const stories = parseStoriesFromInput(storiesText).filter(
        (s) => s && String(s.text || s.story || s.content || s.body || '').trim(),
      )
      if (!stories.length) {
        setStatus('Paste stories (1. … 2. …) or load samples first')
        return
      }

      const defaultName = `Auto stories ${new Date().toISOString().slice(0, 10)}`
      const name = window.prompt('Name for the new QA folder', defaultName)
      if (name == null || !String(name).trim()) {
        setStatus('Cancelled — folder name required')
        return
      }

      setStatus(`Extracting ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} with LLM…`)
      setLog(`Running LLM on ${stories.length} stories → QA folder “${String(name).trim()}”…\n`)

      const result = await runAutoStories({
        folderName: String(name).trim(),
        stories,
        rawText: storiesText,
      })

      const lines = [
        `Folder: ${result.folderName} (${result.folderId})`,
        `Rows saved: ${result.rowCount}`,
        `Extracted OK: ${result.extracted}`,
        `Failed: ${result.failed || 0}`,
      ]
      if (result.errors?.length) {
        for (const er of result.errors) {
          lines.push(`  · story ${er.index}${er.id ? ` (${er.id})` : ''}: ${er.error}`)
        }
      }
      setLog(lines.join('\n'))
      setStatus(`Done — opened QA folder “${result.folderName}”`)
      navigate(`/qa-graphics/${encodeURIComponent(result.folderId)}`)
    } catch (e) {
      setStatus(e.message || 'Auto Stories run failed')
      setLog(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const llmOk = statusInfo?.llm?.configured
  const pgOk = statusInfo?.postgres?.connected

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-paper">Auto select stories</div>
          <div className="truncate text-[11px] text-muted">
            Paste stories → LLM extract → QA Graphics folder
          </div>
        </div>
        {Nav ? <Nav /> : null}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/home" className="text-xs font-semibold text-dim hover:text-paper">
            ← Home
          </Link>
          <Link to="/qa-graphics" className="text-xs font-semibold text-dim hover:text-paper">
            QA folders
          </Link>
        </div>

        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
            Status
          </h2>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">
            <li>
              LLM:{' '}
              <span className={llmOk ? 'text-paper' : 'text-dim'}>
                {llmOk
                  ? `ready (${statusInfo?.llm?.model || 'model'})`
                  : 'set OPENROUTER_API_KEY on API server'}
              </span>
            </li>
            <li>
              Postgres:{' '}
              <span className={pgOk ? 'text-paper' : 'text-dim'}>
                {pgOk ? 'connected (QA saves)' : 'set DB_* and restart API'}
              </span>
            </li>
            <li>
              Stories detected:{' '}
              <span className="text-paper">
                {storyCount} {storyCount === 1 ? 'story' : 'stories'}
              </span>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
            Combined stories
          </h2>
          <p className="mt-2 text-[13px] text-muted">
            Paste numbered stories (no JSON needed), e.g.{' '}
            <code className="text-dim">1. Senior QB…</code> then{' '}
            <code className="text-dim">2. Appalachian State posted…</code>. Blank lines between
            stories also work. Then run extract to create a QA folder.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-paper hover:border-blaze/40">
              Upload .txt / .json
              <input
                type="file"
                accept=".txt,.json,text/plain,application/json"
                className="hidden"
                onChange={onFile}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={onLoadSamples}
              className="rounded-full border border-line bg-inset px-3 py-1.5 text-xs font-semibold text-paper hover:border-blaze/40 disabled:opacity-50"
            >
              Load samples
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRun}
              className="rounded-full bg-blaze px-3.5 py-1.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Running…' : 'Run LLM → QA folder'}
            </button>
          </div>
          <textarea
            value={storiesText}
            onChange={(e) => updateText(e.target.value)}
            rows={14}
            placeholder={`1. Senior QB Malachi Singleton posted three passing touchdowns…\n\n2. Appalachian State posted 29 pass completions…`}
            className="mt-3 w-full rounded-xl border border-line bg-inset px-3 py-2 text-[13px] leading-relaxed text-paper outline-none focus:border-blaze/40"
          />
        </section>

        {status ? <p className="text-[12px] text-muted">{status}</p> : null}
        {log ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-inset p-3 text-[11px] text-dim">
            {log}
          </pre>
        ) : null}
      </main>
    </div>
  )
}
