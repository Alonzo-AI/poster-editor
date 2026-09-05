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

export async function saveTemplateToDb(json) {
  const res = await fetch(`${API}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json }),
  })
  return parse(res)
}

/**
 * Pull DB templates into the engine iframe and return engine listTemplates().
 */
export async function syncDbTemplatesIntoEngine(api) {
  if (!api?.injectRemoteTemplates) return { count: 0, templates: [] }
  const remote = await listDbTemplates()
  return api.injectRemoteTemplates(remote)
}
