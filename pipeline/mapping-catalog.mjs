import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readSeedOverrides } from './mapping-store.mjs'
import { repoRoot } from './paths.mjs'

const root = repoRoot()
const cache = new Map()

function fileName(sport, kind) {
  const suffix = kind === 'team' ? 'teams' : 'competitions'
  return `${sport}_${suffix}.json`
}

async function loadItems(sport, kind) {
  const key = `${sport}:${kind}`
  const cached = cache.get(key)
  if (cached) return cached
  const full = path.join(root, 'data/mapping/seeds/macau_lottery', fileName(sport, kind))
  const parsed = JSON.parse(await readFile(full, 'utf8'))
  cache.set(key, parsed.items)
  return parsed.items
}

function viewOf(item, override) {
  return {
    entity_id: item.entity_id,
    sport: item.sport,
    kind: item.kind,
    canonical_name_zh: override?.canonical_name_zh || item.canonical_name_zh,
    canonical_name_en: override?.canonical_name_en || item.canonical_name_en,
    status: override?.status || item.status,
    source: override?.source || item.source,
    continent: item.meta?.continent || '',
    category: item.meta?.category || '',
  }
}

export async function queryCatalog({ sport, kind, q = '', page = 1, pageSize = 40, confirmedOnly = false }) {
  if (sport !== 'football' && sport !== 'basketball') {
    const error = new Error('sport 必須是 football 或 basketball。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  if (kind !== 'team' && kind !== 'competition') {
    const error = new Error('kind 必須是 team 或 competition。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  const size = Math.min(100, Math.max(1, Number(pageSize) || 40))
  const pageNumber = Math.max(1, Number(page) || 1)
  const needle = String(q || '').trim().toLowerCase()
  const overrides = await readSeedOverrides()
  const items = await loadItems(sport, kind)
  const start = (pageNumber - 1) * size
  const pageItems = []
  let total = 0
  for (const item of items) {
    const view = viewOf(item, overrides.items[item.entity_id])
    if (confirmedOnly && view.status !== 'confirmed') continue
    if (needle) {
      const blob = [view.entity_id, view.canonical_name_zh, view.canonical_name_en, view.continent, view.category]
        .join(' ')
        .toLowerCase()
      if (!blob.includes(needle)) continue
    }
    if (total >= start && pageItems.length < size) pageItems.push(view)
    total += 1
  }
  return { total, page: pageNumber, page_size: size, items: pageItems }
}
