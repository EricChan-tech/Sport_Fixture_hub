export type Sport = 'football' | 'basketball'

export type SourceId = 'macau_lottery' | 'betexplorer' | 'scoresway' | 'aiscore' | 'leisu'

export type CellStatus = 'ok' | 'missing' | 'mismatch'

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'

export type SourceHealthStatus = 'ok' | 'degraded' | 'down'

export type MappingStatus = 'confirmed' | 'pending'

export type MappingOrigin = 'auto' | 'manual' | 'import'

export interface SourceCell {
  source_id: SourceId
  cell: CellStatus
  kickoff_at?: string
  league_name?: string
  home_name?: string
  away_name?: string
  /** True when this source lists home and away opposite the canonical direction. */
  sides_swapped?: boolean
  /** Source kickoff minus canonical kickoff, in minutes. Set on mismatch cells. */
  delta_minutes?: number
}

export interface Match {
  match_id: string
  sport: Sport
  competition_id: string
  league_name: string
  home_name: string
  away_name: string
  home_team_id: string
  away_team_id: string
  kickoff_at: string
  status: MatchStatus
  sources: SourceCell[]
  has_macau: boolean
  confidence: number
  updated_at: string
}

export interface DayFile {
  schema_version: '1.0.0'
  sport: Sport
  date: string
  timezone: 'Asia/Macau'
  matches: Match[]
}

export interface SourceHealth {
  status: SourceHealthStatus
  last_success_at: string | null
  message?: string
  success_rate?: number | null
}

export interface ManifestDay {
  date: string
  path: string
  match_count: number
}

export interface ManifestWindow {
  base_date: string
  from: string
  to: string
}

export interface Manifest {
  schema_version: '1.0.0'
  demo: boolean
  demo_notice: string
  timezone: 'Asia/Macau'
  generated_at: string
  last_success_at?: string | null
  last_job_id?: string | null
  window?: ManifestWindow
  manual_update_window_days: number
  cron: { time: '06:00'; timezone: 'Asia/Macau' }
  runner?: string
  sources_enabled?: SourceId[]
  pending_mapping_count?: number
  sports: Array<{ sport: Sport; days: ManifestDay[] }>
  source_health: Record<SourceId, SourceHealth>
}

export interface SourceAlias {
  source_id: SourceId
  name_zh?: string
  name_en?: string
}

export interface CompetitionMapping {
  entity: 'competition'
  competition_id: string
  sport: Sport
  name_zh: string
  name_en: string
  short_zh: string
  status: MappingStatus
  source: MappingOrigin
  aliases: SourceAlias[]
}

export interface TeamMapping {
  entity: 'team'
  team_id: string
  sport: Sport
  name_zh: string
  name_en: string
  status: MappingStatus
  source: MappingOrigin
  aliases: SourceAlias[]
}

export type MappingEntity = CompetitionMapping | TeamMapping

export interface MappingStore {
  version: 'mapping_store_v1'
  competitions: CompetitionMapping[]
  teams: TeamMapping[]
  pending: MappingEntity[]
}

export interface WhitelistFile {
  version: 'schedule_whitelist_v1'
  sports: Record<Sport, string[]>
}

export interface WhitelistPreference {
  version: 'schedule_whitelist_v1'
  sport: Sport
  competition_ids: string[]
}

export interface AliasFile {
  version: 'aliases_v1'
  competitions: Record<string, string[]>
  teams: Record<string, string[]>
}

export type SortMode = 'time' | 'competition'

export type UpdateJobState = 'idle' | 'queued' | 'running' | 'success' | 'fail'
