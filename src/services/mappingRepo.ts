import seed from '../config/mapping.seed.json'
import type { CompetitionMapping, MappingEntity, MappingStore, TeamMapping } from '../types/schema'
import { clearMappingRaw, readMappingRaw, writeMappingRaw } from '../lib/storage'

export interface ParsedImport {
  entity: 'competition' | 'team'
  sport: CompetitionMapping['sport']
  id?: string
  name_zh: string
  name_en: string
  aliases: CompetitionMapping['aliases']
}

function cloneStore(store: MappingStore): MappingStore {
  // Vue reactive proxies cannot be structuredClone'd.
  return JSON.parse(JSON.stringify(store)) as MappingStore
}

function rebuildPending(store: MappingStore): MappingStore {
  const pending: MappingEntity[] = [
    ...store.competitions.filter((item) => item.status === 'pending'),
    ...store.teams.filter((item) => item.status === 'pending'),
  ]
  return { ...store, pending }
}

function isStore(value: unknown): value is MappingStore {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<MappingStore>
  return record.version === 'mapping_store_v1' && Array.isArray(record.competitions) && Array.isArray(record.teams)
}

export function seedStore(): MappingStore {
  return rebuildPending(structuredClone(seed) as MappingStore)
}

export function loadMappingStore(): MappingStore {
  const saved = readMappingRaw()
  if (isStore(saved)) return rebuildPending(saved)
  return seedStore()
}

export function saveMappingStore(store: MappingStore): MappingStore {
  const next = rebuildPending(store)
  writeMappingRaw(next)
  return next
}

export function adoptMappingStore(remote: MappingStore): MappingStore {
  if (!isStore(remote)) return loadMappingStore()
  return saveMappingStore(remote)
}

export function resetMappingStore(): MappingStore {
  clearMappingRaw()
  return seedStore()
}

export function confirmEntity(store: MappingStore, entity: MappingEntity): MappingStore {
  const next = cloneStore(store)
  if (entity.entity === 'competition') {
    const item = next.competitions.find((row) => row.competition_id === entity.competition_id)
    if (!item) return store
    item.status = 'confirmed'
    item.source = 'manual'
  } else {
    const item = next.teams.find((row) => row.team_id === entity.team_id)
    if (!item) return store
    item.status = 'confirmed'
    item.source = 'manual'
  }
  return saveMappingStore(next)
}

export function rejectEntity(store: MappingStore, entity: MappingEntity): MappingStore {
  const next = cloneStore(store)
  if (entity.entity === 'competition') {
    next.competitions = next.competitions.filter((row) => row.competition_id !== entity.competition_id)
  } else {
    next.teams = next.teams.filter((row) => row.team_id !== entity.team_id)
  }
  return saveMappingStore(next)
}

export function importPending(store: MappingStore, items: readonly ParsedImport[]): { store: MappingStore; error?: string } {
  const next = cloneStore(store)
  for (const item of items) {
    const id = item.id?.trim() || `import-${item.entity}-${crypto.randomUUID().slice(0, 8)}`
    if (item.entity === 'competition') {
      if (next.competitions.some((row) => row.competition_id === id)) {
        return { store, error: `賽事 ${id} 已在對照表。` }
      }
      const row: CompetitionMapping = {
        entity: 'competition',
        competition_id: id,
        sport: item.sport,
        name_zh: item.name_zh,
        name_en: item.name_en,
        short_zh: item.name_zh,
        status: 'pending',
        source: 'import',
        aliases: item.aliases,
      }
      next.competitions.push(row)
    } else {
      if (next.teams.some((row) => row.team_id === id)) {
        return { store, error: `球隊 ${id} 已在對照表。` }
      }
      const row: TeamMapping = {
        entity: 'team',
        team_id: id,
        sport: item.sport,
        name_zh: item.name_zh,
        name_en: item.name_en,
        status: 'pending',
        source: 'import',
        aliases: item.aliases,
      }
      next.teams.push(row)
    }
  }
  return { store: saveMappingStore(next) }
}

export function entityKey(entity: MappingEntity): string {
  return entity.entity === 'competition' ? `competition:${entity.competition_id}` : `team:${entity.team_id}`
}

export function entityTitle(entity: MappingEntity): string {
  return entity.name_zh || entity.name_en
}
