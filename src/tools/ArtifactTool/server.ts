import { createServer, type Server } from 'http'
import { ARTIFACT_SERVER_PORT_RANGE, ARTIFACT_SERVER_FALLBACK_PORT, CSP_HEADER } from './constants.js'
import type { ArtifactType, ArtifactRecord } from './types.js'

type ServerState = {
  server: Server | null
  port: number
  baseUrl: string
}

let state: ServerState = { server: null, port: 0, baseUrl: '' }

async function findAvailablePort(range: { min: number; max: number }): Promise<number> {
  const { min, max } = range
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = min + Math.floor(Math.random() * (max - min + 1))
    try {
      await new Promise<void>((resolve, reject) => {
        const testServer = createServer()
        testServer.once('error', reject)
        testServer.listen(port, '127.0.0.1', () => {
          testServer.close(() => resolve())
        })
      })
      return port
    } catch {
      continue
    }
  }
  return ARTIFACT_SERVER_FALLBACK_PORT
}

function renderArtifactHtml(artifact: ArtifactRecord): string {
  const { type, title, content } = artifact

  if (type === 'html') {
    return content
  }

  if (type === 'svg') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style></head><body>${content}</body></html>`
  }

  if (type === 'chart') {
    // Wrap chart data (expected to be JSON config for chart rendering)
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:2rem;background:#fff;color:#1a1a1a}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(content)}</pre><p style="color:#666;font-size:0.9rem">Chart rendering requires a browser with JavaScript enabled.</p></body></html>`
  }

  // Markdown / default: render as styled text
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a;background:#fff}h1{font-size:1.8rem;border-bottom:2px solid #eee;padding-bottom:0.5rem}code{background:#f0f0f0;padding:0.2rem 0.4rem;border-radius:4px;font-size:0.9em}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}img{max-width:100%}blockquote{border-left:4px solid #ddd;margin:0;padding-left:1rem;color:#666}</style></head><body>${escapeHtml(content)}</body></html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function startServer(): Promise<string> {
  if (state.server) return state.baseUrl

  const port = await findAvailablePort(ARTIFACT_SERVER_PORT_RANGE)

  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      // CORS for local use
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET')

      const url = new URL(req.url || '/', `http://localhost:${port}`)
      const match = url.pathname.match(/^\/artifact\/([^/]+)$/)

      if (!match) {
        // Serve an artifact list page at root
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Artifacts Server</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:600px;margin:3rem auto;text-align:center;color:#333}</style></head><body><h1>Artifacts Server</h1><p>Running on port ${port}</p><p>Access artifacts via <code>/artifact/:id</code></p></body></html>`,
        )
        return
      }

      const artifactId = match[1]
      // The caller should set the artifact before requesting
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`Artifact "${artifactId}" not found`)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(`Artifact server failed: ${err.message}`))
    })

    server.listen(port, '127.0.0.1', () => {
      const baseUrl = `http://localhost:${port}`
      state = { server, port, baseUrl }
      resolve(baseUrl)
    })
  })
}

/**
 * Register a route for a specific artifact so the server can serve it.
 * Call this after creating/updating an artifact.
 */
export function registerArtifactRoute(
  artifact: ArtifactRecord,
): string {
  if (!state.server) return ''
  const url = `${state.baseUrl}/artifact/${artifact.id}`
  const html = renderArtifactHtml(artifact)

  // Override the default 404 handler with artifact-specific routes
  // Re-create the server request listener with artifact awareness
  const server = state.server
  const port = state.port

  // Store routes in a map on the server instance
  if (!('_artifactRoutes' in server)) {
    ;(server as Record<string, unknown>)._artifactRoutes = {}
  }
  ;(server as Record<string, unknown>)._artifactRoutes[artifact.id] = {
    html,
    type: artifact.type,
    title: artifact.title,
  }

  // Replace the listener by removing and re-adding (only once)
  if (!('_patched' in server)) {
    ;(server as Record<string, unknown>)._patched = true
    const listeners = server.listeners('request') as Array<(req: unknown, res: unknown) => void>
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Security-Policy', CSP_HEADER)
      res.setHeader('X-Content-Type-Options', 'nosniff')

      const url = new URL(req.url || '/', `http://localhost:${port}`)
      const match = url.pathname.match(/^\/artifact\/([^/]+)$/)

      if (!match) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Artifacts</title></head><body><h1>Artifacts Server</h1><p>Running</p></body></html>`,
        )
        return
      }

      const artifactId = match[1]
      const routes = (server as Record<string, unknown>)._artifactRoutes as Record<string, { html: string; type: string; title: string }> | undefined
      const route = routes?.[artifactId]

      if (route) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(route.html)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end(`Artifact "${artifactId}" not found`)
      }
    })
  }

  return url
}

export function stopServer(): void {
  if (state.server) {
    state.server.close()
    state = { server: null, port: 0, baseUrl: '' }
  }
}

export function getServerUrl(): string {
  return state.baseUrl
}
