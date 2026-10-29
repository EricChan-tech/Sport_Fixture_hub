import { openBrowser } from '../browser.mjs'
import { shortMessage } from '../http.mjs'
import { fixturesFromLeisuMatches, parseLeisuScheduleHtml } from './parse.mjs'

/** Reads the schedule page's own match list, including rows the list has not painted yet. */
export function leisuMatchesExpr(marker) {
  return `(() => {
  const el = document.querySelector('.${marker}')
  let node = el && el.__vue__
  let list = []
  while (node) {
    const data = node.$data || {}
    if (Array.isArray(data.matches) && data.matches[0] && data.matches[0].home) { list = data.matches; break }
    if (Array.isArray(data.match_notStart) && data.match_notStart[0] && data.match_notStart[0].home) { list = data.match_notStart; break }
    node = node.$parent
  }
  if (!list.length) {
    const root = document.querySelector('#__nuxt')
    const vm = root && root.__vue__
    function walk(current, depth) {
      if (!current || depth > 10) return
      const data = current.$data || {}
      for (const key of ['matches', 'match_notStart']) {
        const candidate = data[key]
        if (Array.isArray(candidate) && candidate.length > list.length && candidate[0] && candidate[0].home && candidate[0].away) list = candidate
      }
      for (const child of current.$children || []) walk(child, depth + 1)
    }
    if (vm) walk(vm, 0)
  }
  return JSON.stringify(list.map((match) => ({
    id: match.id,
    match_time: match.match_time,
    status: match.status,
    comp: (match.com_info && (match.com_info.name || match.com_info.short_name)) || '',
    home: match.home && (match.home.name || ''),
    away: match.away && (match.away.name || ''),
  })))
})()`
}

const PAGE_GAP_MS = 1000

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function compactDate(isoDate) {
  return String(isoDate || '').replaceAll('-', '')
}

export function leisuPages(sports, dates) {
  const mobile = (process.env.LEISU_MOBILE_BASE || 'https://m.leisu.com').replace(/\/$/, '')
  const pages = []
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

async function readSchedulePage(page, browser, options) {
  if (options.readMatches) {
    const value = await options.readMatches(page)
    if (value?.[0]?.kickoff_at) return value
    return fixturesFromLeisuMatches(value, page.sport)
  }
  const marker = page.sport === 'basketball' ? 'bkt-lier-base' : 'ftb-lier-base'
  const html = await browser.render(page.url, {
    timeoutMs: options.timeoutMs ?? 25000,
    readyExpression: `document.querySelectorAll('.${marker}').length > 0`,
  })
  if (browser.evaluate) {
    const raw = await browser.evaluate(leisuMatchesExpr(marker))
    try {
      const matches = JSON.parse(raw || '[]')
      const parsed = fixturesFromLeisuMatches(matches, page.sport)
      if (parsed.length > 0) return parsed
    } catch {
      // fall through to the painted rows
    }
  }
  return parseLeisuScheduleHtml(html, page.sport, page.date)
}

async function renderSchedule(pages, options) {
  const render = options.renderPage
  if (render === false && !options.readMatches) return []
  const schedulePages = pages.filter((page) => page.kind === 'schedule')
  if (schedulePages.length === 0) return []
  const rows = []
  if (options.readMatches && !render) {
    for (const page of schedulePages) rows.push(...await readSchedulePage(page, null, options))
    return rows
  }
  if (render) {
    for (const page of schedulePages) {
      const html = await render(page.url, { sport: page.sport, date: page.date })
      const raw = options.readMatches ? await options.readMatches(page) : null
      rows.push(...(raw ? fixturesFromLeisuMatches(raw, page.sport) : parseLeisuScheduleHtml(html, page.sport, page.date)))
    }
    return rows
  }
  const browser = await openBrowser()
  try {
    const stalled = new Set()
    for (let index = 0; index < schedulePages.length; index += 1) {
      const page = schedulePages[index]
      if (stalled.has(page.sport)) continue
      if (rows.length > 0) await sleep(options.gapMs ?? PAGE_GAP_MS)
      let parsed = await readSchedulePage(page, browser, options)
      if (parsed.length === 0) {
        await sleep(2000)
        parsed = await readSchedulePage(page, browser, options)
      }
      rows.push(...parsed)
      if (parsed.length === 0) stalled.add(page.sport)
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
    fixtures.push(...scheduled)
    bySport[sport] = scheduled.length > 0
      ? { ok: true, count: scheduled.length, message: `m.leisu.com 賽程 ${scheduled.length} 場` }
      : { ok: false, count: 0, message: scheduleError || '雷速賽程頁沒有解析到場次。' }
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
