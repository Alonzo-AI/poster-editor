const API = '/api/auto-stories'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'Auto Stories API error')
  return data
}

export async function autoStoriesStatus() {
  const res = await fetch(`${API}/status`)
  return parse(res)
}

export async function loadAutoStorySamples() {
  const res = await fetch(`${API}/samples`)
  return parse(res)
}

/**
 * Run LLM extract on stories and create a QA Graphics folder in Postgres.
 * @param {{ folderName: string, stories?: object[], useSamples?: boolean }} payload
 */
export async function runAutoStories(payload) {
  const res = await fetch(`${API}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  return parse(res)
}
