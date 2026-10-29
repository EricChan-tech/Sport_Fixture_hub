import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CONFIRM_THRESHOLD,
  HIGH_CONFIDENCE_WINDOW_MS,
  LOW_CONFIDENCE_WINDOW_MS,
  alignObservations,
  applyMappingSuggestions,
  applyObservedAliases,
  sampleMapping,
  sampleObservations,
} from '../pipeline/align.mjs'
import { ensureWorkspace, readWorkspace } from '../pipeline/mapping-store.mjs'
import { syncScheduleMappings } from '../pipeline/mapping-sync.mjs'
import { createStore, objectKey } from '../pipeline/storage.mjs'

const failures = []
function assert(condition, message) {
  if (!condition) failures.push(message)
}

assert(HIGH_CONFIDENCE_WINDOW_MS >= 24 * 60 * 60 * 1000, 'high window at least 24h')
assert(HIGH_CONFIDENCE_WINDOW_MS <= 36 * 60 * 60 * 1000, 'high window at most 36h')
assert(LOW_CONFIDENCE_WINDOW_MS < 12 * 60 * 60 * 1000, 'low window is tighter')
assert(HIGH_CONFIDENCE_WINDOW_MS !== 90 * 60 * 1000, 'high window is not 90 minutes')

const sample = alignObservations(sampleObservations(), sampleMapping())
assert(sample.matches.length === 1, '120 minute gap still one match')
const match = sample.matches[0]
const betexplorer = match.sources.find((cell) => cell.source_id === 'betexplorer')
const scoresway = match.sources.find((cell) => cell.source_id === 'scoresway')
assert(betexplorer.cell === 'mismatch' && betexplorer.delta_minutes === 120, 'yellow delta')
assert(betexplorer.sides_swapped === true, 'swap flag')
assert(scoresway.cell === 'missing' && scoresway.sides_swapped !== true, 'missing stays missing')
assert(match.home_name === '曼聯' && match.away_name === '利物浦', 'canonical follows macau')
assert(sample.suggestions.some((item) => item.id === 'fb-manutd' && item.status === 'confirmed' && item.source === 'auto'), 'exact pending becomes confirmed')
assert(sample.aliasWrites.some((item) => item.id === 'fb-manutd' && item.source_id === 'betexplorer' && item.name === '曼聯'), 'high confidence records betexplorer alias')
assert(sample.aliasWrites.some((item) => item.id === 'fb-epl' && item.source_id === 'betexplorer' && item.name === 'Premier League'), 'high confidence records competition alias')

const low = alignObservations(
  [
    { source_id: 'macau_lottery', sport: 'football', kickoff_at: '2026-10-30T12:00:00+08:00', home_name: '阿仙奴FC', away_name: '車路士隊', competition_name: '英超' },
    { source_id: 'leisu', sport: 'football', kickoff_at: '2026-10-30T22:00:00+08:00', home_name: '阿仙奴FC', away_name: '車路士隊', competition_name: '英超' },
  ],
  {
    teams: [
      { team_id: 'fb-arsenal', name_zh: '阿仙奴', status: 'pending', aliases: [{ name: '阿仙奴' }] },
      { team_id: 'fb-chelsea', name_zh: '車路士', status: 'pending', aliases: [{ name: '車路士' }] },
    ],
    competitions: [],
  },
)
assert(low.matches.length === 2, 'low confidence does not bridge 10 hours')
assert(low.suggestions.some((item) => item.status === 'pending'), 'fuzzy names stay pending')
assert(!low.aliasWrites.some((item) => item.score < CONFIRM_THRESHOLD), 'low confidence does not write aliases')

const wide = alignObservations(
  [
    { source_id: 'macau_lottery', sport: 'football', kickoff_at: '2026-10-30T01:00:00+08:00', home_name: '曼聯', away_name: '利物浦', competition_name: '英超' },
    { source_id: 'leisu', sport: 'football', kickoff_at: '2026-10-31T06:00:00+08:00', home_name: '曼聯', away_name: '利物浦', competition_name: '歐冠' },
  ],
  sampleMapping(),
)
assert(wide.matches.length === 1, 'cross-league high confidence stays inside 36h')

const applied = applyMappingSuggestions(
  { version: 'mapping_store_v1', competitions: [], teams: [{ team_id: 'fb-manutd', status: 'pending', source: 'import' }, { team_id: 'fb-liverpool', status: 'confirmed', source: 'manual' }], pending: [] },
  sample.suggestions,
)
assert(applied.teams.find((item) => item.team_id === 'fb-manutd').status === 'confirmed', 'auto confirm')
assert(applied.teams.find((item) => item.team_id === 'fb-manutd').source === 'auto', 'auto source')
assert(applied.teams.find((item) => item.team_id === 'fb-liverpool').source === 'manual', 'manual is kept')

