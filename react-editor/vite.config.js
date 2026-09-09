import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const portalRoot = path.resolve(__dirname, '..')

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function portalStaticPlugin() {
  return {
    name: 'portal-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/portal/')) return next()
        const rel = decodeURIComponent(url.slice('/portal/'.length).split('?')[0])
        const file = path.resolve(portalRoot, rel)
        if (!file.startsWith(portalRoot)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const ext = path.extname(file).toLowerCase()
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), portalStaticPlugin()],
  server: {
    // 8518 is open on this host's security group; 5173 is not.
    host: '0.0.0.0',
    port: 8518,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [portalRoot, __dirname] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        // San_Jose-sized templates (~1MB+) are slow via Atlas — don't drop Saves
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
})
