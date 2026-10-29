import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseAiscoreHtml } from '../ingest/aiscore/parse.mjs'
import { parseBetexplorerHtml } from '../ingest/betexplorer/parse.mjs'
import { scrapeBetexplorer } from '../ingest/betexplorer/scrape.mjs'
import { parseLeisuHomeHtml, parseLeisuScheduleHtml } from '../ingest/leisu/parse.mjs'
import { scrapeLeisu } from '../ingest/leisu/scrape.mjs'
import { daysFromFixtures } from '../ingest/publish.mjs'
import { SOURCE_SCRAPERS } from '../ingest/scrapers.mjs'
import { chromeWebSocket } from '../ingest/browser.mjs'
import { parseScoreswayHtml } from '../ingest/scoresway/parse.mjs'
import { scrapeScoresway } from '../ingest/scoresway/scrape.mjs'
import { WebSocketServer } from 'ws'
import { SOURCE_IDS } from '../pipeline/constants.mjs'
import { objectKey } from '../pipeline/storage.mjs'
import { runScheduleJob } from '../pipeline/run-job.mjs'

const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

assert(SOURCE_IDS.every((sourceId) => typeof SOURCE_SCRAPERS[sourceId] === 'function'), 'every source has a scraper')

const savedWebSocket = globalThis.WebSocket
try {
  globalThis.WebSocket = undefined
  const Socket = chromeWebSocket()
  assert(typeof Socket === 'function', 'cdp client exists when global WebSocket is missing')
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((resolve) => server.on('listening', resolve))
  const address = server.address()
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data))
      socket.send(JSON.stringify({ id: message.id, result: { ok: true } }))
    })
  })
  const socket = new Socket(`ws://127.0.0.1:${address.port}`)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const reply = await new Promise((resolve, reject) => {
    socket.on('message', (data) => resolve(JSON.parse(String(data))))
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate' }), (error) => {
      if (error) reject(error)
    })
  })
  assert(reply.result?.ok === true, 'cdp client can exchange a frame without global WebSocket')
  socket.close()
  await new Promise((resolve) => server.close(resolve))
} catch (error) {
  failures.push(`node websocket fallback: ${error instanceof Error ? error.message : error}`)
} finally {
  if (savedWebSocket === undefined) delete globalThis.WebSocket
  else globalThis.WebSocket = savedWebSocket
}

const footballHtml = `
<li class="table-main__tournamentNavLi js-tournament" data-ttid="1">
<p class="table-main__leaguesNames leaguesNames">Spain: LaLiga</p>
</li>
<li data-ts="1793390400" data-event-id="xdLoJd4b">
<ul data-dt="30,10,2026,21,00"><span data-live-cell="time">21:00</span>
<div class="table-main__participantHome"><p>Villarreal</p></div>
<div class="table-main__participantAway"><p>Espanyol</p></div>
</ul></li>`

const basketballHtml = `
<tr class="js-tournament"><a class="table-main__tournament">Argentina: Liga Femenina Women</a></tr>
<tr data-dt="30,10,2026,0,00">
<span class="table-main__time">00:00</span>
<a href="/basketball/argentina/liga-femenina-women/boca-el-bigua/2RUab9E6/">
<span class="table-main__teamLine table-main__teamLine--home">Boca W</span>
<span class="table-main__teamLine table-main__teamLine--away">El Bigua W</span>
</a></tr>`

const football = parseBetexplorerHtml(footballHtml, 'football')
assert(football.length === 1, 'betexplorer football row')
assert(football[0].kickoff_at === '2026-10-31T04:00:00+08:00', 'betexplorer uses the absolute timestamp')
assert(football[0].date === '2026-10-31', 'betexplorer macau date')
assert(football[0].league_name === 'Spain: LaLiga' && football[0].home_name === 'Villarreal' && football[0].away_name === 'Espanyol', 'betexplorer names')
assert(football[0].external_id === 'xdLoJd4b' && football[0].source_id === 'betexplorer', 'betexplorer id')

const basketball = parseBetexplorerHtml(basketballHtml, 'basketball')
assert(basketball.length === 1, 'betexplorer basketball row')
assert(basketball[0].kickoff_at === '2026-10-30T07:00:00+08:00', 'betexplorer page clock is Europe/Prague')
assert(basketball[0].home_name === 'Boca W' && basketball[0].away_name === 'El Bigua W', 'betexplorer basketball names')
assert(basketball[0].external_id === '2RUab9E6', 'betexplorer basketball id')
assert(basketball[0].league_name === 'Argentina: Liga Femenina Women', 'betexplorer basketball league')

let blocked = false
try {
  parseBetexplorerHtml('<html><title>Access Denied</title></html>', 'football')
} catch (error) {
  blocked = error?.code === 'BLOCKED'
}
assert(blocked, 'betexplorer access denied is blocked')

