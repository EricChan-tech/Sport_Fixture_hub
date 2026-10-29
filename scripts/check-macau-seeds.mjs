import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'data/mapping/seeds/macau_lottery')
const failures = []
const banned = ['soc', 'cerway'].join('')

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function readCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      cell = ''
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
    } else cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim() !== '')) rows.push(row)
  }
  return rows
}

const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
assert(manifest.version === 'macau_lottery_name_import_v1', 'manifest version')
assert(manifest.source_id === 'macau_lottery', 'manifest source')
assert(manifest.status === 'confirmed' && manifest.source === 'import', 'manifest import status')
assert(Array.isArray(manifest.files) && manifest.files.length === 4, 'manifest has four files')

const expected = {
  'football_teams.json': { sport: 'football', kind: 'team', count: 7745 },
  'basketball_teams.json': { sport: 'basketball', kind: 'team', count: 2832 },
  'football_competitions.json': { sport: 'football', kind: 'competition', count: 350 },
  'basketball_competitions.json': { sport: 'basketball', kind: 'competition', count: 163 },
}
const seenIds = new Set()

for (const entry of manifest.files) {
  const expect = expected[entry.file]
  assert(expect, `unexpected file ${entry.file}`)
  if (!expect) continue
  assert(entry.count === expect.count, `${entry.file} manifest count`)
  assert(entry.sport === expect.sport && entry.kind === expect.kind, `${entry.file} manifest kind`)
  assert(entry.csv === entry.file.replace(/\.json$/, '.csv'), `${entry.file} csv name`)

  const payload = JSON.parse(await readFile(path.join(dir, entry.file), 'utf8'))
  const csvText = await readFile(path.join(dir, entry.csv), 'utf8')
  assert(payload.version === 'macau_lottery_name_import_v1', `${entry.file} version`)
  assert(payload.source_id === 'macau_lottery', `${entry.file} source_id`)
  assert(payload.sport === expect.sport && payload.kind === expect.kind, `${entry.file} sport/kind`)
  assert(payload.count === expect.count && payload.items.length === expect.count, `${entry.file} item count`)

  const csvRows = readCsv(csvText)
  assert(csvRows.length === expect.count + 1, `${entry.csv} row count ${csvRows.length}`)
  const header = csvRows[0].map((value) => value.trim())
  assert(header[0] === 'entity_id' && header.includes('canonical_name_zh'), `${entry.csv} header`)

  for (const item of payload.items) {
    assert(item.sport === expect.sport && item.kind === expect.kind, `${item.entity_id} sport/kind`)
    assert(item.status === 'confirmed' && item.source === 'import', `${item.entity_id} status`)
    assert(typeof item.entity_id === 'string' && item.entity_id.length > 0, 'entity_id')
    assert(!seenIds.has(item.entity_id), `duplicate ${item.entity_id}`)
    seenIds.add(item.entity_id)
    assert(item.canonical_name_zh?.trim() && item.canonical_name_en?.trim(), `${item.entity_id} names`)
    assert(Array.isArray(item.aliases) && item.aliases.length > 0, `${item.entity_id} aliases`)
    for (const alias of item.aliases) {
      assert(alias.source_id === 'macau_lottery', `${item.entity_id} alias source`)
      assert(alias.name?.trim() && alias.normalized?.trim(), `${item.entity_id} alias text`)
    }
    if (expect.kind === 'team') {
      assert(item.meta?.continent?.trim() && item.meta?.category?.trim(), `${item.entity_id} team meta`)
    }
    const blob = JSON.stringify(item).toLowerCase()
    assert(!blob.includes(banned), `${item.entity_id} banned source name`)
  }
}

if (failures.length > 0) {
  console.error(failures.slice(0, 30).join('\n'))
  console.error(`${failures.length} seed check failure(s)`)
  process.exit(1)
}

console.log(`macau seeds ok, entities ${seenIds.size}`)
