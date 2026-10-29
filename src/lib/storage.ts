import type { SortMode, Sport, WhitelistPreference } from '../types/schema'

const SORT_KEY = 'schedule_sort_v1'
const LAST_SUCCESS_KEY = 'schedule_update_last_success_at'
const MAPPING_KEY = 'mapping_store_v1'

export function whitelistKey(sport: Sport): string {
  return `schedule_whitelist_v1:${sport}`
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export function readWhitelist(sport: Sport): string[] | null {
  const parsed = readJson(whitelistKey(sport))
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<WhitelistPreference>
  if (record.version !== 'schedule_whitelist_v1' || record.sport !== sport) return null
  if (!Array.isArray(record.competition_ids)) return null
  return record.competition_ids.filter((id): id is string => typeof id === 'string')
}

export function writeWhitelist(sport: Sport, competitionIds: readonly string[]): void {
  const payload: WhitelistPreference = {
    version: 'schedule_whitelist_v1',
    sport,
    competition_ids: [...competitionIds],
  }
  localStorage.setItem(whitelistKey(sport), JSON.stringify(payload))
}

export function clearWhitelist(sport: Sport): void {
  localStorage.removeItem(whitelistKey(sport))
}

export function readSortMode(): SortMode {
  try {
    return localStorage.getItem(SORT_KEY) === 'competition' ? 'competition' : 'time'
  } catch {
    return 'time'
  }
}

export function writeSortMode(mode: SortMode): void {
  localStorage.setItem(SORT_KEY, mode)
}

export function readLastSuccessAt(): string | null {
  try {
    const value = localStorage.getItem(LAST_SUCCESS_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function writeLastSuccessAt(iso: string): void {
  localStorage.setItem(LAST_SUCCESS_KEY, iso)
}

export function readMappingRaw(): unknown {
  return readJson(MAPPING_KEY)
}

export function writeMappingRaw(value: unknown): void {
  localStorage.setItem(MAPPING_KEY, JSON.stringify(value))
}

export function clearMappingRaw(): void {
  localStorage.removeItem(MAPPING_KEY)
}
