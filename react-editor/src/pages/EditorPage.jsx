import { useEffect, useMemo, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import {
  apiHealth,
  saveTemplateToDb,
  syncDbTemplatesIntoEngine,
} from '../api/templatesApi.js'

function Panel({ title, children, className = '', action = null }) {
  return (
    <section className={`border-b border-line ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
          <h2 className="text-[11px] font-semibold text-dim">{title}</h2>
          {action}
        </div>
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

const inputClass = 'ui-input'

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
    // Keep Save id locked to the active template so Mongo overwrites the same doc
    setBakeId(snapshot.template || '')
    setBakeName(snapshot.templateName || snapshot.template || '')
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
    // Always overwrite the *current* template id in Mongo (not a new document)
    const id = (snapshot?.template || bakeId || '').trim()
    if (!id) {
      setStatus('No template selected')
      return
    }
    // Keep this template's own display name — never reuse another chip's name
    // (stale "Magazine" in the name field made mag_updated look like it vanished).
    const listed = (api.listTemplates?.() || []).find((t) => t.id === id)
    const name = listed?.name || snapshot?.templateName || id
    setBakeId(id)
    setBakeName(name)
    setStatus(download ? 'Downloading…' : `Saving “${id}”…`)
    try {
      const result = await api.bakeTemplate({ id, name, download })
      const json = result?.json
      if (json) {
        json.id = id
        json.name = name
      }
      if (json && !download) {
        try {
          const saved = await saveTemplateToDb(json, { id })
          setApiOnline(true)
          setStatus(
            saved.updated
              ? `Updated “${name}” (id: ${saved.id}) · JSON overwritten`
              : `Created “${name}” (id: ${saved.id}) · later Saves overwrite this id`,
          )
          try {
            api.injectRemoteTemplates?.(
              [
                {
                  id: saved.id,
                  name,
                  frozen: true,
                  json: { ...json, id: saved.id, name },
                },
              ],
              { sync: false },
            )
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
    <div className="flex h-full min-h-0 flex-col bg-ink">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-paper">
            {bakeName || snapshot?.templateName || 'Untitled'}
          </span>
          <span className="hidden text-[11px] text-muted sm:inline">1080 × 1350</span>
        </div>
        <div className="mx-auto flex items-center gap-1">
          <button type="button" className="ui-icon-btn" title="Fit" onClick={() => api?.zoomFit?.()}>
            Fit
          </button>
          <button type="button" className="ui-icon-btn" title="Zoom in" onClick={() => api?.zoomIn?.()}>
            +
          </button>
          <button type="button" className="ui-icon-btn" title="Zoom out" onClick={() => api?.zoomOut?.()}>
            −
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            title="Add text"
            disabled={!ready}
            onClick={() => {
              const label = window.prompt('Text field label', 'New text')
              if (label == null || !String(label).trim()) return
              try {
                const res = api?.addTextField?.({ label: String(label).trim() })
                setStatus(res?.field?.bind ? `Added “${res.field.label}”` : 'Add text failed')
              } catch (e) {
                setStatus(e.message || 'Add text failed')
              }
            }}
          >
            T
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            title="Frame guide"
            onClick={() => api?.toggleFrameGuide?.()}
          >
            ⌗
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Nav />
          <span
            className={`text-[10px] ${
              apiOnline === true ? 'text-blaze' : apiOnline === false ? 'text-dim' : 'text-muted'
            }`}
          >
            {apiOnline === true ? 'DB' : apiOnline === false ? 'Offline' : '…'}
          </span>
          <button type="button" className="ui-btn" onClick={() => onBake(true)} disabled={!ready}>
            Download
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => onBake(false)}
            disabled={!ready}
          >
            Save
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left */}
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Panel
              title="Formats"
              action={
                <button
                  type="button"
                  className="text-[11px] font-medium text-paper hover:text-blaze"
                  disabled={!ready}
                  onClick={() => {
                    const name = window.prompt('New template name', 'New template')
                    if (name == null || !String(name).trim()) return
                    try {
                      const res = api?.createTemplate?.({ name: String(name).trim() })
                      const id = res?.template?.id
                      if (api.listTemplates) setTemplates(api.listTemplates() || [])
                      setStatus(id ? `Created “${name}”` : 'Create failed')
                    } catch (e) {
                      setStatus(e.message || 'Create failed')
                    }
                  }}
                >
                  + Add
                </button>
              }
            >
              <ul className="space-y-0.5">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => api?.switchTemplate?.(t.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
                        snapshot?.template === t.id
                          ? 'bg-panel2 text-paper'
                          : 'text-dim hover:bg-inset hover:text-paper'
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-inset text-[9px] text-muted">
                        4:5
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{t.name}</span>
                        <span className="block truncate text-[10px] text-muted">
                          {t.id}
                          {t.frozen ? ' · frozen' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Layers">
              <button
                type="button"
                className="ui-btn mb-2 w-full"
                disabled={!ready}
                onClick={() => {
                  const label = window.prompt('Text field label', 'New text')
                  if (label == null || !String(label).trim()) return
                  try {
                    const res = api?.addTextField?.({ label: String(label).trim() })
                    setStatus(
                      res?.field?.bind
                        ? `Added “${res.field.label}” on canvas (brand color)`
                        : 'Add text failed — hard-refresh if engine is old',
                    )
                  } catch (e) {
                    setStatus(e.message || 'Add text failed')
                  }
                }}
              >
                + Add text field
              </button>
              <ul className="space-y-0.5">
                {layers.map((layer) => (
                  <li key={layer.id}>
                    <button
                      type="button"
                      onClick={() => api?.selectLayer?.(layer.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                        snapshot?.selectedId === layer.id
                          ? 'bg-panel2 text-paper'
                          : 'text-dim hover:bg-inset hover:text-paper'
                      }`}
                    >
                      <span className="w-10 shrink-0 text-[10px] uppercase text-muted">
                        {layer.type}
                      </span>
                      <span className="truncate">{layer.label}</span>
                    </button>
                  </li>
                ))}
                {!layers.length && (
                  <li className="px-2 text-[11px] text-muted">{ready ? 'No layers' : 'Loading…'}</li>
                )}
              </ul>
            </Panel>

            <Panel title="Stories">
              {stories.length ? (
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
              ) : (
                <p className="text-[11px] text-muted">No stories</p>
              )}
            </Panel>

            <Panel title="Images">
              {imageSlots.map((slot) => (
                <div key={slot.key} className="mb-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px]">{slot.label}</div>
                    <div className="text-[10px] text-muted">{slot.loaded ? 'loaded' : 'empty'}</div>
                  </div>
                  <label className="cursor-pointer text-[11px] text-paper underline decoration-line underline-offset-2">
                    {slot.loaded ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file || !api?.setImageSlot) return
                        const url = await readFileAsDataURL(file)
                        await api.setImageSlot(slot.key, url)
                        if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
                      }}
                    />
                  </label>
                </div>
              ))}
            </Panel>

            <Panel title="Assets">
              <select
                className={`${inputClass} mb-2`}
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="player">Player</option>
                <option value="background">Background</option>
                <option value="logo">Logo</option>
                <option value="conference">Conference</option>
                <option value="sponsor">Sponsor</option>
                <option value="shape">Shapes</option>
              </select>
              <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
                {filteredAssets.slice(0, 24).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.name}
                    onClick={() => onApplyAsset(a.id)}
                    className="overflow-hidden rounded border border-line bg-inset hover:border-muted"
                  >
                    <div
                      className="h-10 bg-contain bg-center bg-no-repeat"
                      style={{ backgroundImage: a.thumb ? `url(${a.thumb})` : undefined }}
                    />
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Shapes">
              <div className="grid grid-cols-3 gap-1">
                {shapePresets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => api?.addShape?.(p.id)}
                    className="ui-btn px-1 py-2 text-[11px]"
                  >
                    {p.label || p.id}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Brand">
              <div className="flex gap-2">
                <Field label="Primary">
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded border border-line bg-inset"
                    value={snapshot?.colors?.primary || '#006F73'}
                    onChange={(e) => api?.setBrandColors?.({ primary: e.target.value })}
                  />
                </Field>
                <Field label="Secondary">
                  <input
                    type="color"
                    className="h-8 w-full cursor-pointer rounded border border-line bg-inset"
                    value={snapshot?.colors?.secondary || '#C5B358'}
                    onChange={(e) => api?.setBrandColors?.({ secondary: e.target.value })}
                  />
                </Field>
              </div>
            </Panel>
          </div>
        </aside>

        {/* Center canvas */}
        <main className="relative flex min-w-0 flex-1 flex-col bg-[#121212]">
          {!ready && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/80 text-xs text-dim">
              {error || 'Starting engine…'}
            </div>
          )}
          <StageHost iframeRef={iframeRef} src={src} onLoad={onLoad} />
          {status ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-line bg-panel/95 px-3 py-1.5 text-[11px] text-dim backdrop-blur">
              {status}
            </div>
          ) : null}
        </main>

        {/* Right properties */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="border-b border-line px-3 py-2.5">
            <div className="text-[12px] font-semibold text-paper">Styles</div>
            <div className="truncate text-[11px] text-muted">
              {selected ? `${selected.type} · ${selected.id}` : 'Select a layer'}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <PropertiesPanel api={api} selected={selected} snapshot={snapshot} />
          </div>
          <div className="space-y-2 border-t border-line p-3">
            <button type="button" className="ui-btn ui-btn-primary w-full" onClick={onExport}>
              Export PNG
            </button>
            <p className="text-[10px] leading-snug text-muted">
              Save writes id <span className="text-dim">{bakeId || '—'}</span> to Atlas.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
