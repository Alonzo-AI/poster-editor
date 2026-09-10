import { useEffect, useMemo, useRef, useState } from 'react'
import StageHost from '../components/StageHost.jsx'
import PropertiesPanel from '../components/PropertiesPanel.jsx'
import ContextToolbar from '../components/ContextToolbar.jsx'
import StudioSidePanel from '../components/StudioSidePanel.jsx'
import SmartCropModal from '../components/SmartCropModal.jsx'
import LayerList from '../components/LayerList.jsx'
import { usePosterEngine } from '../engine/usePosterEngine.js'
import {
  apiHealth,
  deleteTemplateFromDb,
  saveTemplateToDb,
  listDbTemplates,
  mergeTemplateCatalog,
  syncDbTemplatesIntoEngine,
  ensureTemplateInEngine,
  markTemplateHydrated,
  fetchDbTemplate,
  patchTemplateMeta,
  listTeamFolders,
  upsertTeamFolder,
} from '../api/templatesApi.js'
import { uploadDataUrlToS3, uploadImageOrDataUrl, isRemoteImageUrl } from '../api/uploadsApi.js'
import {
  UNASSIGNED_TEAM_KEY,
  collectTeamOptions,
  normalizeTeamKey,
  normalizeTeamLabel,
  promptNewTeam,
  teamOf,
} from '../lib/templateTeam.js'

const inputClass = 'ui-input'

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

