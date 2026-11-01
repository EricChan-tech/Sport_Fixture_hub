import { macauStamp, macauWallTime } from '../clock.mjs'

function decode(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function textContent(html) {
  return decode(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isBlockedPage(html) {
  const text = String(html || '')
  if (/data-ssr-matches|match-card|match-item|ftb-lier-base|bkt-lier-base|list-title/.test(text)) return false
  return /驗證碼|Access Denied|Just a moment|cf-browser-verification/i.test(text)
}

function headingDate(value) {
  const match = String(value || '').match(/(\d{2})\/(\d{1,2})\/(\d{1,2})/)
  if (!match) return null
  const year = Number(match[1])
  const fullYear = year < 100 ? 2000 + year : year
  return `${fullYear}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
}

function teamName(block, kind) {
  const titled = block.match(new RegExp(`class="[^"]*\\b${kind}\\b[^"]*"[\\s\\S]*?<p[^>]*title="([^"]*)"`))
  if (titled) return decode(titled[1]).trim()
  const plain = block.match(new RegExp(`class="[^"]*\\b${kind}\\b[^"]*"[\\s\\S]*?<p[^>]*>([^<]*)`))
  return plain ? textContent(plain[1]) : ''
}

function sportOf(block, fallback) {
  if (/\/lanqiu\/|icon-lanqiu/.test(block)) return 'basketball'
  if (/icon-zuqiu|\/detail-\d+/.test(block)) return 'football'
  return fallback
}

function pushRow(fixtures, seen, row) {
  if (!row.home_name || !row.away_name || !row.kickoff_at) return
  const key = row.external_id || [row.sport, row.kickoff_at, row.home_name, row.away_name].join('|')
  if (seen.has(key)) return
  seen.add(key)
  fixtures.push(row)
}

/** Homepage cards. The visible clock is China time, same offset as Asia/Macau. */
export function parseLeisuHomeHtml(html) {
  const ssr = readLeisuSsrMatches(html)
  if (ssr?.length) {
    const rows = fixturesFromLeisuMatches(ssr)
    if (rows.length > 0) return rows
  }
  const legacy = parseLegacyHomeHtml(html)
  if (legacy.length > 0) return legacy
  return parseMatchCards(html)
}

function parseLegacyHomeHtml(html) {
  const text = String(html || '')
  const fixtures = []
  const seen = new Set()
  const sections = text.split(/class="list-title"/).slice(1)
  for (const section of sections) {
    const date = headingDate(textContent((section.match(/<span[^>]*>([^<]+)<\/span>/) || [])[1] || ''))
    if (!date) continue
    const items = section.match(/<a\b[^>]*\bmatch-item\b[^>]*>[\s\S]*?<\/a>/g) || []
    for (const item of items) {
      const clock = item.match(/\b(\d{1,2}):(\d{2})\b/)
      if (!clock) continue
      const stamp = macauWallTime(date, clock[1], clock[2])
      const league = textContent((item.match(/title="[^"]*"[^>]*>([^<]+)</) || [])[1] || '')
      const href = (item.match(/href="([^"]*detail-\d+[^"]*)"/) || [])[1] || ''
      const externalId = (href.match(/detail-(\d+)/) || [])[1] || ''
      pushRow(fixtures, seen, {
        source_id: 'leisu',
        sport: sportOf(item, 'football'),
        date: stamp.date,
        kickoff_at: stamp.kickoff_at,
        league_name: league,
        home_name: teamName(item, 'first-team'),
        away_name: teamName(item, 'second-team'),
        status: 'scheduled',
        external_id: externalId,
      })
    }
  }
  return fixtures
}

function statusFrom(code) {
  const value = Number(code)
  if (value === 1) return 'scheduled'
  if (value === 8) return 'finished'
  if (value === 9 || value === 13) return 'postponed'
  if (value === 12) return 'cancelled'
  if (value > 1 && value < 8) return 'live'
  return 'scheduled'
}

function teamLabel(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') return String(value.name || value.name_zht || value.name_en || '').trim()
  return String(value).trim()
}

function leagueLabel(match) {
  if (!match) return ''
  if (typeof match.comp === 'string') return match.comp.trim()
  const comp = match.comp && typeof match.comp === 'object' ? (match.comp.name || match.comp.name_zht || '') : ''
  return String(match.league || match.title || comp || match.league_name || '').trim()
}

function sportOfMatch(match, fallback) {
  const id = Number(match?.sport_id || match?.sportId || 0)
  if (id === 1) return 'football'
  if (id === 2) return 'basketball'
  if (match?.category === 'football' || match?.category === 'basketball') return match.category
  if (match?.sport === 'football' || match?.sport === 'basketball') return match.sport
  if (fallback === 'football' || fallback === 'basketball') return fallback
  return ''
}

function statusOf(match) {
  const state = String(match?.state || '')
  if (match?.finished === true || state === '完') return 'finished'
  if (match?.live === true || match?.playing === true) return 'live'
  if (/延期|推迟|中断/.test(state)) return 'postponed'
  if (/取消/.test(state)) return 'cancelled'
  return statusFrom(match?.status ?? match?.status_id ?? match?.status_code)
}

/** Match list from the schedule page or the homepage `data-ssr-matches` payload. */
export function fixturesFromLeisuMatches(matches, sport) {
  const fixtures = []
  const seen = new Set()
  for (const match of matches || []) {
    const when = Number(match.match_time || match.matchTime)
    if (!when) continue
    const rowSport = sportOfMatch(match, sport)
    if (!rowSport) continue
    const stamp = macauStamp(new Date(when * 1000))
    const home = teamLabel(match.home || match.homeTeam || match.home_name)
    const away = teamLabel(match.away || match.awayTeam || match.away_name)
    if (!home || !away) continue
    pushRow(fixtures, seen, {
      source_id: 'leisu',
      sport: rowSport,
      date: stamp.date,
      kickoff_at: stamp.kickoff_at,
      league_name: leagueLabel(match),
      home_name: home,
      away_name: away,
      status: statusOf(match),
      external_id: String(match.id || match.matchId || ''),
    })
  }
  return fixtures
}

/** Homepage attribute written by the server before the list is scrolled. */
export function readLeisuSsrMatches(html) {
  const match = String(html || '').match(/data-ssr-matches="([^"]*)"/)
  if (!match) return null
  try {
    const parsed = JSON.parse(decode(match[1]))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function macauYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Macau', year: 'numeric' }).format(now))
}

function monthDay(label) {
  const match = String(label || '').match(/(\d{1,2})月(\d{1,2})日/)
  if (!match) return null
  return { month: Number(match[1]), day: Number(match[2]) }
}

/**
 * Visible homepage cards. Basketball paints the away side on the left,
 * so the `match-team--home` class is the away team for that sport.
 */
function parseMatchCards(html) {
  const text = String(html || '')
  const fixtures = []
  const seen = new Set()
  let year = macauYear()
  let currentDate = null
  let previousMonth = null
  const parts = text.split(/(?=<div class="home-date|<article class="match-card)/)
  for (const part of parts) {
    if (part.startsWith('<div class="home-date')) {
      const label = textContent((part.match(/>([^<]*\d+月\d+日[^<]*)</) || [])[1] || '')
      const day = monthDay(label)
      if (!day) continue
      if (previousMonth === 12 && day.month === 1) year += 1
      previousMonth = day.month
      currentDate = `${year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`
      continue
    }
    if (!part.startsWith('<article class="match-card') || !currentDate) continue
    const end = part.indexOf('</article>')
    const article = end >= 0 ? part.slice(0, end + 10) : part
    const clock = article.match(/<time[^>]*>\s*(\d{1,2}):(\d{2})/)
    if (!clock) continue
    const sport = /match-card--basketball/.test(article) ? 'basketball' : (/match-card--football/.test(article) ? 'football' : '')
    if (!sport) continue
    const league = textContent((article.match(/class="[^"]*\bmatch-card__league\b[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '')
    const left = textContent((article.match(/match-team--home[\s\S]*?<span[^>]*>([^<]*)/) || [])[1] || '')
    const right = textContent((article.match(/match-team--away[\s\S]*?<span[^>]*>([^<]*)/) || [])[1] || '')
    const home = sport === 'basketball' ? right : left
    const away = sport === 'basketball' ? left : right
    const stamp = macauWallTime(currentDate, clock[1], clock[2])
    pushRow(fixtures, seen, {
      source_id: 'leisu',
      sport,
      date: stamp.date,
      kickoff_at: stamp.kickoff_at,
      league_name: league,
      home_name: home,
      away_name: away,
      status: 'scheduled',
      external_id: '',
    })
  }
  return fixtures
}

/** Mobile schedule rows drawn on /live/saicheng and /live/lanqiu/saicheng. */
export function parseLeisuScheduleHtml(html, sport, pageDate) {
  const text = String(html || '')
  const fixtures = []
  const seen = new Set()
  const marker = sport === 'basketball' ? 'bkt-lier-base' : 'ftb-lier-base'
  const rows = text.split(new RegExp(`class="[^"]*\\b${marker}\\b`)).slice(1)
  for (const row of rows) {
    const league = textContent((row.match(/class="[^"]*\bcom[-_]name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '')
    const clock = row.match(/class="[^"]*(?:matchstart-time|time)[^"]*"[^>]*>\s*(\d{1,2}):(\d{2})/)
    if (!pageDate || !clock) continue
    const stamp = macauWallTime(pageDate, clock[1], clock[2])
    const homeClass = sport === 'basketball' ? 'home-name' : 'team-home'
    const awayClass = sport === 'basketball' ? 'away-name' : 'team-away'
    const href = (row.match(/href="([^"]*detail-\d+[^"]*)"/) || [])[1] || ''
    pushRow(fixtures, seen, {
      source_id: 'leisu',
      sport,
      date: stamp.date,
      kickoff_at: stamp.kickoff_at,
      league_name: league,
      home_name: teamName(row, homeClass) || textContent((row.match(new RegExp(`class="[^"]*${homeClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`)) || [])[1] || ''),
      away_name: teamName(row, awayClass) || textContent((row.match(new RegExp(`class="[^"]*${awayClass}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`)) || [])[1] || ''),
      status: 'scheduled',
      external_id: (href.match(/detail-(\d+)/) || [])[1] || '',
    })
  }
  return fixtures
}
