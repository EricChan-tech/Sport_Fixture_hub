import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { aliasSearchText, CATALOG_SOURCE_IDS, normalizeName, sourceNamesFromAliases } from './alias-names.mjs'
import { ensureWorkspace, putSeedOverride, readSeedOverrides } from './mapping-store.mjs'
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

function addIndexKey(index, key, record) {
  const norm = normalizeName(key)
  if (norm && !index.has(norm)) index.set(norm, record)
}

function confirmedAliasIndex(store, sport, kind) {
  const list = kind === 'competition' ? store?.competitions : store?.teams
  const byZh = new Map()
  const byEn = new Map()
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
    for (const key of [entity.name_zh, macau?.name_zh, entity.short_zh]) addIndexKey(byZh, key, record)
    for (const key of [entity.name_en, macau?.name_en]) addIndexKey(byEn, key, record)
    for (const alias of entity.aliases || []) addIndexKey(byEn, alias.name_en, record)
  }
  return { byZh, byEn }
}

function linkedRecord(aliasIndex, item, canonicalNameZh) {
  const zh = aliasIndex.byZh
  const en = aliasIndex.byEn
  return zh.get(normalizeName(item.canonical_name_zh))
    || zh.get(normalizeName(canonicalNameZh))
    || zh.get(normalizeName(item.short_name_zh))
    || en.get(normalizeName(item.canonical_name_en))
    || null
}

function catalogMatchKeys(item) {
  const keys = new Set()
  for (const value of [item.name_zh, item.short_zh, item.name_en]) {
    const norm = normalizeName(value)
    if (norm) keys.add(norm)
  }
  for (const alias of item.aliases || []) {
    if (alias.source_id !== 'macau_lottery') continue
    for (const value of [alias.name_zh, alias.name_en]) {
      const norm = normalizeName(value)
      if (norm) keys.add(norm)
    }
  }
  return keys
}

function seedMatchKeys(item) {
  const keys = new Set()
  for (const value of [item.canonical_name_zh, item.canonical_name_en, item.short_name_zh]) {
    const norm = normalizeName(value)
    if (norm) keys.add(norm)
  }
  return keys
}

function sourceNamesForWriteback(item) {
  const names = sourceNamesFromAliases(item.aliases)
  const sourceNames = {}
  for (const sourceId of CATALOG_SOURCE_IDS) {
    if (names[sourceId]) sourceNames[sourceId] = names[sourceId]
  }
  return sourceNames
}

/**
 * Copy confirmed review aliases onto matching Macau catalog rows.
 * Chinese names are preferred; English (波爾圖 / Porto → 波圖 / Porto) fills the gap
 * when the workspace label is a variant of the seed name.
 */
export async function writebackConfirmedAliases(item) {
  const sourceNames = sourceNamesForWriteback(item)
  if (Object.keys(sourceNames).length === 0) return []
  const kind = item.entity === 'competition' ? 'competition' : 'team'
  const keys = catalogMatchKeys(item)
  if (keys.size === 0) return []
  const items = await loadItems(item.sport, kind)
  const overrides = await readSeedOverrides()
  const written = []
  for (const seed of items) {
    const seedKeys = seedMatchKeys(seed)
    let hit = false
    for (const key of seedKeys) {
      if (keys.has(key)) {
        hit = true
        break
      }
    }
    if (!hit) continue
    const previous = overrides.items[seed.entity_id] || {}
    const payload = {
      entity_id: seed.entity_id,
      canonical_name_zh: previous.canonical_name_zh || seed.canonical_name_zh,
      canonical_name_en: previous.canonical_name_en || seed.canonical_name_en,
      source_names: sourceNames,
    }
    if (kind === 'competition') {
      payload.short_name_zh = Object.prototype.hasOwnProperty.call(previous, 'short_name_zh')
        ? previous.short_name_zh
        : (seed.short_name_zh || '')
    }
    try {
      const locked = await lockedNamesForEdit(seed.entity_id, sourceNames, payload.canonical_name_zh)
      const unlocked = {}
      for (const [sourceId, value] of Object.entries(sourceNames)) {
        if (!locked[sourceId]) unlocked[sourceId] = value
      }
      if (Object.keys(unlocked).length === 0) continue
      payload.source_names = unlocked
      await putSeedOverride(payload)
      written.push(seed.entity_id)
    } catch (error) {
      if (error && error.code === 'BAD_REQUEST') continue
      throw error
    }
  }
  return written
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
