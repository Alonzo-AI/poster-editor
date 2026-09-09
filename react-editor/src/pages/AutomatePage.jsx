import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import SmartCropModal from '../components/SmartCropModal.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import ContextToolbar from '../components/ContextToolbar.jsx'
import StudioSidePanel from '../components/StudioSidePanel.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import {
  apiHealth,
  syncDbTemplatesIntoEngine,
  ensureTemplateInEngine,
  listDbTemplates,
  mergeTemplateCatalog,
} from '../api/templatesApi.js'

const inputClass = 'ui-input'

const CATEGORIES = [
  { id: 'player', label: 'Player' },
  { id: 'team', label: 'Team' },
  { id: 'player_no_image', label: 'No image' },
]

function pickDefaultTemplate(list) {
  if (!list?.length) return null
  const usable = (t) => (t.fields?.length || 0) > 0 || (t.images?.length || 0) > 0
  return (
    list.find((t) => t.id === 'richmond') ||
    list.find((t) => t.id === 'magazine') ||
    list.find((t) => t.frozen && usable(t)) ||
    list.find((t) => usable(t)) ||
    list.find((t) => t.frozen) ||
    list[0]
  )
}

function Panel({ title, children, className = '', action = null }) {
  return (
    <section className={`border-b border-line/80 ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-1.5">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="px-3.5 pb-3.5">{children}</div>
    </section>
  )
}

export default function AutomatePage({ Nav }) {
  const { iframeRef, src, api, snapshot, ready, error, onLoad } = usePosterEngine({ headless: true })
  const [templates, setTemplates] = useState([])
  const [dbCatalog, setDbCatalog] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [formatCategory, setFormatCategory] = useState('player')
  const [text, setText] = useState({})
  const [colors, setColors] = useState({ primary: '#006F73', secondary: '#C5B358' })
  const [images, setImages] = useState({})
  const [status, setStatus] = useState('')
  const [fields, setFields] = useState([])
  const [imageSlots, setImageSlots] = useState([])
  const [apiOnline, setApiOnline] = useState(null)
  const layoutTemplateRef = useRef(null)
  const [smartCrop, setSmartCrop] = useState(null)
  const [cutoutBusy, setCutoutBusy] = useState(false)
  const [cutoutDone, setCutoutDone] = useState(false)
  /** Editor-like tools for Automate only — does not change fill/export/DB flows. */
  const [editMode, setEditMode] = useState(false)
  const [studioMode, setStudioMode] = useState(null)
  const [shapePresets, setShapePresets] = useState([])

  const filteredTemplates = useMemo(
    () => templates.filter((t) => (t.category || 'player') === formatCategory),
    [templates, formatCategory],
  )

  const current = templates.find((t) => t.id === templateId)
  const layers = snapshot?.layers || []
  const selected = snapshot?.selected || null

  const refreshFromDb = useCallback(async () => {
    if (!api) return []
    try {
      const remote = await listDbTemplates({ lite: true })
      setDbCatalog(remote)
      setTemplates(mergeTemplateCatalog(remote, api.listTemplates?.() || []))
      await syncDbTemplatesIntoEngine(api)
      setApiOnline(true)
      const merged = mergeTemplateCatalog(remote, api.listTemplates?.() || [])
      setTemplates(merged)
      return merged
    } catch (e) {
      setApiOnline(false)
      throw e
    }
  }, [api])

  const apply = useCallback(
    async (includeImages = true, { resetLayout = false } = {}) => {
      if (!api?.setPayload || !templateId) return
      const switching = layoutTemplateRef.current !== templateId
      const shouldReset = resetLayout || switching
      setStatus('Updating…')
      try {
        await ensureTemplateInEngine(api, templateId, {
          updatedAt: templates.find((t) => t.id === templateId)?.updatedAt,
        })
        setTemplates(mergeTemplateCatalog(dbCatalog, api.listTemplates?.() || []))
        const payload = {
          template: templateId,
          auto_palette: false,
          // First paint / Reset: lock to baked positions. Later fills keep drag nudges.
          freeze_layout: shouldReset,
          preserve_layout: !shouldReset,
          text: { ...text },
          colors: { ...colors },
        }
        if (includeImages) {
          if (images.player) payload.player_image = images.player
          if (images.background) payload.background_image = images.background
          if (images.logo) payload.logo_url = images.logo
          if (images.conference) payload.conference_logo = images.conference
          if (images.sponsor) payload.sponsor_logo = images.sponsor
        }
        await api.setPayload(payload)
        if (shouldReset) {
          try {
            api.freezeCurrentLayout?.()
          } catch (_) {}
          layoutTemplateRef.current = templateId
        }
        try {
          api.zoomFit?.()
        } catch (_) {}
        setStatus(
          shouldReset
            ? `Live · “${templateId}” · drag layers to adjust (export only)`
            : `Live · “${templateId}” · layout tweaks kept for this export`,
        )
      } catch (e) {
        setStatus('Update failed: ' + (e.message || e))
      }
    },
    [api, templateId, text, colors, images, dbCatalog, templates],
  )

  function onResetLayout() {
    if (!api) return
    try {
      api.resetAutomateLayout?.() || api.freezeCurrentLayout?.()
      layoutTemplateRef.current = templateId
      setStatus('Layout reset to template · drag again if needed')
    } catch (e) {
      setStatus('Reset failed: ' + (e.message || e))
    }
  }

  function syncFieldsFromEngine() {
    if (!api) return
    try {
      const nextFields = api.listTextFields?.() || []
      if (Array.isArray(nextFields) && nextFields.length) setFields(nextFields)
      const slots = api.listImageSlots?.() || []
      if (Array.isArray(slots) && slots.length) {
        setImageSlots(
          slots.map((s) => ({
            key: s.key,
            label: s.label || s.key,
          })),
        )
      }
      const snap = api.getEditorSnapshot?.()
      if (snap?.text && typeof snap.text === 'object') {
        setText((prev) => ({ ...prev, ...snap.text }))
      }
      if (snap?.colors?.primary || snap?.colors?.secondary) {
        setColors((c) => ({
          primary: snap.colors.primary || c.primary,
          secondary: snap.colors.secondary || c.secondary,
        }))
      }
    } catch (_) {}
  }

  function enterEditMode() {
    setEditMode(true)
    setStudioMode(null)
    try {
      const presets = api?.listShapePresets?.() || []
      setShapePresets(Array.isArray(presets) ? presets : [])
    } catch (_) {
      setShapePresets([])
    }
    setStatus('Edit automate · styles, layers, shapes — session only (not saved to DB)')
  }

  function exitEditMode() {
    setEditMode(false)
    setStudioMode(null)
    syncFieldsFromEngine()
    setStatus('Edit closed · fill & export unchanged · layout tweaks kept for this session')
  }

  useEffect(() => {
    if (!ready || !api) return
    let cancelled = false

    async function load(pickDefault) {
      apiHealth()
        .then(() => setApiOnline(true))
        .catch(() => setApiOnline(false))
      let list = api.listTemplates?.() || []
      try {
        const merged = await refreshFromDb()
        if (cancelled) return
        if (merged?.length) list = merged
      } catch (_) {
        // Fall back to file-based templates from the engine
      }
      if (cancelled) return
      setTemplates(list)
      if (!pickDefault) return
      setTemplateId((prev) => {
        const inCat = (id) => {
          const t = list.find((x) => x.id === id)
          return t && (t.category || 'player') === formatCategory
        }
        if (prev && list.some((t) => t.id === prev) && inCat(prev)) {
          const cur = list.find((t) => t.id === prev)
          const hasContent =
            (cur?.fields?.length || 0) > 0 || (cur?.images?.length || 0) > 0
          if (hasContent) return prev
        }
        const scoped = list.filter((t) => (t.category || 'player') === formatCategory)
        return pickDefaultTemplate(scoped)?.id || pickDefaultTemplate(list)?.id || null
      })
    }

    load(true)
    const timer = setInterval(() => load(false), 8000)
    const onFocus = () => load(false)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [ready, api, refreshFromDb, formatCategory])

  useEffect(() => {
    if (!templateId || !templates.length) return
    const t = templates.find((x) => x.id === templateId)
    if (!t) return
    setFields(t.fields || [])
    setImageSlots(t.images || [])
    setText((prev) => {
      const next = { ...prev }
      ;(t.fields || []).forEach((f) => {
        if (next[f.key] == null) next[f.key] = f.placeholder || ''
      })
      return next
    })
  }, [templateId, templates])

  // Auto-apply fill values — paused while Edit automate is open so canvas tools don't fight the form
  useEffect(() => {
    if (!ready || !templateId || editMode) return
    const t = setTimeout(() => apply(false), 120)
    return () => clearTimeout(t)
  }, [text, colors, templateId, ready, editMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !templateId || editMode) return
    apply(true)
  }, [images, templateId, ready, editMode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onExport() {
    if (!api?.exportPng) return
    setStatus('Rendering…')
    try {
      // Keep drag nudges — do not re-freeze before PNG
      await apply(true, { resetLayout: false })
      const dataUrl = await api.exportPng()
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `poster_${templateId || 'export'}.png`
      a.click()
      setStatus('PNG downloaded · layout tweaks were not saved to DB')
    } catch (e) {
      setStatus('Export failed: ' + (e.message || e))
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
  }

  async function openPlayerSmartCrop(url) {
    if (!url || !api) return
    setImages((img) => ({ ...img, player: url }))
    setCutoutDone(false)
    setCutoutBusy(false)
    try {
      await api.setPayload?.({
        template: templateId,
        preserve_layout: true,
        freeze_layout: false,
        player_image: url,
        text: { ...text },
        colors: { ...colors },
      })
    } catch (_) {}
    const frame = api.getImageFrame?.('player') || {}
    setSmartCrop({
      key: 'player',
      src: url,
      label: 'Player image',
      frameW: frame.w || 560,
      frameH: frame.h || 1017,
    })
  }

  async function onSmartCropRemoveBg() {
    if (!api?.setImageCutout) return null
    setCutoutBusy(true)
    setStatus('Removing background… (first run downloads the model)')
    try {
      const res = await api.setImageCutout('player', true)
      if (!res?.ok || !res?.cutBg) {
        setCutoutDone(false)
        setStatus(res?.error || 'Background removal failed — check network and try again')
        return null
      }
      setCutoutDone(true)
      const srcOut = res.src || api.getImageSlot?.('player')?.src
      if (srcOut) {
        setImages((img) => ({ ...img, player: srcOut }))
        setSmartCrop((s) => (s ? { ...s, src: srcOut } : s))
      }
      setStatus('Background removed')
      return srcOut || null
    } catch (e) {
      setCutoutDone(false)
      setStatus('Background removal failed: ' + (e.message || e))
      return null
    } finally {
      setCutoutBusy(false)
    }
  }

  async function onSmartCropApply({ zoom, cropX, cropY, bake }) {
    if (!api || !smartCrop) return
    try {
      await apply(true, { resetLayout: false })
      await api.applySmartCrop?.(smartCrop.key, { zoom, cropX, cropY, bake })
      const baked = api.getImageSlot?.('player')
      if (baked?.src) {
        setImages((img) => ({ ...img, player: baked.src }))
      }
      setStatus(`Player fitted to ${smartCrop.frameW}×${smartCrop.frameH}`)
      setSmartCrop(null)
    } catch (e) {
      setStatus('Smart crop failed: ' + (e.message || e))
    }
  }

  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
        <div>
          <div className="text-sm font-medium text-paper">Automate</div>
          <div className="text-[11px] text-muted">
            {editMode
              ? 'Edit mode · styles & layers (session only · not saved to DB)'
              : 'Fill copy · drag on canvas to tweak · export PNG (not saved to DB)'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={editMode ? 'ui-btn ui-btn-primary' : 'ui-btn'}
            disabled={!ready || !templateId}
            title={editMode ? 'Close editor tools' : 'Open editor-like tools for this session'}
            onClick={() => (editMode ? exitEditMode() : enterEditMode())}
          >
            {editMode ? 'Done editing' : 'Edit automate'}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!ready || !templateId}
            title="Restore baked template positions"
            onClick={onResetLayout}
          >
            Reset layout
          </button>
          <span
            className={`text-[10px] ${
              apiOnline === true ? 'text-blaze' : 'text-dim'
            }`}
          >
            {apiOnline === true ? 'DB' : apiOnline === false ? 'Offline' : '…'}
          </span>
          <Nav />
          <button type="button" className="ui-btn ui-btn-primary" disabled={!ready} onClick={onExport}>
            Export PNG
          </button>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 overflow-hidden ${
          editMode
            ? 'grid-cols-[minmax(200px,300px)_minmax(0,1fr)_minmax(240px,300px)]'
            : 'grid-cols-[320px_minmax(0,1fr)]'
        }`}
      >
      <aside className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-r border-line bg-panel p-3">
        <section className="mb-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Template</h2>
            <button
              type="button"
              className="rounded border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dim hover:border-blaze hover:text-paper"
              onClick={async () => {
                setStatus('Refreshing templates…')
                try {
                  await refreshFromDb()
                  setStatus('Templates refreshed from DB')
                } catch (e) {
                  setStatus('Refresh failed: ' + (e.message || e))
                }
              }}
            >
              Refresh
            </button>
          </div>
          <div className="mb-2 flex gap-0.5 rounded-full border border-line bg-inset p-0.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`flex-1 rounded-full px-1 py-1.5 text-[10px] font-semibold ${
                  formatCategory === c.id
                    ? 'bg-panel text-paper shadow-sm'
                    : 'text-dim hover:text-paper'
                }`}
                onClick={() => setFormatCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {filteredTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium ${
                  templateId === t.id
                    ? 'border-blaze/40 bg-panel2 text-paper'
                    : 'border-line bg-inset text-dim hover:text-paper'
                }`}
              >
                <span className="block truncate">{t.name}</span>
                <span className="block truncate text-[9px] font-medium opacity-60">{t.id}</span>
                {t.frozen ? <span className="text-[9px] text-blaze">frozen</span> : null}
              </button>
            ))}
          </div>
          {!filteredTemplates.length && (
            <p className="mt-2 text-[11px] text-muted">No templates in this category</p>
          )}
          <p className="mt-2 text-[11px] text-dim">
            {current
              ? `id: ${current.id} · ${fields.length} fields · ${imageSlots.length} images`
              : error || 'Loading…'}
          </p>
          <p className="mt-2 text-[11px] text-dim">
            Templates refresh from the database every few seconds after Editor Save. Layout stays
            frozen.
          </p>
        </section>
        <section className="mb-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Brand colors</h2>
          <div className="flex gap-2">
            <label className="flex-1 text-[11px] text-dim">
              Primary
              <input
                type="color"
                className="mt-1 h-9 w-full cursor-pointer rounded border border-line bg-inset"
                value={colors.primary}
                onChange={(e) => setColors((c) => ({ ...c, primary: e.target.value }))}
              />
            </label>
            <label className="flex-1 text-[11px] text-dim">
              Secondary
              <input
                type="color"
                className="mt-1 h-9 w-full cursor-pointer rounded border border-line bg-inset"
                value={colors.secondary}
                onChange={(e) => setColors((c) => ({ ...c, secondary: e.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="mb-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Text fields</h2>
          {fields.map((f) => {
            const long = /desc|callout|title/i.test(f.key)
            const Tag = long ? 'textarea' : 'input'
            return (
              <label key={f.key} className="mb-2 block text-[11px] text-dim">
                {f.label}
                <Tag
                  className={`${inputClass} mt-1 ${long ? 'min-h-[54px]' : ''}`}
                  value={text[f.key] ?? ''}
                  placeholder={f.placeholder || ''}
                  onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
                />
              </label>
            )
          })}
        </section>

        <section className="mb-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Images</h2>
          {imageSlots.map((slot) => (
            <div key={slot.key} className="mb-2 flex items-center gap-2">
              <div
                className="h-11 w-11 shrink-0 rounded border border-line bg-inset bg-contain bg-center bg-no-repeat"
                style={
                  images[slot.key] ? { backgroundImage: `url(${images[slot.key]})` } : undefined
                }
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{slot.label}</div>
                <div className="text-[10px] text-dim">
                  {images[slot.key] ? 'loaded' : 'none'}
                  {slot.key === 'player' && (() => {
                    const f = api?.getImageFrame?.('player')
                    return f?.w ? ` · frame ${f.w}×${f.h}` : ''
                  })()}
                </div>
                <label className="cursor-pointer text-[11px] text-blaze underline">
                  {images[slot.key] ? 'replace' : 'upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      const url = await readFile(file)
                      if (slot.key === 'player') {
                        await openPlayerSmartCrop(url)
                      } else {
                        setImages((img) => ({ ...img, [slot.key]: url }))
                      }
                    }}
                  />
                </label>
                {slot.key === 'player' && images.player ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="text-[11px] text-blaze underline"
                      onClick={() => openPlayerSmartCrop(images.player)}
                    >
                      fit
                    </button>
                  </>
                ) : null}
                {images[slot.key] ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="text-[11px] text-red-400 underline"
                      onClick={() =>
                        setImages((img) => {
                          const n = { ...img }
                          delete n[slot.key]
                          return n
                        })
                      }
                    >
                      remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        <button
          type="button"
          className="ui-btn ui-btn-primary w-full disabled:opacity-55"
          disabled={!ready}
          onClick={onExport}
        >
          Export PNG
        </button>
        <p className="mt-2 text-[11px] text-muted">
          Drag text or images on the canvas to fine-tune before export. Tweaks are session-only —
          they are not written to Atlas. Use <b className="font-medium text-dim">Reset layout</b> to
          restore the template.
        </p>
        <p className="mt-1 text-xs text-dim">{status}</p>
      </aside>

      {/* Center: canvas (+ editor chrome only in Edit automate) */}
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        {editMode ? (
          <StudioSidePanel
            mode={studioMode}
            onClose={() => setStudioMode(null)}
            api={api}
            selected={selected}
            layers={layers}
          />
        ) : null}
        <main className="ui-canvas-well relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {editMode ? (
            <ContextToolbar
              api={api}
              selected={selected}
              layers={layers}
              studioMode={studioMode}
              onStudioMode={setStudioMode}
            />
          ) : null}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div className="relative aspect-[1080/1350] h-[min(92vh,920px)] max-h-[92vh] w-auto max-w-[min(92%,520px)] rounded-sm shadow-[0_16px_48px_rgba(14,99,155,0.14)] ring-1 ring-line">
              {!ready && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-panel/90 text-xs text-dim">
                  {error || 'Starting poster engine…'}
                </div>
              )}
              <StageHost
                iframeRef={iframeRef}
                src={src}
                onLoad={onLoad}
                className="!absolute inset-0 !flex-none rounded-sm"
              />
            </div>
            {editMode ? (
              <div className="absolute bottom-3 right-3 z-10 flex gap-1 rounded-md border border-line bg-panel/95 p-1 shadow-sm backdrop-blur">
                <button type="button" className="ui-btn px-2 py-1 text-[11px]" onClick={() => api?.zoomOut?.()}>−</button>
                <button type="button" className="ui-btn px-2 py-1 text-[11px]" onClick={() => api?.zoomFit?.()}>Fit</button>
                <button type="button" className="ui-btn px-2 py-1 text-[11px]" onClick={() => api?.zoomIn?.()}>+</button>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {/* Right: editor tools — only when Edit automate is on */}
      {editMode ? (
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-line bg-panel">
          <div className="shrink-0 border-b border-line px-3.5 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Editor tools</div>
            <div className="mt-0.5 truncate text-[12px] text-paper">
              {selected ? `${selected.type} · ${selected.id}` : 'Select a layer on the canvas'}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            <Panel title="Layers">
              <ul className="space-y-0.5">
                {[...layers].reverse().map((layer) => (
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
                {!layers.length ? (
                  <li className="text-[11px] text-muted">No layers</li>
                ) : null}
              </ul>
            </Panel>

            <Panel title="Add">
              <div className="mb-2 flex gap-1.5">
                <button
                  type="button"
                  className="ui-btn flex-1 py-1.5 text-[11px]"
                  onClick={() => {
                    const label = window.prompt('New text field label', 'New text')
                    if (!label?.trim()) return
                    api?.addTextField?.({ label: String(label).trim() })
                    syncFieldsFromEngine()
                    setStatus(`Added text “${label.trim()}” (session only)`)
                  }}
                >
                  + Text
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(shapePresets.length
                  ? shapePresets
                  : ['circle', 'square', 'rectangle', 'rounded', 'pill', 'triangle'].map((id) => ({
                      id,
                      label: id,
                    }))
                ).map((p) => (
                  <button
                    key={p.id || p}
                    type="button"
                    className="rounded border border-line bg-inset px-1 py-2 text-[10px] capitalize text-dim hover:border-blaze hover:text-paper"
                    onClick={() => {
                      api?.addShape?.(p.id || p)
                      setStatus('Added shape (session only)')
                    }}
                  >
                    {p.label || p.id || p}
                  </button>
                ))}
              </div>
            </Panel>

            <div className="p-3.5">
              <PropertiesPanel api={api} selected={selected} snapshot={snapshot} />
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t border-line p-3.5">
            <button type="button" className="ui-btn w-full" onClick={exitEditMode}>
              Done editing
            </button>
            <p className="text-[10px] leading-snug text-muted">
              Edits here are for this Automate session / export only — they are not written to Atlas.
            </p>
          </div>
        </aside>
      ) : null}
      </div>
    </div>

    <SmartCropModal
      open={!!smartCrop}
      src={smartCrop?.src}
      frameW={smartCrop?.frameW}
      frameH={smartCrop?.frameH}
      slotLabel={smartCrop?.label}
      cutoutBusy={cutoutBusy}
      cutoutDone={cutoutDone}
      onRemoveBackground={onSmartCropRemoveBg}
      onClose={() => setSmartCrop(null)}
      onSkip={() => {
        setSmartCrop(null)
        setStatus('Player image kept without smart crop')
      }}
      onApply={onSmartCropApply}
    />
    </>
  )
}
