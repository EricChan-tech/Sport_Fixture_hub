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
      status: entity.status,
      origin: entity.source,
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

function autoLockedName(linked, sourceId) {
  if (!linked || linked.origin !== 'auto' || linked.status !== 'confirmed') return ''
  return linked.names?.[sourceId] || ''
}

function sourceColumnView(item, linked, override) {
  const own = sourceNamesFromAliases(item.aliases)
  const joined = linked?.names || {}
  const manual = override?.source_names
  const names = {}
  const columns = {}
  for (const sourceId of CATALOG_SOURCE_IDS) {
    const autoName = autoLockedName(linked, sourceId)
    if (autoName) {
      names[sourceId] = autoName
      columns[sourceId] = { name: autoName, status: 'confirmed', source: 'auto', editable: false }
      continue
    }
    if (manual && Object.prototype.hasOwnProperty.call(manual, sourceId)) {
      const text = String(manual[sourceId] || '').trim()
      if (text) names[sourceId] = text
      columns[sourceId] = { name: text, status: 'confirmed', source: 'manual', editable: true }
      continue
    }
    const text = own[sourceId] || joined[sourceId] || ''
    if (text) {
      names[sourceId] = text
      const origin = linked ? linked.origin : (item.source || 'import')
      const status = linked ? linked.status : (item.status || 'confirmed')
      columns[sourceId] = {
        name: text,
        status,
        source: origin,
        editable: !(origin === 'auto' && status === 'confirmed'),
      }
      continue
    }
    columns[sourceId] = { name: '', editable: true }
  }
  return { names, columns }
}

function badRequest(message) {
  const error = new Error(message)
  error.code = 'BAD_REQUEST'
  return error
}

const ENTITY_ID = /^macau-(football|basketball)-(team|competition)-\d+$/

async function findSeedItem(entityId) {
  const match = ENTITY_ID.exec(String(entityId || ''))
  if (!match) return null
  const items = await loadItems(match[1], match[2])
  return items.find((item) => item.entity_id === entityId) || null
}

/**
 * Reject edits that would replace a high-confidence auto-confirmed alias.
 * Identical text is reported as locked so the caller does not store it as manual.
 */
export async function lockedNamesForEdit(entityId, sourceNames, canonicalNameZh) {
  if (!sourceNames || typeof sourceNames !== 'object' || Array.isArray(sourceNames)) {
    throw badRequest('來源名稱格式不正確。')
  }
  const item = await findSeedItem(entityId)
  if (!item) throw badRequest('對照 id 不在澳彩種子範圍。')
  const aliasIndex = confirmedAliasIndex(await ensureWorkspace(), item.sport, item.kind)
  const linked = linkedRecord(aliasIndex, item, canonicalNameZh || item.canonical_name_zh)
  const locked = {}
  for (const [sourceId, value] of Object.entries(sourceNames)) {
    if (!CATALOG_SOURCE_IDS.includes(sourceId)) {
      throw badRequest('只能修改 BetExplorer、Scoresway、AiScore、雷速的名稱。')
    }
    if (value != null && typeof value !== 'string') throw badRequest('來源名稱必須是文字。')
    const next = String(value ?? '').trim()
    const autoName = autoLockedName(linked, sourceId)
    if (!autoName) continue
    if (next !== autoName) throw badRequest('自動確認的來源名稱不能修改。')
    locked[sourceId] = autoName
  }
  return locked
}

function viewOf(item, override, aliasIndex) {
  const canonicalNameZh = override?.canonical_name_zh || item.canonical_name_zh
  const linked = linkedRecord(aliasIndex, item, canonicalNameZh)
  const columns = sourceColumnView(item, linked, override)
  return {
    entity_id: item.entity_id,
    sport: item.sport,
    kind: item.kind,
    canonical_name_zh: canonicalNameZh,
    canonical_name_en: override?.canonical_name_en || item.canonical_name_en,
    short_name_zh: shortNameOf(item, override),
    source_names: columns.names,
    source_columns: columns.columns,
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
