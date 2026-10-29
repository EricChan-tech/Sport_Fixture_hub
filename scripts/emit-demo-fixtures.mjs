import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { competitions, teams, matches, sourceHealth, GENERATED_AT } from './demo-data.mjs'
import { SOURCE_IDS } from '../src/lib/sources.mjs'
import { resolveDisplayName } from '../src/lib/productRules.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function byId(list, key) {
  return new Map(list.map((item) => [item[key], item]))
}

const competitionById = byId(competitions, 'competition_id')
const teamById = byId(teams, 'team_id')

function defaultAliases(entity) {
  if (entity.aliases) {
    return SOURCE_IDS.flatMap((sourceId) => {
      const alias = entity.aliases[sourceId]
      if (!alias) return []
      const record = { source_id: sourceId }
      if (alias.name_zh) record.name_zh = alias.name_zh
      if (alias.name_en) record.name_en = alias.name_en
      return [record]
    })
  }
  return [
    { source_id: 'macau_lottery', name_zh: entity.name_zh },
    { source_id: 'leisu', name_zh: entity.name_zh },
    { source_id: 'aiscore', name_zh: entity.name_zh },
    { source_id: 'betexplorer', name_en: entity.name_en },
    { source_id: 'scoresway', name_en: entity.name_en },
  ]
}

function deltaMinutes(canonicalKickoff, sourceKickoff) {
  const canonical = Date.parse(canonicalKickoff)
  const source = Date.parse(sourceKickoff)
  if (!Number.isFinite(canonical) || !Number.isFinite(source)) return undefined
  return Math.round((source - canonical) / 60000)
}

function materializeCell(sourceId, spec, competition, home, away, kickoffAt) {
  if (!spec || spec.cell === 'missing') return { source_id: sourceId, cell: 'missing' }
  const swapped = spec.sides_swapped === true
  const nameHome = swapped ? away : home
  const nameAway = swapped ? home : away
  const chinese = sourceId === 'macau_lottery' || sourceId === 'leisu' || sourceId === 'aiscore'
  const kickoff = spec.kickoff_at ?? kickoffAt
  const cell = {
    source_id: sourceId,
    cell: spec.cell,
    kickoff_at: kickoff,
    league_name: spec.league_name ?? (chinese ? competition.short_zh : competition.name_en),
    home_name: spec.home_name ?? (chinese ? nameHome.name_zh : nameHome.name_en),
    away_name: spec.away_name ?? (chinese ? nameAway.name_zh : nameAway.name_en),
  }
  if (swapped) cell.sides_swapped = true
  if (spec.cell === 'mismatch') {
    cell.delta_minutes = typeof spec.delta_minutes === 'number' ? spec.delta_minutes : deltaMinutes(kickoffAt, kickoff)
  }
  return cell
}

function materializeMatch(spec) {
  const competition = competitionById.get(spec.competition_id)
  const home = teamById.get(spec.home_team_id)
  const away = teamById.get(spec.away_team_id)
  if (!competition) throw new Error(`未知賽事 ${spec.competition_id}`)
  if (!home) throw new Error(`未知主隊 ${spec.home_team_id}`)
  if (!away) throw new Error(`未知客隊 ${spec.away_team_id}`)
  if (competition.sport !== home.sport || competition.sport !== away.sport) {
    throw new Error(`${spec.match_id} 運動項目不一致`)
  }

  const sources = SOURCE_IDS.map((sourceId) =>
    materializeCell(sourceId, spec.sources[sourceId], competition, home, away, spec.kickoff_at),
  )
  const league = resolveDisplayName(sources, 'league_name')
  const homeName = resolveDisplayName(sources, 'home_name')
  const awayName = resolveDisplayName(sources, 'away_name')
  if (!league.text || !homeName.text || !awayName.text) {
    throw new Error(`${spec.match_id} 無法解析顯示名稱`)
  }
  const macau = sources.find((cell) => cell.source_id === 'macau_lottery')

  return {
    match_id: spec.match_id,
    sport: competition.sport,
    competition_id: spec.competition_id,
    league_name: league.text,
    home_name: homeName.text,
    away_name: awayName.text,
    home_team_id: spec.home_team_id,
    away_team_id: spec.away_team_id,
    kickoff_at: spec.kickoff_at,
    status: spec.status,
    sources,
    has_macau: Boolean(macau && macau.cell !== 'missing'),
    confidence: spec.confidence,
    updated_at: GENERATED_AT,
  }
}

