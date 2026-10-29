import { SOURCE_IDS } from '../src/lib/sources.mjs'

export { SOURCE_IDS }

/** Manual updates share one pipeline with the daily job and cannot be queued more often than this. */
export const MANUAL_RATE_LIMIT_MS = 5 * 60 * 1000

export const MANUAL_WINDOW_DAYS = 3

export const CRON_TIME = '06:00'

export const CRON_TZ = 'Asia/Macau'

export const SPORTS = ['football', 'basketball']
