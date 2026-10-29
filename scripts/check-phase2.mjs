import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANUAL_RATE_LIMIT_MS, SOURCE_IDS } from '../pipeline/constants.mjs'
import { objectKey } from '../pipeline/storage.mjs'
import { runScheduleJob } from '../pipeline/run-job.mjs'
import { putSeedOverride, readSeedOverrides } from '../pipeline/mapping-store.mjs'
import { queryCatalog } from '../pipeline/mapping-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const banned = ['soc', 'cerway'].join('')

function assert(condition, message) {
  if (!condition) failures.push(message)
}

assert(SOURCE_IDS.join(',') === 'macau_lottery,betexplorer,scoresway,aiscore,leisu', 'source list')
assert(MANUAL_RATE_LIMIT_MS === 300000, 'manual rate limit is 5 minutes')

const workflow = await readFile(path.join(root, '.github/workflows/daily-schedule.yml'), 'utf8')
assert(workflow.includes('cron: "0 6 * * *"'), 'workflow cron')
assert(workflow.includes('CRON_TZ: Asia/Macau'), 'workflow timezone')
assert(workflow.includes('workflow_dispatch'), 'manual dispatch')
assert(!workflow.toLowerCase().includes(banned), 'workflow source name')

const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8')
assert(gitignore.includes('.schedule-store'), 'store dir is gitignored')

const previousStore = process.env.SCHEDULE_STORE_DIR
const previousDriver = process.env.SCHEDULE_STORE
const dir = await mkdtemp(path.join(tmpdir(), 'schedule-store-'))
process.env.SCHEDULE_STORE = 'local'
process.env.SCHEDULE_STORE_DIR = dir
const now = '2026-10-30T08:00:00+08:00'

const outside = await runScheduleJob({ trigger: 'manual', baseDate: '2020-01-01', now, paceMs: 0 })
assert(outside.accepted === false && outside.job.state === 'fail', 'outside window fails')

const published = await runScheduleJob({
  trigger: 'manual',
  baseDate: '2026-10-30',
  now,
  paceMs: 0,
  failSources: ['aiscore'],
})
assert(published.accepted && published.job.state === 'success', 'job succeeds when one source fails')
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
assert(manifest.last_success_at && manifest.last_job_id === published.job.job_id, 'manifest job')
assert(
  manifest.window?.base_date === '2026-10-30' && manifest.window.from === '2026-10-27' && manifest.window.to === '2026-11-02',
  'manifest window',
)
assert(Array.isArray(manifest.sources_enabled) && manifest.sources_enabled.includes('macau_lottery'), 'sources enabled')
assert(typeof manifest.pending_mapping_count === 'number', 'pending count')
assert(manifest.runner, 'runner')
assert(manifest.source_health.aiscore.status === 'down', 'failed source health')
assert(manifest.source_health.leisu.status === 'degraded', 'unwired source degrades')
const day = JSON.parse(await readFile(path.join(dir, objectKey('football', '2026-10-30')), 'utf8'))
const swapped = day.matches.find((match) => match.match_id === 'fb-20261030-epl-mun-liv')
const betexplorer = swapped.sources.find((cell) => cell.source_id === 'betexplorer')
const aiscore = swapped.sources.find((cell) => cell.source_id === 'aiscore')
assert(betexplorer.sides_swapped === true && betexplorer.cell === 'mismatch', 'swap survives publish')
assert(aiscore.cell === 'missing' && aiscore.sides_swapped !== true, 'failed source is missing, not a swap')

const edited = await putSeedOverride({
  entity_id: 'macau-football-team-1',
  canonical_name_zh: '測試隊',
  canonical_name_en: 'Test FC',
})
assert(edited.source === 'manual' && edited.status === 'confirmed', 'override is manual confirmed')
const overrides = await readSeedOverrides()
assert(overrides.items['macau-football-team-1'].canonical_name_en === 'Test FC', 'override persisted')
const page = await queryCatalog({ sport: 'football', kind: 'team', q: 'Test FC', page: 1, pageSize: 40 })
assert(page.total === 1 && page.items[0].entity_id === 'macau-football-team-1', 'catalog search sees override')
const full = await queryCatalog({ sport: 'football', kind: 'team', q: '', page: 1, pageSize: 40 })
assert(full.total === 7745 && full.items.length === 40, 'team catalog is paged')
assert(page.items[0].short_name_zh === '', 'team catalog short name is blank')

const byShort = await queryCatalog({ sport: 'football', kind: 'competition', q: '英亞盃', page: 1, pageSize: 40 })
assert(byShort.total === 1 && byShort.items[0].entity_id === 'macau-football-competition-1', 'catalog search matches short name')
assert(byShort.items[0].short_name_zh === '英亞盃', 'catalog row exposes short name')
const emptyShort = await queryCatalog({ sport: 'football', kind: 'competition', q: '西亚冠军杯', page: 1, pageSize: 40 })
assert(emptyShort.total === 1 && emptyShort.items[0].short_name_zh === '', 'empty short name stays blank')
const basketball = await queryCatalog({ sport: 'basketball', kind: 'competition', q: '', page: 1, pageSize: 40 })
assert(basketball.total === 162 && basketball.items[0].short_name_zh === '阿籃錦', 'basketball catalog count and short name')
const editedComp = await putSeedOverride({
  entity_id: 'macau-football-competition-1',
  canonical_name_zh: '英超亞洲盃',
  canonical_name_en: 'Premier League Asia Trophy',
  short_name_zh: '亞盃簡',
})
assert(editedComp.short_name_zh === '亞盃簡', 'short name override stored')
const renamed = await queryCatalog({ sport: 'football', kind: 'competition', q: '亞盃簡', page: 1, pageSize: 40 })
assert(renamed.total === 1 && renamed.items[0].short_name_zh === '亞盃簡', 'catalog search sees short override')

const limited = await runScheduleJob({ trigger: 'manual', baseDate: '2026-10-30', now, paceMs: 0 })
assert(limited.accepted === false && limited.job.reason.includes('5 分鐘'), 'rate limit')

if (previousStore === undefined) delete process.env.SCHEDULE_STORE_DIR
else process.env.SCHEDULE_STORE_DIR = previousStore
if (previousDriver === undefined) delete process.env.SCHEDULE_STORE
else process.env.SCHEDULE_STORE = previousDriver
await rm(dir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('phase2 ok')
