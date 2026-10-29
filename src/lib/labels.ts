import type { MappingOrigin, MatchStatus, SourceHealthStatus, Sport, UpdateJobState } from '../types/schema'

export const SPORT_LABEL: Record<Sport, string> = {
  football: '足球',
  basketball: '籃球',
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: '未賽',
  live: '進行中',
  finished: '完場',
  postponed: '延期',
  cancelled: '取消',
}

export const ORIGIN_LABEL: Record<MappingOrigin, string> = {
  auto: '自動',
  manual: '人手',
  import: '匯入',
}

export const JOB_LABEL: Record<UpdateJobState, string> = {
  idle: '閒置',
  queued: '排隊中',
  running: '更新中',
  success: '成功',
  fail: '失敗',
}

export const HEALTH_LABEL: Record<SourceHealthStatus, string> = {
  ok: '正常',
  degraded: '降級',
  down: '中斷',
}
