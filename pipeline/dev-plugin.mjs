import { createStore } from './storage.mjs'
import { handleScheduleRequest } from './http.mjs'
import { handleMappingRequest } from './mapping-http.mjs'

async function toRequest(req) {
  const host = req.headers.host || '127.0.0.1:43123'
  const chunks = []
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    for await (const chunk of req) chunks.push(chunk)
  }
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  })
}

export function scheduleDevPlugin() {
  return {
    name: 'schedule-dev-store',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || '').split('?')[0]
        try {
          if (pathname.startsWith('/api/mapping') || pathname.startsWith('/api/schedule-jobs')) {
            const request = await toRequest(req)
            const response = pathname.startsWith('/api/mapping')
              ? await handleMappingRequest(request)
              : await handleScheduleRequest(request, { paceMs: 450, async: true })
            res.statusCode = response?.status ?? 404
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(await response.text())
            return
          }
          if (pathname.startsWith('/schedule/')) {
            const key = decodeURIComponent(pathname.slice('/schedule/'.length))
            const body = await createStore().get(key)
            if (body == null) {
              res.statusCode = 404
              res.end('{}')
              return
            }
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(body)
            return
          }
        } catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ state: 'fail', reason: error instanceof Error ? error.message : '儲存層錯誤。' }))
          return
        }
        next()
      })
    },
  }
}
