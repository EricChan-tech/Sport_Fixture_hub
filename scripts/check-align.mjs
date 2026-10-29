import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CONFIRM_THRESHOLD,
  HIGH_CONFIDENCE_WINDOW_MS,
  LOW_CONFIDENCE_WINDOW_MS,
  alignObservations,
  applyMappingSuggestions,
  sampleMapping,
  sampleObservations,
} from '../pipeline/align.mjs'
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

const previous = process.env.SCHEDULE_STORE_DIR
process.env.SCHEDULE_STORE = 'local'
const dir = await mkdtemp(path.join(tmpdir(), 'align-store-'))
process.env.SCHEDULE_STORE_DIR = dir
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
