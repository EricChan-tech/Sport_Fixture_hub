import { queryCatalog } from './mapping-catalog.mjs'
import {
  clearWorkspace,
  confirmEntry,
  ensureWorkspace,
  putSeedOverride,
  readSeedOverrides,
  readWorkspace,
  rejectEntry,
  writeWorkspace,
} from './mapping-store.mjs'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function handleMappingRequest(request) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/mapping')) return null
  try {
    if (url.pathname === '/api/mapping/catalog' && request.method === 'GET') {
      return json(await queryCatalog({
        sport: url.searchParams.get('sport'),
        kind: url.searchParams.get('kind'),
        q: url.searchParams.get('q') || '',
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('page_size'),
      }))
    }
    if (url.pathname === '/api/mapping/confirmed' && request.method === 'GET') {
      return json(await queryCatalog({
        sport: url.searchParams.get('sport') || 'football',
        kind: url.searchParams.get('kind') || 'team',
        q: url.searchParams.get('q') || '',
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('page_size'),
        confirmedOnly: true,
      }))
    }
    if (url.pathname === '/api/mapping/overrides' && request.method === 'GET') {
      return json(await readSeedOverrides())
    }
    if (url.pathname === '/api/mapping/overrides' && request.method === 'PUT') {
      const saved = await putSeedOverride(await request.json())
      return json({ ok: true, item: saved })
    }
    if (url.pathname === '/api/mapping/pending' && request.method === 'GET') {
      const store = await readWorkspace()
      const pending = store?.pending ?? (await ensureWorkspace()).pending
      return json({ pending })
    }
    if (url.pathname === '/api/mapping/workspace' && request.method === 'GET') {
      return json({ store: await readWorkspace() })
    }
    if (url.pathname === '/api/mapping/workspace' && request.method === 'PUT') {
      return json({ ok: true, store: await writeWorkspace(await request.json()) })
    }
    if (url.pathname === '/api/mapping/workspace' && request.method === 'DELETE') {
      await clearWorkspace()
      return json({ ok: true })
    }
    if (url.pathname === '/api/mapping/confirm' && request.method === 'POST') {
      const body = await request.json()
      return json({ ok: true, store: await confirmEntry(body.entity, body.id) })
    }
    if (url.pathname === '/api/mapping/reject' && request.method === 'POST') {
      const body = await request.json()
      return json({ ok: true, store: await rejectEntry(body.entity, body.id) })
    }
    return json({ ok: false, reason: '不支援的對照操作。' }, 404)
  } catch (error) {
    const status = error && error.code === 'BAD_REQUEST' ? 400 : 500
    return json({ ok: false, reason: error instanceof Error ? error.message : '對照儲存失敗。' }, status)
  }
}
