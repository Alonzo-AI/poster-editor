import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import StageHost from '../components/StageHost.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import ContextToolbar from '../components/ContextToolbar.jsx'
import StudioSidePanel from '../components/StudioSidePanel.jsx'
import LayerList from '../components/LayerList.jsx'
import SmartCropModal from '../components/SmartCropModal.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import { fetchProject, listProjects, saveProject } from '../api/projectsApi.js'
import { uploadDataUrlToS3, uploadImageOrDataUrl, isRemoteImageUrl } from '../api/uploadsApi.js'

const inputClass = 'ui-input'

function Panel({ title, children, className = '' }) {
  return (
    <section className={`border-b border-line/80 ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-1.5">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">{title}</h2>
        </div>
      ) : null}
      <div className="px-3.5 pb-3.5">{children}</div>
    </section>
  )
}

/**
 * Edit a bulk Project with Automate fill + Edit tools.
 * Saves to /api/projects — never writes Editor templates.
 */
export default function ProjectEditPage({ Nav }) {
  const { id: routeId } = useParams()
  const navigate = useNavigate()
  const projectId = String(routeId || '')
    .trim()
    .replace(/[^\w-]+/g, '_')

  const { iframeRef, src, api, snapshot, ready, error, onLoad } = usePosterEngine({
    headless: true,
  })

  const [project, setProject] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [status, setStatus] = useState('Loading project…')
  const [text, setText] = useState({})
  const [colors, setColors] = useState({ primary: '#006F73', secondary: '#C5B358' })
  const [images, setImages] = useState({})
  const [fields, setFields] = useState([])
  const [imageSlots, setImageSlots] = useState([])
  const [editMode, setEditMode] = useState(false)
  const [studioMode, setStudioMode] = useState(null)
  const [shapePresets, setShapePresets] = useState([])
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [smartCrop, setSmartCrop] = useState(null)
  const [cutoutBusy, setCutoutBusy] = useState(false)
  const [cutoutDone, setCutoutDone] = useState(false)

  const layers = snapshot?.layers || []
  const selected = snapshot?.selected || null

  const siblingIndex = useMemo(() => {
    if (!siblings.length || !projectId) return -1
    return siblings.findIndex((p) => p.id === projectId)
  }, [siblings, projectId])

  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null
  const nextSibling =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null

  const goSibling = useCallback(
    (dir) => {
      if (saving || smartCrop) return
      const target = dir < 0 ? prevSibling : nextSibling
      if (!target?.id) return
      setEditMode(false)
      setStudioMode(null)
      setImages({})
      setSmartCrop(null)
      navigate(`/projects/${encodeURIComponent(target.id)}`)
    },
    [saving, smartCrop, prevSibling, nextSibling, navigate],
  )

  // College-scoped poster list for ← → (Projects only; never touches templates)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await listProjects()
        if (cancelled) return
        const teamKey = project?.teamKey
        const scoped = teamKey
          ? list.filter((p) => p.teamKey === teamKey)
          : list
        const sorted = [...scoped].sort((a, b) => {
          const at = a.createdAt || a.updatedAt || ''
          const bt = b.createdAt || b.updatedAt || ''
          if (at !== bt) return String(at).localeCompare(String(bt))
          return String(a.name || a.id).localeCompare(String(b.name || b.id))
        })
        // Keep current id in the strip even if team filter momentarily empty
        if (projectId && !sorted.some((p) => p.id === projectId) && project) {
          sorted.push({
            id: project.id,
            name: project.name,
            teamKey: project.teamKey,
            category: project.category,
          })
        }
        setSiblings(sorted)
      } catch (_) {
        if (!cancelled) setSiblings([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project?.teamKey, project?.id, project?.name, project?.category, projectId])

  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = String(e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goSibling(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goSibling(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goSibling])

  const syncFieldsFromEngine = useCallback(() => {
    if (!api) return
    try {
      const nextFields = api.listTextFields?.() || []
      if (Array.isArray(nextFields) && nextFields.length) setFields(nextFields)
      const slots = api.listImageSlots?.() || []
      if (Array.isArray(slots) && slots.length) {
        setImageSlots(slots.map((s) => ({ key: s.key, label: s.label || s.key })))
      }
      const snap = api.getEditorSnapshot?.()
      if (snap?.text && typeof snap.text === 'object') {
        const fieldList = Array.isArray(nextFields) && nextFields.length ? nextFields : fields
        const next = {}
        if (fieldList.length) {
          for (const f of fieldList) {
            const key = f.key || f
            if (snap.text[key] != null) next[key] = snap.text[key]
            else next[key] = f.placeholder != null ? String(f.placeholder) : ''
          }
        } else {
          Object.assign(next, snap.text)
        }
        setText(next)
      }
      if (snap?.colors?.primary || snap?.colors?.secondary) {
        setColors((c) => ({
          primary: snap.colors.primary || c.primary,
          secondary: snap.colors.secondary || c.secondary,
        }))
      }
    } catch (_) {}
  }, [api, fields])

  const apply = useCallback(
    async (force = false, { resetLayout = false } = {}) => {
      if (!api?.setPayload || !projectId || !hydrated) return
      try {
        const shouldReset = resetLayout || !layoutReady
        const payload = {
          template: projectId,
          auto_palette: false,
          freeze_layout: shouldReset,
          preserve_layout: !shouldReset,
          text: { ...text },
          colors: { ...colors },
        }
        if (images.player) payload.player_image = images.player
        if (images.background) payload.background_image = images.background
        if (images.logo) payload.logo_url = images.logo
        if (images.conference) payload.conference_logo = images.conference
        if (images.sponsor) payload.sponsor_logo = images.sponsor
        await api.setPayload(payload)
        if (shouldReset) {
          try {
            api.freezeCurrentLayout?.()
          } catch (_) {}
          setLayoutReady(true)
        }
        try {
          api.zoomFit?.()
        } catch (_) {}
        if (force) setStatus(`Live · “${project?.name || projectId}”`)
      } catch (e) {
        setStatus('Update failed: ' + (e.message || e))
      }
    },
    [api, projectId, hydrated, layoutReady, text, colors, images, project?.name],
  )

  useEffect(() => {
    if (!ready || !api || !projectId) return
    let cancelled = false
    ;(async () => {
      try {
        setStatus('Loading project…')
        setHydrated(false)
        setLayoutReady(false)
        const row = await fetchProject(projectId)
        if (cancelled) return
        setProject(row)

        // Deep-ish copy so engine mutations never touch the React/API object
        const json =
          typeof structuredClone === 'function'
            ? structuredClone(row.json)
            : JSON.parse(JSON.stringify(row.json || {}))
        json.id = row.id
        json.name = row.name
        json.category = row.category || json.category || 'player'
        json.teamKey = row.teamKey || json.teamKey
        json.teamLabel = row.teamLabel || json.teamLabel
        if (!json.settings) json.settings = {}
        json.settings.freezeLayout = true
        if (!json.automation) json.automation = {}
        json.automation.freezeLayout = true

        // CRITICAL: __RENDER_API_V3__ exists before init finishes. loadAll() clears TEMPLATES.
        // Wait for that wipe first, then inject the project JSON.
        if (typeof api.ensureTemplatesLoaded === 'function') {
          await api.ensureTemplatesLoaded()
        } else {
          await api.setPayload({
            auto_palette: false,
            preserve_layout: true,
            freeze_layout: false,
          })
        }
        if (cancelled) return

        // Same inject shape Automate uses after fetchDbTemplate
        const injected = api.injectRemoteTemplates(
          [
            {
              id: row.id,
              name: row.name,
              category: json.category,
              teamKey: json.teamKey,
              teamLabel: json.teamLabel,
              frozen: true,
              updatedAt: row.updatedAt,
              json,
            },
          ],
          { sync: false },
        )
        if (!injected?.ids?.includes?.(row.id) && !api.listTemplates?.()?.some((t) => t.id === row.id)) {
          throw new Error(`Engine did not accept project “${row.id}”`)
        }

        const listed = (api.listTemplates?.() || []).find((t) => t.id === row.id)
        const fieldList = listed?.fields?.length
          ? listed.fields
          : (json.layers || [])
              .filter((l) => l?.type === 'text' && l.bind)
              .map((l) => ({
                key: l.bind,
                label: l.label || l.bind,
                placeholder: l.placeholder != null ? String(l.placeholder) : '',
              }))
        const imageList = listed?.images?.length
          ? listed.images
          : (json.automation?.swapImages || ['player', 'background', 'logo', 'conference']).map(
              (key) => ({ key, label: key }),
            )

        const defaults = json.defaults?.text || {}
        const nextText = {}
        for (const f of fieldList) {
          if (!f?.key) continue
          nextText[f.key] =
            defaults[f.key] != null
              ? String(defaults[f.key])
              : f.placeholder != null
                ? String(f.placeholder)
                : ''
        }
        if (!fieldList.length && defaults && typeof defaults === 'object') {
          for (const [k, v] of Object.entries(defaults)) {
            if (v != null) nextText[k] = String(v)
          }
        }

        // Paint like Automate first-open: setPayload + freeze
        await api.setPayload({
          template: row.id,
          auto_palette: false,
          freeze_layout: true,
          preserve_layout: false,
          text: nextText,
          colors: { ...colors },
        })
        try {
          api.freezeCurrentLayout?.()
        } catch (_) {}
        try {
          api.zoomFit?.()
        } catch (_) {}
        // Second fit after layout settles (iframe measure can be 0 on first paint)
        requestAnimationFrame(() => {
          try {
            api.zoomFit?.()
          } catch (_) {}
        })

        if (cancelled) return
        setFields(fieldList)
        setImageSlots(imageList)
        setText(nextText)
        setHydrated(true)
        setLayoutReady(true)
        setStatus(`Project “${row.name}”`)
        syncFieldsFromEngine()
      } catch (e) {
        if (!cancelled) {
          setHydrated(false)
          setStatus(e.message || 'Failed to load project')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, api, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live fill updates — only after first paint succeeded (skip empty race on mount)
  useEffect(() => {
    if (!ready || !hydrated || !layoutReady || !projectId || editMode) return
    const t = setTimeout(() => apply(false), 120)
    return () => clearTimeout(t)
  }, [text, colors, projectId, ready, hydrated, layoutReady, editMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !hydrated || !layoutReady || !projectId || editMode) return
    const t = setTimeout(() => apply(false), 80)
    return () => clearTimeout(t)
  }, [images, projectId, ready, hydrated, layoutReady, editMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function enterEditMode() {
    setEditMode(true)
    setStudioMode(null)
    try {
      setShapePresets(api?.listShapePresets?.() || [])
    } catch (_) {
      setShapePresets([])
    }
    setStatus('Edit project · styles & layers (Save project to keep)')
  }

  function exitEditMode() {
    setEditMode(false)
    setStudioMode(null)
    syncFieldsFromEngine()
    setStatus('Edit closed · fill & export · Save project to persist')
  }

  async function onSave() {
    if (!api?.bakeTemplate || !project) return
    setSaving(true)
    setStatus('Saving project…')
    try {
      // Apply current fill before bake so text/images land in JSON
      await apply(true, { resetLayout: false })
      const result = await api.bakeTemplate({
        id: project.id,
        name: project.name,
        download: false,
      })
      const json = result?.json
      if (!json) throw new Error('Bake returned no JSON')
      json.id = project.id
      json.name = project.name
      json.category = project.category || json.category
      json.teamKey = project.teamKey || json.teamKey
      json.teamLabel = project.teamLabel || json.teamLabel
      const saved = await saveProject(json, {
        id: project.id,
        name: project.name,
        category: project.category,
        teamKey: project.teamKey,
        teamLabel: project.teamLabel,
        sourceTemplateId: project.sourceTemplateId,
      })
      setProject((p) => ({ ...p, updatedAt: saved.updatedAt, json }))
      setStatus(`Saved project “${project.name}”`)
    } catch (e) {
      setStatus(`Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  async function onExport() {
    if (!api?.exportPng) return
    setStatus('Rendering PNG…')
    try {
      await apply(true, { resetLayout: false })
      const dataUrl = await api.exportPng()
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `project_${projectId || 'export'}.png`
      a.click()
      setStatus('PNG downloaded')
    } catch (e) {
      setStatus('Export failed: ' + (e.message || e))
    }
  }

  async function uploadSlotImage(file, slotKey) {
    setStatus(`Uploading ${slotKey}…`)
    const { url, via, error } = await uploadImageOrDataUrl(file, {
      folder: `projects/${slotKey}`,
    })
    if (via === 's3') setStatus(`${slotKey} uploaded`)
    else setStatus(`Upload fallback (${error || 'local'})`)
    return url
  }

  async function persistProcessedImage(slotKey, src) {
    if (!src) return src
    if (isRemoteImageUrl(src)) return src
    if (!String(src).startsWith('data:') && !String(src).startsWith('blob:')) return src
    try {
      const url = await uploadDataUrlToS3(src, { folder: `projects/${slotKey}` })
      setImages((img) => ({ ...img, [slotKey]: url }))
      try {
        await api?.setImageSlot?.(slotKey, url)
      } catch (_) {}
      return url
    } catch (_) {
      return src
    }
  }

  async function openPlayerSmartCrop(url) {
    if (!url || !api) return
    setImages((img) => ({ ...img, player: url }))
    setCutoutDone(false)
    setCutoutBusy(false)
    try {
      await api.setPayload?.({
        template: projectId,
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
    try {
      const res = await api.setImageCutout('player', true)
      if (!res?.ok || !res?.cutBg) {
        setCutoutDone(false)
        setStatus(res?.error || 'Background removal failed')
        return null
      }
      setCutoutDone(true)
      let srcOut = res.src || api.getImageSlot?.('player')?.src
      if (srcOut) srcOut = await persistProcessedImage('player', srcOut)
      if (srcOut) setSmartCrop((s) => (s ? { ...s, src: srcOut } : s))
      return srcOut
    } catch (e) {
      setStatus(e.message || 'Cutout failed')
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
      let srcOut = api.getImageSlot?.('player')?.src
      if (bake !== false && srcOut) srcOut = await persistProcessedImage('player', srcOut)
      if (srcOut) setImages((img) => ({ ...img, player: srcOut }))
      setSmartCrop(null)
      setStatus('Player crop applied')
    } catch (e) {
      setStatus(e.message || 'Crop failed')
    }
  }

  const title = project?.name || projectId || 'Project'
  const posLabel =
    siblingIndex >= 0 && siblings.length
      ? `${siblingIndex + 1} / ${siblings.length}`
      : null

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-ink">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-paper">{title}</div>
            <div className="truncate text-[11px] text-muted">
              {posLabel ? `${posLabel} · ` : ''}
              {editMode
                ? 'Edit mode · styles & layers · Save project to keep'
                : 'Fill copy · drag on canvas · Save project to persist'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-line bg-inset p-0.5">
              <button
                type="button"
                className="ui-btn px-2.5 py-1 text-[12px] disabled:opacity-40"
                disabled={!prevSibling || saving}
                title="Previous poster (←)"
                onClick={() => goSibling(-1)}
              >
                ←
              </button>
              <span className="min-w-[3.5rem] px-1 text-center text-[11px] tabular-nums text-dim">
                {posLabel || '—'}
              </span>
              <button
                type="button"
                className="ui-btn px-2.5 py-1 text-[12px] disabled:opacity-40"
                disabled={!nextSibling || saving}
                title="Next poster (→)"
                onClick={() => goSibling(1)}
              >
                →
              </button>
            </div>
            <Link
              to={
                project?.teamKey
                  ? `/projects/team/${encodeURIComponent(project.teamKey)}`
                  : '/projects'
              }
              className="ui-btn text-[12px]"
            >
              {project?.teamKey ? 'Folder' : 'All projects'}
            </Link>
            <button
              type="button"
              className={editMode ? 'ui-btn ui-btn-primary' : 'ui-btn'}
              disabled={!ready || !hydrated}
              onClick={() => (editMode ? exitEditMode() : enterEditMode())}
            >
              {editMode ? 'Done editing' : 'Edit automate'}
            </button>
            <button
              type="button"
              className="ui-btn"
              disabled={!ready || !hydrated}
              onClick={() => {
                try {
                  api?.resetAutomateLayout?.()
                  setLayoutReady(false)
                  setStatus('Layout reset to project bake')
                  setTimeout(() => apply(true, { resetLayout: true }), 50)
                } catch (e) {
                  setStatus(e.message || 'Reset failed')
                }
              }}
            >
              Reset layout
            </button>
            <button
              type="button"
              className="ui-btn"
              disabled={!ready || !hydrated}
              onClick={onExport}
            >
              Export PNG
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!ready || !hydrated || saving}
              onClick={onSave}
            >
              {saving ? 'Saving…' : 'Save project'}
            </button>
            {Nav ? <Nav /> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel p-3">
            <p className="mb-3 text-[11px] text-muted">
              Same tools as Automate. Saves to <strong className="text-dim">Projects</strong> only —
              not Editor templates.
            </p>
            <p className="mb-3 text-[11px] text-dim">{status}</p>

            <section className="mb-3 rounded-xl border border-line bg-inset/40 p-3.5 shadow-sm">
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Text fields
              </h2>
              {fields.map((f) => {
                const long = /desc|callout|title|story/i.test(f.key)
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
              {!fields.length ? (
                <p className="text-[11px] text-muted">No text fields on this project yet.</p>
              ) : null}
            </section>

            <section className="mb-3 rounded-xl border border-line bg-inset/40 p-3.5 shadow-sm">
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                Images
              </h2>
              {imageSlots.map((slot) => (
                <div key={slot.key} className="mb-2 flex items-center gap-2">
                  <div
                    className="h-11 w-11 shrink-0 rounded border border-line bg-inset bg-contain bg-center bg-no-repeat"
                    style={
                      images[slot.key] ? { backgroundImage: `url(${images[slot.key]})` } : undefined
                    }
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium text-paper">{slot.label}</div>
                    <div className="text-[10px] text-dim">
                      {images[slot.key] ? 'loaded' : 'template default'}
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
                          try {
                            const url = await uploadSlotImage(file, slot.key)
                            if (slot.key === 'player') await openPlayerSmartCrop(url)
                            else setImages((img) => ({ ...img, [slot.key]: url }))
                          } catch (err) {
                            setStatus(err.message || 'Image upload failed')
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
                  </div>
                </div>
              ))}
              {!imageSlots.length ? (
                <p className="text-[11px] text-muted">No image slots on this project.</p>
              ) : null}
            </section>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
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
              <div className="relative flex min-h-0 flex-1 items-center justify-center gap-2 overflow-hidden p-3">
                <button
                  type="button"
                  className="ui-btn z-10 shrink-0 px-3 py-6 text-lg disabled:opacity-30"
                  disabled={!prevSibling || saving}
                  title="Previous poster (←)"
                  aria-label="Previous poster"
                  onClick={() => goSibling(-1)}
                >
                  ←
                </button>
                <div className="relative aspect-[1080/1350] w-[min(100%,520px)] max-h-[min(92vh,920px)] overflow-hidden rounded-sm bg-[#f4f7f8] shadow-[0_16px_48px_rgba(14,99,155,0.14)] ring-1 ring-line">
                  {!ready && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-panel/90 text-xs text-dim">
                      {error || 'Starting poster engine…'}
                    </div>
                  )}
                  <StageHost
                    iframeRef={iframeRef}
                    src={src}
                    onLoad={onLoad}
                    className="!absolute inset-0 !h-full !w-full !flex-none rounded-sm"
                  />
                </div>
                <button
                  type="button"
                  className="ui-btn z-10 shrink-0 px-3 py-6 text-lg disabled:opacity-30"
                  disabled={!nextSibling || saving}
                  title="Next poster (→)"
                  aria-label="Next poster"
                  onClick={() => goSibling(1)}
                >
                  →
                </button>
                {editMode ? (
                  <div className="absolute bottom-3 right-3 z-10 flex gap-1 rounded-md border border-line bg-panel/95 p-1 shadow-sm backdrop-blur">
                    <button
                      type="button"
                      className="ui-btn px-2 py-1 text-[11px]"
                      onClick={() => api?.zoomOut?.()}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="ui-btn px-2 py-1 text-[11px]"
                      onClick={() => api?.zoomFit?.()}
                    >
                      Fit
                    </button>
                    <button
                      type="button"
                      className="ui-btn px-2 py-1 text-[11px]"
                      onClick={() => api?.zoomIn?.()}
                    >
                      +
                    </button>
                  </div>
                ) : null}
              </div>
            </main>

            {editMode ? (
              <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-l border-line bg-panel">
                <div className="shrink-0 border-b border-line px-3.5 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
                    Editor tools
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-paper">
                    {selected ? `${selected.type} · ${selected.id}` : 'Select a layer on the canvas'}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
                  <Panel title="Layers">
                    <LayerList
                      layers={layers}
                      selectedId={snapshot?.selectedId}
                      api={api}
                      emptyText="No layers"
                    />
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
                          setStatus(`Added text “${label.trim()}”`)
                        }}
                      >
                        + Text
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(shapePresets.length
                        ? shapePresets
                        : ['circle', 'square', 'rectangle', 'rounded', 'pill', 'triangle'].map(
                            (id) => ({ id, label: id }),
                          )
                      ).map((p) => (
                        <button
                          key={p.id || p}
                          type="button"
                          className="rounded border border-line bg-inset px-1 py-2 text-[10px] capitalize text-dim hover:border-blaze hover:text-paper"
                          onClick={() => {
                            api?.addShape?.(p.id || p)
                            setStatus('Added shape')
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
                    Use <strong className="text-dim">Save project</strong> to write changes to the
                    projects collection (not templates).
                  </p>
                </div>
              </aside>
            ) : null}
          </div>
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
