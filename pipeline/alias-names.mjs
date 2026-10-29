import { SOURCE_IDS } from '../src/lib/sources.mjs'

/** Non-Macau columns on the full catalog. Order follows SOURCE_IDS. */
export const CATALOG_SOURCE_IDS = SOURCE_IDS.filter((id) => id !== 'macau_lottery')

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Prefer Chinese, then English, then a single undifferentiated alias string. */
export function aliasDisplayName(alias) {
  const zh = String(alias?.name_zh || '').trim()
  if (zh) return zh
  const en = String(alias?.name_en || '').trim()
  if (en) return en
  return String(alias?.name || '').trim()
}

export function sourceNamesFromAliases(aliases) {
  const picked = new Map()
  for (const alias of aliases || []) {
    if (!alias || !SOURCE_IDS.includes(alias.source_id)) continue
    const text = aliasDisplayName(alias)
    if (!text) continue
    const fromZh = Boolean(String(alias.name_zh || '').trim())
    const current = picked.get(alias.source_id)
    if (!current || (fromZh && !current.fromZh)) picked.set(alias.source_id, { text, fromZh })
  }
  const names = {}
  for (const [sourceId, value] of picked) names[sourceId] = value.text
  return names
}

export function aliasSearchText(aliases) {
  const texts = []
  for (const alias of aliases || []) {
    for (const field of ['name_zh', 'name_en', 'name', 'normalized']) {
      const value = String(alias?.[field] || '').trim()
      if (value) texts.push(value)
    }
  }
  return texts
}
