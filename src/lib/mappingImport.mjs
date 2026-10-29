import { SOURCE_IDS, isSourceId } from './sources.mjs'

export const CSV_HEADER = [
  'entity',
  'sport',
  'id',
  'name_zh',
  'name_en',
  'macau_zh',
  'macau_en',
  'leisu_zh',
  'aiscore_zh',
  'betexplorer_en',
  'scoresway_en',
]

const CSV_ALIAS_COLUMNS = [
  ['macau_zh', 'macau_en', 'macau_lottery'],
  ['leisu_zh', null, 'leisu'],
  ['aiscore_zh', null, 'aiscore'],
  [null, 'betexplorer_en', 'betexplorer'],
  [null, 'scoresway_en', 'scoresway'],
]

function emptyItemError(prefix, message) {
  return { ok: false, error: `${prefix}${message}` }
}

function pushAlias(aliases, sourceId, nameZh, nameEn) {
  const alias = { source_id: sourceId }
  if (nameZh) alias.name_zh = nameZh
  if (nameEn) alias.name_en = nameEn
  if (!alias.name_zh && !alias.name_en) return null
  aliases.push(alias)
  return alias
}

function normalizeItem(raw, prefix) {
  if (!raw || typeof raw !== 'object') return emptyItemError(prefix, '不是物件。')
  const entity = raw.entity
  const sport = raw.sport
  if (entity !== 'competition' && entity !== 'team') {
    return emptyItemError(prefix, 'entity 必須是 competition 或 team。')
  }
  if (sport !== 'football' && sport !== 'basketball') {
    return emptyItemError(prefix, 'sport 必須是 football 或 basketball。')
  }
  const nameZh = typeof raw.name_zh === 'string' ? raw.name_zh.trim() : ''
  const nameEn = typeof raw.name_en === 'string' ? raw.name_en.trim() : ''
  if (!nameZh || !nameEn) return emptyItemError(prefix, 'name_zh 與 name_en 都要有值。')

  const idField = entity === 'competition' ? 'competition_id' : 'team_id'
  const idValue = typeof raw[idField] === 'string' ? raw[idField].trim() : ''
  if (raw.competition_id && entity !== 'competition') {
    return emptyItemError(prefix, '球隊列不應填 competition_id。')
  }
  if (raw.team_id && entity !== 'team') {
    return emptyItemError(prefix, '賽事列不應填 team_id。')
  }

  const aliases = []
  if (raw.aliases !== undefined) {
    if (!Array.isArray(raw.aliases)) return emptyItemError(prefix, 'aliases 必須是陣列。')
    for (const alias of raw.aliases) {
      if (!alias || typeof alias !== 'object') return emptyItemError(prefix, '別名格式不正確。')
      if (!isSourceId(alias.source_id)) {
        return emptyItemError(prefix, '別名來源不在允許清單。允許的來源只有五個。')
      }
      const aliasZh = typeof alias.name_zh === 'string' ? alias.name_zh.trim() : ''
      const aliasEn = typeof alias.name_en === 'string' ? alias.name_en.trim() : ''
      if (!aliasZh && !aliasEn) return emptyItemError(prefix, '別名至少要有中文或英文。')
      pushAlias(aliases, alias.source_id, aliasZh, aliasEn)
    }
  }

  const item = { entity, sport, name_zh: nameZh, name_en: nameEn, aliases }
  if (idValue) item.id = idValue
  return { ok: true, item }
}

function parseJsonImport(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON 無法解析。' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'JSON 根節點必須是物件。' }
  }
  if (data.version !== 'mapping_import_v1') {
    return { ok: false, error: 'version 必須是 mapping_import_v1。' }
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return { ok: false, error: 'items 必須是非空陣列。' }
  }
  const items = []
  for (let index = 0; index < data.items.length; index += 1) {
    const normalized = normalizeItem(data.items[index], `items[${index}]：`)
    if (!normalized.ok) return normalized
    items.push(normalized.item)
  }
  return { ok: true, items }
}

export function parseCsvTable(text) {
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
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      cell = ''
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
    } else {
      cell += char
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim() !== '')) rows.push(row)
  }
  return rows
}

function parseCsvImport(text) {
  const rows = parseCsvTable(text)
  if (rows.length < 2) return { ok: false, error: 'CSV 至少要有標題列與一列資料。' }
  const header = rows[0].map((value) => value.trim())
  if (header.join(',') !== CSV_HEADER.join(',')) {
    return { ok: false, error: `CSV 標題必須是 ${CSV_HEADER.join(',')}。` }
  }
  const items = []
  for (let index = 1; index < rows.length; index += 1) {
    const line = rows[index]
    if (line.length !== CSV_HEADER.length) {
      return { ok: false, error: `第 ${index + 1} 行欄位數不正確。` }
    }
    const record = Object.fromEntries(CSV_HEADER.map((key, column) => [key, (line[column] ?? '').trim()]))
    const aliases = []
    for (const [zhKey, enKey, sourceId] of CSV_ALIAS_COLUMNS) {
      const nameZh = zhKey ? record[zhKey] : ''
      const nameEn = enKey ? record[enKey] : ''
      if (!isSourceId(sourceId)) {
        return { ok: false, error: '別名來源不在允許清單。' }
      }
      pushAlias(aliases, sourceId, nameZh, nameEn)
    }
    const normalized = normalizeItem(
      {
        entity: record.entity,
        sport: record.sport,
        name_zh: record.name_zh,
        name_en: record.name_en,
        [record.entity === 'team' ? 'team_id' : 'competition_id']: record.id,
        aliases,
      },
      `第 ${index + 1} 行：`,
    )
    if (!normalized.ok) return normalized
    items.push(normalized.item)
  }
  return { ok: true, items }
}

export function parseMappingImport(text) {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: '請貼上 CSV 或 JSON。' }
  if (trimmed.startsWith('{')) return parseJsonImport(trimmed)
  return parseCsvImport(trimmed)
}

export function allowedSourceIds() {
  return [...SOURCE_IDS]
}
