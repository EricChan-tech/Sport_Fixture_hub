import { handleMappingRequest } from '../../pipeline/mapping-http.mjs'

export async function handler(event) {
  const query = new URLSearchParams(event.queryStringParameters || {}).toString()
  const suffix = event.path?.includes('/catalog')
    ? '/catalog'
    : event.path?.includes('/confirmed')
      ? '/confirmed'
      : event.path?.includes('/pending')
        ? '/pending'
        : event.path?.includes('/overrides')
          ? '/overrides'
          : event.path?.includes('/confirm')
            ? '/confirm'
            : event.path?.includes('/reject')
              ? '/reject'
              : '/workspace'
  const request = new Request(`https://mapping.local/api/mapping${suffix}${query ? `?${query}` : ''}`, {
    method: event.httpMethod,
    headers: event.headers || {},
    body: event.httpMethod === 'GET' || event.httpMethod === 'HEAD' || event.httpMethod === 'DELETE' ? undefined : event.body || '{}',
  })
  const response = await handleMappingRequest(request)
  return {
    statusCode: response?.status ?? 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: response ? await response.text() : JSON.stringify({ ok: false, reason: '找不到對照入口。' }),
  }
}
