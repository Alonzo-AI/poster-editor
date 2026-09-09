/**
 * Upload a tiny sample image to S3 to verify credentials + bucket permissions.
 *
 * Usage (from server/):
 *   node scripts/upload-s3-sample.mjs
 *
 * Optional env:
 *   CLEANUP=1     -> delete the uploaded object after verification
 *   S3_KEY_PREFIX -> defaults to "healthcheck/"
 */

import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(serverDir, '.env') })

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  S3_BUCKET,
} = process.env

const CLEANUP = process.env.CLEANUP === '1'
const S3_KEY_PREFIX = (process.env.S3_KEY_PREFIX || 'healthcheck/').replace(/^\/*/, '').replace(/\/?$/, '/')

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in server/.env`)
    process.exit(1)
  }
}

requireEnv('AWS_ACCESS_KEY_ID')
requireEnv('AWS_SECRET_ACCESS_KEY')
requireEnv('AWS_REGION')
requireEnv('S3_BUCKET')

// Tiny 1x1 transparent PNG (used only for credential/bucket verification).
const samplePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+q3YQAAAAASUVORK5CYII='
const sampleBody = Buffer.from(samplePngBase64, 'base64')

const keySuffix = crypto.randomBytes(6).toString('hex')
const objectKey = `${S3_KEY_PREFIX}sample-${Date.now()}-${keySuffix}.png`

const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
})

console.log('=== S3 credential verification ===')
console.log(`Bucket: ${S3_BUCKET}`)
console.log(`Region: ${AWS_REGION}`)
console.log(`Key:    ${objectKey}`)

// 1) Upload
await s3.send(
  new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: objectKey,
    Body: sampleBody,
    ContentType: 'image/png',
  }),
)

// 2) Verify
const head = await s3.send(
  new HeadObjectCommand({
    Bucket: S3_BUCKET,
    Key: objectKey,
  }),
)

console.log('Upload + HeadObject: OK')
console.log(`ETag: ${head.ETag || '(no ETag)'}`)
console.log(`Size: ${head.ContentLength ?? '(unknown)'} bytes`)

// 3) Print likely public URL (may not work if bucket is private / policy blocks public access)
const encodedKey = encodeURIComponent(objectKey).replace(/%2F/g, '/')
const publicUrl =
  AWS_REGION === 'us-east-1'
    ? `https://${S3_BUCKET}.s3.amazonaws.com/${encodedKey}`
    : `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodedKey}`

console.log(`Likely URL: ${publicUrl}`)

if (CLEANUP) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: objectKey,
    }),
  )
  console.log('Cleanup: deleted uploaded object.')
}

console.log('Done.')

