#!/usr/bin/env node
/**
 * Standalone: stories → poster bulk CSV (test harness).
 * Folder: Script_Testing — does not import or change poster-editor app code.
 *
 * Usage:
 *   node extract_stories_to_csv.mjs --mode deterministic --stories samples/stories.json --out out/d.csv
 *   node extract_stories_to_csv.mjs --mode llm --stories samples/stories.json --prompt prompts/extract_fields.txt --out out/llm.csv
 *   node extract_stories_to_csv.mjs --mode both --stories samples/stories.json --out out/compare
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CSV_HEADERS = [
  'college',
  'category',
  'name',
  'player_name',
  'stat_name',
  'stat_value',
  'rank',
  'story',
  'class_position',
  'opponent_score',
]

const EMPTY_ROW = Object.fromEntries(CSV_HEADERS.map((h) => [h, '']))

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 0) continue
    const k = s.slice(0, i).trim()
    let v = s.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

function parseArgs(argv) {
  const out = {
    mode: 'deterministic',
    stories: path.join(__dirname, 'samples/stories.json'),
    prompt: path.join(__dirname, 'prompts/extract_fields.txt'),
    out: null, // set per-mode so llm does not overwrite deterministic
    outSet: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--mode' && next) {
      out.mode = String(next).toLowerCase()
      i++
    } else if (a === '--stories' && next) {
      out.stories = path.resolve(next)
      i++
    } else if (a === '--prompt' && next) {
      out.prompt = path.resolve(next)
      i++
    } else if (a === '--out' && next) {
      out.out = path.resolve(next)
      out.outSet = true
      i++
    } else if (a === '--help' || a === '-h') {
      out.help = true
    }
  }
  return out
}

function defaultOutPath(mode) {
  if (mode === 'llm') return path.join(__dirname, 'out/llm.csv')
  if (mode === 'both') return path.join(__dirname, 'out/compare')
  return path.join(__dirname, 'out/deterministic.csv')
}

function csvEscape(v) {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function rowsToCsv(rows) {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push(CSV_HEADERS.map((h) => csvEscape(r[h] ?? '')).join(','))
  }
  return lines.join('\n') + '\n'
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function loadStories(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(raw)
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.stories)) return data.stories
  throw new Error('stories file must be a JSON array or { stories: [...] }')
}

function storyText(story) {
  return String(
    story.text || story.body || story.story || story.content || story.narrative || '',
  ).trim()
}

function titleCaseWords(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Heuristic extractor — no LLM. Good baseline for clear “N yards/points” copy. */
export function extractDeterministic(story) {
  const text = storyText(story)
  const row = { ...EMPTY_ROW }

  row.college = String(story.college || story.team || story.school || '').trim()
  row.category = String(story.category || 'player').trim() || 'player'
  if (row.category === 'no image' || row.category === 'no_image') row.category = 'player_no_image'

  // Pass-through if already structured
  for (const h of CSV_HEADERS) {
    if (story[h] != null && String(story[h]).trim()) row[h] = String(story[h]).trim()
  }

  // Class | Position  e.g. Senior running back / Jr. guard
  const classPos = text.match(
    /\b(Freshman|Sophomore|Junior|Senior|Fr\.?|So\.?|Jr\.?|Sr\.?)\b[^.\n]{0,40}?\b(QB|RB|WR|TE|LB|DB|DE|DT|OL|G|F|C|PG|SG|SF|PF|P|K|S)\b/i,
  )
  if (classPos && !row.class_position) {
    const cls = classPos[1]
    const pos = classPos[2].toUpperCase()
    const clsNorm = /^(Fr|So|Jr|Sr)\.?$/i.test(cls)
      ? cls.replace(/\./, '')
      : cls.charAt(0).toUpperCase() + cls.slice(1).toLowerCase()
    row.class_position = `${clsNorm} | ${pos}`
  }

  // Player: "… back NAME NAME …" or "guard NAME NAME"
  const nameAfterRole = text.match(
    /\b(?:running back|wide receiver|quarterback|point guard|guard|forward|center|pitcher|catcher)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\b/,
  )
  const nameLed = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,2})\s+(?:rushed|threw|scored|poured|finished|had|recorded)\b/)
  if (!row.player_name) {
    row.player_name = (nameAfterRole?.[1] || nameLed?.[1] || '').trim()
  }

  // Stat patterns (first strong match wins)
  const patterns = [
    { re: /(?:rushed for|rushing)\s+(?:a\s+)?(?:career-high\s+)?(\d+(?:\.\d+)?)\s+yards?/i, name: 'Rushing Yards', valueFrom: 1 },
    { re: /(?:threw for|passing)\s+(?:a\s+)?(?:career-high\s+)?(\d+(?:\.\d+)?)\s+yards?/i, name: 'Passing Yards', valueFrom: 1 },
    { re: /(?:poured in|scored|finished with)\s+(\d+(?:\.\d+)?)\s+points?/i, name: 'Points', valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(rushing\s+yards?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(passing\s+yards?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(receiving\s+yards?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(points?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(rebounds?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(assists?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(receptions?)/i, nameFrom: 2, valueFrom: 1 },
    { re: /(\d+(?:\.\d+)?)\s+(touchdowns?|TDs?)/i, nameFrom: 2, valueFrom: 1 },
  ]

  if (!row.stat_value || !row.stat_name) {
    for (const p of patterns) {
      const m = text.match(p.re)
      if (!m) continue
      row.stat_value = row.stat_value || String(m[p.valueFrom])
      row.stat_name =
        row.stat_name ||
        (p.name ? p.name : titleCaseWords(String(m[p.nameFrom] || '').replace(/s$/i, (x) => (x.length > 1 ? x.slice(0, -1) : x))))
      // Fix plurals → nicer labels
      row.stat_name = row.stat_name
        .replace(/\bYards\b/i, 'Yards')
        .replace(/\bPoints\b/i, 'Points')
        .replace(/\bTouchdown\b/i, 'Touchdowns')
      break
    }
  }

  // Scoreline: beat X 31-24 / 74-68 win
  const score =
    text.match(/\b(?:beat|defeated|past)\s+([A-Za-z0-9 .'-]{2,40}?)\s+(\d{1,3}-\d{1,3})\b/i) ||
    text.match(/\b(\d{1,3}-\d{1,3})\s+win\s+over\s+([A-Za-z][A-Za-z0-9 .'-]{1,40}?)\b/i)
  if (!row.opponent_score && score) {
    if (/win\s+over/i.test(score[0])) {
      row.opponent_score = `vs. ${score[2].trim().replace(/\.$/, '')} | ${score[1]}`
    } else {
      row.opponent_score = `vs. ${score[1].trim().replace(/\.$/, '')} | ${score[2]}`
    }
  }

  // Short story line for poster (not full article)
  if (!row.story) {
    const punch = text.match(/\b(career-high|season-high|game-high|double-double|hat trick)[^.]{0,60}/i)
    if (punch) row.story = punch[0].trim().replace(/\s+/g, ' ').slice(0, 80)
    else if (row.player_name && row.stat_value && row.stat_name) {
      row.story = `${row.player_name.split(' ').pop()} · ${row.stat_value} ${row.stat_name}`
    } else {
      row.story = text.split(/[.!?]/)[0]?.trim().slice(0, 80) || ''
    }
  }

  row.name = row.name || row.player_name || String(story.title || story.id || '').trim()
  return row
}

function buildLlmPrompt(template, story) {
  const payload = {
    id: story.id || null,
    college: story.college || story.team || null,
    category: story.category || null,
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

async function extractWithLlm(story, promptTemplate, cfg) {
  const prompt = buildLlmPrompt(promptTemplate, story)
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  }
  // OpenRouter optional ranking headers (ignored by plain OpenAI-compatible hosts)
  if (/openrouter\.ai/i.test(cfg.baseUrl)) {
    headers['HTTP-Referer'] = cfg.referer || 'https://localhost/poster-lab-script-testing'
    headers['X-Title'] = cfg.title || 'Poster Lab Script_Testing'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
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
    throw new Error(data?.error?.message || data?.error || res.statusText || 'LLM request failed')
  }
  const content = data?.choices?.[0]?.message?.content || ''
  const parsed = parseJsonObject(content)
  const row = { ...EMPTY_ROW }
  for (const h of CSV_HEADERS) {
    if (parsed[h] != null) row[h] = String(parsed[h]).trim()
  }

  // Sheet rule: poster story = rank + story_context (LLM returns them split)
  const rank = String(parsed.rank || row.rank || '').trim()
  const ctx = String(
    parsed.story_context || parsed.story_qualifier || parsed.context || '',
  ).trim()
  if (rank) row.rank = rank
  if (rank && ctx) {
    row.story = `${rank} ${ctx}`.replace(/\s+/g, ' ').trim()
  } else if (rank && !row.story) {
    row.story = rank
  } else if (ctx && !row.story) {
    row.story = ctx
  } else if (parsed.story != null && String(parsed.story).trim()) {
    // If model already combined into story, keep it
    row.story = String(parsed.story).trim()
  }

  // Prefer story college/category if LLM left blank
  if (!row.college) row.college = String(story.college || story.team || '').trim()
  if (!row.category) {
    const ent = String(story.entity || story.category || parsed.category || 'player')
      .trim()
      .toLowerCase()
    row.category = ent === 'team' ? 'team' : 'player'
  }
  if (!row.name) {
    row.name =
      row.category === 'team'
        ? row.college || String(story.title || story.id || '').trim()
        : row.player_name || String(story.title || story.id || '').trim()
  }
  return row
}

async function runMode(mode, stories, opts) {
  const rows = []
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]
    process.stderr.write(`[${mode}] ${i + 1}/${stories.length} ${s.id || s.college || ''}…\n`)
    if (mode === 'deterministic') {
      rows.push(extractDeterministic(s))
    } else {
      rows.push(await extractWithLlm(s, opts.promptText, opts.llm))
    }
  }
  return rows
}

function printHelp() {
  console.log(`Story → poster CSV tester (Script_Testing only)

Options:
  --mode deterministic|llm|both   (default: deterministic)
  --stories <path.json>           (default: samples/stories.json)
  --prompt <path.txt>             (default: prompts/extract_fields.txt)
  --out <path.csv|prefix>         (default: out/deterministic.csv or out/llm.csv;
                                   both → out/compare_deterministic.csv + out/compare_llm.csv)

Env (.env): OPENROUTER_API_KEY (or OPENAI_API_KEY), OPENROUTER_BASE_URL, OPENROUTER_MODEL
`)
}

async function main() {
  loadDotEnv(path.join(__dirname, '.env'))
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }
  if (!['deterministic', 'llm', 'both'].includes(args.mode)) {
    throw new Error(`Invalid --mode ${args.mode}`)
  }
  if (!args.outSet) args.out = defaultOutPath(args.mode)

  const stories = loadStories(args.stories)
  if (!stories.length) throw new Error('No stories found')

  // Prefer OpenRouter; fall back to OpenAI-compatible env names
  const llm = {
    apiKey:
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '',
    baseUrl:
      process.env.OPENROUTER_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://openrouter.ai/api/v1',
    model:
      process.env.OPENROUTER_MODEL ||
      process.env.OPENAI_MODEL ||
      'openai/gpt-4o-mini',
    referer: process.env.OPENROUTER_REFERER || '',
    title: process.env.OPENROUTER_TITLE || 'Poster Lab Script_Testing',
  }
  let promptText = ''
  if (args.mode === 'llm' || args.mode === 'both') {
    if (!llm.apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY required for llm/both (see .env.example). OPENAI_API_KEY also accepted.',
      )
    }
    if (!fs.existsSync(args.prompt)) throw new Error(`Prompt file missing: ${args.prompt}`)
    promptText = fs.readFileSync(args.prompt, 'utf8')
  }

  if (args.mode === 'both') {
    const base = args.out.endsWith('.csv') ? args.out.replace(/\.csv$/i, '') : args.out
    const detPath = `${base}_deterministic.csv`
    const llmPath = `${base}_llm.csv`
    const detRows = await runMode('deterministic', stories, { promptText, llm })
    const llmRows = await runMode('llm', stories, { promptText, llm })
    ensureDirFor(detPath)
    ensureDirFor(llmPath)
    fs.writeFileSync(detPath, rowsToCsv(detRows), 'utf8')
    fs.writeFileSync(llmPath, rowsToCsv(llmRows), 'utf8')
    console.log(`Wrote ${detPath}`)
    console.log(`Wrote ${llmPath}`)
    console.log(`Compare the two CSVs, then paste your final prompt into prompts/extract_fields.txt`)
    return
  }

  const rows = await runMode(args.mode, stories, { promptText, llm })
  ensureDirFor(args.out)
  fs.writeFileSync(args.out, rowsToCsv(rows), 'utf8')
  console.log(`Wrote ${args.out} (${rows.length} rows)`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
