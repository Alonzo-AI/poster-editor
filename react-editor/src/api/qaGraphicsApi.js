const API = '/api/qa-graphics'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'QA Graphics API error')
  return data
}

export async function qaGraphicsStatus() {
  const res = await fetch(`${API}/status`)
  return parse(res)
}

export async function listQaFolders() {
  const res = await fetch(`${API}/folders`)
  return parse(res)
}

export async function createQaFolder(name) {
  const res = await fetch(`${API}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return parse(res)
}

export async function deleteQaFolder(id) {
  const res = await fetch(`${API}/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return parse(res)
}

export async function loadQaSheet(folderId) {
  const res = await fetch(`${API}/folders/${encodeURIComponent(folderId)}`)
  return parse(res)
}

export async function saveQaSheet(folderId, payload) {
  const res = await fetch(`${API}/folders/${encodeURIComponent(folderId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  return parse(res)
}

export const DEFAULT_QA_COLUMNS = [
  { id: 'game', key: 'game', label: 'GAME' },
  { id: 'opponent_score', key: 'opponent_score', label: 'opponent_score' },
  { id: 'story_class', key: 'story_class', label: 'STORY CLASS' },
  { id: 'entity', key: 'entity', label: 'ENTITY' },
  { id: 'core_story', key: 'core_story', label: 'CORE STORY' },
  { id: 'stat_value', key: 'stat_value', label: 'stat_value' },
  { id: 'stat_name', key: 'stat_name', label: 'stat_name' },
  { id: 'player_name', key: 'player_name', label: 'player_name' },
  { id: 'class_positon', key: 'class_positon', label: 'class_positon' },
  { id: 'rank', key: 'rank', label: 'rank' },
  { id: 'story', key: 'story', label: 'story' },
  { id: 'final_check', key: 'final_check', label: 'FINAL CHECK' },
  { id: 'canva_link', key: 'canva_link', label: 'CANVA LINK' },
  { id: 'poster_check', key: 'poster_check', label: 'POSTER CHECK' },
  { id: 'notes', key: 'notes', label: 'NOTES' },
]

export function emptyLocalSheet(name = 'Untitled') {
  return {
    id: 'local',
    name,
    columns: DEFAULT_QA_COLUMNS.map((c) => ({ ...c })),
    rows: [],
    updatedAt: null,
    db: { configured: false, connected: false },
  }
}

export function newLocalRowId() {
  return `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
