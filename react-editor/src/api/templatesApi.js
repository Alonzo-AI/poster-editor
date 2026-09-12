const API = '/api'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'API error')
  return data
}

export async function apiHealth() {
  const res = await fetch(`${API}/health`)
  return parse(res)
}

/** Lite list = ids/names only. Pass { lite:false } only when you truly need every full JSON. */
export async function listDbTemplates({ lite = true } = {}) {
  const q = lite ? '?lite=1' : ''
  const res = await fetch(`${API}/templates${q}`)
  const data = await parse(res)
  return data.templates || []
}

/** Alias used by Editor/Automate pages */
export const fetchDbTemplates = listDbTemplates

/** Persisted team folders (including empty). */
export async function listTeamFolders() {
  const res = await fetch(`${API}/teams`)
  const data = await parse(res)
  return data.teams || []
}

export async function upsertTeamFolder({ teamKey, teamLabel } = {}) {
  const key = String(teamKey || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!key || key === '__unassigned__') throw new Error('Invalid team folder')
  const res = await fetch(`${API}/teams/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamKey: key, teamLabel: teamLabel || key }),
  })
  const data = await parse(res)
  return data.team || { teamKey: key, teamLabel: teamLabel || key }
}

/**
 * Merge Mongo name catalog + engine list so DB names never flicker away
 * when the iframe temporarily only knows disk templates.
 *
 * opts.dbAuthority — Automate mode: list = Mongo ids only (no engine ghosts /
 * deleted remotes / stale Unassigned leftovers). Engine still supplies fields/images.
 */
export function mergeTemplateCatalog(dbLite = [], engineList = [], opts = {}) {
  const dbAuthority = !!opts.dbAuthority
  const engineById = new Map()
  for (const t of engineList || []) {
    if (!t?.id) continue
    engineById.set(t.id, t)
  }

  const map = new Map()

  if (!dbAuthority) {
    for (const t of engineList || []) {
      if (!t?.id) continue
      map.set(t.id, { ...t, fromDb: false })
    }
  }

  for (const t of dbLite || []) {
    if (!t?.id) continue
    const prev = map.get(t.id) || engineById.get(t.id) || {}
    // Prefer Mongo college/category when the row exists in DB (never keep stale engine teamKey)
    const teamKey = t.teamKey || '__unassigned__'
    const teamLabel = t.teamLabel || (teamKey === '__unassigned__' ? 'Unassigned' : t.teamLabel) || 'Unassigned'
    map.set(t.id, {
      ...prev,
      id: t.id,
      name: t.name || prev.name || t.id,
      category: t.category || prev.category || 'player',
      teamKey,
      teamLabel: t.teamLabel || prev.teamLabel || teamLabel,
      frozen: t.frozen !== false,
      disk: !!prev.disk,
      fields: prev.fields || [],
      // Prefer hydrated engine slots over a sticky empty [] from a prior lite merge
      images:
        (engineById.get(t.id)?.images?.length
          ? engineById.get(t.id).images
          : null) ||
        (prev.images?.length ? prev.images : null) ||
        [],
      automation: prev.automation || null,
      fromDb: true,
      updatedAt: t.updatedAt || prev.updatedAt,
    })
  }

  return [...map.values()].sort((a, b) => {
    const af = a.frozen ? 0 : 1
    const bf = b.frozen ? 0 : 1
    if (af !== bf) return af - bf
    return String(a.name || a.id).localeCompare(String(b.name || b.id))
  })
}

/** One full template document from Mongo (includes baked images). */
export async function fetchDbTemplate(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Template id required')
  const res = await fetch(`${API}/templates/${encodeURIComponent(tid)}`)
  const row = await parse(res)
  const json = row?.json && typeof row.json === 'object' ? { ...row.json } : null
  if (!json) throw new Error('Template JSON missing')
  json.id = row.id || json.id || tid
  json.name = row.name || json.name || json.id
  json.category = row.category || json.category || 'player'
  json.teamKey = row.teamKey || json.teamKey || '__unassigned__'
  json.teamLabel = row.teamLabel || json.teamLabel || 'Unassigned'
  delete json._remoteLite
  return {
    id: json.id,
    name: json.name,
    category: json.category,
    teamKey: json.teamKey,
    teamLabel: json.teamLabel,
    frozen: row.frozen !== false,
    updatedAt: row.updatedAt,
    json,
  }
}

export async function saveTemplateToDb(json, { id } = {}) {
  const payload = json && typeof json === 'object' ? { ...json } : {}
  if (id) payload.id = id
  const tid = String(payload.id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Template id required')

  let body
  try {
    body = JSON.stringify({ json: { ...payload, id: tid } })
  } catch (e) {
    throw new Error('Template JSON is not serializable: ' + (e.message || e))
  }
  const mb = body.length / (1024 * 1024)
  if (mb > 15) {
    throw new Error(
      `Template is ${mb.toFixed(1)}MB (Mongo max 16MB). Clear large baked images or use Download.`,
    )
  }

  const controller = new AbortController()
  // Max wait for Save (not a pre-delay). Keep enough headroom for ~4MB templates on Atlas.
  const timer = setTimeout(() => controller.abort(), 60000)
  let res
  try {
    res = await fetch(`${API}/templates/${encodeURIComponent(tid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error('Save timed out talking to DB (large template). Try again.')
    }
    throw new Error('Save failed to reach API: ' + (e.message || e))
  } finally {
    clearTimeout(timer)
  }
  return parse(res)
}

/** Metadata-only: rename template or update team folder label (no layout rewrite). */
export async function patchTemplateMeta(id, patch = {}) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Template id required')
  const body = {}
  if (patch.name != null) body.name = String(patch.name).trim()
  if (patch.teamKey != null) body.teamKey = patch.teamKey
  if (patch.teamLabel != null) body.teamLabel = patch.teamLabel
  const res = await fetch(`${API}/templates/${encodeURIComponent(tid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse(res)
}

/** Remove one template from Atlas. 404 = already gone (ok). */
export async function deleteTemplateFromDb(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Template id required')
  const res = await fetch(`${API}/templates/${encodeURIComponent(tid)}`, {
    method: 'DELETE',
  })
  if (res.status === 404) return { ok: true, missing: true }
  return parse(res)
}

function isLiteInEngine(api, id) {
  try {
    const snap = api.listTemplates?.()?.find((x) => x.id === id)
    if (!snap) return true
    if (snap.disk) return false
    const fields = snap.fields?.length || 0
    const images = snap.images?.length || 0
    return fields === 0 && images === 0
  } catch {
    return true
  }
}

/** updatedAt string of the full JSON last injected per template id */
const hydratedUpdatedAt = new Map()

function stampUpdatedAt(id, updatedAt) {
  if (!id || updatedAt == null) return
  hydratedUpdatedAt.set(id, String(updatedAt))
}

/**
 * Pull DB template *metadata* into the engine (fast). Full JSON loads on demand.
 * Pass { remote } to reuse an already-fetched lite list (avoids a second round-trip).
 */
export async function syncDbTemplatesIntoEngine(api, { remote: remoteIn } = {}) {
  if (!api?.injectRemoteTemplates) return { count: 0, templates: [], remote: [] }
  const remote = remoteIn || (await listDbTemplates({ lite: true }))
  const stubs = remote.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category || 'player',
    teamKey: t.teamKey || '__unassigned__',
    teamLabel: t.teamLabel || 'Unassigned',
    frozen: t.frozen !== false,
    updatedAt: t.updatedAt,
    json: {
      id: t.id,
      name: t.name || t.id,
      category: t.category || 'player',
      teamKey: t.teamKey || '__unassigned__',
      teamLabel: t.teamLabel || 'Unassigned',
      layers: [],
      canvas: { background: '#000' },
      settings: { freezeLayout: true },
      _remoteLite: true,
    },
  }))
  const injected = api.injectRemoteTemplates(stubs, { sync: true })
  return { ...injected, remote }
}

/**
 * Fetch full Mongo JSON for one id and inject.
 * Re-fetches when another user changed updatedAt, or when only a lite stub is present.
 */
export async function ensureTemplateInEngine(api, id, { updatedAt = null, force = false } = {}) {
  if (!api?.injectRemoteTemplates || !id) return null
  const want = updatedAt != null ? String(updatedAt) : null
  const have = hydratedUpdatedAt.get(id)
  const needsHydrate = isLiteInEngine(api, id)
  const isStale = !!(want && have && want !== have)
  const neverStamped = !!(want && !have && !needsHydrate)
  if (!force && !needsHydrate && !isStale && !neverStamped) return null
  const row = await fetchDbTemplate(id)
  api.injectRemoteTemplates([row], { sync: false })
  stampUpdatedAt(id, row.updatedAt || want || Date.now())
  return row
}

/** After local Save/Copy — mark this id as matching the just-written DB version. */
export function markTemplateHydrated(id, updatedAt = Date.now()) {
  stampUpdatedAt(id, updatedAt)
}
