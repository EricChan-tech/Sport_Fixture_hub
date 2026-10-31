import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANUAL_RATE_LIMIT_MS, SOURCE_IDS } from '../pipeline/constants.mjs'
import { createNetlifyBlobsStore, createStore, objectKey, resolveStoreDriver } from '../pipeline/storage.mjs'
import { runScheduleJob } from '../pipeline/run-job.mjs'
import { handleMappingRequest } from '../pipeline/mapping-http.mjs'
import { confirmEntry, ensureWorkspace, putSeedOverride, readSeedOverrides, readWorkspace, writeWorkspace } from '../pipeline/mapping-store.mjs'
import { macauTargetsForEntity, queryCatalog } from '../pipeline/mapping-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const banned = ['soc', 'cerway'].join('')

function assert(condition, message) {
  if (!condition) failures.push(message)
}

assert(SOURCE_IDS.join(',') === 'macau_lottery,betexplorer,scoresway,aiscore,leisu', 'source list')
assert(MANUAL_RATE_LIMIT_MS === 300000, 'manual rate limit is 5 minutes')

const workflow = await readFile(path.join(root, '.github/workflows/daily-schedule.yml'), 'utf8')
assert(workflow.includes('cron: "0 6 * * *"'), 'workflow cron')
assert(workflow.includes('CRON_TZ: Asia/Macau'), 'workflow timezone')
assert(workflow.includes('workflow_dispatch'), 'manual dispatch')
assert(!workflow.toLowerCase().includes(banned), 'workflow source name')

const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8')
assert(gitignore.includes('.schedule-store'), 'store dir is gitignored')

const previousStore = process.env.SCHEDULE_STORE_DIR
const previousDriver = process.env.SCHEDULE_STORE
const dir = await mkdtemp(path.join(tmpdir(), 'schedule-store-'))
process.env.SCHEDULE_STORE = 'local'
process.env.SCHEDULE_STORE_DIR = dir
const now = '2026-10-30T08:00:00+08:00'

const outside = await runScheduleJob({ trigger: 'manual', baseDate: '2020-01-01', now, paceMs: 0, scrape: false })
assert(outside.accepted === false && outside.job.state === 'fail', 'outside window fails')

function catalogRow(page, id) {
  return page.items.find((item) => item.entity_id === id)
}