export default function EditorPage({ Nav }) {
  const { iframeRef, src, api, snapshot, ready, error, onLoad } = usePosterEngine({
    headless: false,
  })
  const [templates, setTemplates] = useState([])
  const [dbCatalog, setDbCatalog] = useState([]) // stable Mongo names (lite)
  const [imageSlots, setImageSlots] = useState([])
  const [status, setStatus] = useState('')
  const [bakeId, setBakeId] = useState('')
  const [bakeName, setBakeName] = useState('')

  const [apiOnline, setApiOnline] = useState(null)
  const [textFields, setTextFields] = useState([])
  const [renamingBind, setRenamingBind] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [formatCategory, setFormatCategory] = useState('player')
  const [formatTeamKey, setFormatTeamKey] = useState(UNASSIGNED_TEAM_KEY)
  const [extraTeams, setExtraTeams] = useState([]) // DB team folders (+ optimistic local)
  const [tplMenuId, setTplMenuId] = useState(null)
  const [tplMoveTeamOpen, setTplMoveTeamOpen] = useState(false)
  const tplMenuRef = useRef(null)
  const [smartCrop, setSmartCrop] = useState(null) // { key, src, label, frameW, frameH }
  const [cutoutBusy, setCutoutBusy] = useState(false)
  const [cutoutDone, setCutoutDone] = useState(false)
  const [studioMode, setStudioMode] = useState(null) // font | effects | position | color

  const CATEGORIES = [
    { id: 'player', label: 'Player' },
    { id: 'team', label: 'Team' },
    { id: 'player_no_image', label: 'No image' },
    { id: 'nostalgia', label: 'Nostalgia' },
  ]

  const teamOptions = useMemo(() => {
    const fromTpl = collectTeamOptions(templates)
    const map = new Map(fromTpl.map((t) => [t.teamKey, t.teamLabel]))
    for (const t of extraTeams) map.set(t.teamKey, t.teamLabel)
    if (!map.has(formatTeamKey)) {
      map.set(formatTeamKey, normalizeTeamLabel('', formatTeamKey))
    }
    return [...map.entries()]
      .map(([teamKey, teamLabel]) => ({ teamKey, teamLabel }))
      .sort((a, b) => {
        if (a.teamKey === UNASSIGNED_TEAM_KEY) return -1
        if (b.teamKey === UNASSIGNED_TEAM_KEY) return 1
        return a.teamLabel.localeCompare(b.teamLabel)
      })
  }, [templates, extraTeams, formatTeamKey])

  const filteredTemplates = useMemo(
    () =>
      templates.filter((t) => {
        const cat = (t.category || 'player') === formatCategory
        const { teamKey } = teamOf(t)
        return cat && teamKey === formatTeamKey
      }),
    [templates, formatCategory, formatTeamKey],
  )

  useEffect(() => {
    if (!tplMenuId) {
      setTplMoveTeamOpen(false)
      return
    }
    const onDoc = (e) => {
      if (tplMenuRef.current && !tplMenuRef.current.contains(e.target)) {
        setTplMenuId(null)
        setTplMoveTeamOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setTplMenuId(null)
        setTplMoveTeamOpen(false)
      }
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

  const refreshTemplates = (catalog = dbCatalog) => {
    try {
      setTemplates(mergeTemplateCatalog(catalog, api?.listTemplates?.() || []))
    } catch (e) {
      console.warn(e)
    }
  }

  /** Lite poll so other users' Saves appear without a full page reload. */
  const pullDbCatalog = async ({ hydrateActive = false, quiet = false } = {}) => {
    if (!api?.injectRemoteTemplates) return []
    const remote = await listDbTemplates({ lite: true })
    setDbCatalog(remote)
    setApiOnline(true)
    try {
      const folders = await listTeamFolders()
      setExtraTeams(
        (folders || [])
          .filter((t) => t?.teamKey && t.teamKey !== UNASSIGNED_TEAM_KEY)
          .map((t) => ({
            teamKey: normalizeTeamKey(t.teamKey),
            teamLabel: normalizeTeamLabel(t.teamLabel, t.teamKey),
          })),
      )
    } catch (_) {
      // Teams API optional — template-derived teams still work
    }
    await syncDbTemplatesIntoEngine(api, { remote })
    setTemplates(mergeTemplateCatalog(remote, api.listTemplates?.() || []))

    if (hydrateActive) {
      const active = api.getEditorSnapshot?.()?.template || snapshot?.template
      if (active) {
        const meta = remote.find((t) => t.id === active)
        if (!quiet) setStatus(`Loading “${active}”…`)
        await ensureTemplateInEngine(api, active, { updatedAt: meta?.updatedAt })
        setTemplates(mergeTemplateCatalog(remote, api.listTemplates?.() || []))
      }
    }
    if (!quiet) setStatus('')
    return remote
  }

  useEffect(() => {
    if (!api?.listTemplates) return
    // Re-merge when active template changes — never drop Mongo names
    refreshTemplates()
  }, [api, snapshot?.template, dbCatalog])

  // Initial load + multi-user catalog sync (names only, ~every 8s + on focus)
  useEffect(() => {
    if (!api?.injectRemoteTemplates || !ready) return
    let cancelled = false
    let busy = false

    async function run(opts) {
      if (busy || cancelled) return
      busy = true
      try {
        await pullDbCatalog(opts)
      } catch (e) {
        if (!cancelled) {
          setApiOnline(false)
          if (!opts?.quiet) {
            setStatus(e.message || 'Failed to load template list from DB')
          }
          try {
            setTemplates(api.listTemplates?.() || [])
          } catch (_) {}
        }
      } finally {
        busy = false
      }
    }

    run({ hydrateActive: true, quiet: false })
    const timer = setInterval(() => run({ hydrateActive: true, quiet: true }), 8000)
    const onFocus = () => run({ hydrateActive: true, quiet: true })
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, ready])

  useEffect(() => {
    if (!api) return
    try {
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
    if (snapshot.teamKey) setFormatTeamKey(normalizeTeamKey(snapshot.teamKey))
  }, [snapshot?.template, snapshot?.templateName, snapshot?.category, snapshot?.teamKey])

  const selected = snapshot?.selected
  const layers = snapshot?.layers || []

  useEffect(() => {
    if (!selected) setStudioMode(null)
  }, [selected?.id])

  const shapePresets = useMemo(() => {
    if (api?.listShapePresets) return api.listShapePresets()
    return (snapshot?.shapePresets || []).map((id) => ({ id, label: id }))
  }, [api, snapshot?.shapePresets])

  async function uploadSlotImage(file, slotKey) {
    setStatus(`Uploading ${slotKey} to S3…`)
    const { url, via, error } = await uploadImageOrDataUrl(file, {
      folder: `templates/${slotKey}`,
    })
    if (via === 's3') setStatus(`${slotKey} uploaded`)
    else setStatus(`S3 upload failed (${error}) · using local image for now`)
    return url
  }

  /** Cutout / smart-crop bake produce data URLs — push those to S3 before Save bakes JSON. */
  async function persistProcessedImage(slotKey, src) {
    if (!src || !api?.setImageSlot) return src
    if (isRemoteImageUrl(src)) return src
    if (!String(src).startsWith('data:') && !String(src).startsWith('blob:')) return src
    try {
      setStatus(`Uploading processed ${slotKey} to S3…`)
      const url = await uploadDataUrlToS3(src, { folder: `templates/${slotKey}` })
      await api.setImageSlot(slotKey, url)
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      setStatus(`${slotKey} stored on S3`)
      return url
    } catch (e) {
      console.warn('[upload] processed image S3 failed:', e.message || e)
      setStatus(`Processed image kept locally (S3: ${e.message || e})`)
      return src
    }
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
    const nextCatalog = dbCatalog.filter((x) => x.id !== t.id)
    setDbCatalog(nextCatalog)
    setTemplates(mergeTemplateCatalog(nextCatalog, api.listTemplates?.() || []))
    const stillThere = (api.listTemplates?.() || []).some((x) => x.id === t.id)
    setStatus(
      stillThere
        ? `Cleared DB/session copy of “${label}” · seed kept`
        : `Deleted “${label}” · gone from Editor & Automate`,
    )
  }

  async function onCopyTemplate(t) {
    if (!t?.id || !api?.duplicateTemplate) return
    setTplMenuId(null)
    setStatus(`Loading “${t.name || t.id}”…`)
    try {
      await ensureTemplateInEngine(api, t.id, { updatedAt: t.updatedAt })
    } catch (e) {
      setStatus(e.message || 'Failed to load template')
      return
    }
    const suggested = `${t.name || t.id} copy`
    const name = window.prompt('Name for duplicate template', suggested)
    if (name == null || !String(name).trim()) return
    setStatus(`Duplicating “${t.name || t.id}”…`)
    try {
      const existingIds = [
        ...new Set(
          [
            ...dbCatalog.map((x) => x.id),
            ...(api.listTemplates?.() || []).map((x) => x.id),
          ].filter(Boolean),
        ),
      ]
      const res = await api.duplicateTemplate({
        id: t.id,
        name: String(name).trim(),
        category: t.category || formatCategory,
        teamKey: teamOf(t).teamKey,
        teamLabel: teamOf(t).teamLabel,
        existingIds,
      })
      const json = res?.json
      const newId = String(res?.id || json?.id || '').trim()
      if (!newId) throw new Error('Duplicate failed — hard-refresh if engine is old')
      if (newId === t.id) {
        throw new Error('Copy kept the original id — refused to overwrite. Try a different name.')
      }
      json.id = newId
      json.name = res?.name || json.name || String(name).trim()
      const srcTeam = teamOf(t)
      json.teamKey = json.teamKey || srcTeam.teamKey
      json.teamLabel = json.teamLabel || srcTeam.teamLabel
      // Always PUT under the NEW id (never the source)
      const saved = await saveTemplateToDb(json, { id: newId })
      if (saved.id === t.id) {
        throw new Error('DB saved under original id — copy aborted')
      }
      setApiOnline(true)
      markTemplateHydrated(saved.id, saved.updatedAt || Date.now())
      try {
        api.injectRemoteTemplates?.(
          [
            {
              id: saved.id,
              name: json.name,
              category: json.category || 'player',
              teamKey: json.teamKey,
              teamLabel: json.teamLabel,
              frozen: true,
              json: { ...json, id: saved.id },
            },
          ],
          { sync: false },
        )
      } catch (_) {}
      // Lock editor + Save target onto the copy
      setBakeId(saved.id)
      setBakeName(json.name)
      try {
        api.switchTemplate?.(saved.id)
      } catch (_) {}
      const catalogEntry = {
        id: saved.id,
        name: json.name,
        category: json.category || 'player',
        teamKey: json.teamKey || UNASSIGNED_TEAM_KEY,
        teamLabel: json.teamLabel || 'Unassigned',
        frozen: true,
        updatedAt: saved.updatedAt,
      }
      setDbCatalog((prev) => [...prev.filter((x) => x.id !== saved.id), catalogEntry])
      setTemplates(
        mergeTemplateCatalog(
          [...dbCatalog.filter((x) => x.id !== saved.id), catalogEntry],
          api.listTemplates?.() || [],
        ),
      )
      setFormatTeamKey(normalizeTeamKey(json.teamKey))
      setStatus(`Copied “${json.name}” as new id “${saved.id}” (from ${t.id}) · saved to DB`)
    } catch (e) {
      setStatus(e.message || 'Copy failed')
    }
  }

  async function onRenameTemplate(t) {
    setTplMenuId(null)
    setTplMoveTeamOpen(false)
    if (!t?.id) return
    const next = window.prompt('Edit template name', t.name || t.id)
    if (next == null) return
    const name = String(next).trim()
    if (!name) {
      setStatus('Name cannot be empty')
      return
    }
    if (name === (t.name || '')) {
      setStatus('Name unchanged')
      return
    }
    setStatus(`Renaming “${t.name || t.id}”…`)
    try {
      let saved = null
      try {
        saved = await patchTemplateMeta(t.id, { name })
        setApiOnline(true)
      } catch (e) {
        // Not in DB yet (session-only) — still rename in the engine
        if (!/not found/i.test(String(e.message || e))) throw e
      }
      try {
        api?.patchTemplateMeta?.(t.id, { name })
      } catch (_) {}
      const entry = {
        id: t.id,
        name,
        category: t.category || 'player',
        teamKey: teamOf(t).teamKey,
        teamLabel: teamOf(t).teamLabel,
        frozen: t.frozen !== false,
        updatedAt: saved?.updatedAt || t.updatedAt || Date.now(),
      }
      const nextCatalog = dbCatalog.some((x) => x.id === t.id) || saved
        ? [...dbCatalog.filter((x) => x.id !== t.id), entry]
        : dbCatalog
      setDbCatalog(nextCatalog)
      setTemplates(mergeTemplateCatalog(nextCatalog, api.listTemplates?.() || []))
      if (snapshot?.template === t.id || bakeId === t.id) {
        setBakeName(name)
      }
      markTemplateHydrated(t.id, entry.updatedAt)
      setStatus(`Renamed template → “${name}” (id unchanged: ${t.id})`)
    } catch (e) {
      setStatus(e.message || 'Rename failed')
    }
  }

  async function onRenameTeamFolder() {
    if (formatTeamKey === UNASSIGNED_TEAM_KEY) {
      setStatus('Cannot rename Unassigned')
      return
    }
    const currentLabel =
      teamOptions.find((x) => x.teamKey === formatTeamKey)?.teamLabel ||
      normalizeTeamLabel('', formatTeamKey)
    const next = window.prompt('Edit team name', currentLabel)
    if (next == null) return
    const teamLabel = String(next).trim()
    if (!teamLabel) {
      setStatus('Team name cannot be empty')
      return
    }
    if (teamLabel === currentLabel) {
      setStatus('Team name unchanged')
      return
    }
    // Keep teamKey stable so filters/links stay valid — only display label changes.
    const teamKey = formatTeamKey
    const members = [
      ...new Map(
        [...templates, ...dbCatalog]
          .filter((x) => x?.id && teamOf(x).teamKey === teamKey)
          .map((x) => [x.id, x]),
      ).values(),
    ]
    setStatus(
      members.length
        ? `Updating team “${currentLabel}” → “${teamLabel}” (${members.length})…`
        : `Renaming team folder → “${teamLabel}”…`,
    )
    try {
      let ok = 0
      let fail = 0
      for (const t of members) {
        try {
          await patchTemplateMeta(t.id, { teamKey, teamLabel })
          try {
            api?.patchTemplateMeta?.(t.id, { teamKey, teamLabel })
          } catch (_) {}
          ok++
        } catch (_) {
          try {
            api?.patchTemplateMeta?.(t.id, { teamKey, teamLabel })
            ok++
          } catch (__) {
            fail++
          }
        }
      }
      setExtraTeams((prev) => {
        const others = prev.filter((x) => x.teamKey !== teamKey)
        return [...others, { teamKey, teamLabel }]
      })
      try {
        await upsertTeamFolder({ teamKey, teamLabel })
      } catch (_) {}
      const nextCatalog = dbCatalog.map((x) =>
        teamOf(x).teamKey === teamKey ? { ...x, teamKey, teamLabel } : x,
      )
      setDbCatalog(nextCatalog)
      setTemplates(mergeTemplateCatalog(nextCatalog, api.listTemplates?.() || []))
      setApiOnline(true)
      setStatus(
        fail
          ? `Team renamed to “${teamLabel}” · ${ok} ok · ${fail} failed`
          : `Team renamed to “${teamLabel}”`,
      )
    } catch (e) {
      setStatus(e.message || 'Team rename failed')
    }
  }

  async function onSetTemplateTeam(t, dest) {
    setTplMenuId(null)
    setTplMoveTeamOpen(false)
    if (!t?.id || !dest) return
    const teamKey = normalizeTeamKey(dest.teamKey)
    const teamLabel = normalizeTeamLabel(dest.teamLabel, teamKey)
    if (teamOf(t).teamKey === teamKey) {
      setStatus(`Already in “${teamLabel}”`)
      return
    }
    setStatus(`Moving “${t.name || t.id}” to ${teamLabel}…`)
    try {
      await ensureTemplateInEngine(api, t.id, { updatedAt: t.updatedAt, force: true })
      let json = null
      try {
        const row = await fetchDbTemplate(t.id)
        json = row?.json
      } catch (_) {}
      if (!json) {
        const baked = await api.bakeTemplate?.({ id: t.id, name: t.name || t.id, download: false })
        json = baked?.json
      }
      if (!json) throw new Error('Could not load template JSON')
      json = { ...json, id: t.id, name: json.name || t.name || t.id, teamKey, teamLabel }
      const saved = await saveTemplateToDb(json, { id: t.id })
      markTemplateHydrated(saved.id, saved.updatedAt || Date.now())
      const entry = {
        id: saved.id,
        name: json.name,
        category: json.category || t.category || 'player',
        teamKey,
        teamLabel,
        frozen: true,
        updatedAt: saved.updatedAt,
      }
      setDbCatalog((prev) => [...prev.filter((x) => x.id !== saved.id), entry])
      try {
        api.injectRemoteTemplates?.(
          [{ ...entry, json: { ...json, teamKey, teamLabel } }],
          { sync: false },
        )
      } catch (_) {}
      if (api.listTemplates) refreshTemplates()
      setFormatTeamKey(teamKey)
      setStatus(`Moved “${json.name}” → ${teamLabel}`)
    } catch (e) {
      setStatus(e.message || 'Move failed')
    }
  }

  async function onBake(download) {
    if (!api?.bakeTemplate) return
    // Prefer live engine selection (after Copy this is the NEW id), not a stale React snapshot
    const liveId = api.getEditorSnapshot?.()?.template
    const id = String(liveId || bakeId || snapshot?.template || '').trim()
    if (!id) {
      setStatus('No template selected')
      return
    }
    // Keep this template's own display name — never reuse another chip's name
    const listed = (api.listTemplates?.() || []).find((t) => t.id === id)
    const name = listed?.name || snapshot?.templateName || bakeName || id
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
        {
          const teamKey = normalizeTeamKey(
            json.teamKey ||
              snapshot?.teamKey ||
              listed?.teamKey ||
              formatTeamKey ||
              UNASSIGNED_TEAM_KEY,
          )
          const teamLabel = normalizeTeamLabel(
            json.teamLabel || snapshot?.teamLabel || listed?.teamLabel,
            teamKey,
          )
          json.teamKey = teamKey
          json.teamLabel = teamLabel
        }
      }
      if (json && !download) {
        try {
          const saved = await saveTemplateToDb(json, { id })
          setApiOnline(true)
          markTemplateHydrated(saved.id, saved.updatedAt || Date.now())
          setDbCatalog((prev) => {
            const entry = {
              id: saved.id,
              name,
              category: json.category || 'player',
              teamKey: json.teamKey || UNASSIGNED_TEAM_KEY,
              teamLabel: json.teamLabel || 'Unassigned',
              frozen: true,
              updatedAt: saved.updatedAt,
            }
            return [...prev.filter((x) => x.id !== saved.id), entry]
          })
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
                  teamKey: json.teamKey,
                  teamLabel: json.teamLabel,
                  frozen: true,
                  json: {
                    ...json,
                    id: saved.id,
                    name,
                    category: json.category || 'player',
                    teamKey: json.teamKey,
                    teamLabel: json.teamLabel,
                  },
                },
              ],
              { sync: false },
            )
          } catch (_) {}
          if (api.listTemplates) refreshTemplates()
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
      if (api.listTemplates) refreshTemplates()
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
      if (!res?.ok || !res?.cutBg) {
        setCutoutDone(false)
        setStatus(res?.error || 'Background removal failed — check network and try again')
        return null
      }
      setCutoutDone(true)
      if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
      let src = res.src || api.getImageSlot?.('player')?.src
      if (src) src = await persistProcessedImage('player', src)
      if (src) setSmartCrop((s) => (s ? { ...s, src } : s))
      setStatus('Background removed')
      return src || null
    } catch (e) {
      setCutoutDone(false)
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
      if (bake !== false) {
        const src = api.getImageSlot?.(smartCrop.key)?.src
        await persistProcessedImage(smartCrop.key, src)
      }
      setStatus(
        `Fitted ${smartCrop.label.toLowerCase()} to ${smartCrop.frameW}×${smartCrop.frameH}`,
      )
      setSmartCrop(null)
    } catch (e) {
      setStatus(e.message || 'Smart crop failed')
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
          <button
            type="button"
            className="ui-icon-btn"
            title="Undo (Ctrl+Z)"
            disabled={!ready || !snapshot?.canUndo}
            onClick={() => api?.undo?.()}
          >
            Undo
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!ready || !snapshot?.canRedo}
            onClick={() => api?.redo?.()}
          >
            Redo
          </button>
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
          <button
            type="button"
            className="ui-btn"
            title="Pull latest template names from DB (other users' saves)"
            disabled={!ready}
            onClick={async () => {
              setStatus('Refreshing templates…')
              try {
                await pullDbCatalog({ hydrateActive: true, quiet: false })
                setStatus('Templates refreshed from DB')
              } catch (e) {
                setApiOnline(false)
                setStatus('Refresh failed: ' + (e.message || e))
              }
            }}
          >
            Refresh
          </button>
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
                        teamKey: formatTeamKey,
                        teamLabel:
                          teamOptions.find((x) => x.teamKey === formatTeamKey)?.teamLabel ||
                          normalizeTeamLabel('', formatTeamKey),
                      })
                      const id = res?.template?.id
                      if (api.listTemplates) refreshTemplates()
                      const teamLabel =
                        teamOptions.find((x) => x.teamKey === formatTeamKey)?.teamLabel ||
                        normalizeTeamLabel('', formatTeamKey)
                      const catLabel =
                        CATEGORIES.find((c) => c.id === formatCategory)?.label || formatCategory
                      setStatus(
                        id ? `Created “${name}” · ${teamLabel} / ${catLabel}` : 'Create failed',
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
              <div className="mb-2 flex items-center gap-1">
                <select
                  className={`${inputClass} min-w-0 flex-1 py-1.5 text-[11px]`}
                  value={formatTeamKey}
                  onChange={(e) => setFormatTeamKey(normalizeTeamKey(e.target.value))}
                  aria-label="Team folder"
                >
                  {teamOptions.map((t) => (
                    <option key={t.teamKey} value={t.teamKey}>
                      {t.teamLabel}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="Edit team name"
                  disabled={formatTeamKey === UNASSIGNED_TEAM_KEY}
                  className="shrink-0 rounded border border-line px-2 py-1.5 text-[11px] font-semibold text-dim hover:border-blaze hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => onRenameTeamFolder()}
                >
                  Edit
                </button>
                <button
                  type="button"
                  title="New team folder"
                  className="shrink-0 rounded border border-line px-2 py-1.5 text-[11px] font-semibold text-dim hover:border-blaze hover:text-paper"
                  onClick={async () => {
                    const created = promptNewTeam()
                    if (!created) return
                    setExtraTeams((prev) => {
                      if (prev.some((x) => x.teamKey === created.teamKey)) return prev
                      return [...prev, created]
                    })
                    setFormatTeamKey(created.teamKey)
                    try {
                      await upsertTeamFolder(created)
                      setApiOnline(true)
                      setStatus(
                        `Team folder “${created.teamLabel}” saved — use + Add to create templates here`,
                      )
                    } catch (e) {
                      setStatus(
                        `Team “${created.teamLabel}” added locally · DB save failed: ${e.message || e}`,
                      )
                    }
                  }}
                >
                  + Team
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
              <ul className="space-y-0.5">
                {filteredTemplates.map((t) => (
                  <li key={t.id} className="group relative flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={async () => {
                        setTplMenuId(null)
                        setStatus(`Loading “${t.name || t.id}”…`)
                        try {
                          await ensureTemplateInEngine(api, t.id, {
                            updatedAt: t.updatedAt,
                          })
                          refreshTemplates()
                          api?.switchTemplate?.(t.id)
                          setStatus('')
                        } catch (e) {
                          setStatus(e.message || 'Failed to load template')
                        }
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left ${
                        snapshot?.template === t.id
                          ? 'bg-panel2 text-paper'
                          : 'text-dim hover:bg-inset hover:text-paper'
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-inset text-[12px] font-semibold uppercase text-dim">
                        {(t.name || t.id || '?').trim().charAt(0) || '?'}
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
                          setTplMoveTeamOpen(false)
                          setTplMenuId((cur) => (cur === t.id ? null : t.id))
                        }}
                      >
                        ⋮
                      </button>
                      {tplMenuId === t.id ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-30 mt-0.5 min-w-[168px] overflow-hidden rounded-md border border-line bg-panel py-1 shadow-md"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-paper hover:bg-inset"
                            onClick={() => onRenameTemplate(t)}
                          >
                            <span className="w-4 text-center text-[11px] text-dim" aria-hidden>
                              ✎
                            </span>
                            Rename template
                          </button>
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
                            aria-expanded={tplMoveTeamOpen}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-paper hover:bg-inset"
                            onClick={(e) => {
                              e.stopPropagation()
                              setTplMoveTeamOpen((open) => !open)
                            }}
                          >
                            <span className="w-4 text-center text-[11px] text-dim" aria-hidden>
                              ⧉
                            </span>
                            <span className="flex-1">Move to team</span>
                            <span className="text-[10px] text-muted">{tplMoveTeamOpen ? '▾' : '▸'}</span>
                          </button>
                          {tplMoveTeamOpen ? (
                            <div className="max-h-48 overflow-y-auto border-y border-line/80 bg-inset/40 py-0.5">
                              {teamOptions.map((team) => {
                                const current = teamOf(t).teamKey === team.teamKey
                                return (
                                  <button
                                    key={team.teamKey}
                                    type="button"
                                    role="menuitem"
                                    disabled={current}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 pl-8 text-left text-[12px] ${
                                      current
                                        ? 'cursor-default text-muted'
                                        : 'text-paper hover:bg-inset'
                                    }`}
                                    onClick={() => onSetTemplateTeam(t, team)}
                                  >
                                    <span className="min-w-0 flex-1 truncate">{team.teamLabel}</span>
                                    {current ? (
                                      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted">
                                        current
                                      </span>
                                    ) : null}
                                  </button>
                                )
                              })}
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-1.5 pl-8 text-left text-[12px] text-dim hover:bg-inset hover:text-paper"
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  const created = promptNewTeam()
                                  if (!created) return
                                  setExtraTeams((prev) => {
                                    if (prev.some((x) => x.teamKey === created.teamKey)) return prev
                                    return [...prev, created]
                                  })
                                  try {
                                    await upsertTeamFolder(created)
                                  } catch (_) {}
                                  onSetTemplateTeam(t, created)
                                }}
                              >
                                + New team…
                              </button>
                            </div>
                          ) : null}
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
                      ? `No ${CATEGORIES.find((c) => c.id === formatCategory)?.label || ''} templates in this team — + Add`
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
              <LayerList
                layers={layers}
                selectedId={snapshot?.selectedId}
                api={api}
                emptyText={ready ? 'No layers' : 'Loading…'}
              />
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
                        try {
                          const url = await uploadSlotImage(file, slot.key)
                          await api.setImageSlot(slot.key, url)
                          if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
                          if (slot.key === 'player') {
                            await openSmartCropForSlot('player', url, slot.label)
                          }
                        } catch (err) {
                          setStatus(err.message || 'Image upload failed')
                        }
                      }}
                    />
                  </label>
                  {slot.loaded ? (
                    <button
                      type="button"
                      className="text-[11px] text-dim underline decoration-line underline-offset-2 hover:text-paper"
                      title={`Remove ${slot.label}`}
                      onClick={() => {
                        if (!api?.clearImageSlot) return
                        api.clearImageSlot(slot.key)
                        if (api.listImageSlots) setImageSlots(api.listImageSlots() || [])
                        if (slot.key === 'player') {
                          setCutoutDone(false)
                          setSmartCrop(null)
                        }
                        setStatus(`Removed ${slot.label.toLowerCase()}`)
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </Panel>

            <Panel title="Assets">
              <p className="text-[11px] text-muted">
                Library presets removed. Use Shapes below, or upload images (S3).
              </p>
            </Panel>

            <Panel title="Shapes">
              <div className="grid grid-cols-3 gap-1.5">
                {shapePresets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label || p.id}
                    onClick={() => api?.addShape?.(p.id)}
                    className="flex flex-col items-center gap-1 rounded-md border border-line bg-white px-1 py-2 text-paper hover:border-blaze hover:bg-panel2"
                  >
                    {p.icon ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="h-8 w-8 text-paper"
                        aria-hidden
                        dangerouslySetInnerHTML={{ __html: p.icon }}
                      />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center text-[10px] text-muted">
                        ◆
                      </span>
                    )}
                    <span className="truncate text-[10px] text-dim">{p.label || p.id}</span>
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

        {/* Center: optional studio flyout + canvas */}
        <div className="flex min-h-0 min-w-0 overflow-hidden">
          <StudioSidePanel
            mode={studioMode}
            onClose={() => setStudioMode(null)}
            api={api}
            selected={selected}
            layers={layers}
          />
          <main className="ui-canvas-well relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ContextToolbar
              api={api}
              selected={selected}
              layers={layers}
              studioMode={studioMode}
              onStudioMode={setStudioMode}
            />
            {!ready && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/70 text-xs text-dim">
                {error || 'Starting engine…'}
              </div>
            )}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <StageHost iframeRef={iframeRef} src={src} onLoad={onLoad} />
              {status ? (
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-panel/95 px-3.5 py-1.5 text-[11px] text-dim shadow-sm backdrop-blur">
                  {status}
                </div>
              ) : null}
            </div>
          </main>
        </div>

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
