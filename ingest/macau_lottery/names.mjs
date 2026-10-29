import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { repoRoot } from '../../pipeline/paths.mjs'

const SPORTS = ['football', 'basketball']

let catalogPromise

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function remember(index, sport, kind, name, id) {
  const key = normalizeName(name)
  if (!key || index.has(`${sport}\0${kind}\0${key}`)) return
  index.set(`${sport}\0${kind}\0${key}`, id)
}

async function loadCatalog() {
  const index = new Map()
  const root = path.join(repoRoot(), 'data/mapping/seeds/macau_lottery')
  for (const sport of SPORTS) {
    for (const kind of ['competition', 'team']) {
      const file = path.join(root, `${sport}_${kind}s.json`)
      const payload = JSON.parse(await readFile(file, 'utf8'))
      for (const item of payload.items || []) {
        const id = item.entity_id
        remember(index, sport, kind, item.canonical_name_zh, id)
        remember(index, sport, kind, item.canonical_name_en, id)
        remember(index, sport, kind, item.short_name_zh, id)
        for (const alias of item.aliases || []) remember(index, sport, kind, alias.name, id)
      }
    }
  }
  return index
}

function catalog() {
  catalogPromise ??= loadCatalog()
  return catalogPromise
}

export function fallbackCompetitionId(sport, leagueName) {
  const slug = createHash('sha1').update(normalizeName(leagueName)).digest('hex').slice(0, 10)
  return `macau-${sport}-league-${slug}`
}

export async function attachCatalogIds(fixtures) {
  const index = await catalog()
  return fixtures.map((fixture) => {
    const competitionId = index.get(`${fixture.sport}\0competition\0${normalizeName(fixture.league_name)}`)
      || fallbackCompetitionId(fixture.sport, fixture.league_name)
    return {
      ...fixture,
      competition_id: competitionId,
      home_team_id: index.get(`${fixture.sport}\0team\0${normalizeName(fixture.home_name)}`) || '',
      away_team_id: index.get(`${fixture.sport}\0team\0${normalizeName(fixture.away_name)}`) || '',
    }
  })
}
