import { addCalendarDays } from '../../pipeline/time.mjs'
import { fetchText, shortMessage } from '../http.mjs'
import { parseBetexplorerHtml } from './parse.mjs'

const PAGE_GAP_MS = 1000

function sleep(ms) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function betexplorerPages(sport, dates) {
  const base = (process.env.BETEXPLORER_BASE || 'https://www.betexplorer.com').replace(/\/$/, '')
  const needed = new Set()
  for (const date of dates || []) {
    needed.add(date)
    needed.add(addCalendarDays(date, -1))
  }
  return [...needed].sort().map((date) => {
    const [year, month, day] = date.split('-')
    const query = `year=${year}&month=${Number(month)}&day=${Number(day)}`
    const url = sport === 'basketball'
      ? `${base}/basketball/next/?${query}`
      : `${base}/?${query}`
    return { sport, date, url }
  })
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
        let response = await load(page.url, { sport })
        let rows
        try {
          rows = parseBetexplorerHtml(response.text ?? response, sport)
        } catch (error) {
          if (!['EMPTY', 'STRUCTURE', 'BLOCKED'].includes(error?.code)) throw error
          await sleep(options.gapMs ?? PAGE_GAP_MS)
          response = await load(page.url, { sport })
          rows = parseBetexplorerHtml(response.text ?? response, sport)
        }
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
