import vm from 'node:vm'
import { macauStamp } from '../clock.mjs'

const UNSAFE = /fetch\s*\(|eval\s*\(|document\.|XMLHttpRequest|WebSocket|import\s*\(|Function\s*\(/
const SCRIPT_END = `<${'/script>'}`

export function isChallengePage(html) {
  const text = String(html || '')
  if (text.includes('window.__NUXT__') && text.includes('matchTime')) return false
  return /Just a moment|cf-browser-verification|cf-mitigated|challenges\.cloudflare\.com/i.test(text)
}

function statusFrom(code) {
  if (code === 2) return 'live'
  if (code === 3) return 'finished'
  if (code === 4 || code === 8) return 'postponed'
  if (code === 5) return 'cancelled'
  return 'scheduled'
}

function competitionName(match, names) {
  const direct = match.competition?.name || match.com_info?.name || match.league_name || ''
  if (direct) return String(direct)
  const id = match.competition?.id || match.comp_id || ''
  return names.get(id) || ''
}

function rememberName(names, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  if (value.matchTime || value.homeTeam) return
  if (value.id && value.name) names.set(String(value.id), String(value.name))
}

function walk(value, names, matches, seen, depth) {
  if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    const rows = value.filter((item) => item && typeof item === 'object' && item.matchTime && item.homeTeam?.name && item.awayTeam?.name)
    if (rows.length > 0) {
      matches.push(...rows)
      for (const row of rows) {
        rememberName(names, row.competition)
        rememberName(names, row.com_info)
      }
      return
    }
    for (const item of value) walk(item, names, matches, seen, depth + 1)
    return
  }
  rememberName(names, value)
  for (const child of Object.values(value)) walk(child, names, matches, seen, depth + 1)
}

export function fixturesFromAiscoreState(state, sport) {
  const names = new Map()
  const matches = []
  const root = sport && state?.[sport] ? state[sport] : state
  walk(root, names, matches, new Set(), 0)
  if (sport && root !== state) {
    const extraNames = new Map()
    walk(state, extraNames, [], new Set(), 0)
    for (const [id, name] of extraNames) if (!names.has(id)) names.set(id, name)
  }
  const sportId = sport === 'basketball' ? 2 : 1
  const fixtures = []
  const seen = new Set()
  for (const match of matches) {
    if (match.sportId && Number(match.sportId) !== sportId) continue
    const when = new Date(Number(match.matchTime) * 1000)
    if (Number.isNaN(when.getTime())) continue
    const stamp = macauStamp(when)
    const home = String(match.homeTeam.name || '').trim()
    const away = String(match.awayTeam.name || '').trim()
    if (!home || !away) continue
    const externalId = String(match.id || '')
    const key = externalId || [stamp.kickoff_at, home, away].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push({
      source_id: 'aiscore',
      sport,
      date: stamp.date,
      kickoff_at: stamp.kickoff_at,
      league_name: competitionName(match, names),
      home_name: home,
      away_name: away,
      status: statusFrom(Number(match.matchStatus)),
      external_id: externalId,
    })
  }
  return fixtures
}

export function readAiscoreState(html) {
  const text = String(html || '')
  const start = text.indexOf('window.__NUXT__=')
  if (start < 0) return null
  const end = text.indexOf(SCRIPT_END, start)
  const script = text.slice(start, end > start ? end : undefined)
  if (!script.startsWith('window.__NUXT__=(function(')) return null
  if (UNSAFE.test(script)) return null
  const context = { globalThis: {} }
  vm.runInNewContext(script.replace('window.__NUXT__=', 'globalThis.__NUXT__='), context, { timeout: 2000 })
  return context.globalThis.__NUXT__?.state || null
}

export function parseAiscoreHtml(html, sport) {
  const text = String(html || '')
  if (isChallengePage(text)) {
    const error = new Error('AiScore 頁面停在驗證，沒有賽程內容。')
    error.code = 'BLOCKED'
    throw error
  }
  const state = readAiscoreState(text)
  if (!state) {
    const error = new Error('AiScore 賽程頁結構不符，找不到頁面資料。')
    error.code = 'STRUCTURE'
    throw error
  }
  const fixtures = fixturesFromAiscoreState(state, sport)
  if (fixtures.length === 0) {
    const error = new Error('AiScore 賽程頁沒有解析到場次。')
    error.code = 'EMPTY'
    throw error
  }
  return fixtures
}