function mappingCompetition(competition) {
  return {
    entity: 'competition',
    competition_id: competition.competition_id,
    sport: competition.sport,
    name_zh: competition.name_zh,
    name_en: competition.name_en,
    short_zh: competition.short_zh,
    status: competition.mapping_status,
    source: competition.mapping_source,
    aliases: defaultAliases(competition),
  }
}

function mappingTeam(team) {
  return {
    entity: 'team',
    team_id: team.team_id,
    sport: team.sport,
    name_zh: team.name_zh,
    name_en: team.name_en,
    status: team.mapping_status ?? 'confirmed',
    source: team.mapping_source ?? 'auto',
    aliases: defaultAliases(team),
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const materialized = matches.map(materializeMatch)
const sports = ['football', 'basketball']
const daysBySport = new Map(sports.map((sport) => [sport, new Map()]))

for (const match of materialized) {
  const date = match.kickoff_at.slice(0, 10)
  const bucket = daysBySport.get(match.sport)
  const list = bucket.get(date) ?? []
  list.push(match)
  bucket.set(date, list)
}

const manifestSports = sports.map((sport) => {
  const dates = [...daysBySport.get(sport).keys()].sort()
  return {
    sport,
    days: dates.map((date) => ({
      date,
      path: `/fixtures/${sport}/${date}.json`,
      match_count: daysBySport.get(sport).get(date).length,
    })),
  }
})

const manifest = {
  schema_version: '1.0.0',
  demo: true,
  demo_notice: 'Phase 1 示範賽程，只供介面與產品規則。正式賽程 JSON 放物件儲存，不進 Git。',
  timezone: 'Asia/Macau',
  generated_at: GENERATED_AT,
  manual_update_window_days: 3,
  cron: { time: '06:00', timezone: 'Asia/Macau' },
  sports: manifestSports,
  source_health: sourceHealth,
}

await writeJson(path.join(root, 'public/fixtures/manifest.json'), manifest)

for (const sport of sports) {
  for (const [date, list] of daysBySport.get(sport)) {
    list.sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || a.match_id.localeCompare(b.match_id))
    await writeJson(path.join(root, 'public/fixtures', sport, `${date}.json`), {
      schema_version: '1.0.0',
      sport,
      date,
      timezone: 'Asia/Macau',
      matches: list,
    })
  }
}

const mappedCompetitions = competitions.map(mappingCompetition)
const mappedTeams = teams.map(mappingTeam)
const pending = [
  ...mappedCompetitions.filter((item) => item.status === 'pending'),
  ...mappedTeams.filter((item) => item.status === 'pending'),
]

await writeJson(path.join(root, 'src/config/mapping.seed.json'), {
  version: 'mapping_store_v1',
  competitions: mappedCompetitions,
  teams: mappedTeams,
  pending,
})

await writeJson(path.join(root, 'src/config/default_whitelist.json'), {
  version: 'schedule_whitelist_v1',
  sports: {
    football: competitions.filter((item) => item.sport === 'football' && item.default_whitelist).map((item) => item.competition_id),
    basketball: competitions.filter((item) => item.sport === 'basketball' && item.default_whitelist).map((item) => item.competition_id),
  },
})

const aliasCompetitions = {}
const aliasTeams = {}
for (const competition of competitions) {
  aliasCompetitions[competition.competition_id] = [
    ...new Set([competition.short_zh, competition.name_zh, competition.name_en, ...(competition.search_aliases ?? [])]),
  ]
}
for (const team of teams) {
  aliasTeams[team.team_id] = [...new Set([team.name_zh, team.name_en, ...(team.search_aliases ?? [])])]
}

await writeJson(path.join(root, 'src/config/aliases.json'), {
  version: 'aliases_v1',
  competitions: aliasCompetitions,
  teams: aliasTeams,
})

console.log(`fixtures ${materialized.length}, pending ${pending.length}`)
