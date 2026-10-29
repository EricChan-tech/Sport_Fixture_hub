import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFixtureHtml } from '../ingest/macau_lottery/parse.mjs'
import { attachCatalogIds } from '../ingest/macau_lottery/names.mjs'
import { fixturesToDay } from '../ingest/macau_lottery/scrape.mjs'
import { objectKey } from '../pipeline/storage.mjs'
import { runScheduleJob } from '../pipeline/run-job.mjs'

const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const footballHtml = `
<h1>2026 年 10 月 30 日 (星期五)</h1>
<div class="table_body fixture">
  <div class="row dl odd">
    <div class="league dd"><div class="tableDiv"><p>法甲</p></div></div>
    <div class="time dd">03:00</div>
    <div class="team_payout home"><div class="tableDiv"><p><span>巴黎聖日耳曼</span></p></div></div>
    <div class="team_payout away"><div class="tableDiv"><p><span>馬賽</span></p></div></div>
  </div>
</div>
<h1>2026 年 10 月 31 日 (星期六)</h1>
<div class="row dl">
  <div class="league dd"><p>英超</p></div>
  <div class="time dd">23:30</div>
  <div class="team_payout home"><span>曼聯</span></div>
  <div class="team_payout away"><span>利物浦</span></div>
</div>`

const basketballHtml = `
<h1>2026 年 10 月 30 日 (星期五)</h1>
<div class="table fixture"><div class="table_body">
  <div class="row dl odd">
    <div class="league dd"><div class="tableDiv"><p>NBA</p></div></div>
    <div class="time dd">08:00</div>
    <div class="home bn fl">湖人</div>
    <div class="vs bn fl"><span>對</span></div>
    <div class="away fl">塞爾特人</div>
  </div>
</div></div>`

const football = parseFixtureHtml(footballHtml, 'football')
assert(football.length === 2, 'football rows')
assert(football[0].date === '2026-10-30' && football[0].kickoff_at === '2026-10-30T03:00:00+08:00', 'football kickoff')
assert(football[0].league_name === '法甲' && football[0].home_name === '巴黎聖日耳曼' && football[0].away_name === '馬賽', 'football names')
assert(football[1].kickoff_at === '2026-10-31T23:30:00+08:00' && football[1].home_name === '曼聯', 'second football row')

const basketball = parseFixtureHtml(basketballHtml, 'basketball')
assert(basketball.length === 1 && basketball[0].home_name === '湖人' && basketball[0].away_name === '塞爾特人', 'basketball row')
assert(basketball[0].kickoff_at === '2026-10-30T08:00:00+08:00', 'basketball kickoff')

let blocked = false
try {
  parseFixtureHtml('<html><script>function reload(x){setCookie("acw_sc__v2", x)}</script><script name="aliyunwaf_6a6f5ea8"></script></html>', 'football')
} catch (error) {
  blocked = error?.code === 'BLOCKED'
}
assert(blocked, 'challenge page is blocked')

const identified = await attachCatalogIds(football)
assert(identified[0].competition_id === 'macau-football-competition-71', '法甲 maps to the seed competition')
assert(identified[1].competition_id === 'macau-football-competition-8', '英超 maps to the seed competition')
assert(identified[1].home_team_id.startsWith('macau-football-team-'), '曼聯 maps to a seed team')
const unknown = await attachCatalogIds([{ ...football[0], league_name: '不存在的示範聯', home_name: '沒有這隊', away_name: '也沒有' }])
assert(unknown[0].competition_id.startsWith('macau-football-league-') && unknown[0].home_team_id === '', 'unknown names get a stable competition id')

const day = fixturesToDay({
  sport: 'football',
  date: '2026-10-30',
  fixtures: identified,
  updatedAt: '2026-10-30T06:00:00+08:00',
})
assert(day.matches.length === 1 && day.matches[0].has_macau === true, 'day keeps that date')
assert(day.matches[0].sources.find((cell) => cell.source_id === 'macau_lottery').cell === 'ok', 'macau cell')
assert(day.matches[0].sources.find((cell) => cell.source_id === 'leisu').cell === 'missing', 'other source stays missing')
assert(day.timezone === 'Asia/Macau', 'day timezone')

const previousStore = process.env.SCHEDULE_STORE_DIR
const previousDriver = process.env.SCHEDULE_STORE
const dir = await mkdtemp(path.join(tmpdir(), 'macau-scrape-'))
process.env.SCHEDULE_STORE = 'local'
process.env.SCHEDULE_STORE_DIR = dir
const now = '2026-10-30T08:00:00+08:00'

const live = await runScheduleJob({
  trigger: 'manual',
  baseDate: '2026-10-30',
  now,
  paceMs: 0,
  sources: ['macau_lottery'],
  sports: ['football'],
  scrapers: {
    macau_lottery: async () => ({
      ok: true,
      partial: false,
      fixtures: identified.filter((fixture) => fixture.date === '2026-10-30'),
      sports: { football: { ok: true, count: 1 } },
      message: '澳彩公開賽程頁：足球 1 場。',
    }),
  },
})
assert(live.accepted && live.job.state === 'success', 'stub scrape succeeds')
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
assert(manifest.demo === false, 'live macau is not marked demo')
assert(manifest.source_health.macau_lottery.status === 'ok', 'macau health ok')
assert(manifest.source_health.betexplorer.status === 'down', 'other sources stay out of this run')
const stored = JSON.parse(await readFile(path.join(dir, objectKey('football', '2026-10-30')), 'utf8'))
assert(stored.matches.length === 1 && stored.matches[0].league_name === '法甲', 'stored day is the scraped fixture')
assert(!stored.matches.some((match) => match.match_id.startsWith('fb-')), 'demo match ids are not reused')

const failedDir = await mkdtemp(path.join(tmpdir(), 'macau-scrape-fail-'))
process.env.SCHEDULE_STORE_DIR = failedDir
const failed = await runScheduleJob({
  trigger: 'manual',
  baseDate: '2026-10-30',
  now,
  paceMs: 0,
  scrapers: {
    macau_lottery: async () => {
      throw new Error('渲染澳彩賽程頁逾時。')
    },
  },
})
assert(failed.accepted && failed.job.state === 'success', 'scrape failure does not fail the job')
const failedManifest = JSON.parse(await readFile(path.join(failedDir, 'manifest.json'), 'utf8'))
assert(failedManifest.source_health.macau_lottery.status === 'down', 'failed macau is down')
assert(failedManifest.source_health.leisu.status === 'degraded', 'unwired source still degrades')
assert(failedManifest.demo === true, 'fallback stays demo')
const failedDay = JSON.parse(await readFile(path.join(failedDir, objectKey('football', '2026-10-30')), 'utf8'))
const demoMatch = failedDay.matches.find((match) => match.match_id === 'fb-20261030-epl-mun-liv')
const macauCell = demoMatch?.sources.find((cell) => cell.source_id === 'macau_lottery')
const betexplorerCell = demoMatch?.sources.find((cell) => cell.source_id === 'betexplorer')
assert(macauCell?.cell === 'missing', 'failed macau cell is missing')
assert(betexplorerCell?.cell === 'mismatch' && betexplorerCell.sides_swapped === true, 'other demo cells stay')

if (previousStore === undefined) delete process.env.SCHEDULE_STORE_DIR
else process.env.SCHEDULE_STORE_DIR = previousStore
if (previousDriver === undefined) delete process.env.SCHEDULE_STORE
else process.env.SCHEDULE_STORE = previousDriver
await rm(dir, { recursive: true, force: true })
await rm(failedDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('macau scrape ok')
