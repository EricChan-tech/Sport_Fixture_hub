import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { MANUAL_RATE_LIMIT_MS, MANUAL_WINDOW_DAYS, SOURCE_IDS, SPORTS } from './constants.mjs'
import { syncScheduleMappings } from './mapping-sync.mjs'
import { pipelineFile, repoRoot } from './paths.mjs'
import { createStore, objectKey } from './storage.mjs'
import { addCalendarDays, todayInMacau } from './time.mjs'
import { withinManualWindow } from '../src/lib/productRules.mjs'

const root = repoRoot()
const fixtureRoot = path.join(root, 'public/fixtures')

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function newJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

async function loadSourceConfig() {
  const file = pipelineFile('sources.config.json')
  return JSON.parse(await readFile(file, 'utf8'))
}

async function enabledSources() {
  const sourceConfig = await loadSourceConfig()
  return SOURCE_IDS.filter((sourceId) => sourceConfig.sources[sourceId]?.enabled !== false)
}

function normalizeList(value, allowed) {
  if (!value || value.length === 0) return [...allowed]
  const unique = []
  for (const item of value) {
    if (!allowed.includes(item)) {
      const error = new Error(`不接受的項目：${item}`)
      error.code = 'BAD_REQUEST'
      throw error
    }
    if (!unique.includes(item)) unique.push(item)
  }
  return unique
}

function blankHealth(sourceId, status, message, successRate) {
  return {
    status,
    last_success_at: null,
    success_rate: successRate,
    message,
  }
}

function rewriteSources(day, selected, failed) {
  const next = structuredClone(day)
  next.matches = (next.matches ?? []).map((match) => ({
    ...match,
    sources: (match.sources ?? []).map((cell) => {
      if (failed.has(cell.source_id) || !selected.has(cell.source_id)) {
        return { source_id: cell.source_id, cell: 'missing' }
      }
      return cell
    }),
  }))
  return next
}

async function loadCatalogDay(sport, date) {
  const file = path.join(fixtureRoot, sport, `${date}.json`)
  const existing = await readJson(file)
  if (existing) return existing
  return {
    schema_version: '1.0.0',
    sport,
    date,
    timezone: 'Asia/Macau',
    matches: [],
  }
}

function mergeSports(previous, published) {
  const bySport = new Map()
  for (const sport of previous?.sports ?? []) {
    bySport.set(sport.sport, new Map(sport.days.map((day) => [day.date, day])))
  }
  for (const entry of published) {
    const days = bySport.get(entry.sport) ?? new Map()
    days.set(entry.date, {
      date: entry.date,
      path: objectKey(entry.sport, entry.date),
      match_count: entry.match_count,
    })
    bySport.set(entry.sport, days)
  }
  return SPORTS.filter((sport) => bySport.has(sport)).map((sport) => ({
    sport,
    days: [...bySport.get(sport).values()].sort((a, b) => a.date.localeCompare(b.date)),
  }))
}

export async function readJob(jobId) {
  const store = createStore()
  const raw = await store.get(`jobs/${jobId}.json`)
  return raw ? JSON.parse(raw) : null
}

