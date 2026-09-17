/**
 * External Stories-portal API — additive only.
 * Does not change /api/templates, /api/projects, Automate, or Editor routes.
 *
 * Auth: Authorization: Bearer <EXTERNAL_API_TOKEN>  or  X-Api-Key: <token>
 * Env:  EXTERNAL_API_TOKEN (required), PUBLIC_APP_ORIGIN (edit deep-links)
 */

import { Router } from 'express'
import crypto from 'crypto'
import {
  parseCollegeBulkInput,
  parseMultiCollegeBulkInput,
  generateBulkPosters,
  generateMultiCollegeBulkPosters,
  createBulkBatchId,
  defaultBulkBatchLabel,
  extractStaticImageUrl,
  normalizeTeamKey,
  normalizeTeamLabel,
} from '../lib/externalBulk.js'

/** In-memory job tracker (batch results also live in Projects DB). */
const jobs = new Map()

function publicAppOrigin() {
  return String(process.env.PUBLIC_APP_ORIGIN || 'http://127.0.0.1:8518').replace(/\/$/, '')
}

function editUrlFor(posterId) {
  return `${publicAppOrigin()}/projects/${encodeURIComponent(posterId)}`
}

function absoluteMediaUrl(req, url) {
  if (!url) return null
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/')) {
    const base = `${req.protocol}://${req.get('host')}`
    return `${base}${url}`
  }
  return url
}

function requireExternalAuth(req, res, next) {
  const expected = String(process.env.EXTERNAL_API_TOKEN || '').trim()
  if (!expected) {
    return res.status(503).json({
      error: 'External API disabled — set EXTERNAL_API_TOKEN in the poster lab server .env',
    })
  }
  const header = String(req.get('authorization') || '')
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const key = String(req.get('x-api-key') || '').trim()
  const got = bearer || key
  if (!got || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API token' })
  }
  return next()
}

function newJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function setJob(jobId, patch) {
  const prev = jobs.get(jobId) || {}
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() }
  jobs.set(jobId, next)
  return next
}

/**
 * @param {{ Template: any, Project: any, TeamFolder: any, upsertProjectJson: Function }} deps
 */
