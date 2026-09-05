import { useEffect, useMemo, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import {
  apiHealth,
  fetchDbTemplates,
  saveTemplateToDb,
  syncDbTemplatesIntoEngine,
} from '../api/templatesApi.js'

function Panel({ title, children, className = '' }) {
  return (
    <section className={`border-b border-line ${className}`}>
      {title ? (
        <h2 className="font-display px-3 py-2 text-xs font-bold uppercase tracking-widest text-dim">
          {title}
        </h2>
      ) : null}
      <div className="px-3 pb-3">{children}</div>
    </section>
  )
}

function Field({ label, children }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] text-dim">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded border border-line bg-inset px-2 py-1.5 text-sm text-paper outline-none focus:border-blaze'

export default function EditorPage({ Nav }) {
  const { iframeRef, src, api, snapshot, ready, error, onLoad } = usePosterEngine({
    headless: false,
  })
  const [templates, setTemplates] = useState([])
  const [stories, setStories] = useState([])
  const [assets, setAssets] = useState([])
  const [imageSlots, setImageSlots] = useState([])
  const [assetFilter, setAssetFilter] = useState('all')
  const [status, setStatus] = useState('')
  const [bakeId, setBakeId] = useState('')
  const [bakeName, setBakeName] = useState('')

  const [apiOnline, setApiOnline] = useState(null)

  useEffect(() => {
    apiHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false))
  }, [])

  useEffect(() => {
    if (!api?.listTemplates) return
    try {
      setTemplates(api.listTemplates() || [])
    } catch (e) {
      console.warn(e)
    }
  }, [api, snapshot?.template])

  // Pull DB templates into the engine so Editor chips stay in sync
  useEffect(() => {
    if (!api?.injectRemoteTemplates || !ready) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await syncDbTemplatesIntoEngine(api)
        if (cancelled) return
        setTemplates(api.listTemplates?.() || [])
        setApiOnline(true)
        if (r?.count) setStatus(`Loaded ${r.count} saved template(s) from DB`)
      } catch {
        setApiOnline(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, ready])

  useEffect(() => {
    if (!api) return
    try {
      if (api.listStories) setStories(api.listStories() || [])
      if (api.listAssetLibrary) setAssets(api.listAssetLibrary() || [])
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
    } catch (e) {
      console.warn(e)
    }
  }, [api, snapshot?.storyIndex, snapshot?.storyCount, snapshot?.template, ready])

  useEffect(() => {
    if (!snapshot) return
    setBakeId((v) => v || snapshot.template || '')
    setBakeName((v) => v || snapshot.templateName || '')
  }, [snapshot?.template, snapshot?.templateName])

  const selected = snapshot?.selected
  const layers = snapshot?.layers || []

  const shapePresets = useMemo(() => {
    if (api?.listShapePresets) return api.listShapePresets()
    return (snapshot?.shapePresets || []).map((id) => ({ id, label: id }))
  }, [api, snapshot?.shapePresets])

  const filteredAssets = useMemo(() => {
    const list =
      assetFilter === 'all'
        ? assets
        : assetFilter === 'shape'
          ? assets.filter((a) => a.isShape)
          : assets.filter((a) => a.slot === assetFilter)
    return list.map((a) => ({
      ...a,
      thumb:
        a.src && !/^https?:|data:|\//.test(a.src) ? `/portal/${a.src.replace(/^\.\//, '')}` : a.src,
    }))
  }, [assets, assetFilter])

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
  }

  async function onExport() {
    if (!api?.exportPng) return
    setStatus('Rendering…')
    try {
      const dataUrl = await api.exportPng()
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `poster_${snapshot?.template || 'export'}.png`
      a.click()
      setStatus('PNG downloaded')
    } catch (e) {
      setStatus(e.message || 'Export failed')
    }
  }

  async function onBake(download) {
    if (!api?.bakeTemplate) return
    setStatus(download ? 'Downloading…' : 'Saving…')
    try {
      const result = await api.bakeTemplate({ id: bakeId, name: bakeName, download })
      const json = result?.json
      if (json && !download) {
        try {
          const saved = await saveTemplateToDb(json)
          setApiOnline(true)
          setStatus(`Saved to DB · “${saved.name || saved.id}” — Automate will pick it up`)
          // Refresh local chip list
          try {
            const list = await fetchDbTemplates()
            api.injectRemoteTemplates?.(list)
          } catch (_) {}
          if (api.listTemplates) setTemplates(api.listTemplates() || [])
          return
        } catch (dbErr) {
          setApiOnline(false)
          setStatus(
            `Saved in browser only · DB failed: ${dbErr.message}. Start server/Mongo or use Download.`,
          )
          return
        }
      }
      setStatus(download ? 'Template downloaded' : 'Saved to session')
      if (api.listTemplates) setTemplates(api.listTemplates() || [])
    } catch (e) {
      setStatus(e.message || 'Save failed')
    }
  }

  async function onApplyAsset(id) {
    if (!api?.applyLibraryAsset) return
    setStatus('Loading asset…')
    try {
      await api.applyLibraryAsset(id)
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      setStatus('Asset applied')
    } catch (e) {
      setStatus(e.message || 'Asset failed')
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left — layers & tools */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="border-b border-line p-3">
          <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-blaze">
            Narrative Styles
          </div>
          <h1 className="font-display text-2xl font-extrabold uppercase leading-none tracking-wide">
            Poster Lab
          </h1>
          <p className="mt-1 text-xs text-dim">Design · freeze · export 4:5</p>
          <p
            className={`mt-1 text-[10px] ${
              apiOnline === true
                ? 'text-emerald-400'
                : apiOnline === false
                  ? 'text-amber-400'
                  : 'text-dim'
            }`}
          >
            {apiOnline === true
              ? 'DB connected · Save writes to Mongo'
              : apiOnline === false
                ? 'DB offline · Save stays in browser (start server/)'
                : 'Checking DB…'}
          </p>
          <div className="mt-3">
            <Nav />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Panel title="Template">
            <div className="grid grid-cols-2 gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => api?.switchTemplate?.(t.id)}
                  className={`rounded border px-2 py-2 font-display text-xs font-semibold ${
                    snapshot?.template === t.id
                      ? 'border-blaze bg-blaze/15 text-white'
                      : 'border-line bg-inset text-dim hover:text-paper'
                  }`}
                >
                  {t.name}
                  {t.frozen ? ' ✓' : ''}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Stories">
            {stories.length ? (
              <>
                <select
                  className={inputClass}
                  value={snapshot?.storyIndex ?? 0}
                  onChange={(e) => api?.setStoryIndex?.(+e.target.value)}
                >
                  {stories.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    className="flex-1 rounded border border-line bg-inset py-1.5 font-display text-xs font-semibold uppercase text-dim hover:text-paper"
                    onClick={() => api?.gotoStory?.(-1)}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded border border-line bg-inset py-1.5 font-display text-xs font-semibold uppercase text-dim hover:text-paper"
                    onClick={() => api?.gotoStory?.(1)}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-dim">No stories loaded yet.</p>
            )}
          </Panel>

          <Panel title="Images">
            {imageSlots.map((slot) => (
              <div key={slot.key} className="mb-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{slot.label}</div>
                  <div className="text-[10px] text-dim">{slot.loaded ? 'loaded' : 'none'}</div>
                  <label className="cursor-pointer text-[11px] text-blaze underline">
                    {slot.loaded ? 'replace' : 'upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file || !api?.setImageSlot) return
                        const url = await readFileAsDataURL(file)
                        await api.setImageSlot(slot.key, url)
                        setImageSlots(api.listImageSlots?.() || [])
                      }}
                    />
                  </label>
                  {slot.loaded ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="text-[11px] text-red-400 underline"
                        onClick={() => {
                          api?.clearImageSlot?.(slot.key)
                          setImageSlots(api?.listImageSlots?.() || [])
                        }}
                      >
                        remove
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Asset library">
            <div className="mb-2 flex flex-wrap gap-1">
              {['all', 'player', 'logo', 'background', 'shape'].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAssetFilter(f)}
                  className={`rounded px-2 py-1 font-display text-[10px] font-semibold uppercase ${
                    assetFilter === f ? 'bg-blaze/20 text-white' : 'bg-inset text-dim'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto">
              {filteredAssets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.name}
                  onClick={() => onApplyAsset(a.id)}
                  className="overflow-hidden rounded border border-line bg-inset text-left hover:border-blaze"
                >
                  <div
                    className="h-14 bg-contain bg-center bg-no-repeat"
                    style={{ backgroundImage: a.thumb ? `url(${a.thumb})` : undefined }}
                  />
                  <div className="truncate px-1.5 py-1 text-[10px] text-dim">{a.name}</div>
                </button>
              ))}
              {!filteredAssets.length && (
                <p className="col-span-2 text-xs text-dim">No assets in this filter.</p>
              )}
            </div>
          </Panel>

          <Panel title="Layers">
            <ul className="space-y-0.5">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <button
                    type="button"
                    onClick={() => api?.selectLayer?.(layer.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      snapshot?.selectedId === layer.id
                        ? 'bg-blaze/20 text-white'
                        : 'text-dim hover:bg-inset hover:text-paper'
                    }`}
                  >
                    <span className="w-14 shrink-0 font-display text-[10px] uppercase tracking-wide opacity-70">
                      {layer.type}
                    </span>
                    <span className="truncate">{layer.label}</span>
                  </button>
                </li>
              ))}
              {!layers.length && (
                <li className="text-xs text-dim">{ready ? 'No layers' : 'Loading engine…'}</li>
              )}
            </ul>
          </Panel>

          <Panel title="Shapes">
            <div className="grid grid-cols-3 gap-1.5">
              {shapePresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => api?.addShape?.(p.id)}
                  className="rounded border border-line bg-inset px-1 py-2 font-display text-[11px] font-semibold uppercase text-dim hover:border-blaze hover:text-paper"
                >
                  {p.label || p.id}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Brand colors">
            <div className="flex gap-2">
              <Field label="Primary">
                <input
                  type="color"
                  className="h-9 w-full cursor-pointer rounded border border-line bg-inset"
                  value={snapshot?.colors?.primary || '#006F73'}
                  onChange={(e) => api?.setBrandColors?.({ primary: e.target.value })}
                />
              </Field>
              <Field label="Secondary">
                <input
                  type="color"
                  className="h-9 w-full cursor-pointer rounded border border-line bg-inset"
                  value={snapshot?.colors?.secondary || '#C5B358'}
                  onChange={(e) => api?.setBrandColors?.({ secondary: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Text fields">
            {Object.entries(snapshot?.text || {})
              .slice(0, 12)
              .map(([key, val]) => (
                <Field key={key} label={key}>
                  <input
                    className={inputClass}
                    value={val ?? ''}
                    onChange={(e) => api?.setTextValue?.(key, e.target.value)}
                  />
                </Field>
              ))}
          </Panel>
        </div>
      </aside>

      {/* Center — canvas */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-ink">
        <div className="absolute left-3 top-3 z-10 flex gap-1">
          <button
            type="button"
            className="rounded border border-line bg-panel/90 px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-paper backdrop-blur"
            onClick={() => api?.zoomFit?.()}
          >
            Fit
          </button>
          <button
            type="button"
            className="rounded border border-line bg-panel/90 px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-paper backdrop-blur"
            onClick={() => api?.zoomIn?.()}
          >
            +
          </button>
          <button
            type="button"
            className="rounded border border-line bg-panel/90 px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-paper backdrop-blur"
            onClick={() => api?.zoomOut?.()}
          >
            −
          </button>
          <button
            type="button"
            className="rounded border border-line bg-panel/90 px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-paper backdrop-blur"
            onClick={() => api?.toggleFrameGuide?.()}
          >
            Frame
          </button>
          <button
            type="button"
            className="rounded border border-line bg-panel/90 px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-paper backdrop-blur"
            onClick={() => api?.deselect?.()}
          >
            Deselect
          </button>
        </div>
        {!ready && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/80 font-display text-sm uppercase tracking-widest text-dim">
            {error || 'Starting engine…'}
          </div>
        )}
        <StageHost iframeRef={iframeRef} src={src} onLoad={onLoad} />
      </main>

      {/* Right — properties */}
      <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-panel">
        <div className="border-b border-line p-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-widest text-paper">
            Properties
          </h2>
          <p className="mt-0.5 truncate text-xs text-dim">
            {selected ? `${selected.type} · ${selected.id}` : 'Select a layer'}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <PropertiesPanel api={api} selected={selected} snapshot={snapshot} />
        </div>

        <div className="space-y-2 border-t border-line p-3">
          <Field label="Save as id">
            <input className={inputClass} value={bakeId} onChange={(e) => setBakeId(e.target.value)} />
          </Field>
          <Field label="Display name">
            <input
              className={inputClass}
              value={bakeName}
              onChange={(e) => setBakeName(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-blaze py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white hover:bg-blaze2"
              onClick={() => onBake(false)}
            >
              Save
            </button>
            <button
              type="button"
              className="flex-1 rounded border border-line bg-panel2 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-paper hover:bg-inset"
              onClick={() => onBake(true)}
            >
              Download
            </button>
          </div>
          <button
            type="button"
            className="w-full rounded bg-blaze py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white hover:bg-blaze2"
            onClick={onExport}
          >
            Export PNG
          </button>
          {status ? <p className="font-display text-xs tracking-wide text-blaze">{status}</p> : null}
          <p className="text-[10px] leading-snug text-dim">
            Vanilla fallback: open <code className="text-paper/80">../index.html</code>. Engine paint
            stays in the iframe.
          </p>
        </div>
      </aside>
    </div>
  )
}
