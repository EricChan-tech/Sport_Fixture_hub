import { macauStamp } from '../clock.mjs'

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
  if (/Opta-fixture/i.test(text)) return false
  return /Access Denied|errors\.edgesuite\.net|Just a moment/i.test(text)
}

function classText(block, className) {
  const re = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:div|span|td|a)>`)
  const match = block.match(re)
  return match ? textContent(match[1]) : ''
}

/**
 * Opta fixtures widget markup that Scoresway draws on the public page.
 * `time[datetime]` is an absolute instant when the widget provides one.
 */
export function parseScoreswayHtml(html, sport) {
  const text = String(html || '')
  if (isBlockedPage(text)) {
    const error = new Error('Scoresway 頁面被拒絕，沒有賽程內容。')
    error.code = 'BLOCKED'
    throw error
  }
  const chunks = text.split(/class="[^"]*\bOpta-fixture\b/i).slice(1)
  const fixtures = []
  const seen = new Set()
  let pendingLeague = ''
  for (const chunk of chunks) {
    const league = classText(chunk, 'Opta-Competition') || classText(chunk, 'Opta-title') || pendingLeague
    if (league) pendingLeague = league
    const datetime = (chunk.match(/<time[^>]*datetime="([^"]+)"/i) || [])[1]
      || (chunk.match(/data-date="([^"]+)"/i) || [])[1]
      || ''
    const home = classText(chunk, 'Opta-Home') || classText(chunk, 'Opta-Team-Home')
    const away = classText(chunk, 'Opta-Away') || classText(chunk, 'Opta-Team-Away')
    if (!datetime || !home || !away) continue
    const when = new Date(datetime)
    if (Number.isNaN(when.getTime())) continue
    const stamp = macauStamp(when)
    const href = (chunk.match(/href="([^"]+)"/) || [])[1] || ''
    const externalId = (href.match(/([A-Za-z0-9]{6,})\/?$/) || [])[1] || ''
    const key = externalId || [stamp.kickoff_at, home, away].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push({
      source_id: 'scoresway',
      sport,
      date: stamp.date,
      kickoff_at: stamp.kickoff_at,
      league_name: league,
      home_name: home,
      away_name: away,
      status: 'scheduled',
      external_id: externalId,
    })
  }
  if (fixtures.length === 0) {
    const error = new Error(text.includes('pageData')
      ? 'Scoresway 頁面還沒畫出賽程。'
      : 'Scoresway 賽程頁沒有解析到場次。')
    error.code = text.includes('id="pageData"') ? 'EMPTY' : 'STRUCTURE'
    throw error
  }
  return fixtures
}
