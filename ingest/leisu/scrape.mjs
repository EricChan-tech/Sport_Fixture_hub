import { openBrowser } from '../browser.mjs'
import { fetchText, shortMessage } from '../http.mjs'
import { parseLeisuHomeHtml, parseLeisuScheduleHtml } from './parse.mjs'

const PAGE_GAP_MS = 1000

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function compactDate(isoDate) {
  return String(isoDate || '').replaceAll('-', '')
}

export function leisuPages(sports, dates) {
  const base = (process.env.LEISU_BASE || 'https://www.leisu.com').replace(/\/$/, '')
  const mobile = (process.env.LEISU_MOBILE_BASE || 'https://m.leisu.com').replace(/\/$/, '')
  const pages = [{ kind: 'home', sport: null, url: `${base}/`, date: null }]
  for (const sport of sports || []) {
    const prefix = sport === 'basketball' ? '/live/lanqiu/saicheng' : '/live/saicheng'
    for (const date of dates || []) {
      pages.push({
        kind: 'schedule',
        sport,
        date,
        url: `${mobile}${prefix}-${compactDate(date)}`,
      })
    }
  }
  return pages
}

function dedupe(rows) {
  const fixtures = []
  const seen = new Set()
  for (const row of rows) {
    const key = row.external_id || [row.sport, row.kickoff_at, row.home_name, row.away_name].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push(row)
  }
  return fixtures
}

async function renderSchedule(pages, options) {
  const render = options.renderPage
  if (render === false) return []
  const schedulePages = pages.filter((page) => page.kind === 'schedule')
  if (schedulePages.length === 0) return []
  const rows = []
  if (render) {
    for (const page of schedulePages) {
      const html = await render(page.url, { sport: page.sport, date: page.date })
      rows.push(...parseLeisuScheduleHtml(html, page.sport, page.date))
    }
    return rows
  }
  const browser = await openBrowser()
  try {
    const stalled = new Set()
    for (let index = 0; index < schedulePages.length; index += 1) {
      const page = schedulePages[index]
      if (stalled.has(page.sport)) continue
      if (index > 0) await sleep(options.gapMs ?? PAGE_GAP_MS)
      const marker = page.sport === 'basketball' ? 'bkt-lier-base' : 'ftb-lier-base'
      const html = await browser.render(page.url, {
        timeoutMs: options.timeoutMs ?? 10000,
        readyExpression: `document.body && document.body.innerHTML.includes('${marker}')`,
      })
      const parsed = parseLeisuScheduleHtml(html, page.sport, page.date)
      rows.push(...parsed)
      const stillLoading = html.includes('oly-match-list') && !html.includes(marker)
      if (parsed.length === 0 && (stillLoading || /Access Denied|Just a moment/i.test(html))) stalled.add(page.sport)
    }
  } finally {
    browser.close()
  }
  return rows
}

export async function scrapeLeisu(options = {}) {
  const sports = (options.sports || ['football', 'basketball']).filter((sport) => sport === 'football' || sport === 'basketball')
  const dates = options.dates || []
  const pages = leisuPages(sports, dates)
  const load = options.fetchText || fetchText
  let homeRows = []
  let homeError = ''
  const home = pages.find((page) => page.kind === 'home')
  try {
    const response = await load(home.url)
    homeRows = parseLeisuHomeHtml(response.text ?? response)
  } catch (error) {
    homeError = shortMessage(error, '雷速首頁抓取失敗。')
  }
  let scheduleRows = []
  let scheduleError = ''
  try {
    scheduleRows = await renderSchedule(pages, options)
  } catch (error) {
    scheduleError = shortMessage(error, '雷速賽程頁抓取失敗。')
  }
  const fixtures = []
  const bySport = {}
  for (const sport of sports) {
    const scheduled = dedupe(scheduleRows.filter((row) => row.sport === sport && (dates.length === 0 || dates.includes(row.date))))
    const featured = dedupe(homeRows.filter((row) => row.sport === sport && (dates.length === 0 || dates.includes(row.date))))
    const chosen = scheduled.length > 0 ? scheduled : featured
    fixtures.push(...chosen)
    bySport[sport] = chosen.length > 0
      ? { ok: true, count: chosen.length, message: `${scheduled.length > 0 ? '賽程頁' : '首頁賽程'} ${chosen.length} 場。` }
      : { ok: false, count: 0, message: scheduleError || homeError || '雷速賽程頁沒有解析到場次。' }
  }
  const unique = dedupe(fixtures)
  const failed = sports.filter((sport) => !bySport[sport]?.ok)
  const ok = failed.length < sports.length && unique.length > 0
  const partial = ok && failed.length > 0
  const parts = sports.map((sport) => {
    const entry = bySport[sport]
    const label = sport === 'football' ? '足球' : '籃球'
    return entry?.ok ? `${label} ${entry.message}` : `${label}失敗（${entry?.message || '未知'}）`
  })
  return {
    ok,
    partial,
    fixtures: unique,
    sports: bySport,
    message: ok
      ? `雷速公開賽程：${parts.join('，')}。`
      : `雷速公開賽程抓取失敗。${parts.join('，')}。`,
  }
}