export function createExternalApiRouter(deps) {
  const { Template, Project, TeamFolder, upsertProjectJson } = deps
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'poster-lab-external',
      authConfigured: !!String(process.env.EXTERNAL_API_TOKEN || '').trim(),
      appOrigin: publicAppOrigin(),
    })
  })

  router.use(requireExternalAuth)

  /**
   * POST /api/external/generate
   * Body: {
   *   mode?: "college" | "multi"   (default: college if teamKey, else multi)
   *   teamKey?, teamLabel?,
   *   csv?: string,
   *   rows?: object[],
   *   batchLabel?: string,
   *   async?: boolean              (default true)
   * }
   */
  router.post('/generate', async (req, res) => {
    try {
      const body = req.body || {}
      const csv = body.csv != null ? String(body.csv) : ''
      const rows = Array.isArray(body.rows) ? body.rows : null
      if (!csv.trim() && !(rows && rows.length)) {
        return res.status(400).json({ error: 'Provide csv string or rows[]' })
      }

      const teamKeyIn = body.teamKey || body.college || body.team
      let mode = String(body.mode || '').toLowerCase()
      if (mode !== 'college' && mode !== 'multi') {
        mode = teamKeyIn ? 'college' : 'multi'
      }
      if (mode === 'college' && !teamKeyIn) {
        return res.status(400).json({ error: 'teamKey required for mode=college' })
      }

      const runAsync = body.async !== false
      const batchLabel = defaultBulkBatchLabel(body.batchLabel || body.label || '')
      const jobId = newJobId()

      setJob(jobId, {
        jobId,
        status: 'queued',
        mode,
        progress: { done: 0, ok: 0, skip: 0, fail: 0 },
        createdAt: new Date().toISOString(),
        result: null,
        error: null,
      })

      const run = async () => {
        setJob(jobId, { status: 'running' })
        const templates = await Template.find(
          {},
          { id: 1, name: 1, category: 1, teamKey: 1, teamLabel: 1 },
        ).lean()
        const folders = await TeamFolder.find({}, { teamKey: 1, teamLabel: 1 }).lean()

        const fetchTemplate = async (id) => {
          const row = await Template.findOne({ id: String(id) }).lean()
          if (!row?.json) throw new Error(`Template not found: ${id}`)
          return row
        }
        const saveProject = async (json, meta) => upsertProjectJson(json, meta.id || json.id, meta)

        const onProgress = (ev) => {
          const job = jobs.get(jobId) || {}
          const progress = { ...(job.progress || {}) }
          if (ev?.type === 'ok') {
            progress.done = (progress.done || 0) + 1
            progress.ok = (progress.ok || 0) + 1
          } else if (ev?.type === 'skip') {
            progress.done = (progress.done || 0) + 1
            progress.skip = (progress.skip || 0) + 1
          } else if (ev?.type === 'fail') {
            progress.done = (progress.done || 0) + 1
            progress.fail = (progress.fail || 0) + 1
          }
          setJob(jobId, { progress, lastEvent: ev })
        }

        let parseErrors = []
        let result

        if (mode === 'college') {
          const parsed = parseCollegeBulkInput({
            csv,
            rows,
            teamKey: teamKeyIn,
            teamLabel: body.teamLabel,
          })
          parseErrors = parsed.errors || []
          if (!parsed.records.length) {
            throw new Error(
              parseErrors.length
                ? parseErrors.slice(0, 5).join('; ')
                : 'No valid rows to generate',
            )
          }
          result = await generateBulkPosters({
            records: parsed.records,
            templates,
            teamKey: parsed.teamKey,
            teamLabel: parsed.teamLabel,
            fetchTemplate,
            saveProject,
            onProgress,
            bulkBatchDate: createBulkBatchId(),
            bulkBatchLabel: batchLabel,
            editUrlFor,
          })
        } else {
          const parsed = parseMultiCollegeBulkInput({ csv, rows, templates, folders })
          parseErrors = parsed.errors || []
          if (!parsed.groups.length) {
            throw new Error(
              parseErrors.length
                ? parseErrors.slice(0, 5).join('; ')
                : 'No valid college groups to generate',
            )
          }
          result = await generateMultiCollegeBulkPosters({
            groups: parsed.groups,
            templates,
            fetchTemplate,
            saveProject,
            onProgress,
            bulkBatchDate: parsed.bulkBatchDate,
            bulkBatchLabel: batchLabel,
            editUrlFor,
          })
        }

        const posters = (result.created || []).map((p) => ({
          ...p,
          editUrl: p.editUrl || editUrlFor(p.id),
          staticImageUrl: p.staticImageUrl || null,
        }))

        setJob(jobId, {
          status: 'done',
          parseErrors,
          result: {
            batchId: result.bulkBatchDate,
            batchLabel: result.bulkBatchLabel,
            createdCount: posters.length,
            skippedCount: (result.skipped || []).length,
            failedCount: (result.failed || []).length,
            posters,
            skipped: result.skipped || [],
            failed: result.failed || [],
            colleges: result.colleges || undefined,
            teamKey: result.teamKey,
            teamLabel: result.teamLabel,
          },
        })
      }

      if (runAsync) {
        res.status(202).json({
          ok: true,
          async: true,
          jobId,
          statusUrl: `/api/external/jobs/${encodeURIComponent(jobId)}`,
        })
        setImmediate(() => {
          run().catch((err) => {
            console.error('[external] generate failed', jobId, err)
            setJob(jobId, {
              status: 'error',
              error: err.message || String(err),
            })
          })
        })
        return
      }

      await run()
      const job = jobs.get(jobId)
      if (job?.status === 'error') {
        return res.status(500).json({ ok: false, jobId, error: job.error })
      }
      return res.status(201).json({
        ok: true,
        async: false,
        jobId,
        ...(job?.result || {}),
        parseErrors: job?.parseErrors || [],
      })
    } catch (err) {
      console.error('[external] generate', err)
      res.status(err.status || 500).json({ error: err.message || String(err) })
    }
  })

  /** GET /api/external/jobs/:jobId */
  router.get('/jobs/:jobId', (req, res) => {
    const job = jobs.get(String(req.params.jobId || ''))
    if (!job) return res.status(404).json({ error: 'Job not found (expired or unknown id)' })
    res.json({
      ok: true,
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      parseErrors: job.parseErrors || [],
      result: job.result,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })
  })

  /**
   * GET /api/external/batches/:batchId
   * Lists Projects in a bulk batch (from DB — works after job memory clears).
   */
  router.get('/batches/:batchId', async (req, res) => {
    try {
      const batchId = String(req.params.batchId || '')
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 64)
      if (!batchId) return res.status(400).json({ error: 'batchId required' })

      const rows = await Project.find({ bulkBatchDate: batchId })
        .sort({ createdAt: 1 })
        .lean()
      if (!rows.length) return res.status(404).json({ error: 'Batch not found' })

      const posters = rows.map((r) => {
        const staticImageUrl = extractStaticImageUrl(r.json)
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          teamKey: normalizeTeamKey(r.teamKey),
          teamLabel: normalizeTeamLabel(r.teamLabel, r.teamKey),
          bulkBatchDate: r.bulkBatchDate,
          bulkBatchLabel: r.bulkBatchLabel,
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
          staticImageUrl: absoluteMediaUrl(req, staticImageUrl),
          editUrl: editUrlFor(r.id),
        }
      })

      res.json({
        ok: true,
        batchId,
        batchLabel: rows[0]?.bulkBatchLabel || batchId,
        count: posters.length,
        posters,
      })
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  /** GET /api/external/posters/:id — one project for Stories gallery / edit link */
  router.get('/posters/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '')
        .trim()
        .replace(/[^\w-]+/g, '_')
      if (!id) return res.status(400).json({ error: 'id required' })
      const row = await Project.findOne({ id }).lean()
      if (!row) return res.status(404).json({ error: 'Poster not found' })
      const staticImageUrl = extractStaticImageUrl(row.json)
      res.json({
        ok: true,
        id: row.id,
        name: row.name,
        category: row.category,
        teamKey: normalizeTeamKey(row.teamKey),
        teamLabel: normalizeTeamLabel(row.teamLabel, row.teamKey),
        bulkBatchDate: row.bulkBatchDate || null,
        bulkBatchLabel: row.bulkBatchLabel || null,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        staticImageUrl: absoluteMediaUrl(req, staticImageUrl),
        editUrl: editUrlFor(row.id),
      })
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  return router
}
