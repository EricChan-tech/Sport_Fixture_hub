import { readJob, runScheduleJob } from './run-job.mjs'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function authorized(request) {
  const expected = process.env.SCHEDULE_JOB_TOKEN
  if (!expected) return process.env.SCHEDULE_REQUIRE_TOKEN !== '1'
  return request.headers.get('x-schedule-token') === expected
}

export async function handleScheduleRequest(request, options = {}) {
  const url = new URL(request.url)
  const pathname = options.pathname || url.pathname
  if (!pathname.startsWith('/api/schedule-jobs')) return null
  if (!authorized(request)) return json({ state: 'fail', reason: '更新入口未授權。' }, 401)

  if (request.method === 'GET') {
    const jobId = url.searchParams.get('job_id') || pathname.split('/').filter(Boolean).pop()
    if (!jobId || jobId === 'schedule-jobs') return json({ state: 'fail', reason: '缺少 job id。' }, 400)
    const job = await readJob(jobId)
    if (!job) return json({ state: 'fail', reason: '找不到這個更新工作。' }, 404)
    return json(job)
  }

  if (request.method !== 'POST') return json({ state: 'fail', reason: '不支援的方法。' }, 405)
  let payload = {}
  try {
    payload = await request.json()
  } catch {
    payload = {}
  }
  const result = await runScheduleJob({
    trigger: 'manual',
    baseDate: payload.base_date,
    sports: payload.sports,
    sources: payload.sources,
    paceMs: options.paceMs ?? 0,
    async: options.async === true,
  })
  const status = result.accepted ? 202 : result.job.reason?.includes('5 分鐘') ? 429 : 422
  return json(result.job, status)
}
