/**
 * Auto Stories → LLM extract → QA Graphics folder.
 * Additive only — does not change Editor / Automate / Projects routes.
 */
import { Router } from 'express'
import {
  extractStoriesToQaRows,
  llmStatus,
  loadSampleStories,
  parsePlainStories,
  parseStoriesInput,
  storyText,
} from '../lib/storyLlmExtract.js'
import {
  createQaFolder,
  DEFAULT_QA_COLUMNS,
  qaPgStatus,
  saveQaSheet,
} from '../lib/qaPg.js'

function normalizeStoriesInput(body) {
  if (Array.isArray(body?.stories)) return body.stories
  if (Array.isArray(body)) return body
  if (typeof body?.rawText === 'string' && body.rawText.trim()) {
    return parseStoriesInput(body.rawText)
  }
  if (typeof body?.plainText === 'string' && body.plainText.trim()) {
    return parsePlainStories(body.plainText)
  }
  if (body && typeof body === 'object' && storyText(body)) return [body]
  return []
}

export function createAutoStoriesRouter() {
  const router = Router()

  router.get('/status', (_req, res) => {
    res.json({
      llm: llmStatus(),
      postgres: qaPgStatus(),
    })
  })

  router.get('/samples', (_req, res) => {
    try {
      const stories = loadSampleStories()
      res.json({ stories, count: stories.length })
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err) })
    }
  })

  /**
   * POST /api/auto-stories/run
   * body: { folderName, stories: [{ text, college, ... }] }
   * Runs LLM on each story, creates a QA folder, saves rows to Postgres.
   */
  router.post('/run', async (req, res) => {
    try {
      const pg = qaPgStatus()
      if (!pg.connected) {
        return res.status(503).json({
          error: 'Postgres not connected — set DB_* and restart API',
          postgres: pg,
          llm: llmStatus(),
        })
      }
      const llm = llmStatus()
      if (!llm.configured) {
        return res.status(503).json({
          error: 'OPENROUTER_API_KEY not set on API server',
          postgres: pg,
          llm,
        })
      }

      const body = req.body || {}
      let stories = normalizeStoriesInput(body)
      if (body.useSamples === true && !stories.length) {
        stories = loadSampleStories()
      }
      stories = stories.filter((s) => storyText(s))
      if (!stories.length) {
        return res.status(400).json({
          error: 'No stories with text. Pass stories[] or useSamples:true',
        })
      }

      const folderName =
        String(body.folderName || body.name || '').trim() ||
        `Auto stories ${new Date().toISOString().slice(0, 10)}`

      const { rows, errors } = await extractStoriesToQaRows(stories)
      if (!rows.length) {
        return res.status(422).json({
          error: 'LLM extracted zero rows',
          errors,
          llm,
          postgres: pg,
        })
      }

      const created = await createQaFolder({ name: folderName })
      const saved = await saveQaSheet(created.id, {
        name: folderName,
        columns: created.columns?.length ? created.columns : DEFAULT_QA_COLUMNS,
        rows,
      })

      res.status(201).json({
        ok: true,
        folderId: saved.id,
        folderName: saved.name,
        rowCount: saved.rows?.length || 0,
        extracted: rows.length,
        failed: errors.length,
        errors,
        sheet: saved,
      })
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message || String(err),
        llm: llmStatus(),
        postgres: qaPgStatus(),
      })
    }
  })

  return router
}
