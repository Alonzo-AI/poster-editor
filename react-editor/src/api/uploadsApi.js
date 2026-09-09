const API = '/api'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed')
  return data
}

function guessExt(mime, fallback = 'bin') {
  const m = String(mime || '').toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return fallback
}

/**
 * Upload a File/Blob to S3 via the API. Returns a durable https URL for Mongo JSON.
 */
export async function uploadImageToS3(fileOrBlob, { folder = 'uploads', filename } = {}) {
  if (!fileOrBlob) throw new Error('No file to upload')
  const type = fileOrBlob.type || 'application/octet-stream'
  const name =
    filename ||
    fileOrBlob.name ||
    `image-${Date.now()}.${guessExt(type, 'png')}`

  const body = new FormData()
  body.append('file', fileOrBlob, name)
  if (folder) body.append('folder', folder)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  let res
  try {
    res = await fetch(`${API}/uploads`, {
      method: 'POST',
      body,
      signal: controller.signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Image upload timed out')
    throw new Error('Image upload failed: ' + (e.message || e))
  } finally {
    clearTimeout(timer)
  }

  const data = await parse(res)
  if (!data?.url) throw new Error('Upload succeeded but no URL returned')
  return data.url
}

/** Upload a data: or blob: URL to S3 (used after cutout / smart-crop bake). */
export async function uploadDataUrlToS3(dataUrl, { folder = 'uploads', filename } = {}) {
  if (!dataUrl || typeof dataUrl !== 'string') throw new Error('No image data')
  if (isRemoteImageUrl(dataUrl)) return dataUrl
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const ext = guessExt(blob.type, dataUrl.includes('png') ? 'png' : 'jpg')
  return uploadImageToS3(blob, {
    folder,
    filename: filename || `processed-${Date.now()}.${ext}`,
  })
}

/** Prefer S3 for new uploads; fall back to local data URL if API/S3 is down. */
export async function uploadImageOrDataUrl(file, opts = {}) {
  try {
    return { url: await uploadImageToS3(file, opts), via: 's3' }
  } catch (e) {
    console.warn('[upload] S3 failed, using data URL fallback:', e.message || e)
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = reject
      r.readAsDataURL(file)
    })
    return { url, via: 'data', error: e.message || String(e) }
  }
}

export function isRemoteImageUrl(src) {
  const s = String(src || '')
  return /^https?:\/\//i.test(s) || s.startsWith('/api/media/')
}
