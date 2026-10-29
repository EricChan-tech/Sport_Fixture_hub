import { handleScheduleRequest } from '../../pipeline/http.mjs'

export async function handler(event) {
  const jobId = event.queryStringParameters?.job_id
  const path = jobId ? `/api/schedule-jobs/${jobId}` : '/api/schedule-jobs'
  const request = new Request(`https://schedule.local${path}`, {
    method: event.httpMethod,
    headers: event.headers || {},
    body: event.httpMethod === 'GET' || event.httpMethod === 'HEAD' ? undefined : event.body || '{}',
  })
  const response = await handleScheduleRequest(request, { paceMs: 0, async: false })
  return {
    statusCode: response?.status ?? 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: response ? await response.text() : JSON.stringify({ state: 'fail', reason: '找不到更新入口。' }),
  }
}
