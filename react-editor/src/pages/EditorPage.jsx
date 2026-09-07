import { useEffect, useMemo, useRef, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import SmartCropModal from '../components/SmartCropModal.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import {
  apiHealth,
  deleteTemplateFromDb,
  saveTemplateToDb,
  syncDbTemplatesIntoEngine,
} from '../api/templatesApi.js'

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
  const [textFields, setTextFields] = useState([])
  const [renamingBind, setRenamingBind] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [formatCategory, setFormatCategory] = useState('player')
  const [tplMenuId, setTplMenuId] = useState(null)
  const tplMenuRef = useRef(null)
  const [smartCrop, setSmartCrop] = useState(null) // { key, src, label, frameW, frameH }
  const [cutoutBusy, setCutoutBusy] = useState(false)
  const [cutoutDone, setCutoutDone] = useState(false)

  const CATEGORIES = [
    { id: 'player', label: 'Player' },
    { id: 'team', label: 'Team' },
    { id: 'player_no_image', label: 'No image' },
  ]

  const filteredTemplates = useMemo(
    () =>
      templates.filter((t) => (t.category || 'player') === formatCategory),
    [templates, formatCategory],
  )

  useEffect(() => {
    if (!tplMenuId) return
    const onDoc = (e) => {
      if (tplMenuRef.current && !tplMenuRef.current.contains(e.target)) {
        setTplMenuId(null)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setTplMenuId(null)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [tplMenuId])

  useEffect(() => {
    apiHealth()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false))
  }, [])

  useEffect(() => {
    if (!api?.listTextFields) {
      setTextFields([])
      return
    }
    try {
      setTextFields(api.listTextFields() || [])
    } catch (e) {
      console.warn(e)
    }
  }, [api, snapshot?.template, snapshot?.layers, ready])

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
    if (snapshot.category) setFormatCategory(snapshot.category)
  }, [snapshot?.template, snapshot?.templateName, snapshot?.category])

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

  async function onDeleteTemplate(t) {
    if (!t?.id || !api) return
    setTplMenuId(null)
    const label = t.name || t.id
    const ok = window.confirm(
      t.disk
        ? `Clear saved “${label}” from the database?\n(The built-in seed file stays in Formats.)`
        : `Delete “${label}”?\nRemoves it from the database and Automate.`,
    )
    if (!ok) return
    setStatus(`Deleting “${label}”…`)
    try {
      await deleteTemplateFromDb(t.id)
      setApiOnline(true)
    } catch (e) {
      setStatus(`DB delete failed (${e.message || e}) · removing locally…`)
    }
    try {
      api.removeRemoteTemplate?.(t.id)
    } catch (_) {}
    const next = api.listTemplates?.() || []
    setTemplates(next)
    const stillThere = next.some((x) => x.id === t.id)
    setStatus(
      stillThere
        ? `Cleared DB/session copy of “${label}” · seed kept`
        : `Deleted “${label}” · gone from Editor & Automate`,
    )
  }

  async function onCopyTemplate(t) {
    if (!t?.id || !api?.duplicateTemplate) return
    setTplMenuId(null)
    const suggested = `${t.name || t.id} copy`
    const name = window.prompt('Name for duplicate template', suggested)
    if (name == null || !String(name).trim()) return
    setStatus(`Duplicating “${t.name || t.id}”…`)
    try {
      const res = await api.duplicateTemplate({
        id: t.id,
        name: String(name).trim(),
        category: t.category || formatCategory,
      })
      const json = res?.json
      if (!json?.id) throw new Error('Duplicate failed — hard-refresh if engine is old')
      const saved = await saveTemplateToDb(json, { id: json.id })
      setApiOnline(true)
      try {
        api.injectRemoteTemplates?.(
          [
            {
              id: saved.id,
              name: json.name,
              category: json.category || 'player',
              frozen: true,
              json: { ...json, id: saved.id },
            },
          ],
          { sync: false },
        )
      } catch (_) {}
      setTemplates(api.listTemplates?.() || [])
      setBakeId(saved.id)
      setBakeName(json.name)
      setStatus(`Copied “${json.name}” (id: ${saved.id}) · saved to DB`)
    } catch (e) {
      setStatus(e.message || 'Copy failed')
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
        json.category =
          json.category ||
          snapshot?.category ||
          listed?.category ||
          formatCategory ||
          'player'
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
                  category: json.category || 'player',
                  frozen: true,
                  json: { ...json, id: saved.id, name, category: json.category || 'player' },
                },
              ],
              { sync: false },
            )
          } catch (_) {}
          if (api.listTemplates) setTemplates(api.listTemplates() || [])
          if (api.listTextFields) setTextFields(api.listTextFields() || [])
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
      if (api.listTextFields) setTextFields(api.listTextFields() || [])
    } catch (e) {
      setStatus(e.message || 'Save failed')
    }
  }

  async function openSmartCropForSlot(key, src, label) {
    if (key !== 'player' || !src) return
    const frame = api?.getImageFrame?.(key) || {}
    setCutoutDone(!!api?.getImageCutout?.('player')?.cutBg)
    setCutoutBusy(false)
    setSmartCrop({
      key,
      src,
      label: label || 'Player image',
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
      setCutoutDone(!!res?.cutBg)
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      const src = res?.src || api.getImageSlot?.('player')?.src
      if (src) setSmartCrop((s) => (s ? { ...s, src } : s))
      setStatus(res?.cutBg ? 'Background removed' : 'Background removal finished')
      return src || null
    } catch (e) {
      setStatus(e.message || 'Background removal failed')
      return null
    } finally {
      setCutoutBusy(false)
    }
  }

  async function onSmartCropApply({ zoom, cropX, cropY, bake }) {
    if (!api?.applySmartCrop || !smartCrop) return
    try {
      await api.applySmartCrop(smartCrop.key, { zoom, cropX, cropY, bake })
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      setStatus(
        `Fitted ${smartCrop.label.toLowerCase()} to ${smartCrop.frameW}×${smartCrop.frameH}`,
      )
      setSmartCrop(null)
    } catch (e) {
      setStatus(e.message || 'Smart crop failed')
    }
  }

  async function onApplyAsset(id) {
    if (!api?.applyLibraryAsset) return
    setStatus('Loading asset…')
    try {
      await api.applyLibraryAsset(id)
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      const asset = assets.find((a) => a.id === id)
      if (asset?.slot === 'player') {
        const slot = api.getImageSlot?.('player')
        if (slot?.src) await openSmartCropForSlot('player', slot.src, 'Player image')
      }
      setStatus('Asset applied')
    } catch (e) {
      setStatus(e.message || 'Asset failed')
    }
  }


  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-ink">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-paper">
            {bakeName || snapshot?.templateName || 'Untitled'}
          </span>
          <span className="hidden rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-dim sm:inline">
            1080 × 1350
          </span>
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
                if (api.listTextFields) setTextFields(api.listTextFields() || [])
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

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(200px,280px)_minmax(0,1fr)_minmax(240px,320px)] overflow-hidden">
        {/* Left */}
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-panel">
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
                      const res = api?.createTemplate?.({
                        name: String(name).trim(),
                        category: formatCategory,
                      })
                      const id = res?.template?.id
                      if (api.listTemplates) setTemplates(api.listTemplates() || [])
                      setStatus(
                        id
                          ? `Created “${name}” · ${CATEGORIES.find((c) => c.id === formatCategory)?.label || formatCategory}`
                          : 'Create failed',
                      )
                    } catch (e) {
                      setStatus(e.message || 'Create failed')
                    }
                  }}
                >
                  + Add
                </button>
              }
            >
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
              <ul className="space-y-0.5">
                {filteredTemplates.map((t) => (
                  <li key={t.id} className="group relative flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTplMenuId(null)
                        api?.switchTemplate?.(t.id)
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left ${
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
                    <div
                      className="relative shrink-0"
                      ref={tplMenuId === t.id ? tplMenuRef : null}
                    >
                      <button
                        type="button"
                        title="Template options"
                        aria-label="Template options"
                        aria-expanded={tplMenuId === t.id}
                        className={`mr-0.5 flex h-7 w-7 items-center justify-center rounded text-[15px] leading-none text-muted hover:bg-inset hover:text-paper ${
                          tplMenuId === t.id
                            ? 'bg-inset text-paper opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setTplMenuId((cur) => (cur === t.id ? null : t.id))
                        }}
                      >
                        ⋮
                      </button>
                      {tplMenuId === t.id ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-30 mt-0.5 min-w-[148px] overflow-hidden rounded-md border border-line bg-panel py-1 shadow-md"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-paper hover:bg-inset"
                            onClick={() => onCopyTemplate(t)}
                          >
                            <span className="w-4 text-center text-[11px] text-dim" aria-hidden>
                              ⎘
                            </span>
                            Copy template
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-paper hover:bg-inset"
                            onClick={() => onDeleteTemplate(t)}
                          >
                            <svg
                              className="h-3.5 w-3.5 shrink-0 text-dim"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
                {!filteredTemplates.length && (
                  <li className="px-1 text-[11px] text-muted">
                    {ready
                      ? `No ${CATEGORIES.find((c) => c.id === formatCategory)?.label || ''} templates — + Add`
                      : 'Loading…'}
                  </li>
                )}
              </ul>
            </Panel>

            <Panel
              title="Text fields"
              action={
                <button
                  type="button"
                  className="text-[11px] font-medium text-paper hover:text-blaze"
                  disabled={!ready}
                  onClick={() => {
                    const label = window.prompt('Text field label', 'New text')
                    if (label == null || !String(label).trim()) return
                    try {
                      const res = api?.addTextField?.({ label: String(label).trim() })
                      if (api.listTextFields) setTextFields(api.listTextFields() || [])
                      setStatus(
                        res?.field?.bind
                          ? `Added “${res.field.label}”`
                          : 'Add text failed — hard-refresh if engine is old',
                      )
                    } catch (e) {
                      setStatus(e.message || 'Add text failed')
                    }
                  }}
                >
                  + Add
                </button>
              }
            >
              <ul className="space-y-1">
                {textFields.map((field) => (
                  <li
                    key={field.key}
                    className="rounded-md border border-line bg-inset px-2 py-1.5"
                  >
                    {renamingBind === field.key ? (
                      <input
                        className={inputClass}
                        autoFocus
                        value={renameDraft}
                        placeholder="Field label"
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          const next = String(renameDraft || '').trim()
                          try {
                            if (next && next !== field.label) {
                              api?.renameTextField?.(field.key, next)
                              if (api.listTextFields) setTextFields(api.listTextFields() || [])
                              setStatus(`Renamed to “${next}”`)
                            }
                          } catch (e) {
                            setStatus(e.message || 'Rename failed')
                          }
                          setRenamingBind(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') {
                            setRenamingBind(null)
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-[12px] text-paper">
                          {field.label}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-[10px] text-dim hover:text-paper"
                          title="Rename field"
                          onClick={() => {
                            setRenamingBind(field.key)
                            setRenameDraft(field.label || '')
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="shrink-0 text-[10px] text-dim hover:text-paper"
                          title="Remove field from template"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Remove “${field.label}” from this template?\n\nSave to update Atlas / Automate.`,
                              )
                            ) {
                              return
                            }
                            try {
                              const res = api?.deleteTextField?.(field.key, { confirm: false })
                              if (api.listTextFields) setTextFields(api.listTextFields() || [])
                              setStatus(
                                res?.ok
                                  ? `Removed “${field.label}” — Save to update DB`
                                  : res?.reason === 'cancelled'
                                    ? ''
                                    : 'Remove failed',
                              )
                            } catch (e) {
                              setStatus(e.message || 'Remove failed')
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[10px] text-muted">{field.key}</div>
                  </li>
                ))}
                {!textFields.length && (
                  <li className="text-[11px] text-muted">
                    {ready ? 'No text fields' : 'Loading…'}
                  </li>
                )}
              </ul>
            </Panel>

            <Panel title="Layers">
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
                    <div className="text-[10px] text-muted">
                      {slot.loaded ? 'loaded' : 'empty'}
                      {slot.key === 'player' && slot.frameW
                        ? ` · frame ${slot.frameW}×${slot.frameH}`
                        : ''}
                    </div>
                  </div>
                  {slot.key === 'player' && slot.loaded ? (
                    <button
                      type="button"
                      className="text-[11px] text-blaze underline decoration-line underline-offset-2"
                      onClick={() => {
                        const cur = api?.getImageSlot?.('player')
                        if (cur?.src) openSmartCropForSlot('player', cur.src, slot.label)
                      }}
                    >
                      Fit
                    </button>
                  ) : null}
                  <label className="cursor-pointer text-[11px] text-paper underline decoration-line underline-offset-2">
                    {slot.loaded ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file || !api?.setImageSlot) return
                        const url = await readFileAsDataURL(file)
                        await api.setImageSlot(slot.key, url)
                        if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
                        if (slot.key === 'player') {
                          await openSmartCropForSlot('player', url, slot.label)
                        }
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
        <main className="ui-canvas-well relative flex min-h-0 min-w-0 flex-col overflow-hidden">
          {!ready && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/70 text-xs text-dim">
              {error || 'Starting engine…'}
            </div>
          )}
          <StageHost iframeRef={iframeRef} src={src} onLoad={onLoad} />
          {status ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-panel/95 px-3.5 py-1.5 text-[11px] text-dim shadow-sm backdrop-blur">
              {status}
            </div>
          ) : null}
        </main>

        {/* Right properties */}
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-line bg-panel">
          <div className="shrink-0 border-b border-line px-3.5 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">Styles</div>
            <div className="mt-0.5 truncate text-[12px] text-paper">
              {selected ? `${selected.type} · ${selected.id}` : 'Select a layer'}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3.5">
            <PropertiesPanel api={api} selected={selected} snapshot={snapshot} />
          </div>
          <div className="shrink-0 space-y-2 border-t border-line p-3.5">
            <button type="button" className="ui-btn ui-btn-primary w-full" onClick={onExport}>
              Export PNG
            </button>
            <p className="text-[10px] leading-snug text-muted">
              Save writes id <span className="font-medium text-dim">{bakeId || '—'}</span> to Atlas.
            </p>
          </div>
        </aside>
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
