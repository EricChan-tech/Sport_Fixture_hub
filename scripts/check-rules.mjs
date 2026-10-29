import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE_IDS } from '../src/lib/sources.mjs'
import {
  clearedPreferenceIds,
  effectiveCompetitionIds,
  macauLockedCompetitionIds,
  resolveDisplayName,
  selectNoneIds,
  sortByCompetition,
  sortByTime,
  withinManualWindow,
} from '../src/lib/productRules.mjs'
import { parseMappingImport } from '../src/lib/mappingImport.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

async function walk(dir, skipped) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (skipped.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full, skipped)))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

const files = await walk(root, new Set(['node_modules', 'dist', '.git']))
for (const file of files) {
  const info = await stat(file)
  if (info.size > 2_000_000) continue
  const text = await readFile(file, 'utf8')
  const bannedSource = ['soc', 'cerway'].join('')
  if (text.toLowerCase().includes(bannedSource)) {
    failures.push(`不允許的來源名稱出現在 ${path.relative(root, file)}`)
  }
}

const manifest = JSON.parse(await readFile(path.join(root, 'public/fixtures/manifest.json'), 'utf8'))
const whitelist = JSON.parse(await readFile(path.join(root, 'src/config/default_whitelist.json'), 'utf8'))
const mapping = JSON.parse(await readFile(path.join(root, 'src/config/mapping.seed.json'), 'utf8'))
const sampleJson = await readFile(path.join(root, 'public/samples/mapping-import.sample.json'), 'utf8')
const sampleCsv = await readFile(path.join(root, 'public/samples/mapping-import.sample.csv'), 'utf8')

assert(manifest.timezone === 'Asia/Macau', 'manifest timezone')
assert(manifest.cron.time === '06:00', 'cron time')
assert(manifest.manual_update_window_days === 3, 'window days')
assert(whitelist.version === 'schedule_whitelist_v1', 'whitelist version')
assert(mapping.version === 'mapping_store_v1', 'mapping version')
assert(Object.keys(manifest.source_health).join(',') === SOURCE_IDS.join(','), 'health keys')

const allMatches = []
for (const sport of manifest.sports) {
  for (const day of sport.days) {
    const dayFile = JSON.parse(await readFile(path.join(root, 'public', day.path), 'utf8'))
    assert(dayFile.date === day.date, `day date ${day.path}`)
    assert(dayFile.sport === sport.sport, `day sport ${day.path}`)
    assert(dayFile.matches.length === day.match_count, `count ${day.path}`)
    for (const match of dayFile.matches) {
      allMatches.push(match)
      assert(match.kickoff_at.endsWith('+08:00'), `${match.match_id} offset`)
      assert(match.kickoff_at.slice(0, 10) === day.date, `${match.match_id} date`)
      assert(match.sources.map((cell) => cell.source_id).join(',') === SOURCE_IDS.join(','), `${match.match_id} sources`)
      const macau = match.sources.find((cell) => cell.source_id === 'macau_lottery')
      assert(match.has_macau === (macau.cell !== 'missing'), `${match.match_id} has_macau`)
      for (const field of ['league_name', 'home_name', 'away_name']) {
        assert(resolveDisplayName(match.sources, field).text === match[field], `${match.match_id} ${field}`)
      }
      assert(match.confidence >= 0 && match.confidence <= 1, `${match.match_id} confidence`)
      for (const cell of match.sources) {
        if (cell.cell === 'missing') {
          assert(cell.sides_swapped !== true, `${match.match_id} ${cell.source_id} missing is not a side swap`)
          continue
        }
        if (cell.cell !== 'mismatch') continue
        const expectedDelta = Math.round((Date.parse(cell.kickoff_at) - Date.parse(match.kickoff_at)) / 60000)
        assert(cell.delta_minutes === expectedDelta, `${match.match_id} ${cell.source_id} delta_minutes`)
      }
    }
  }
}

const byId = Object.fromEntries(allMatches.map((match) => [match.match_id, match]))
assert(byId['fb-20261030-epl-mun-liv'].home_name === '曼聯', 'macau zh wins')
const swappedMatch = byId['fb-20261030-epl-mun-liv']
const swappedCell = swappedMatch.sources.find((cell) => cell.source_id === 'betexplorer')
const swappedMacau = swappedMatch.sources.find((cell) => cell.source_id === 'macau_lottery')
assert(swappedCell.sides_swapped === true && swappedCell.cell === 'mismatch', 'betexplorer sides swapped')
assert(swappedCell.delta_minutes === -60, 'betexplorer delta minutes')
assert(swappedCell.home_name === 'Liverpool' && swappedCell.away_name === 'Manchester United', 'swapped source names')
assert(swappedMacau.sides_swapped !== true && swappedMacau.home_name === '曼聯', 'canonical stays with macau')
assert(
  byId['fb-20261030-bund-bvb-rbl'].sources.find((cell) => cell.source_id === 'betexplorer').delta_minutes === -120,
  'large mismatch delta',
)
assert(
  allMatches.some(
    (match) => match.sport === 'football' && match.kickoff_at.startsWith('2026-10-30') && match.sources.some((cell) => cell.sides_swapped === true),
  ),
  'demo day has a side swap',
)
assert(byId['fb-20261030-j1-kaw-yok'].home_name === '川崎前鋒', 'leisu zh before aiscore')
assert(byId['fb-20261030-primeira-ben-por'].league_name === 'Primeira Liga', 'english fallback')
assert(byId['fb-20261030-primeira-ben-por'].home_name === 'Benfica', 'betexplorer before scoresway')
assert(byId['fb-20261030-primeira-ben-por'].has_macau === false, 'primeira has no macau')
assert(byId['fb-20261030-facup-mci-tot'].has_macau === true, 'fa cup has macau')
assert(byId['bb-20261030-nbl-syd-mel'].has_macau === true, 'nbl has macau')