export async function runScheduleJob(options = {}) {
  const now = options.now ? new Date(options.now) : new Date()
  const today = todayInMacau(now)
  const trigger = options.trigger === 'cron' ? 'cron' : 'manual'
  const baseDate = options.baseDate || today
  const sports = normalizeList(options.sports, SPORTS)
  const requestedSources = normalizeList(options.sources, SOURCE_IDS)
  const enabled = new Set(await enabledSources())
  const selected = requestedSources.filter((sourceId) => enabled.has(sourceId))
  const paceMs = options.paceMs ?? 0
  const failSources = new Set(options.failSources ?? [])
  const store = createStore()

  if (trigger === 'manual' && !withinManualWindow(baseDate, today, MANUAL_WINDOW_DAYS)) {
    return {
      accepted: false,
      job: {
        job_id: null,
        state: 'fail',
        reason: '超出手動更新窗口（今日 ±3 日），未送出。',
        base_date: baseDate,
        trigger,
      },
    }
  }

  const limitRaw = await store.get('meta/rate-limit.json')
  const limit = limitRaw ? JSON.parse(limitRaw) : null
  if (trigger === 'manual' && limit?.last_accepted_at) {
    const elapsed = now.getTime() - Date.parse(limit.last_accepted_at)
    if (elapsed < MANUAL_RATE_LIMIT_MS) {
      return {
        accepted: false,
        job: {
          job_id: null,
          state: 'fail',
          reason: '距離上次手動更新未滿 5 分鐘。',
          retry_after_ms: MANUAL_RATE_LIMIT_MS - elapsed,
          trigger,
        },
      }
    }
  }

  const activeRaw = await store.get('meta/active-job.json')
  if (activeRaw) {
    const active = JSON.parse(activeRaw)
    if (active.state === 'queued' || active.state === 'running') {
      return {
        accepted: false,
        job: { ...active, state: 'fail', reason: '已有更新正在執行。', job_id: active.job_id },
      }
    }
  }

  const job = {
    job_id: newJobId(),
    state: 'queued',
    trigger,
    base_date: baseDate,
    sports,
    sources: selected,
    reason: '',
    created_at: now.toISOString(),
    started_at: null,
    finished_at: null,
  }
  await store.put(`jobs/${job.job_id}.json`, JSON.stringify(job))
  await store.put('meta/active-job.json', JSON.stringify(job))
  if (trigger === 'manual') {
    await store.put('meta/rate-limit.json', JSON.stringify({ last_accepted_at: now.toISOString() }))
  }

  const finish = async () => {
    job.state = 'running'
    job.started_at = new Date().toISOString()
    await store.put(`jobs/${job.job_id}.json`, JSON.stringify(job))
    await store.put('meta/active-job.json', JSON.stringify(job))
    await sleep(paceMs)
    try {
      const dates = trigger === 'cron'
        ? Array.from({ length: MANUAL_WINDOW_DAYS * 2 + 1 }, (_, index) => addCalendarDays(today, index - MANUAL_WINDOW_DAYS))
        : [baseDate]
      const published = []
      const scheduleDays = []
      const health = {}
      for (const sourceId of SOURCE_IDS) {
        if (failSources.has(sourceId)) {
          health[sourceId] = blankHealth(sourceId, 'down', '抓取失敗（stub），已降級為缺格。', 0)
          continue
        }
        if (!selected.includes(sourceId)) {
          health[sourceId] = blankHealth(sourceId, 'down', '來源未納入本次更新。', 0)
          continue
        }
        health[sourceId] = blankHealth(sourceId, 'degraded', '尚未接入真實抓取，本次沿用示範賽程。', null)
      }
      for (const sport of sports) {
        for (const date of dates) {
          const day = rewriteSources(await loadCatalogDay(sport, date), new Set(selected), failSources)
          await store.put(objectKey(sport, date), `${JSON.stringify(day, null, 2)}\n`)
          scheduleDays.push(day)
          published.push({ sport, date, match_count: day.matches.length })
        }
      }
      const mappingStore = await syncScheduleMappings(scheduleDays)
      const previousRaw = await store.get('manifest.json')
      const previous = previousRaw ? JSON.parse(previousRaw) : null
      const finishedAt = new Date().toISOString()
      const manifest = {
        schema_version: '1.0.0',
        demo: true,
        demo_notice: '由管線發佈的示範賽程。真實抓取尚未接入。',
        timezone: 'Asia/Macau',
        generated_at: finishedAt,
        last_success_at: finishedAt,
        last_job_id: job.job_id,
        window: {
          base_date: baseDate,
          from: addCalendarDays(today, -MANUAL_WINDOW_DAYS),
          to: addCalendarDays(today, MANUAL_WINDOW_DAYS),
        },
        manual_update_window_days: MANUAL_WINDOW_DAYS,
        cron: { time: '06:00', timezone: 'Asia/Macau' },
        runner: process.env.RUNNER_EGRESS || 'local',
        sources_enabled: selected,
        pending_mapping_count: mappingStore.pending.length,
        sports: mergeSports(previous, published),
        source_health: health,
      }
      await store.put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
      job.state = 'success'
      job.reason = '已寫入物件儲存。來源尚未真實抓取，賽程沿用示範目錄。'
      job.finished_at = finishedAt
    } catch (error) {
      job.state = 'fail'
      job.reason = error instanceof Error ? error.message : '管線失敗。'
      job.finished_at = new Date().toISOString()
    }
    await store.put(`jobs/${job.job_id}.json`, JSON.stringify(job))
    await store.put('meta/active-job.json', JSON.stringify({ state: 'idle' }))
    return job
  }

  if (options.async) {
    const queued = { ...job }
    void finish()
    return { accepted: true, job: queued }
  }
  return { accepted: true, job: await finish() }
}

async function main() {
  const args = process.argv.slice(2)
  const read = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  const result = await runScheduleJob({
    trigger: read('--trigger') || 'cron',
    baseDate: read('--base-date'),
    sports: read('--sports')?.split(',').filter(Boolean),
    sources: read('--sources')?.split(',').filter(Boolean),
    paceMs: 0,
  })
  console.log(JSON.stringify(result.job, null, 2))
  if (result.job.state === 'fail' && !result.accepted) process.exitCode = 2
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  return /^run-job\.(mjs|cjs|js)$/.test(path.basename(entry))
}

if (invokedAsCli()) {
  void main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
