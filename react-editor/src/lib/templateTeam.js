/** Team folder metadata for templates (separate from category). */

export const UNASSIGNED_TEAM_KEY = '__unassigned__'
export const UNASSIGNED_TEAM_LABEL = 'Unassigned'

export function normalizeTeamKey(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!v || v === 'unassigned' || v === 'none' || v === 'null') return UNASSIGNED_TEAM_KEY
  return v
}

export function normalizeTeamLabel(raw, key = UNASSIGNED_TEAM_KEY) {
  const k = normalizeTeamKey(key)
  if (k === UNASSIGNED_TEAM_KEY) return UNASSIGNED_TEAM_LABEL
  const label = String(raw ?? '').trim()
  if (label) return label
  return k
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function teamOf(t) {
  const key = normalizeTeamKey(t?.teamKey ?? t?.json?.teamKey)
  const label = normalizeTeamLabel(t?.teamLabel ?? t?.json?.teamLabel, key)
  return { teamKey: key, teamLabel: label }
}

/** Unique teams from a template list, Unassigned first, then A–Z by label. */
export function collectTeamOptions(templates = []) {
  const map = new Map()
  map.set(UNASSIGNED_TEAM_KEY, UNASSIGNED_TEAM_LABEL)
  for (const t of templates || []) {
    const { teamKey, teamLabel } = teamOf(t)
    if (!map.has(teamKey) || (teamKey !== UNASSIGNED_TEAM_KEY && teamLabel)) {
      map.set(teamKey, teamLabel)
    }
  }
  return [...map.entries()]
    .map(([teamKey, teamLabel]) => ({ teamKey, teamLabel }))
    .sort((a, b) => {
      if (a.teamKey === UNASSIGNED_TEAM_KEY) return -1
      if (b.teamKey === UNASSIGNED_TEAM_KEY) return 1
      return a.teamLabel.localeCompare(b.teamLabel)
    })
}

export function promptNewTeam() {
  const label = window.prompt('New team folder name', '')
  if (label == null || !String(label).trim()) return null
  const teamLabel = String(label).trim()
  const teamKey = normalizeTeamKey(teamLabel)
  if (teamKey === UNASSIGNED_TEAM_KEY) return null
  return { teamKey, teamLabel: normalizeTeamLabel(teamLabel, teamKey) }
}

/** Persist Formats college filter across refresh (Editor / Automate). */
export const EDITOR_FORMAT_TEAM_LS = 'poster.editor.formatTeamKey'
export const AUTOMATE_FORMAT_TEAM_LS = 'poster.automate.formatTeamKey'

export function readStoredTeamKey(storageKey, fallback = UNASSIGNED_TEAM_KEY) {
  try {
    const v = localStorage.getItem(storageKey)
    if (v == null || !String(v).trim()) return fallback
    return normalizeTeamKey(v)
  } catch (_) {
    return fallback
  }
}

export function writeStoredTeamKey(storageKey, teamKey) {
  try {
    localStorage.setItem(storageKey, normalizeTeamKey(teamKey))
  } catch (_) {}
}
