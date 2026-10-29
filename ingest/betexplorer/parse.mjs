/** Parse public BetExplorer schedule HTML. Times on the anonymous page follow Europe/Prague; `data-ts` is the absolute kickoff. */

import { macauStamp, zonedWallTimeToDate } from '../clock.mjs'

const PAGE_ZONE = 'Europe/Prague'
const DT_RE = /(\d{1,2}),(\d{1,2}),(\d{4}),(\d{1,2}),(\d{2})/

function decode(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function textContent(html) {
  return decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBlockedPage(html) {
  const text = String(html || '')
  return /Access Denied|Just a moment|cf-browser-verification/i.test(text) && !text.includes('data-dt')
}

function stampFrom(block) {
  const ts = block.match(/data-ts="(\d+)"/)
  if (ts) return macauStamp(new Date(Number(ts[1]) * 1000))
  const dt = block.match(/data-dt="(\d{1,2},\d{1,2},\d{4},\d{1,2},\d{2})"/)
  if (!dt) return null
  const parts = dt[1].match(DT_RE)
  if (!parts) return null
  return macauStamp(zonedWallTimeToDate({
    day: Number(parts[1]),
    month: Number(parts[2]),
    year: Number(parts[3]),
    hour: Number(parts[4]),
    minute: Number(parts[5]),
  }, PAGE_ZONE))
}

function statusFrom(block) {
  const label = textContent((block.match(/data-live-cell="time"[^>]*>([\s\S]*?)<\//) || [])[1] || '')
  if (/FIN|FT|AET|AP/i.test(label)) return 'finished'
  if (/POSTP|CANC/i.test(label)) return 'postponed'
  return 'scheduled'
}

function pushFixture(fixtures, seen, fixture) {
  if (!fixture?.home_name || !fixture.away_name || !fixture.kickoff_at) return
  const key = fixture.external_id || [fixture.kickoff_at, fixture.home_name, fixture.away_name].join('|')
  if (seen.has(key)) return
  seen.add(key)
  fixtures.push(fixture)
}

function parseList(html, sport) {
  const fixtures = []
  const seen = new Set()
  const sections = String(html || '').split(/<li[^>]*class="[^"]*\bjs-tournament\b[^"]*"/).slice(1)
  for (const section of sections) {
    const league = textContent((section.match(/table-main__leaguesNames[^>]*>([\s\S]*?)<\/p>/) || [])[1]
      || (section.match(/data-league-name="([^"]*)"/) || [])[1]
      || '')
    const blocks = section.match(/<li\b[^>]*data-event-id="[^"]+"[^>]*>[\s\S]*?(?=<li\b[^>]*data-event-id="|$)/g) || []
    for (const block of blocks) {
      const externalId = (block.match(/data-event-id="([^"]+)"/) || [])[1] || ''
      const stamp = stampFrom(block)
      const home = textContent((block.match(/table-main__participantHome[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '')
      const away = textContent((block.match(/table-main__participantAway[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '')
      if (!stamp) continue
      pushFixture(fixtures, seen, {
        source_id: 'betexplorer',
        sport,
        date: stamp.date,
        kickoff_at: stamp.kickoff_at,
        league_name: league,
        home_name: home,
        away_name: away,
        status: statusFrom(block),
        external_id: externalId,
      })
    }
  }
  return fixtures
}

function parseTable(html, sport) {
  const fixtures = []
  const seen = new Set()
  const sections = String(html || '').split(/<tr[^>]*class="[^"]*\bjs-tournament\b[^"]*"/).slice(1)
  for (const section of sections) {
    const league = textContent((section.match(/table-main__tournament[^>]*>([\s\S]*?)<\/a>/) || [])[1]
      || (section.match(/data-league-name="([^"]*)"/) || [])[1]
      || '')
    const rows = section.split(/<tr\b/).slice(1)
    for (const row of rows) {
      if (!row.includes('data-dt=')) continue
      const stamp = stampFrom(row)
      const home = textContent((row.match(/table-main__teamLine--home[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '')
      const away = textContent((row.match(/table-main__teamLine--away[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '')
      const href = (row.match(/href="([^"]+)"/) || [])[1] || ''
      const externalId = (href.match(/\/([^/]+)\/?$/) || [])[1] || ''
      if (!stamp) continue
      pushFixture(fixtures, seen, {
        source_id: 'betexplorer',
        sport,
        date: stamp.date,
        kickoff_at: stamp.kickoff_at,
        league_name: league,
        home_name: home,
        away_name: away,
        status: /table-main__time--fin|>FIN</.test(row) ? 'finished' : statusFrom(row),
        external_id: externalId,
      })
    }
  }
  return fixtures
}

export function parseBetexplorerHtml(html, sport) {
  const text = String(html || '')
  if (isBlockedPage(text)) {
    const error = new Error('BetExplorer 頁面被拒絕，沒有賽程內容。')
    error.code = 'BLOCKED'
    throw error
  }
  const fixtures = [...parseList(text, sport), ...parseTable(text, sport)]
  if (!text.includes('data-dt') && fixtures.length === 0) {
    const error = new Error('BetExplorer 賽程頁結構不符，找不到場次。')
    error.code = 'STRUCTURE'
    throw error
  }
  if (fixtures.length === 0) {
    const error = new Error('BetExplorer 賽程頁沒有解析到場次。')
    error.code = 'EMPTY'
    throw error
  }
  return fixtures
}