const footballMatches = allMatches.filter((match) => match.sport === 'football')
const basketballMatches = allMatches.filter((match) => match.sport === 'basketball')
const footballLocks = macauLockedCompetitionIds(footballMatches)
const basketballLocks = macauLockedCompetitionIds(basketballMatches)

assert(!whitelist.sports.football.includes('fb-facup'), 'fa cup is not a default')
assert(!whitelist.sports.basketball.includes('bb-nbl'), 'nbl is not a default')
assert(footballLocks.includes('fb-facup'), 'fa cup lock derived')
assert(basketballLocks.includes('bb-nbl'), 'nbl lock derived')
assert(!footballLocks.includes('fb-ligue1'), 'ligue 1 is not locked')

const footballEffective = effectiveCompetitionIds({
  stored: null,
  defaults: whitelist.sports.football,
  macauLocked: footballLocks,
})
assert(footballEffective.includes('fb-facup'), 'default union keeps fa cup')
assert(footballEffective.includes('fb-ligue1'), 'default keeps ligue 1')

const selectedNone = selectNoneIds(footballLocks)
assert(selectedNone.includes('fb-facup') && selectedNone.includes('fb-epl'), 'select none keeps locks')
assert(!selectedNone.includes('fb-ligue1'), 'select none drops unlocked')

const explicitEmpty = effectiveCompetitionIds({
  stored: [],
  defaults: whitelist.sports.football,
  macauLocked: footballLocks,
})
assert(explicitEmpty.includes('fb-epl') && !explicitEmpty.includes('fb-ligue1'), 'empty stored still locks macau')

const cleared = clearedPreferenceIds({
  defaults: whitelist.sports.football,
  macauLocked: footballLocks,
})
assert(cleared.includes('fb-ligue1') && cleared.includes('fb-facup'), 'clear prefs restores default and lock')

assert(
  withinManualWindow('2026-10-27', '2026-10-30', 3) && withinManualWindow('2026-11-02', '2026-10-30', 3),
  'window edges',
)
assert(!withinManualWindow('2026-10-26', '2026-10-30', 3), 'before window')
assert(!withinManualWindow('2026-11-03', '2026-10-30', 3), 'after window')

const visible = footballMatches.filter(
  (match) => match.kickoff_at.startsWith('2026-10-30') && footballEffective.includes(match.competition_id),
)
const byTime = sortByTime(visible).map((match) => match.match_id)
const byComp = sortByCompetition(visible).map((match) => match.match_id)
const eplA = 'fb-20261030-epl-mun-liv'
const eplB = 'fb-20261030-epl-ars-che'
assert(Math.abs(byTime.indexOf(eplA) - byTime.indexOf(eplB)) > 1, 'time sort separates epl')
assert(Math.abs(byComp.indexOf(eplA) - byComp.indexOf(eplB)) === 1, 'competition sort groups epl')

const pendingFromStatus = [
  ...mapping.competitions.filter((item) => item.status === 'pending'),
  ...mapping.teams.filter((item) => item.status === 'pending'),
]
assert(pendingFromStatus.length >= 5, 'pending queue has items')
assert(JSON.stringify(mapping.pending) === JSON.stringify(pendingFromStatus), 'pending projection')
assert(mapping.pending.some((item) => item.entity === 'competition' && item.competition_id === 'fb-eredivisie'), 'eredivisie pending')
assert(mapping.pending.some((item) => item.entity === 'team' && item.team_id === 'fb-manutd'), 'man utd pending')

for (const item of [...mapping.competitions, ...mapping.teams]) {
  assert(item.status === 'confirmed' || item.status === 'pending', 'status enum')
  assert(['auto', 'manual', 'import'].includes(item.source), 'origin enum')
  for (const alias of item.aliases) assert(SOURCE_IDS.includes(alias.source_id), 'alias source')
}

const teamIds = new Set(mapping.teams.map((team) => team.team_id))
const competitionIds = new Set(mapping.competitions.map((item) => item.competition_id))
for (const match of allMatches) {
  assert(teamIds.has(match.home_team_id) && teamIds.has(match.away_team_id), `${match.match_id} teams mapped`)
  assert(competitionIds.has(match.competition_id), `${match.match_id} competition mapped`)
}

const jsonImport = parseMappingImport(sampleJson)
const csvImport = parseMappingImport(sampleCsv)
assert(jsonImport.ok && jsonImport.items.length === 2, 'sample json')
assert(csvImport.ok && csvImport.items.length === 2, 'sample csv')
assert(parseMappingImport('{"version":"mapping_import_v1","items":[{"entity":"team","sport":"football","name_zh":"甲","name_en":"A","aliases":[{"source_id":"other","name_en":"A"}]}]}').ok === false, 'reject unknown source')

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`rules ok, matches ${allMatches.length}, pending ${mapping.pending.length}`)
