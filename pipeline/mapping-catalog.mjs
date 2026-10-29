import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { aliasSearchText, CATALOG_SOURCE_IDS, normalizeName, sourceNamesFromAliases } from './alias-names.mjs'
import { ensureWorkspace, readSeedOverrides } from './mapping-store.mjs'
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

function shortNameOf(item, override) {
  if (override && Object.prototype.hasOwnProperty.call(override, 'short_name_zh')) return override.short_name_zh || ''
  return item.short_name_zh || ''
}

function confirmedAliasIndex(store, sport, kind) {
  const list = kind === 'competition' ? store?.competitions : store?.teams
  const byZh = new Map()
  for (const entity of list || []) {
    if (entity.sport && entity.sport !== sport) continue
    if (entity.status !== 'confirmed') continue
    const record = {
      names: sourceNamesFromAliases(entity.aliases),
      texts: aliasSearchText(entity.aliases),
    }
    const macau = (entity.aliases || []).find((alias) => alias.source_id === 'macau_lottery')
    for (const key of [entity.name_zh, macau?.name_zh, entity.short_zh]) {
      const norm = normalizeName(key)
      if (norm && !byZh.has(norm)) byZh.set(norm, record)
    }
  }
  return byZh
}

function linkedRecord(aliasIndex, item, canonicalNameZh) {
  return aliasIndex.get(normalizeName(item.canonical_name_zh))
    || aliasIndex.get(normalizeName(canonicalNameZh))
    || null
}

function catalogSourceNames(item, linked) {
  const own = sourceNamesFromAliases(item.aliases)
  const joined = linked?.names || {}
  const names = {}
  for (const sourceId of CATALOG_SOURCE_IDS) {
    const text = own[sourceId] || joined[sourceId] || ''
    if (text) names[sourceId] = text
  }
  return names
}

function viewOf(item, override, aliasIndex) {
  const canonicalNameZh = override?.canonical_name_zh || item.canonical_name_zh
  const linked = linkedRecord(aliasIndex, item, canonicalNameZh)
  return {
    entity_id: item.entity_id,
    sport: item.sport,
    kind: item.kind,
    canonical_name_zh: canonicalNameZh,
    canonical_name_en: override?.canonical_name_en || item.canonical_name_en,
    short_name_zh: shortNameOf(item, override),
    source_names: catalogSourceNames(item, linked),
    status: override?.status || item.status,
    source: override?.source || item.source,
    continent: item.meta?.continent || '',
    category: item.meta?.category || '',
    _search: linked?.texts || [],
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
  const aliasIndex = confirmedAliasIndex(await ensureWorkspace(), sport, kind)
  const items = await loadItems(sport, kind)
  const start = (pageNumber - 1) * size
  const pageItems = []
  let total = 0
  for (const item of items) {
    const view = viewOf(item, overrides.items[item.entity_id], aliasIndex)
    if (confirmedOnly && view.status !== 'confirmed') continue
    if (needle) {
      const blob = [
        view.entity_id,
        view.canonical_name_zh,
        view.short_name_zh,
        view.canonical_name_en,
        view.continent,
        view.category,
        ...Object.values(view.source_names),
        ...aliasSearchText(item.aliases),
        ...view._search,
      ].join(' ').toLowerCase()
      if (!blob.includes(needle)) continue
    }
    if (total >= start && pageItems.length < size) {
      const { _search, ...publicView } = view
      pageItems.push(publicView)
    }
    total += 1
  }
  return { total, page: pageNumber, page_size: size, items: pageItems }
}
