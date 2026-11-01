import { openBrowser } from '../browser.mjs'
import { fetchText, shortMessage } from '../http.mjs'
import { fixturesFromLeisuMatches, isBlockedPage, parseLeisuHomeHtml } from './parse.mjs'

export function leisuHomeUrl() {
  const mobile = (process.env.LEISU_MOBILE_BASE || process.env.LEISU_BASE || 'https://m.leisu.com').replace(/\/$/, '')
  return `${mobile}/`
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

function emptyHomeError(html) {
  const blocked = isBlockedPage(html)
  const error = new Error(blocked ? '雷速當日頁被拒絕，沒有賽程內容。' : '雷速當日頁沒有解析到場次。')
  error.code = blocked ? 'BLOCKED' : 'EMPTY'
  return error
}

async function renderHome(url, options) {
  if (options.renderPage) return options.renderPage(url, { sport: 'football' })
  const browser = await openBrowser()
  try {
    return await browser.render(url, {
      timeoutMs: options.timeoutMs ?? 15000,
      readyExpression: "document.documentElement.outerHTML.includes('data-ssr-matches') || document.querySelector('.match-card, .match-item')",
    })
  } finally {
    browser.close()
  }
}

/** Public daily page. The server writes the visible list into `data-ssr-matches`. */
async function loadHome(options) {
  const url = leisuHomeUrl()
  const load = options.fetchText || fetchText
  let text = ''
  try {
    const response = await load(url, { referer: url })
    text = response.text ?? String(response || '')
    const parsed = parseLeisuHomeHtml(text)
    if (parsed.length > 0) return { rows: parsed, url }
  } catch (error) {
    if (options.renderPage === false) throw error
  }
  if (options.renderPage === false) throw emptyHomeError(text)
  const html = await renderHome(url, options)
  const again = parseLeisuHomeHtml(html)
  if (again.length > 0) return { rows: again, url }
  throw emptyHomeError(html || text)
}

async function rowsFromReadMatches(options, sports, dates) {
  const rows = []
  const needed = dates.length > 0 ? dates : ['']
  for (const sport of sports) {
    for (const date of needed) {
      const value = await options.readMatches({ kind: 'home', sport, date, url: leisuHomeUrl() })
      if (value?.[0]?.kickoff_at) rows.push(...value)
      else rows.push(...fixturesFromLeisuMatches(value, sport))
    }
  }
  return { rows, url: leisuHomeUrl() }
}

export async function scrapeLeisu(options = {}) {
  const sports = (options.sports || ['football', 'basketball']).filter((sport) => sport === 'football' || sport === 'basketball')
  const dates = options.dates || []
  let scheduleRows = []
  let pageUrl = leisuHomeUrl()
  let scheduleError = ''
  let parsed = false
  try {
    const loaded = options.readMatches
      ? await rowsFromReadMatches(options, sports, dates)
      : await loadHome(options)
    scheduleRows = loaded.rows
    pageUrl = loaded.url
    parsed = true
  } catch (error) {
    scheduleError = shortMessage(error, '雷速當日頁抓取失敗。')
  }
  const fixtures = []
  const bySport = {}
  for (const sport of sports) {
    const scheduled = dedupe(scheduleRows.filter((row) => row.sport === sport && (dates.length === 0 || dates.includes(row.date))))
    fixtures.push(...scheduled)
    const label = sport === 'football' ? '足球' : '籃球'
    bySport[sport] = scheduled.length > 0
      ? { ok: true, count: scheduled.length, url: pageUrl, message: `m.leisu.com 當日頁 ${scheduled.length} 場` }
      : {
        ok: false,
        count: 0,
        url: pageUrl,
        message: scheduleError || (parsed ? `m.leisu.com 當日頁沒有這日的${label}。` : '雷速當日頁沒有解析到場次。'),
      }
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
