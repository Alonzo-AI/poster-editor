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

export async function listDbTemplates() {
  const res = await fetch(`${API}/templates`)
  const data = await parse(res)
  return data.templates || []
}

/** Alias used by Editor/Automate pages */
export const fetchDbTemplates = listDbTemplates

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

  // PUT by id → overwrite the same Mongo document (create on first save)
  const res = await fetch(`${API}/templates/${encodeURIComponent(tid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return parse(res)
}

/**
 * Pull DB templates into the engine iframe and prune ones deleted from Atlas.
 */
export async function syncDbTemplatesIntoEngine(api) {
  if (!api?.injectRemoteTemplates) return { count: 0, templates: [] }
  const remote = await listDbTemplates()
  return api.injectRemoteTemplates(remote, { sync: true })
}
