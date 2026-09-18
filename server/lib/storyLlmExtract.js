/**
 * LLM story → poster fields extract (Script_Testing rules).
 * Used only by Auto Stories → QA Graphics. Does not touch Editor/Automate/Projects.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_PATH = path.resolve(__dirname, '../../Script_Testing/prompts/extract_fields.txt')
const SAMPLES_PATH = path.resolve(__dirname, '../../Script_Testing/samples/stories.json')

export function storyText(story) {
  return String(
    story?.text ||
      story?.body ||
      story?.story ||
      story?.content ||
      story?.narrative ||
      story?.core_story ||
      '',
  ).trim()
}

/**
 * Split pasted plain text into story objects.
 * Supports:
 *   1. First story…
 *   2. Second story…
 *   1) First…
 * blank-line separated blocks, or one story per non-empty line.
 */
export function parsePlainStories(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim()
  if (!text) return []

  // Numbered list: 1. / 1) / 1: at start of line
  const numbered = text.split(/\n(?=\s*\d+[.)]\s+)/)
  if (numbered.length > 1) {
    const out = []
    for (let i = 0; i < numbered.length; i++) {
      const chunk = numbered[i].trim().replace(/^\s*\d+[.)]\s*/, '').trim()
      if (chunk) out.push({ id: `p${i + 1}`, text: chunk })
    }
    if (out.length) return out
  }

  // Blank-line separated paragraphs
  const paras = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter(Boolean)
  if (paras.length > 1) {
    return paras.map((t, i) => ({ id: `p${i + 1}`, text: t }))
  }

  // One story per non-empty line (only if multiple lines look like full sentences)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length > 1 && lines.every((l) => l.length > 40)) {
    return lines.map((t, i) => ({ id: `p${i + 1}`, text: t }))
  }

  // Single story blob
  return [{ id: 'p1', text }]
}

/** Accept JSON array / {stories} / plain numbered text. */
export function parseStoriesInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const data = JSON.parse(s)
      if (Array.isArray(data)) return data
      if (Array.isArray(data?.stories)) return data.stories
      if (data && typeof data === 'object' && storyText(data)) return [data]
    } catch (_) {
      // fall through to plain text
    }
  }
  return parsePlainStories(s)
}

export function llmStatus() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '').trim()
  const baseUrl = String(
    process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  ).trim()
  const model = String(
    process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
  ).trim()
  return {
    configured: Boolean(apiKey),
    baseUrl,
    model,
    promptExists: fs.existsSync(PROMPT_PATH),
    samplesExists: fs.existsSync(SAMPLES_PATH),
  }
}

function loadPrompt() {
  if (!fs.existsSync(PROMPT_PATH)) {
    const err = new Error(`Extract prompt missing: ${PROMPT_PATH}`)
    err.status = 500
    throw err
  }
  return fs.readFileSync(PROMPT_PATH, 'utf8')
}

export function loadSampleStories() {
  if (!fs.existsSync(SAMPLES_PATH)) {
    const err = new Error('Sample stories file missing')
    err.status = 404
    throw err
  }
  const raw = JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8'))
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.stories)) return raw.stories
  return []
}

function buildLlmPrompt(template, story) {
  const payload = {
    id: story.id || null,
    college: story.college || story.team || null,
    category: story.category || story.entity || null,
    title: story.title || null,
    text: storyText(story),
  }
  if (template.includes('{STORY_JSON}')) {
    return template.replace('{STORY_JSON}', JSON.stringify(payload, null, 2))
  }
  return `${template.trim()}\n\nSTORY_JSON:\n${JSON.stringify(payload, null, 2)}\n`
}

function parseJsonObject(text) {
  const raw = String(text || '').trim()
  try {
    return JSON.parse(raw)
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error('LLM did not return JSON object')
  }
}

function normalizeStoryContext(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  s = s
    .replace(/\bsun belt conference\b/gi, 'SBC')
    .replace(/\bsoutheastern conference\b/gi, 'SEC')
    .replace(/\bamerican athletic conference\b/gi, 'AAC')
    .replace(/\bmountain west conference\b/gi, 'MWC')
    .replace(/\bin the country\b/gi, 'NCAA')
  s = s.replace(
    /\bin a game in the\s+(SBC|SEC|AAC|MWC|NCAA|Big Sky|Pac-12|PFL|Patriot|FCS)\b(?:\s+this season(?:\s+so far)?)?/gi,
    'IN A $1 GAME THIS SEASON',
  )
  s = s.replace(
    /\bin a game in the\s+(SBC|SEC|AAC|MWC|NCAA|Big Sky|Pac-12|PFL|Patriot|FCS)\b/gi,
    'IN A $1 GAME',
  )
  s = s.replace(
    /\bin a\s+(SBC|SEC|AAC|MWC|NCAA|Big Sky|Pac-12|PFL|Patriot|FCS)\s+game(?:\s+this season)?(?:\s+so far)?/gi,
    'IN A $1 GAME THIS SEASON',
  )
  s = s.replace(/\bin the\s+(SBC|SEC|AAC|MWC)\s+this week\b/gi, 'IN THE $1 THIS WEEK')
  s = s.replace(/\bin\s+(SBC|SEC|AAC|MWC)\s+this week\b/gi, 'IN THE $1 THIS WEEK')
  s = s.replace(/\s+so far\b/gi, '')
  return s.replace(/\s+/g, ' ').trim().toUpperCase()
}

