import { handleMappingRequest } from '../../pipeline/mapping-http.mjs'

function notFound() {
  return new Response(JSON.stringify({ ok: false, reason: '找不到對照入口。' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function mappingSuffix(pathname) {
  if (pathname.includes('/catalog')) return '/catalog'
  if (pathname.includes('/confirmed')) return '/confirmed'
  if (pathname.includes('/pending')) return '/pending'
  if (pathname.includes('/overrides')) return '/overrides'
  if (pathname.includes('/confirm')) return '/confirm'
  if (pathname.includes('/reject')) return '/reject'
  return '/workspace'
}

export default async (request) => {
  const url = new URL(request.url)
  const query = url.searchParams.toString()
  const target = url.pathname.startsWith('/api/mapping')
    ? request.url
    : `https://mapping.local/api/mapping${mappingSuffix(url.pathname)}${query ? `?${query}` : ''}`
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'DELETE'
  const next = target === request.url
    ? request
    : new Request(target, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? (await request.text()) || '{}' : undefined,
      })
  const response = await handleMappingRequest(next)
  return response ?? notFound()
}
