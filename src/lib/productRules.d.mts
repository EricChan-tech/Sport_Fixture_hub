import type { SourceCell, SourceId } from '../types/schema'

export function uniqueIds(ids: readonly string[]): string[]

export function effectiveCompetitionIds(input: {
  stored: readonly string[] | null
  defaults: readonly string[]
  macauLocked: readonly string[]
}): string[]

export function selectNoneIds(macauLocked: readonly string[]): string[]

export function clearedPreferenceIds(input: {
  defaults: readonly string[]
  macauLocked: readonly string[]
}): string[]

export function macauLockedCompetitionIds(
  matches: readonly { has_macau: boolean; competition_id: string }[],
): string[]

export function resolveDisplayName(
  sources: readonly SourceCell[],
  field: 'league_name' | 'home_name' | 'away_name',
): { text: string; source_id: SourceId | null }

export function sortByTime<T extends { kickoff_at: string; match_id: string }>(
  matches: readonly T[],
): T[]

export function sortByCompetition<
  T extends { kickoff_at: string; match_id: string; competition_id: string },
>(matches: readonly T[]): T[]

export function withinManualWindow(date: string, today: string, windowDays?: number): boolean
