import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createStore } from './storage.mjs'
import { repoRoot } from './paths.mjs'

const OVERRIDES_KEY = 'mapping/overrides.json'
const WORKSPACE_KEY = 'mapping/workspace.json'
const seedPath = path.join(repoRoot(), 'src/config/mapping.seed.json')

function emptyOverrides() {
  return { version: 'mapping_overrides_v1', items: {} }
}

export async function readSeedOverrides() {
  const raw = await createStore().get(OVERRIDES_KEY)
  if (!raw) return emptyOverrides()
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version === 'mapping_overrides_v1' && parsed.items && typeof parsed.items === 'object') return parsed
  } catch {
    return emptyOverrides()
  }
  return emptyOverrides()
}

export async function putSeedOverride(input) {
  const entityId = String(input?.entity_id || '')
  const nameZh = String(input?.canonical_name_zh || '').trim()
  const nameEn = String(input?.canonical_name_en || '').trim()
  const hasShort = Boolean(input) && Object.prototype.hasOwnProperty.call(input, 'short_name_zh')
  const shortName = hasShort ? String(input.short_name_zh || '').trim() : ''
  if (!/^macau-(football|basketball)-(team|competition)-\d+$/.test(entityId)) {
    const error = new Error('對照 id 不在澳彩種子範圍。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  if (!nameZh || !nameEn) {
    const error = new Error('中文名和英文名都要填。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  const current = await readSeedOverrides()
  const item = {
    canonical_name_zh: nameZh,
    canonical_name_en: nameEn,
    status: 'confirmed',
    source: 'manual',
    updated_at: new Date().toISOString(),
  }
  if (hasShort) item.short_name_zh = shortName
  current.items[entityId] = item
  await createStore().put(OVERRIDES_KEY, `${JSON.stringify(current)}\n`)
  return item
}

function rebuildPending(store) {
  return {
    ...store,
    pending: [
      ...store.competitions.filter((item) => item.status === 'pending'),
      ...store.teams.filter((item) => item.status === 'pending'),
    ],
  }
}

export function isWorkspace(value) {
  return Boolean(value && value.version === 'mapping_store_v1' && Array.isArray(value.competitions) && Array.isArray(value.teams))
}

export async function readWorkspace() {
  const raw = await createStore().get(WORKSPACE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isWorkspace(parsed) ? rebuildPending(parsed) : null
  } catch {
    return null
  }
}

async function seedWorkspace() {
  const parsed = JSON.parse(await readFile(seedPath, 'utf8'))
  return rebuildPending(parsed)
}

export async function ensureWorkspace() {
  return (await readWorkspace()) ?? (await seedWorkspace())
}

export async function writeWorkspace(store) {
  if (!isWorkspace(store)) {
    const error = new Error('對照工作區格式不正確。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  const next = rebuildPending(store)
  await createStore().put(WORKSPACE_KEY, `${JSON.stringify(next)}\n`)
  return next
}

export async function clearWorkspace() {
  await createStore().delete(WORKSPACE_KEY)
}

function findEntry(store, entity, id) {
  if (entity === 'competition') return store.competitions.find((item) => item.competition_id === id)
  if (entity === 'team') return store.teams.find((item) => item.team_id === id)
  return undefined
}

export async function confirmEntry(entity, id) {
  const store = await ensureWorkspace()
  const item = findEntry(store, entity, id)
  if (!item) {
    const error = new Error('找不到這筆待確認對照。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  item.status = 'confirmed'
  item.source = 'manual'
  // Aliases stay on the entity. The catalog shows them once status is confirmed.
  return writeWorkspace(store)
}

export async function rejectEntry(entity, id) {
  const store = await ensureWorkspace()
  if (entity === 'competition') store.competitions = store.competitions.filter((item) => item.competition_id !== id)
  else if (entity === 'team') store.teams = store.teams.filter((item) => item.team_id !== id)
  else {
    const error = new Error('類型必須是 competition 或 team。')
    error.code = 'BAD_REQUEST'
    throw error
  }
  return writeWorkspace(store)
}