const liverpool = await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5458', page: 1, pageSize: 5 })
const liv = catalogRow(liverpool, 'macau-football-team-5458')
assert(liv?.canonical_name_zh === '利物浦', 'liverpool row')
assert(liv?.source_names?.betexplorer === 'Liverpool' && liv?.source_names?.leisu === '利物浦', 'confirmed source columns')
assert(liv?.source_names?.scoresway === 'Liverpool' && liv?.source_names?.aiscore === '利物浦', 'scoresway and aiscore columns')
assert(liv?.source_columns?.betexplorer?.editable === false && liv?.source_columns?.betexplorer?.source === 'auto', 'auto betexplorer is locked')
assert(liv?.source_columns?.betexplorer?.status === 'confirmed' && liv?.source_columns?.leisu?.editable === false, 'auto columns are confirmed and locked')
let livBlocked = false
try {
  await putSeedOverride({
    entity_id: 'macau-football-team-5458',
    canonical_name_zh: '利物浦',
    canonical_name_en: liv.canonical_name_en,
    source_names: { scoresway: 'Liverpool FC' },
  })
} catch (error) {
  livBlocked = error?.code === 'BAD_REQUEST' && String(error.message).includes('不能修改')
}
assert(livBlocked, 'seed auto alias is rejected')
const livSame = await putSeedOverride({
  entity_id: 'macau-football-team-5458',
  canonical_name_zh: '利物浦',
  canonical_name_en: liv.canonical_name_en,
  source_names: { scoresway: 'Liverpool' },
})
assert(!livSame.source_names?.scoresway, 'identical auto name is not stored as manual')
const livAfterSame = catalogRow(await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5458', page: 1, pageSize: 5 }), 'macau-football-team-5458')
assert(livAfterSame?.source_columns?.scoresway?.source === 'auto' && livAfterSame?.source_columns?.scoresway?.editable === false, 'auto column stays auto')
assert(livAfterSame?.canonical_name_zh === '利物浦' && livAfterSame?.source === 'manual', 'macau name save still marks the row manual')
const hiddenAlias = await queryCatalog({ sport: 'football', kind: 'team', q: '曼徹斯特聯', page: 1, pageSize: 5 })
assert(hiddenAlias.total === 0, 'pending alias is not searchable yet')
const manutdBefore = await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5468', page: 1, pageSize: 5 })
assert(!catalogRow(manutdBefore, 'macau-football-team-5468')?.source_names?.aiscore, 'pending manutd column empty')
const macauPorto = await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5413', page: 1, pageSize: 5 })
assert(catalogRow(macauPorto, 'macau-football-team-5413')?.canonical_name_zh === '波圖', '波圖 row')
assert(!catalogRow(macauPorto, 'macau-football-team-5413')?.source_names?.betexplorer, '波圖 does not take 波爾圖 aliases')
await confirmEntry('team', 'fb-porto')
const portoConfirmed = await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5413', page: 1, pageSize: 5 })
assert(!catalogRow(portoConfirmed, 'macau-football-team-5413')?.source_names?.betexplorer, 'confirming 波爾圖 does not fill 波圖')
assert(!(await readSeedOverrides()).items['macau-football-team-5413']?.source_names, '波圖 override stays empty')

const competitionIdsBefore = (await ensureWorkspace()).competitions.map((item) => item.competition_id).sort().join('|')
await confirmEntry('team', 'fb-benfica')
const benficaPage = await queryCatalog({ sport: 'football', kind: 'team', q: 'SL Benfica', page: 1, pageSize: 10 })
const benficaRow = benficaPage.items.find((item) => item.canonical_name_zh === '賓菲加')
assert(benficaRow?.source_names?.scoresway === 'SL Benfica', 'manual confirm shows scoresway')
assert(benficaRow?.source_names?.betexplorer === 'Benfica', 'manual confirm shows betexplorer')
assert(!benficaRow?.source_names?.leisu, 'empty source stays empty')
assert(benficaRow?.source_columns?.scoresway?.editable === true && benficaRow?.source_columns?.scoresway?.source === 'manual', 'manual confirm alias stays editable')
assert(benficaRow?.source_columns?.leisu?.editable === true && benficaRow?.source_columns?.leisu?.name === '', 'empty source column is editable')
assert((await readWorkspace()).teams.find((item) => item.team_id === 'fb-benfica')?.source === 'manual', 'confirm persisted in workspace')
const benficaOverride = (await readSeedOverrides()).items[benficaRow.entity_id]
assert(benficaOverride?.source_names?.scoresway === 'SL Benfica', 'confirm writes scoresway onto the macau row')
assert(benficaOverride?.source_names?.betexplorer === 'Benfica', 'confirm writes betexplorer onto the macau row')
assert(!benficaOverride?.source_names?.leisu, 'confirm does not invent an empty source')
const benficaWorkspace = await readWorkspace()
const benficaTeam = benficaWorkspace.teams.find((item) => item.team_id === 'fb-benfica')
benficaTeam.status = 'pending'
await writeWorkspace(benficaWorkspace)
const detachedBenfica = catalogRow(
  await queryCatalog({ sport: 'football', kind: 'team', q: benficaRow.entity_id, page: 1, pageSize: 5 }),
  benficaRow.entity_id,
)
assert(detachedBenfica?.source_names?.scoresway === 'SL Benfica', 'confirm alias remains after the workspace link drops')
assert(detachedBenfica?.source_names?.betexplorer === 'Benfica', 'confirm betexplorer remains on the macau row')
benficaTeam.status = 'confirmed'
benficaTeam.source = 'manual'
await writeWorkspace(benficaWorkspace)
const benficaSaved = await putSeedOverride({
  entity_id: benficaRow.entity_id,
  canonical_name_zh: benficaRow.canonical_name_zh,
  canonical_name_en: benficaRow.canonical_name_en,
  source_names: { leisu: '賓菲加雷速' },
})
assert(benficaSaved.source_names?.leisu === '賓菲加雷速', 'manual source alias stored')

const published = await runScheduleJob({
  trigger: 'manual',
  baseDate: '2026-10-30',
  now,
  paceMs: 0,
  failSources: ['aiscore'],
  scrape: false,
})
assert(published.accepted && published.job.state === 'success', 'job succeeds when one source fails')
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
assert(manifest.last_success_at && manifest.last_job_id === published.job.job_id, 'manifest job')
assert(
  manifest.window?.base_date === '2026-10-30' && manifest.window.from === '2026-10-27' && manifest.window.to === '2026-11-02',
  'manifest window',
)
assert(Array.isArray(manifest.sources_enabled) && manifest.sources_enabled.includes('macau_lottery'), 'sources enabled')
assert(typeof manifest.pending_mapping_count === 'number', 'pending count')
assert(manifest.runner, 'runner')
assert(manifest.source_health.aiscore.status === 'down', 'failed source health')
assert(manifest.source_health.leisu.status === 'degraded', 'unwired source degrades')
const mappingAfter = await readWorkspace()
assert(mappingAfter.competitions.map((item) => item.competition_id).sort().join('|') === competitionIdsBefore, 'job keeps competitions')
assert(mappingAfter.teams.find((item) => item.team_id === 'fb-benfica')?.source === 'manual', 'manual confirm survives the job')
const manutdEntity = mappingAfter.teams.find((item) => item.team_id === 'fb-manutd')
assert(manutdEntity?.status === 'confirmed' && manutdEntity.source === 'auto', 'job auto-confirms manutd')
const revealed = await queryCatalog({ sport: 'football', kind: 'team', q: '曼徹斯特聯', page: 1, pageSize: 10 })
const manutd = revealed.items.find((item) => item.entity_id === 'macau-football-team-5468')
assert(manutd?.source_names?.aiscore === '曼徹斯特聯', 'auto confirm shows aiscore')
assert(manutd?.source_names?.betexplorer === 'Manchester United', 'auto confirm shows betexplorer')
assert(manutd?.source_names?.scoresway === 'Man Utd', 'auto confirm shows scoresway')
assert(manutd?.source_columns?.aiscore?.editable === false && manutd?.source_columns?.aiscore?.source === 'auto', 'auto confirm locks aiscore')
assert(manutd?.source_columns?.betexplorer?.editable === false, 'auto confirm locks betexplorer')
const benficaAfter = await queryCatalog({ sport: 'football', kind: 'team', q: '賓菲加雷速', page: 1, pageSize: 10 })
const benficaKept = benficaAfter.items.find((item) => item.entity_id === benficaRow.entity_id)
assert(benficaKept?.source_names?.leisu === '賓菲加雷速', 'manual source alias survives the job')
assert(benficaKept?.source_columns?.leisu?.editable === true && benficaKept?.source_columns?.leisu?.source === 'manual', 'manual alias stays editable after the job')
assert(benficaKept?.source_names?.scoresway === 'SL Benfica', 'linked manual alias still shows')
let blocked = false
try {
  await putSeedOverride({
    entity_id: manutd.entity_id,
    canonical_name_zh: manutd.canonical_name_zh,
    canonical_name_en: manutd.canonical_name_en,
    source_names: { aiscore: '人手曼聯' },
  })
} catch (error) {
  blocked = error?.code === 'BAD_REQUEST' && String(error.message).includes('不能修改')
}
assert(blocked, 'auto alias write is rejected')
const manutdStill = await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5468', page: 1, pageSize: 5 })
assert(catalogRow(manutdStill, 'macau-football-team-5468')?.source_names?.aiscore === '曼徹斯特聯', 'rejected write keeps auto alias')
const denied = await handleMappingRequest(new Request('http://local/api/mapping/overrides', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    entity_id: 'macau-football-team-5468',
    canonical_name_zh: manutd.canonical_name_zh,
    canonical_name_en: manutd.canonical_name_en,
    source_names: { betexplorer: 'Not United' },
  }),
}))
assert(denied.status === 400, 'api rejects auto alias edit')
const dutch = await queryCatalog({ sport: 'football', kind: 'competition', q: '荷甲', page: 1, pageSize: 10 })
const eredivisie = dutch.items.find((item) => item.entity_id === 'macau-football-competition-83')
assert(eredivisie?.source_names?.leisu === '荷甲', 'auto confirm shows competition alias')
assert(eredivisie?.source_names?.scoresway === 'Dutch Eredivisie', 'scoresway competition alias')
const day = JSON.parse(await readFile(path.join(dir, objectKey('football', '2026-10-30')), 'utf8'))
const swapped = day.matches.find((match) => match.match_id === 'fb-20261030-epl-mun-liv')
const betexplorer = swapped.sources.find((cell) => cell.source_id === 'betexplorer')
const aiscore = swapped.sources.find((cell) => cell.source_id === 'aiscore')
assert(betexplorer.sides_swapped === true && betexplorer.cell === 'mismatch', 'swap survives publish')
assert(aiscore.cell === 'missing' && aiscore.sides_swapped !== true, 'failed source is missing, not a swap')

