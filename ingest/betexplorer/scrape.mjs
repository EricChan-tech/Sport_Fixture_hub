import { addCalendarDays } from '../../pipeline/time.mjs'
import { fetchText, shortMessage } from '../http.mjs'
import { parseBetexplorerHtml } from './parse.mjs'

const PAGE_GAP_MS = 2000

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pageToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Date-tab URLs the site itself uses. Football stays on the homepage calendar; basketball uses next or results. */
export function betexplorerPages(sport, dates, today = pageToday()) {
  const base = (process.env.BETEXPLORER_BASE || 'https://www.betexplorer.com').replace(/\/$/, '')
  const needed = new Set()
  for (const date of dates || []) {
    needed.add(date)
    needed.add(addCalendarDays(date, -1))
    needed.add(addCalendarDays(date, 1))
  }
  return [...needed].sort().map((date) => {
    const [year, month, day] = date.split('-')
    const query = `year=${year}&month=${Number(month)}&day=${Number(day)}`
    let url = `${base}/?${query}`
    if (sport === 'basketball') {
      const section = date < today ? 'results' : 'next'
      url = `${base}/basketball/${section}/?${query}`
    }
    return { sport, date, url }
  })
}

function hiddenCount(html, className) {
  const match = String(html || '').match(new RegExp(`class="${className}"[^>]*value="(\\d+)"`))
    || String(html || '').match(new RegExp(`value="(\\d+)"[^>]*class="${className}"`))
  return match ? Number(match[1]) : 0
}

async function loadHtml(load, url, sport) {
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(5000 * attempt)
    const response = await load(url, {
      sport,
      cookie: 'my_timezone=+8',
      referer: 'https://www.betexplorer.com/',
    })
    const html = response.text ?? String(response || '')
    lastStatus = response.status || 200
    if (lastStatus === 429 || lastStatus === 503) continue
    return html
  }
  const error = new Error(`BetExplorer 回應 ${lastStatus}。`)
  error.code = lastStatus === 429 ? 'BLOCKED' : 'HTTP'
  throw error
}

async function loadDatePage(page, load, options) {
  let html = await loadHtml(load, page.url, page.sport)
  let rows
  try {
    rows = parseBetexplorerHtml(html, page.sport)
  } catch (error) {
    if (!['EMPTY', 'STRUCTURE', 'BLOCKED'].includes(error?.code)) throw error
    await sleep(Math.max(options.gapMs ?? PAGE_GAP_MS, 3000))
    html = await loadHtml(load, page.url, page.sport)
    rows = parseBetexplorerHtml(html, page.sport)
  }
  const allCount = hiddenCount(html, 'all-count')
  const finalCount = hiddenCount(html, 'start-final')
  const init = html.match(/init_first_homepage_load\("([^"]+)"/)
  if (init && allCount > finalCount) {
    try {
      const base = new URL(page.url).origin
      const extraUrl = `${base}/gres/ajax/homepage-data.php?${init[1]}&tz=%2B8:00&start=${finalCount}&end=${allCount}`
      const extra = await loadHtml(load, extraUrl, page.sport)
      rows.push(...parseBetexplorerHtml(extra, page.sport))
    } catch {
      // the date tab already returned its first page
    }
  }
  return rows
}

export async function scrapeBetexplorer(options = {}) {
  const sports = (options.sports || ['football', 'basketball']).filter((sport) => sport === 'football' || sport === 'basketball')
  const dates = options.dates || []
  const load = options.fetchText || fetchText
  const fixtures = []
  const seen = new Set()
  const bySport = {}
  for (const sport of sports) {
    const pages = betexplorerPages(sport, dates)
    let parsed = 0
    let failures = 0
    let lastError = ''
    for (let index = 0; index < pages.length; index += 1) {
      if (index > 0) await sleep(options.gapMs ?? PAGE_GAP_MS)
      const page = pages[index]
      try {
        const rows = await loadDatePage(page, load, options)
        parsed += rows.length
        for (const row of rows) {
          if (dates.length > 0 && !dates.includes(row.date)) continue
          const key = row.external_id || [row.kickoff_at, row.home_name, row.away_name].join('|')
          if (seen.has(`${sport}|${key}`)) continue
          seen.add(`${sport}|${key}`)
          fixtures.push(row)
        }
      } catch (error) {
        failures += 1
        lastError = shortMessage(error, 'BetExplorer 抓取失敗。')
      }
    }
    const kept = fixtures.filter((fixture) => fixture.sport === sport).length
    bySport[sport] = parsed > 0
      ? { ok: true, count: kept, message: `已解析 ${kept} 場。` }
      : { ok: false, count: 0, message: lastError || 'BetExplorer 賽程頁沒有解析到場次。' }
    if (failures === pages.length) bySport[sport].ok = false
  }
  const failed = sports.filter((sport) => !bySport[sport]?.ok)
  const ok = failed.length < sports.length && fixtures.length > 0
  const partial = ok && failed.length > 0
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
      ? `BetExplorer 公開賽程頁：${parts.join('，')}。`
      : `BetExplorer 公開賽程頁抓取失敗。${parts.join('，')}。`,
  }
}
