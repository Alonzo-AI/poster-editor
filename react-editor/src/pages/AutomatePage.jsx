import { useCallback, useEffect, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import { apiHealth, syncDbTemplatesIntoEngine } from '../api/templatesApi.js'

const inputClass =
  'w-full rounded border border-line bg-inset px-2 py-1.5 text-sm text-paper outline-none focus:border-blaze'

export default function AutomatePage({ Nav }) {
  const { iframeRef, src, api, ready, error, onLoad } = usePosterEngine({ headless: true })
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [text, setText] = useState({})
  const [colors, setColors] = useState({ primary: '#006F73', secondary: '#C5B358' })
  const [images, setImages] = useState({})
  const [status, setStatus] = useState('')
  const [fields, setFields] = useState([])
  const [imageSlots, setImageSlots] = useState([])
  const [apiOnline, setApiOnline] = useState(null)

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
    async (includeImages = true) => {
      if (!api?.setPayload || !templateId) return
      setStatus('Updating…')
      try {
        const payload = {
          template: templateId,
          auto_palette: false,
          freeze_layout: true,
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
        try {
          api.freezeCurrentLayout?.()
        } catch (_) {}
        setStatus(
          (current?.frozen ? 'Live · layout frozen · ' : 'Live · ') + `“${templateId}”`,
        )
      } catch (e) {
        setStatus('Update failed: ' + (e.message || e))
      }
    },
    [api, templateId, text, colors, images, current?.frozen],
  )

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
        if (prev && list.some((t) => t.id === prev)) return prev
        const preferred =
          list.find((t) => t.frozen) ||
          list.find((t) => t.id === 'richmond') ||
          list.find((t) => t.id === 'magazine') ||
          list[0]
        return preferred?.id || null
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
  }, [ready, api, refreshFromDb])

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
      await apply(true)
      const dataUrl = await api.exportPng()
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `poster_${templateId || 'export'}.png`
      a.click()
      setStatus('PNG downloaded.')
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

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel p-3">
        <div className="mb-3">
          <div className="mb-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-blaze">
            Narrative Styles
          </div>
          <h1 className="font-display text-2xl font-extrabold uppercase leading-none">Automate</h1>
          <p className="mt-1 text-xs text-dim">Pick a frozen template · fill · export PNG</p>
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
              ? 'DB connected · templates from Mongo + files'
              : apiOnline === false
                ? 'DB offline · file templates only'
                : 'Checking DB…'}
          </p>
          <div className="mt-3">
            <Nav />
          </div>
        </div>

        <section className="mb-3 rounded border border-line border-l-[3px] border-l-blaze bg-panel2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-xs font-bold uppercase tracking-widest">Template</h2>
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
          <div className="grid grid-cols-2 gap-1.5">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`rounded border px-2 py-2 font-display text-xs font-semibold ${
                  templateId === t.id
                    ? 'border-blaze bg-blaze/15 text-white'
                    : 'border-line bg-inset text-dim hover:text-paper'
                }`}
              >
                {t.name}
                {t.frozen ? ' ✓' : ''}
              </button>
            ))}
          </div>
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
        <section className="mb-3 rounded border border-line border-l-[3px] border-l-blaze bg-panel2 p-3">
          <h2 className="font-display mb-2 text-xs font-bold uppercase tracking-widest">
            Brand colors
          </h2>
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

        <section className="mb-3 rounded border border-line border-l-[3px] border-l-blaze bg-panel2 p-3">
          <h2 className="font-display mb-2 text-xs font-bold uppercase tracking-widest">
            Text fields
          </h2>
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

        <section className="mb-3 rounded border border-line border-l-[3px] border-l-blaze bg-panel2 p-3">
          <h2 className="font-display mb-2 text-xs font-bold uppercase tracking-widest">Images</h2>
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
                <div className="text-[10px] text-dim">{images[slot.key] ? 'loaded' : 'none'}</div>
                <label className="cursor-pointer text-[11px] text-blaze underline">
                  {images[slot.key] ? 'replace' : 'upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = await readFile(file)
                      setImages((img) => ({ ...img, [slot.key]: url }))
                    }}
                  />
                </label>
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
          className="w-full rounded bg-blaze py-3 font-display text-sm font-bold uppercase tracking-wide text-white hover:bg-blaze2 disabled:opacity-55"
          disabled={!ready}
          onClick={onExport}
        >
          Export PNG
        </button>
        <p className="mt-2 text-[11px] text-dim">
          Templates refresh from the database every few seconds after Editor Save. Preview updates
          live; layout stays frozen.
        </p>
        <p className="mt-1 font-display text-xs tracking-wide text-[#ffb896]">{status}</p>
      </aside>

      <main className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,#1a1520_0%,transparent_55%),linear-gradient(160deg,#12141a_0%,#0a0b0e_55%,#101218_100%)]">
        <div className="relative aspect-[1080/1350] h-[min(92vh,92%)] max-h-[92vh] w-[min(92%,520px)] shadow-[0_28px_90px_#000c]">
          <div className="pointer-events-none absolute -left-1.5 -top-1.5 z-10 h-[18px] w-[18px] border-l-2 border-t-2 border-blaze opacity-85" />
          <div className="pointer-events-none absolute -bottom-1.5 -right-1.5 z-10 h-[18px] w-[18px] border-b-2 border-r-2 border-blaze opacity-85" />
          {!ready && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/90 font-display text-xs uppercase tracking-widest text-dim">
              {error || 'Starting poster engine…'}
            </div>
          )}
          <StageHost iframeRef={iframeRef} src={src} onLoad={onLoad} className="rounded-sm" />
        </div>
      </main>
    </div>
  )
}
