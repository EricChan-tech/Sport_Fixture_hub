import { macauWallTime } from '../clock.mjs'

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
  if (text.includes('match-item') || text.includes('ftb-lier-base') || text.includes('bkt-lier-base')) return false
  return /驗證碼|AliyunCaptcha|Access Denied|Just a moment/i.test(text) && !text.includes('list-title')
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
