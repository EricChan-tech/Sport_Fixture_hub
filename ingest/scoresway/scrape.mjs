import { openBrowser } from '../browser.mjs'
import { fetchText, shortMessage } from '../http.mjs'
import { isBlockedPage, parseScoreswayHtml } from './parse.mjs'

const PAGE_GAP_MS = 1000

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function scoreswayPages(sports) {
  const base = (process.env.SCOREWAY_BASE || 'https://www.scoresway.com').replace(/\/$/, '')
  const paths = {
    football: '/en_GB/soccer',
    basketball: '/en_GB/basketball',
  }
  return (sports || []).filter((sport) => paths[sport]).map((sport) => ({
    sport,
    url: `${base}${paths[sport]}`,
  }))
}

async function readRendered(url, sport, options) {
  if (options.renderPage) return options.renderPage(url, { sport })
  const browser = await openBrowser()
  try {
    return await browser.render(url, {
      timeoutMs: options.timeoutMs ?? 12000,
      readyExpression: "document.body && document.body.innerHTML.includes('Opta-fixture')",
    })
  } finally {
    browser.close()
  }
}

async function loadPage(page, options) {
  const load = options.fetchText || fetchText
  const response = await load(page.url, { sport: page.sport })
  const text = response.text ?? response
  if (!isBlockedPage(text)) {
    try {
      return parseScoreswayHtml(text, page.sport)
    } catch (error) {
      if (error?.code !== 'EMPTY' && error?.code !== 'STRUCTURE') throw error
    }
  }
  if (options.renderPage === false) {
    const error = new Error(isBlockedPage(text) ? 'Scoresway 頁面被拒絕，沒有賽程內容。' : 'Scoresway 頁面沒有賽程內容。')
    error.code = isBlockedPage(text) ? 'BLOCKED' : 'EMPTY'
    throw error
  }
  return parseScoreswayHtml(await readRendered(page.url, page.sport, options), page.sport)
}

export async function scrapeScoresway(options = {}) {
  const sports = (options.sports || ['football', 'basketball']).filter((sport) => sport === 'football' || sport === 'basketball')
  const dates = options.dates || []
  const pages = scoreswayPages(sports)
  const fixtures = []
  const bySport = {}
  for (let index = 0; index < pages.length; index += 1) {
    if (index > 0) await sleep(options.gapMs ?? PAGE_GAP_MS)
    const page = pages[index]
    try {
      const rows = await loadPage(page, options)
      const kept = rows.filter((row) => dates.length === 0 || dates.includes(row.date))
      fixtures.push(...kept)
      bySport[page.sport] = { ok: true, count: kept.length, url: page.url, message: `已解析 ${kept.length} 場。` }
    } catch (error) {
      bySport[page.sport] = { ok: false, count: 0, url: page.url, message: shortMessage(error, 'Scoresway 抓取失敗。') }
    }
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
      ? `Scoresway 公開賽程頁：${parts.join('，')}。`
      : `Scoresway 公開賽程頁抓取失敗。${parts.join('，')}。`,
  }
}
