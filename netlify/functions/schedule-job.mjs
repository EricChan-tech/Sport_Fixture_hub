import { handleScheduleRequest } from '../../pipeline/http.mjs'

function notFound() {
  return new Response(JSON.stringify({ state: 'fail', reason: '找不到更新入口。' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

// Default export selects the Netlify Functions v2 runtime, which bundles .mjs
// as ESM. A named `handler` export is bundled as CommonJS and rejects the
// top-level await in pipeline/run-job.mjs.
export default async (request) => {
  const url = new URL(request.url)
  const jobId = url.searchParams.get('job_id')
  const path = url.pathname.startsWith('/api/schedule-jobs')
    ? `${url.pathname}${url.search}`
    : jobId
      ? `/api/schedule-jobs/${jobId}`
      : '/api/schedule-jobs'
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const next = new Request(`https://schedule.local${path}`, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? (await request.text()) || '{}' : undefined,
  })
  const response = await handleScheduleRequest(next, { paceMs: 0, async: false })
  return response ?? notFound()
}