const scoreswayHtml = `
<div class="Opta-fixture">
  <div class="Opta-Competition">Premier League</div>
  <time datetime="2026-10-30T20:00:00Z"></time>
  <a href="/en_GB/soccer/match/view/abc123xyz"><div class="Opta-Team Opta-Home">Arsenal</div></a>
  <div class="Opta-Team Opta-Away">Chelsea</div>
</div>`
const scoresway = parseScoreswayHtml(scoreswayHtml, 'football')
assert(scoresway.length === 1 && scoresway[0].home_name === 'Arsenal' && scoresway[0].away_name === 'Chelsea', 'scoresway teams')
assert(scoresway[0].kickoff_at === '2026-10-31T04:00:00+08:00', 'scoresway kickoff')
assert(scoresway[0].league_name === 'Premier League' && scoresway[0].external_id === 'abc123xyz', 'scoresway league and id')
let scoreswayBlocked = false
try {
  parseScoreswayHtml('<HTML><TITLE>Access Denied</TITLE><p>errors.edgesuite.net</p></HTML>', 'football')
} catch (error) {
  scoreswayBlocked = error?.code === 'BLOCKED'
}
assert(scoreswayBlocked, 'scoresway access denied is blocked')

const aiscoreHtml = `<script>window.__NUXT__=(function(a,b){return {state:{football:{matches:[{id:a,sportId:1,matchTime:b,matchStatus:1,homeTeam:{name:"Arsenal"},awayTeam:{name:"Chelsea"},competition:{id:"epl",name:"Premier League"}}]}}}})("match-1", 1793390400);</script>`
const aiscore = parseAiscoreHtml(aiscoreHtml, 'football')
assert(aiscore.length === 1 && aiscore[0].home_name === 'Arsenal' && aiscore[0].away_name === 'Chelsea', 'aiscore teams')
assert(aiscore[0].kickoff_at === '2026-10-31T04:00:00+08:00', 'aiscore kickoff')
assert(aiscore[0].league_name === 'Premier League' && aiscore[0].external_id === 'match-1', 'aiscore league and id')
assert(aiscore[0].status === 'scheduled', 'aiscore status')
let aiscoreBlocked = false
try {
  parseAiscoreHtml('<html><title>Just a moment...</title><p>challenges.cloudflare.com</p></html>', 'football')
} catch (error) {
  aiscoreBlocked = error?.code === 'BLOCKED'
}
assert(aiscoreBlocked, 'aiscore challenge is blocked')

const leisuHome = `
<div class="list-title"><span>26/10/30 星期五</span></div>
<a href="https://live.leisu.com/detail-4553730" class="match-item">
  <use xlink:href="#icon-zuqiu21"></use>
  <div>02:00</div>
  <div title="丹麦超 联赛 第12轮">丹麦超</div>
  <div class="team first-team"><p title="哥本哈根">哥本哈根</p></div>
  <div class="team second-team"><p title="中日德兰">中日德兰</p></div>
</a>
<a href="https://live.leisu.com/lanqiu/detail-88" class="match-item">
  <use xlink:href="#icon-lanqiu"></use>
  <div>08:30</div>
  <div title="NBA">NBA</div>
  <div class="team first-team"><p title="湖人">湖人</p></div>
  <div class="team second-team"><p title="塞爾特人">塞爾特人</p></div>
</a>`
const leisu = parseLeisuHomeHtml(leisuHome)
assert(leisu.length === 2, 'leisu home rows')
assert(leisu[0].sport === 'football' && leisu[0].kickoff_at === '2026-10-30T02:00:00+08:00', 'leisu football kickoff')
assert(leisu[0].league_name === '丹麦超' && leisu[0].home_name === '哥本哈根' && leisu[0].away_name === '中日德兰', 'leisu football names')
assert(leisu[0].external_id === '4553730', 'leisu football id')
assert(leisu[1].sport === 'basketball' && leisu[1].home_name === '湖人' && leisu[1].away_name === '塞爾特人', 'leisu basketball names')

const leisuSchedule = parseLeisuScheduleHtml(`
<li class="ftb-lier-base"><a href="/detail-99">
  <div class="com-name">英超</div>
  <div class="matchstart-time">21:00</div>
  <div class="team-home">曼聯</div>
  <div class="team-away">利物浦</div>
</a></li>`, 'football', '2026-10-30')
assert(leisuSchedule.length === 1 && leisuSchedule[0].kickoff_at === '2026-10-30T21:00:00+08:00', 'leisu schedule kickoff')
assert(leisuSchedule[0].league_name === '英超' && leisuSchedule[0].home_name === '曼聯' && leisuSchedule[0].away_name === '利物浦', 'leisu schedule names')

const scraped = await scrapeBetexplorer({
  sports: ['football'],
  dates: ['2026-10-31'],
  gapMs: 0,
  fetchText: async () => ({ text: footballHtml }),
})
assert(scraped.ok && scraped.fixtures.length === 1 && scraped.sports.football.ok, 'betexplorer scrape keeps the macau date')