const edited = await putSeedOverride({
  entity_id: 'macau-football-team-1',
  canonical_name_zh: '測試隊',
  canonical_name_en: 'Test FC',
})
assert(edited.source === 'manual' && edited.status === 'confirmed', 'override is manual confirmed')
const overrides = await readSeedOverrides()
assert(overrides.items['macau-football-team-1'].canonical_name_en === 'Test FC', 'override persisted')
const page = await queryCatalog({ sport: 'football', kind: 'team', q: 'Test FC', page: 1, pageSize: 40 })
assert(page.total === 1 && page.items[0].entity_id === 'macau-football-team-1', 'catalog search sees override')
const full = await queryCatalog({ sport: 'football', kind: 'team', q: '', page: 1, pageSize: 40 })
assert(full.total === 7745 && full.items.length === 40, 'team catalog is paged')
assert(full.items.every((item) => item.source_names && typeof item.source_names === 'object'), 'catalog rows include source_names')
assert(page.items[0].short_name_zh === '', 'team catalog short name is blank')

const byShort = await queryCatalog({ sport: 'football', kind: 'competition', q: '英亞盃', page: 1, pageSize: 40 })
assert(byShort.total === 1 && byShort.items[0].entity_id === 'macau-football-competition-1', 'catalog search matches short name')
assert(byShort.items[0].short_name_zh === '英亞盃', 'catalog row exposes short name')
const emptyShort = await queryCatalog({ sport: 'football', kind: 'competition', q: '西亚冠军杯', page: 1, pageSize: 40 })
assert(emptyShort.total === 1 && emptyShort.items[0].short_name_zh === '', 'empty short name stays blank')
const basketball = await queryCatalog({ sport: 'basketball', kind: 'competition', q: '', page: 1, pageSize: 40 })
assert(basketball.total === 162 && basketball.items[0].short_name_zh === '阿籃錦', 'basketball catalog count and short name')
const editedComp = await putSeedOverride({
  entity_id: 'macau-football-competition-1',
  canonical_name_zh: '英超亞洲盃',
  canonical_name_en: 'Premier League Asia Trophy',
  short_name_zh: '亞盃簡',
})
assert(editedComp.short_name_zh === '亞盃簡', 'short name override stored')
const renamed = await queryCatalog({ sport: 'football', kind: 'competition', q: '亞盃簡', page: 1, pageSize: 40 })
assert(renamed.total === 1 && renamed.items[0].short_name_zh === '亞盃簡', 'catalog search sees short override')

