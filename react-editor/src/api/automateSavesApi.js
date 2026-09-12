const API = '/api'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'API error')
  return data
}

export async function listAutomateSaves() {
  const res = await fetch(`${API}/automate-saves`)
  const data = await parse(res)
  return data.saves || []
}

export async function fetchAutomateSave(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Automate save id required')
  const res = await fetch(`${API}/automate-saves/${encodeURIComponent(tid)}`)
  return parse(res)
}

export async function saveAutomateSave(
  json,
  { id, name, category, teamKey, teamLabel, sourceTemplateId } = {},
) {
  const payload = json && typeof json === 'object' ? { ...json } : {}
  const tid = String(id || payload.id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Automate save id required')
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
  })

  const res = await fetch(`${API}/automate-saves/${encodeURIComponent(tid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return parse(res)
}

export async function deleteAutomateSave(id) {
  const tid = String(id || '')
    .trim()
    .replace(/[^\w-]+/g, '_')
  if (!tid) throw new Error('Automate save id required')
  const res = await fetch(`${API}/automate-saves/${encodeURIComponent(tid)}`, {
    method: 'DELETE',
  })
  return parse(res)
}