const filled = applyObservedAliases(
  {
    version: 'mapping_store_v1',
    competitions: [],
    teams: [
      { team_id: 'fb-porto', status: 'pending', source: 'auto', aliases: [{ source_id: 'betexplorer', name_en: 'FC Porto' }] },
      { team_id: 'fb-liverpool', status: 'confirmed', source: 'manual', aliases: [] },
    ],
    pending: [],
  },
  [
    { kind: 'team', id: 'fb-porto', source_id: 'leisu', name: '波爾圖', score: 1 },
    { kind: 'team', id: 'fb-porto', source_id: 'betexplorer', name: 'Porto FC', score: 1 },
    { kind: 'team', id: 'fb-liverpool', source_id: 'betexplorer', name: 'Liverpool', score: 1 },
    { kind: 'team', id: 'fb-porto', source_id: 'aiscore', name: '波爾圖', score: 0.8 },
  ],
)
const portoAlias = filled.teams.find((item) => item.team_id === 'fb-porto')
assert(portoAlias.aliases.find((alias) => alias.source_id === 'leisu')?.name_zh === '波爾圖', 'high confidence fills empty alias')
assert(portoAlias.aliases.find((alias) => alias.source_id === 'betexplorer')?.name_en === 'FC Porto', 'existing alias is kept')
assert(!portoAlias.aliases.some((alias) => alias.source_id === 'aiscore'), 'low score does not write')
assert(filled.teams.find((item) => item.team_id === 'fb-liverpool').aliases.length === 0, 'manual alias is not written')

const previous = process.env.SCHEDULE_STORE_DIR
process.env.SCHEDULE_STORE = 'local'
const dir = await mkdtemp(path.join(tmpdir(), 'align-store-'))
process.env.SCHEDULE_STORE_DIR = dir
const beforeSync = await ensureWorkspace()
const competitionIds = beforeSync.competitions.map((item) => item.competition_id).sort().join('|')
const synced = await syncScheduleMappings([
  {
    matches: [
      {
        sport: 'football',
        kickoff_at: '2026-10-30T12:00:00+08:00',
        sources: [
          {
            source_id: 'leisu',
            cell: 'ok',
            kickoff_at: '2026-10-30T12:00:00+08:00',
            league_name: '葡超',
            home_name: '波爾圖',
            away_name: '賓菲加',
          },
        ],
      },
    ],
  },
])
const syncedPorto = synced.teams.find((item) => item.team_id === 'fb-porto')
const syncedBenfica = synced.teams.find((item) => item.team_id === 'fb-benfica')
assert(syncedPorto?.status === 'confirmed' && syncedPorto.source === 'auto', 'sync auto-confirms high confidence')
assert(syncedPorto.aliases.some((alias) => alias.source_id === 'leisu' && alias.name_zh === '波爾圖'), 'sync writes the new source alias')
assert(syncedBenfica?.aliases.some((alias) => alias.source_id === 'leisu' && alias.name_zh === '賓菲加'), 'sync writes the other side')
assert(synced.competitions.map((item) => item.competition_id).sort().join('|') === competitionIds, 'sync keeps competitions')
assert((await readWorkspace()).teams.find((item) => item.team_id === 'fb-porto').aliases.some((alias) => alias.name_zh === '波爾圖'), 'alias persisted in the runtime store')
await createStore().put(objectKey('football', '2026-10-30'), `${JSON.stringify({ schema_version: '1.0.0', sport: 'football', date: '2026-10-30', timezone: 'Asia/Macau', matches: sample.matches })}\n`)
const stored = JSON.parse(await createStore().get(objectKey('football', '2026-10-30')))
assert(stored.matches[0].sources.some((cell) => cell.sides_swapped) && stored.matches[0].sources.some((cell) => cell.cell === 'mismatch') && stored.matches[0].sources.some((cell) => cell.cell === 'missing'), 'stored day has swap yellow and missing')
if (previous === undefined) delete process.env.SCHEDULE_STORE_DIR
else process.env.SCHEDULE_STORE_DIR = previous
await rm(dir, { recursive: true, force: true })

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`align ok, sample matches ${sample.matches.length}, suggestions ${sample.suggestions.length}`)