const withSource = await putSeedOverride({
  entity_id: 'macau-football-team-1',
  canonical_name_zh: '測試隊',
  canonical_name_en: 'Test FC',
  source_names: { betexplorer: 'Boroughmuir Manual', aiscore: '博洛人手' },
})
assert(withSource.source_names.betexplorer === 'Boroughmuir Manual' && withSource.short_name_zh === undefined, 'source names stored on override')
const seen = await queryCatalog({ sport: 'football', kind: 'team', q: 'Boroughmuir Manual', page: 1, pageSize: 5 })
assert(seen.total === 1 && seen.items[0].entity_id === 'macau-football-team-1', 'manual source name is searchable')
assert(seen.items[0].source_columns.betexplorer.source === 'manual' && seen.items[0].source_columns.betexplorer.editable === true, 'manual source column is editable')
assert(seen.items[0].source_columns.leisu.editable === true && seen.items[0].source_columns.leisu.name === '', 'untouched source stays empty')
const kept = await putSeedOverride({
  entity_id: 'macau-football-team-1',
  canonical_name_zh: '測試隊',
  canonical_name_en: 'Test FC',
})
assert(kept.source_names.betexplorer === 'Boroughmuir Manual' && kept.canonical_name_en === 'Test FC', 'macau save keeps source names')
const cleared = await putSeedOverride({
  entity_id: 'macau-football-team-1',
  canonical_name_zh: '測試隊',
  canonical_name_en: 'Test FC',
  source_names: { betexplorer: '   ' },
})
assert(cleared.source_names.betexplorer === '' && cleared.source_names.aiscore === '博洛人手', 'blank source name clears one column')
const afterClear = await queryCatalog({ sport: 'football', kind: 'team', q: '博洛人手', page: 1, pageSize: 5 })
assert(afterClear.items[0].source_names.aiscore === '博洛人手' && !afterClear.items[0].source_names.betexplorer, 'cleared column drops from source_names')
assert(afterClear.items[0].source_columns.betexplorer.name === '' && afterClear.items[0].source_columns.betexplorer.editable === true, 'cleared column is editable dash')
assert(afterClear.items[0].source_columns.betexplorer.source === 'manual', 'explicit clear stays manual')
let invalid = false
try {
  await putSeedOverride({
    entity_id: 'macau-football-team-1',
    canonical_name_zh: '測試隊',
    canonical_name_en: 'Test FC',
    source_names: { macau_lottery: '澳彩別名' },
  })
} catch (error) {
  invalid = error?.code === 'BAD_REQUEST'
}
assert(invalid, 'macau source column is not a catalog alias edit')
const stillAiscore = await readSeedOverrides()
assert(stillAiscore.items['macau-football-team-1'].source_names.aiscore === '博洛人手', 'rejected source id does not wipe aliases')
const filled = await handleMappingRequest(new Request('http://local/api/mapping/overrides', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    entity_id: 'macau-football-team-2',
    canonical_name_zh: '帕里克瑪',
    canonical_name_en: 'Parikrma',
    source_names: { leisu: '帕里克瑪雷速' },
  }),
}))
assert(filled.status === 200, 'api accepts an empty source alias')
const parikrma = catalogRow(await queryCatalog({ sport: 'football', kind: 'team', q: '帕里克瑪雷速', page: 1, pageSize: 5 }), 'macau-football-team-2')
assert(parikrma?.source_names?.leisu === '帕里克瑪雷速' && parikrma?.canonical_name_zh === '帕里克瑪', 'filled dash is stored and macau name stays')
assert(parikrma?.source_columns?.betexplorer?.editable === true && parikrma?.source_columns?.betexplorer?.name === '', 'other empty sources stay editable')