const leisuScraped = await scrapeLeisu({
  sports: ['football', 'basketball'],
  dates: ['2026-10-30'],
  gapMs: 0,
  renderPage: false,
  fetchText: async () => ({ text: leisuHome }),
})
assert(leisuScraped.ok && leisuScraped.fixtures.length === 2, 'leisu homepage fallback')
assert(leisuScraped.sports.football.ok && leisuScraped.sports.basketball.ok, 'leisu both sports')

const denied = await scrapeScoresway({
  sports: ['football'],
  dates: ['2026-10-31'],
  gapMs: 0,
  renderPage: false,
  fetchText: async () => ({ text: '<HTML><TITLE>Access Denied</TITLE></HTML>' }),
})
assert(denied.ok === false && denied.sports.football.ok === false, 'scoresway denial does not throw')

const days = daysFromFixtures({
  sport: 'football',
  dates: ['2026-10-31'],
  fixtures: [...football, ...scoresway, ...aiscore],
  workspace: { teams: [], competitions: [] },
  updatedAt: '2026-10-30T06:00:00+08:00',
})
assert(days[0].matches.length === 2, 'unmapped names stay apart')
const arsenal = days[0].matches.find((match) => match.home_name === 'Arsenal')
const villarreal = days[0].matches.find((match) => match.home_name === 'Villarreal')
assert(arsenal?.sources.find((cell) => cell.source_id === 'aiscore').cell === 'ok', 'aiscore cell')
assert(arsenal?.sources.find((cell) => cell.source_id === 'scoresway').home_name === 'Chelsea' || arsenal?.sources.find((cell) => cell.source_id === 'scoresway').away_name === 'Chelsea', 'scoresway cell')
assert(arsenal?.sources.find((cell) => cell.source_id === 'betexplorer').cell === 'missing', 'betexplorer stays off the other match')
assert(villarreal?.sources.find((cell) => cell.source_id === 'betexplorer').home_name === 'Villarreal', 'betexplorer cell')
assert(villarreal?.sources.find((cell) => cell.source_id === 'leisu').cell === 'missing', 'missing source stays missing')
assert(days[0].timezone === 'Asia/Macau', 'day timezone')

const previousStore = process.env.SCHEDULE_STORE_DIR
const previousDriver = process.env.SCHEDULE_STORE
const dir = await mkdtemp(path.join(tmpdir(), 'source-scrapers-'))
process.env.SCHEDULE_STORE = 'local'
process.env.SCHEDULE_STORE_DIR = dir
const now = '2026-10-30T08:00:00+08:00'
const live = await runScheduleJob({
  trigger: 'manual',
  baseDate: '2026-10-30',
  now,
  paceMs: 0,
  sports: ['football'],
  sources: ['betexplorer', 'scoresway', 'aiscore', 'leisu'],
  scrapers: {
    betexplorer: async () => ({
      ok: true,
      partial: false,
      fixtures: [{ ...football[0], date: '2026-10-30', kickoff_at: '2026-10-30T21:00:00+08:00' }],
      sports: { football: { ok: true, count: 1 } },
      message: 'BetExplorer 公開賽程頁：足球 1 場。',
    }),
    scoresway: async () => {
      throw new Error('Scoresway 頁面被拒絕。')
    },
    aiscore: async () => ({ ok: false, fixtures: [], sports: { football: { ok: false } }, message: '驗證頁。' }),
    leisu: async () => ({
      ok: true,
      partial: false,
      fixtures: leisu.filter((fixture) => fixture.sport === 'football'),
      sports: { football: { ok: true, count: 1 } },
      message: '雷速公開賽程：足球 1 場。',
    }),
  },
})
assert(live.accepted && live.job.state === 'success', 'one source failure still succeeds')
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
assert(manifest.demo === false, 'live rows are not demo')
assert(manifest.source_health.betexplorer.status === 'ok', 'betexplorer health')
assert(manifest.source_health.leisu.status === 'ok', 'leisu health')
assert(manifest.source_health.scoresway.status === 'down', 'scoresway health')
assert(manifest.source_health.aiscore.status === 'down', 'aiscore health')
assert(manifest.source_health.macau_lottery.status === 'down', 'macau stays out of this run')
const stored = JSON.parse(await readFile(path.join(dir, objectKey('football', '2026-10-30')), 'utf8'))
assert(stored.matches.length >= 1, 'stored live matches')
assert(stored.matches.some((match) => match.sources.some((cell) => cell.source_id === 'leisu' && cell.cell === 'ok')), 'leisu cell stored')
assert(stored.matches.every((match) => match.sources.find((cell) => cell.source_id === 'scoresway').cell === 'missing'), 'failed scoresway cell is missing')

if (previousStore === undefined) delete process.env.SCHEDULE_STORE_DIR
else process.env.SCHEDULE_STORE_DIR = previousStore
if (previousDriver === undefined) delete process.env.SCHEDULE_STORE
else process.env.SCHEDULE_STORE = previousDriver
await rm(dir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('source scrapers ok')