function normalizeCombinedStory(story, rank) {
  const full = String(story || '').trim()
  const r = String(rank || '').trim()
  if (r && full.toLowerCase().startsWith(r.toLowerCase())) {
    const rest = full.slice(r.length).trim()
    const ctx = normalizeStoryContext(rest)
    return ctx ? `${r} ${ctx}` : r
  }
  return normalizeStoryContext(full) || full
}

function normalizeCategory(raw) {
  const c = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (c.includes('nostalgia')) return 'nostalgia'
  if (c === 'team') return 'team'
  if (c === 'no_image' || c === 'player_no_image') return 'player_no_image'
  return 'player'
}

/**
 * Call OpenRouter/OpenAI-compatible chat and return mapped extract fields.
 */
export async function extractStoryFields(story) {
  const st = llmStatus()
  if (!st.configured) {
    const err = new Error('OPENROUTER_API_KEY (or OPENAI_API_KEY) not set on API server')
    err.status = 503
    throw err
  }
  const text = storyText(story)
  if (!text) {
    const err = new Error('Story has no text')
    err.status = 400
    throw err
  }
  const apiKey = String(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '').trim()
  const prompt = buildLlmPrompt(loadPrompt(), story)
  const url = `${st.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (/openrouter\.ai/i.test(st.baseUrl)) {
    headers['HTTP-Referer'] =
      process.env.OPENROUTER_REFERER || process.env.PUBLIC_APP_ORIGIN || 'http://127.0.0.1:8518'
    headers['X-Title'] = process.env.OPENROUTER_TITLE || 'Poster Lab Auto Stories'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: st.model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You extract structured poster fields. Reply with a single JSON object only — no markdown fences.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(
      data?.error?.message || data?.error || res.statusText || 'LLM request failed',
    )
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502
    throw err
  }
  const content = data?.choices?.[0]?.message?.content || ''
  const parsed = parseJsonObject(content)

  const rank = String(parsed.rank || '').trim()
  let ctx = String(
    parsed.story_context || parsed.story_qualifier || parsed.context || '',
  ).trim()
  ctx = normalizeStoryContext(ctx)
  let storyLine = ''
  if (rank && ctx) storyLine = `${rank} ${ctx}`.replace(/\s+/g, ' ').trim()
  else if (rank) storyLine = rank
  else if (ctx) storyLine = ctx
  else if (parsed.story) storyLine = normalizeCombinedStory(String(parsed.story).trim(), rank)

  let category = normalizeCategory(parsed.category || story.category || story.entity)
  const college = String(parsed.college || story.college || story.team || '').trim()
  const playerName = String(parsed.player_name || '').trim()
  let name = String(parsed.name || '').trim()
  if (!name) {
    name =
      category === 'team' || (category === 'nostalgia' && !playerName)
        ? college
        : playerName || college
  }

  return {
    category,
    college,
    player_name: playerName,
    class_position: String(parsed.class_position || parsed.class_positon || '').trim(),
    stat_value: String(parsed.stat_value || '').trim(),
    stat_name: String(parsed.stat_name || '').trim(),
    rank,
    story_context: ctx,
    story: storyLine,
    opponent_score: String(parsed.opponent_score || '').trim(),
    name,
    core_story: text,
  }
}

/** Map LLM extract → QA Graphics default column values. */
export function mapExtractToQaRowValues(extracted) {
  const entity = extracted.college || ''
  return {
    game: '',
    opponent_score: extracted.opponent_score || '',
    story_class: extracted.category || '',
    entity,
    core_story: extracted.core_story || '',
    stat_value: extracted.stat_value || '',
    stat_name: extracted.stat_name || '',
    player_name: extracted.player_name || '',
    class_positon: extracted.class_position || '',
    rank: extracted.rank || '',
    story: extracted.story || '',
    final_check: '',
    canva_link: '',
    poster_check: '',
    notes: '',
  }
}

function normalizeTeamKey(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return v || ''
}

/**
 * Extract many stories sequentially (safer for rate limits).
 * Returns { rows, errors } where rows are QA sheet row objects.
 */
export async function extractStoriesToQaRows(stories, { onProgress } = {}) {
  const list = Array.isArray(stories) ? stories : []
  const rows = []
  const errors = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {}
    if (typeof onProgress === 'function') {
      try {
        onProgress({ index: i, total: list.length, id: s.id || null })
      } catch (_) {}
    }
    try {
      const extracted = await extractStoryFields(s)
      const values = mapExtractToQaRowValues(extracted)
      const teamKey = normalizeTeamKey(extracted.college)
      rows.push({
        id: `row_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        teamKey,
        teamLabel: extracted.college || '',
        values,
        sortOrder: i,
      })
    } catch (err) {
      errors.push({
        index: i,
        id: s.id || null,
        error: err.message || String(err),
      })
    }
  }
  return { rows, errors }
}

export { PROMPT_PATH, SAMPLES_PATH }