await confirmEntry('team', 'fb-manutd')
let manutdRow = catalogRow(
  await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5468', page: 1, pageSize: 5 }),
  'macau-football-team-5468',
)
assert(manutdRow?.source_names?.betexplorer === 'Manchester United', 'confirm fills man utd betexplorer')
assert(manutdRow?.source_names?.scoresway === 'Man Utd', 'confirm fills man utd scoresway')
assert(manutdRow?.source_names?.aiscore === '曼徹斯特聯', 'confirm fills man utd aiscore')
assert(manutdRow?.source_names?.leisu === '曼聯', 'confirm fills man utd leisu')
assert(manutdRow?.source_columns?.betexplorer?.source === 'manual' && manutdRow?.source_columns?.leisu?.editable === true, 'confirmed man utd aliases are manual')
await putSeedOverride({
  entity_id: 'macau-football-team-5468',
  canonical_name_zh: '曼聯',
  canonical_name_en: 'Manchester Utd',
  source_names: { aiscore: '人手曼聯欄' },
})
await confirmEntry('team', 'fb-manutd')
const manutdKept = (await readSeedOverrides()).items['macau-football-team-5468']
assert(manutdKept?.source_names?.aiscore === '人手曼聯欄', 'confirm does not replace a manual column')
assert(manutdKept?.source_names?.betexplorer === 'Manchester United', 'confirm keeps the other man utd aliases')
const manutdWorkspace = await readWorkspace()
const manutdTeam = manutdWorkspace.teams.find((item) => item.team_id === 'fb-manutd')
manutdTeam.status = 'pending'
await writeWorkspace(manutdWorkspace)
manutdRow = catalogRow(
  await queryCatalog({ sport: 'football', kind: 'team', q: 'macau-football-team-5468', page: 1, pageSize: 5 }),
  'macau-football-team-5468',
)
assert(manutdRow?.source_names?.leisu === '曼聯', 'man utd aliases stay on the macau row without the workspace link')
assert(manutdRow?.source_names?.aiscore === '人手曼聯欄', 'manual man utd edit stays after the link drops')
assert(manutdRow?.canonical_name_zh === '曼聯' && manutdRow?.canonical_name_en === 'Manchester Utd', 'confirm does not rename the macau row')

