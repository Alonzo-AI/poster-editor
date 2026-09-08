import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import SmartCropModal from '../components/SmartCropModal.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import { apiHealth, syncDbTemplatesIntoEngine } from '../api/templatesApi.js'

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

export default function AutomatePage({ Nav }) {
  const { iframeRef, src, api, ready, error, onLoad } = usePosterEngine({ headless: true })
  const [templates, setTemplates] = useState([])
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

  const filteredTemplates = useMemo(
    () => templates.filter((t) => (t.category || 'player') === formatCategory),
    [templates, formatCategory],
  )

  const current = templates.find((t) => t.id === templateId)

  const refreshFromDb = useCallback(async () => {
    if (!api) return []
    try {
      await syncDbTemplatesIntoEngine(api)
      setApiOnline(true)
      const merged = api.listTemplates?.() || []
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
    [api, templateId, text, colors, images],
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
    const timer = setInterval(() => load(false), 5000)
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

  useEffect(() => {
    if (!ready || !templateId) return
    const t = setTimeout(() => apply(false), 120)
    return () => clearTimeout(t)
  }, [text, colors, templateId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !templateId) return
    apply(true)
  }, [images, templateId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const src = res.src || api.getImageSlot?.('player')?.src
      if (src) {
        setImages((img) => ({ ...img, player: src }))
        setSmartCrop((s) => (s ? { ...s, src } : s))
      }
      setStatus('Background removed')
      return src || null
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
            Fill copy · drag on canvas to tweak · export PNG (not saved to DB)
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="flex min-h-0 flex-1">
      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel p-3">
        <div className="mb-1 hidden">
          <div className="mt-3">
            <Nav />
          </div>
        </div>

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

      <main className="ui-canvas-well relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
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
      </main>
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
