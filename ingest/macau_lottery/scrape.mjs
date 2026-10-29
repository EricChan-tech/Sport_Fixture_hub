import { createHash } from 'node:crypto'
import { SOURCE_IDS } from '../../pipeline/constants.mjs'
import { attachCatalogIds } from './names.mjs'
import { parseFixtureHtml } from './parse.mjs'
import { renderPublicPage } from './render.mjs'

/** Public fixture pages. `lang=cn` on this site is the Traditional Chinese (zh-HK) view. */
export const MACAU_FIXTURE_PAGES = {
  football: 'https://www.macauslot.com/cn/soccer/fixture.html?lang=cn',
  basketball: 'https://www.macauslot.com/cn/basketball/fixture.html?lang=cn',
}

const PAGE_GAP_MS = 2000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shortMessage(error) {
  const message = error instanceof Error ? error.message : '澳彩抓取失敗。'
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

export async function scrapeMacauLottery(options = {}) {
  const sports = (options.sports || ['football', 'basketball']).filter((sport) => MACAU_FIXTURE_PAGES[sport])
  const render = options.renderPage || renderPublicPage
  const fixtures = []
  const bySport = {}
  let failures = 0
  for (let index = 0; index < sports.length; index += 1) {
    const sport = sports[index]
    if (index > 0) await sleep(options.gapMs ?? PAGE_GAP_MS)
    const url = MACAU_FIXTURE_PAGES[sport]
    try {
      const html = await render(url, { sport })
      const parsed = await attachCatalogIds(parseFixtureHtml(html, sport))
      fixtures.push(...parsed)
      bySport[sport] = { ok: true, count: parsed.length, url, message: `已解析 ${parsed.length} 場。` }
    } catch (error) {
      failures += 1
      bySport[sport] = { ok: false, count: 0, url, message: shortMessage(error) }
    }
  }
  const ok = failures < sports.length && fixtures.length > 0
  const partial = ok && failures > 0
  const parts = sports.map((sport) => {
    const entry = bySport[sport]
    const label = sport === 'football' ? '足球' : '籃球'
    return entry?.ok ? `${label} ${entry.count} 場` : `${label}失敗（${entry?.message || '未知'}）`
  })
  return {
    ok,
    partial,
    fixtures,
    sports: bySport,
    message: ok
      ? `澳彩公開賽程頁：${parts.join('，')}。`
      : `澳彩公開賽程頁抓取失敗。${parts.join('，')}。`,
  }
}

function matchId(fixture) {
  const stamp = createHash('sha1')
    .update([fixture.sport, fixture.kickoff_at, fixture.league_name, fixture.home_name, fixture.away_name].join('|'))
    .digest('hex')
    .slice(0, 12)
  return `macau-${fixture.sport}-${fixture.date}-${stamp}`
}

export function fixturesToDay({ sport, date, fixtures, updatedAt }) {
  const matches = (fixtures || [])
    .filter((fixture) => fixture.sport === sport && fixture.date === date)
    .map((fixture) => ({
      match_id: matchId(fixture),
      sport,
      competition_id: fixture.competition_id || '',
      league_name: fixture.league_name,
      home_name: fixture.home_name,
      away_name: fixture.away_name,
      home_team_id: fixture.home_team_id || '',
      away_team_id: fixture.away_team_id || '',
      kickoff_at: fixture.kickoff_at,
      status: fixture.status || 'scheduled',
      sources: SOURCE_IDS.map((sourceId) => {
        if (sourceId !== 'macau_lottery') return { source_id: sourceId, cell: 'missing' }
        return {
          source_id: 'macau_lottery',
          cell: 'ok',
          kickoff_at: fixture.kickoff_at,
          league_name: fixture.league_name,
          home_name: fixture.home_name,
          away_name: fixture.away_name,
        }
      }),
      has_macau: true,
      confidence: 1,
      updated_at: updatedAt,
    }))
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || a.match_id.localeCompare(b.match_id))
  return {
    schema_version: '1.0.0',
    sport,
    date,
    timezone: 'Asia/Macau',
    matches,
  }
}
