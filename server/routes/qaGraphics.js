/**
 * QA Graphics Testing API — additive only.
 * Folders = separate sheets in Postgres. Does not change Editor / Automate / Projects.
 */
import { Router } from 'express'
import {
  addQaColumn,
  addQaRow,
  createQaFolder,
  deleteQaFolder,
  getQaSheet,
  initQaPg,
  listQaFolders,
  qaPgStatus,
  renameQaFolder,
  saveQaSheet,
} from '../lib/qaPg.js'

export function createQaGraphicsRouter() {
  const router = Router()

  router.get('/status', (_req, res) => {
    res.json(qaPgStatus())
  })

  router.post('/connect', async (_req, res) => {
    try {
      const ok = await initQaPg()
      res.status(ok ? 200 : 503).json(qaPgStatus())
    } catch (err) {
      res.status(500).json({ error: err.message || String(err), ...qaPgStatus() })
    }
  })

  router.get('/folders', async (_req, res) => {
    try {
      const data = await listQaFolders()
      res.json(data)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.post('/folders', async (req, res) => {
    try {
      const body = req.body || {}
      const sheet = await createQaFolder({ name: body.name })
      res.status(201).json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.patch('/folders/:id', async (req, res) => {
    try {
      const sheet = await renameQaFolder(req.params.id, req.body?.name)
      res.json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.delete('/folders/:id', async (req, res) => {
    try {
      const result = await deleteQaFolder(req.params.id)
      res.json(result)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.get('/folders/:id', async (req, res) => {
    try {
      const sheet = await getQaSheet(req.params.id)
      res.json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.put('/folders/:id', async (req, res) => {
    try {
      const body = req.body || {}
      const sheet = await saveQaSheet(req.params.id, {
        columns: body.columns,
        rows: body.rows,
        name: body.name,
      })
      res.json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.post('/folders/:id/columns', async (req, res) => {
    try {
      const body = req.body || {}
      const sheet = await addQaColumn(req.params.id, { key: body.key, label: body.label })
      res.status(201).json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  router.post('/folders/:id/rows', async (req, res) => {
    try {
      const body = req.body || {}
      const sheet = await addQaRow(req.params.id, {
        teamKey: body.teamKey,
        teamLabel: body.teamLabel,
        values: body.values,
      })
      res.status(201).json(sheet)
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || String(err), db: qaPgStatus() })
    }
  })

  // Back-compat aliases (single-sheet era) → 410 with hint
  router.get('/sheet', (_req, res) => {
    res.status(410).json({
      error: 'Use GET /api/qa-graphics/folders then GET /api/qa-graphics/folders/:id',
      db: qaPgStatus(),
    })
  })
  router.put('/sheet', (_req, res) => {
    res.status(410).json({
      error: 'Use PUT /api/qa-graphics/folders/:id',
      db: qaPgStatus(),
    })
  })

  return router
}
