const API = '/api'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'API error')
  return data
}

export async function listProjects() {
  const res = await fetch(`${API}/projects`)
  const data = await parse(res)
  return data.projects || []
}

export async function fetchProject(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Project id required')
  const res = await fetch(`${API}/projects/${encodeURIComponent(tid)}`)
  return parse(res)
}

export async function saveProject(
  json,
  { id, name, category, teamKey, teamLabel, sourceTemplateId, bulkBatchDate } = {},
) {
  const payload = json && typeof json === 'object' ? { ...json } : {}
  const tid = String(id || payload.id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Project id required')
  payload.id = tid
  if (name) payload.name = name
  if (category) payload.category = category
  if (teamKey) payload.teamKey = teamKey
  if (teamLabel) payload.teamLabel = teamLabel

  const body = JSON.stringify({
    json: payload,
    name: name || payload.name,
    category: category || payload.category,
    teamKey: teamKey || payload.teamKey,
    teamLabel: teamLabel || payload.teamLabel,
    sourceTemplateId: sourceTemplateId || payload._bakeMeta?.sourceTemplate || null,
    bulkBatchDate: bulkBatchDate || payload._bakeMeta?.bulkBatchDate || null,
  })

  const res = await fetch(`${API}/projects/${encodeURIComponent(tid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return parse(res)
}

export async function deleteProject(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Project id required')
  const res = await fetch(`${API}/projects/${encodeURIComponent(tid)}`, { method: 'DELETE' })
  return parse(res)
}
