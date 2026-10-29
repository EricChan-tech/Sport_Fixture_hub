import manifest from '../../data/mapping/seeds/macau_lottery/manifest.json'

export interface MacauSeedItem {
  entity_id: string
  sport: 'football' | 'basketball'
  kind: 'team' | 'competition'
  canonical_name_zh: string
  canonical_name_en: string
  aliases: Array<{ source_id: string; name: string; normalized: string }>
  meta: { serial: number; continent?: string; category?: string }
  status: 'confirmed'
  source: 'import'
}

interface SeedFile {
  items: MacauSeedItem[]
}

export const macauSeedFiles = manifest.files

const loaders = {
  football_teams: () => import('../../data/mapping/seeds/macau_lottery/football_teams.json'),
  basketball_teams: () => import('../../data/mapping/seeds/macau_lottery/basketball_teams.json'),
  football_competitions: () => import('../../data/mapping/seeds/macau_lottery/football_competitions.json'),
  basketball_competitions: () => import('../../data/mapping/seeds/macau_lottery/basketball_competitions.json'),
} as const

const cache = new Map<string, MacauSeedItem[]>()

async function itemsFor(file: keyof typeof loaders): Promise<MacauSeedItem[]> {
  const cached = cache.get(file)
  if (cached) return cached
  const loaded = (await loaders[file]()) as { default: SeedFile }
  const items = loaded.default.items
  cache.set(file, items)
  return items
}

export async function searchMacauSeeds(query: string, limit = 20): Promise<MacauSeedItem[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const files = Object.keys(loaders) as Array<keyof typeof loaders>
  const groups = await Promise.all(files.map((file) => itemsFor(file)))
  const hits: MacauSeedItem[] = []
  for (const items of groups) {
    for (const item of items) {
      const blob = [
        item.entity_id,
        item.canonical_name_zh,
        item.canonical_name_en,
        item.meta.continent ?? '',
        item.meta.category ?? '',
        ...item.aliases.map((alias) => alias.normalized),
      ]
        .join(' ')
        .toLowerCase()
      if (!blob.includes(needle)) continue
      hits.push(item)
      if (hits.length >= limit) return hits
    }
  }
  return hits
}
