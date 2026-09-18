/**
 * One-time migrate: category "nostalgia" → "nostalgia_team"
 * in templates, projects, automate_saves (top-level + nested json).
 *
 * Usage (from server/):
 *   node scripts/migrate-nostalgia-to-nostalgia-team.mjs
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mongoose from 'mongoose'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/narrative_styles'
const dbName = process.env.MONGODB_DB || 'narrative_styles'

async function migrateCollection(db, name) {
  const col = db.collection(name)
  const filter = {
    $or: [
      { category: 'nostalgia' },
      { 'json.category': 'nostalgia' },
      { 'json.settings.category': 'nostalgia' },
    ],
  }
  const before = await col.countDocuments(filter)
  if (!before) {
    console.log(`[${name}] nothing to migrate`)
    return { name, matched: 0, modified: 0 }
  }

  const result = await col.updateMany(filter, [
    {
      $set: {
        category: {
          $cond: [{ $eq: ['$category', 'nostalgia'] }, 'nostalgia_team', '$category'],
        },
        json: {
          $cond: [
            { $eq: [{ $type: '$json' }, 'object'] },
            {
              $mergeObjects: [
                '$json',
                {
                  category: {
                    $cond: [
                      { $eq: ['$json.category', 'nostalgia'] },
                      'nostalgia_team',
                      '$json.category',
                    ],
                  },
                  settings: {
                    $cond: [
                      { $eq: [{ $type: '$json.settings' }, 'object'] },
                      {
                        $mergeObjects: [
                          '$json.settings',
                          {
                            category: {
                              $cond: [
                                { $eq: ['$json.settings.category', 'nostalgia'] },
                                'nostalgia_team',
                                '$json.settings.category',
                              ],
                            },
                          },
                        ],
                      },
                      '$json.settings',
                    ],
                  },
                },
              ],
            },
            '$json',
          ],
        },
        updatedAt: new Date(),
      },
    },
  ])

  console.log(
    `[${name}] matched=${result.matchedCount} modified=${result.modifiedCount} (scanned filter count=${before})`,
  )
  return { name, matched: result.matchedCount, modified: result.modifiedCount }
}

async function main() {
  console.log('[migrate] connecting…', dbName)
  await mongoose.connect(MONGODB_URI, { dbName })
  const db = mongoose.connection.db
  const reports = []
  for (const name of ['templates', 'projects', 'automate_saves']) {
    reports.push(await migrateCollection(db, name))
  }
  // Sanity: leftover nostalgia
  for (const name of ['templates', 'projects', 'automate_saves']) {
    const left = await db.collection(name).countDocuments({
      $or: [
        { category: 'nostalgia' },
        { 'json.category': 'nostalgia' },
        { 'json.settings.category': 'nostalgia' },
      ],
    })
    console.log(`[${name}] remaining nostalgia=${left}`)
  }
  await mongoose.disconnect()
  console.log('[migrate] done', reports)
}

main().catch((err) => {
  console.error('[migrate] failed', err)
  process.exit(1)
})
