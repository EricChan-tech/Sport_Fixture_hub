/** Parse the rendered public Macau fixture pages into schedule rows. */

const DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/
const TIME_RE = /class="time dd"[^>]*>\s*(\d{1,2}):(\d{2})/
const LEAGUE_RE = /class="league dd"[\s\S]*?<p>([^<]*)<\/p>/

export function isChallengePage(html) {
  const text = String(html || '')
  if (text.includes('<h1>') && text.includes('class="row ')) return false
  return /acw_sc__v2|aliyunwaf_/.test(text)
}

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
  return decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseHeadingDate(heading) {
  const match = textContent(heading).match(DATE_RE)
  if (!match) return null
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`
}

function classText(row, className) {
  const re = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</div>`)
  const match = row.match(re)
  return match ? textContent(match[1]) : ''
}

function teamsFromRow(row) {
  const home = classText(row, 'home')
  const away = classText(row, 'away')
  return { home, away }
}

function parseRow(row, sport, date) {
  const league = textContent((row.match(LEAGUE_RE) || [])[1] || '')
  const time = row.match(TIME_RE)
  const { home, away } = teamsFromRow(row)
  if (!league || !time || !home || !away) return null
  const hour = pad(time[1])
  const minute = time[2]
  return {
    source_id: 'macau_lottery',
    sport,
    date,
    kickoff_at: `${date}T${hour}:${minute}:00+08:00`,
    league_name: league,
    home_name: home,
    away_name: away,
    status: 'scheduled',
  }
}

/**
 * @param {string} html rendered fixture page
 * @param {'football' | 'basketball'} sport
 */
export function parseFixtureHtml(html, sport) {
  const text = String(html || '')
  if (isChallengePage(text)) {
    const error = new Error('澳彩頁面回傳驗證頁，沒有賽程內容。')
    error.code = 'BLOCKED'
    throw error
  }
  if (!text.includes('<h1>')) {
    const error = new Error('澳彩賽程頁結構不符，找不到日期標題。')
    error.code = 'STRUCTURE'
    throw error
  }
  const fixtures = []
  const sections = text.split(/<h1>/i).slice(1)
  for (const section of sections) {
    const close = section.indexOf('</h1>')
    if (close < 0) continue
    const date = parseHeadingDate(section.slice(0, close))
    if (!date) continue
    const body = section.slice(close + 5)
    for (const row of body.split(/<div class="row /).slice(1)) {
      const fixture = parseRow(row, sport, date)
      if (fixture) fixtures.push(fixture)
    }
  }
  if (fixtures.length === 0) {
    const error = new Error('澳彩賽程頁沒有解析到場次。')
    error.code = 'EMPTY'
    throw error
  }
  return fixtures
}