const duplicateRows = await macauTargetsForEntity({
  entity: 'team',
  sport: 'football',
  name_zh: '西部APIA',
  name_en: 'Wests APIA',
})
assert(duplicateRows.length === 2, 'identical duplicate rows both receive the alias')
const pickedRow = await macauTargetsForEntity({
  entity: 'team',
  sport: 'football',
  name_zh: '利尼史特朗女足',
  name_en: 'LSK Kvinner W',
})
assert(pickedRow.length === 1 && pickedRow[0].entity_id === 'macau-football-team-3718', 'english name picks one of two')
const ambiguousRow = await macauTargetsForEntity({
  entity: 'team',
  sport: 'football',
  name_zh: '利尼史特朗女足',
  name_en: 'Not A Club',
})
assert(ambiguousRow.length === 0, 'ambiguous chinese name is not attached')
const manutdTarget = await macauTargetsForEntity({
  entity: 'team',
  sport: 'football',
  name_zh: '曼聯',
  name_en: 'Manchester United',
  aliases: [{ source_id: 'macau_lottery', name_zh: '曼聯', name_en: 'Man Utd' }],
})
assert(manutdTarget.length === 1 && manutdTarget[0].entity_id === 'macau-football-team-5468', 'man utd maps to 5468')

assert(resolveStoreDriver({ SCHEDULE_STORE: 'local' }) === 'local', 'local store stays on disk')
assert(resolveStoreDriver({}) === 'local', 'unset store stays on disk')
assert(resolveStoreDriver({ SCHEDULE_STORE: 'local', AWS_LAMBDA_FUNCTION_NAME: 'mapping' }) === 'netlify-blobs', 'netlify function does not use the ephemeral disk')
assert(resolveStoreDriver({ SCHEDULE_STORE: 'local', NETLIFY_BLOBS_CONTEXT: 'e30=' }) === 'netlify-blobs', 'blobs context upgrades local')
assert(resolveStoreDriver({ SCHEDULE_STORE: 'netlify-blobs' }) === 'netlify-blobs', 'explicit blobs driver')
assert(resolveStoreDriver({ SCHEDULE_STORE: 's3' }) === 's3', 'explicit s3 stays')
assert(createStore().driver === 'local', 'check script keeps the local store')
const memory = new Map()
const blobs = createNetlifyBlobsStore({
  async set(key, value) {
    memory.set(key, value)
  },
  async get(key) {
    return memory.has(key) ? memory.get(key) : null
  },
  async delete(key) {
    memory.delete(key)
  },
})
await blobs.put('mapping/overrides.json', '{"ok":true}\n')
assert((await blobs.get('mapping/overrides.json')) === '{"ok":true}\n', 'blobs adapter reads back the same key')
await blobs.put('mapping/workspace.json', '{"version":"mapping_store_v1"}\n')
assert((await blobs.get('mapping/workspace.json')) === '{"version":"mapping_store_v1"}\n', 'blobs adapter keeps workspace')
await blobs.delete('mapping/overrides.json')
assert((await blobs.get('mapping/overrides.json')) === null, 'blobs adapter deletes')
const savedDriver = process.env.SCHEDULE_STORE
const savedContext = process.env.NETLIFY_BLOBS_CONTEXT
const savedLambda = process.env.AWS_LAMBDA_FUNCTION_NAME
const savedSite = process.env.NETLIFY_BLOBS_SITE_ID
const savedToken = process.env.NETLIFY_AUTH_TOKEN
delete process.env.NETLIFY_BLOBS_CONTEXT
delete process.env.AWS_LAMBDA_FUNCTION_NAME
delete process.env.NETLIFY_BLOBS_SITE_ID
delete process.env.NETLIFY_AUTH_TOKEN
process.env.SCHEDULE_STORE = 'netlify-blobs'
let blobsRefused = false
try {
  createStore()
} catch (error) {
  blobsRefused = error?.code === 'STORE_NOT_CONFIGURED'
}
assert(blobsRefused, 'blobs outside netlify requires site id and token')
process.env.SCHEDULE_STORE = 'local'
process.env.AWS_LAMBDA_FUNCTION_NAME = 'mapping'
let functionRefused = false
try {
  createStore()
} catch (error) {
  functionRefused = error?.code === 'STORE_NOT_CONFIGURED' && String(error.message).includes('Netlify Blobs')
}
assert(functionRefused, 'function without blobs context fails closed')
process.env.SCHEDULE_STORE = savedDriver
if (savedContext === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT
else process.env.NETLIFY_BLOBS_CONTEXT = savedContext
if (savedLambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME
else process.env.AWS_LAMBDA_FUNCTION_NAME = savedLambda
if (savedSite === undefined) delete process.env.NETLIFY_BLOBS_SITE_ID
else process.env.NETLIFY_BLOBS_SITE_ID = savedSite
if (savedToken === undefined) delete process.env.NETLIFY_AUTH_TOKEN
else process.env.NETLIFY_AUTH_TOKEN = savedToken
assert(createStore().driver === 'local', 'local store restored')

const limited = await runScheduleJob({ trigger: 'manual', baseDate: '2026-10-30', now, paceMs: 0, scrape: false })
assert(limited.accepted === false && limited.job.reason.includes('5 分鐘'), 'rate limit')

if (previousStore === undefined) delete process.env.SCHEDULE_STORE_DIR
else process.env.SCHEDULE_STORE_DIR = previousStore
if (previousDriver === undefined) delete process.env.SCHEDULE_STORE
else process.env.SCHEDULE_STORE = previousDriver
await rm(dir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('phase2 ok')
