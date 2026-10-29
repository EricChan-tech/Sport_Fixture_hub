import { NAME_PRIORITY, SOURCE_IDS } from '../src/lib/sources.mjs'

/** High-confidence names share a match across 36 hours. Ninety minutes is not this gate. */
export const HIGH_CONFIDENCE_WINDOW_MS = 36 * 60 * 60 * 1000

/** Low-confidence names use a tighter window. */
export const LOW_CONFIDENCE_WINDOW_MS = 6 * 60 * 60 * 1000

export const CONFIRM_THRESHOLD = 0.92
export const PENDING_THRESHOLD = 0.72

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function aliasNames(entity) {
  const names = [entity.name_zh, entity.name_en, entity.canonical_name_zh, entity.canonical_name_en]
  for (const alias of entity.aliases || []) {
    names.push(alias.name, alias.name_zh, alias.name_en)
  }
  return names.filter(Boolean)
}

function buildIndex(entries) {
  const exact = new Map()
  for (const entry of entries) {
    const id = entry.team_id || entry.competition_id || entry.entity_id
    for (const name of aliasNames(entry)) {
      exact.set(normalize(name), { id, status: entry.status || 'confirmed', entity: entry })
    }
  }
  return exact
}

function scoreName(name, index) {
  const key = normalize(name)
  if (!key) return { score: 0, id: null, status: null, entity: null }
  const direct = index.get(key)
  if (direct) return { score: 1, ...direct }
  let best = { score: 0, id: null, status: null, entity: null }
  for (const [known, hit] of index) {
    if (known.length < 2 || key.length < 2) continue
    if (known.includes(key) || key.includes(known)) {
      best = { score: 0.8, ...hit }
      break
    }
  }
  return best
}

function confidenceOf(homeScore, awayScore) {
  const min = Math.min(homeScore, awayScore)
  if (min >= CONFIRM_THRESHOLD) return 'high'
  if (min >= PENDING_THRESHOLD) return 'low'
  return 'none'
}

function windowFor(confidence) {
  return confidence === 'high' ? HIGH_CONFIDENCE_WINDOW_MS : LOW_CONFIDENCE_WINDOW_MS
}

function clusterKey(item) {
  if (item.confidence === 'none') return `name:${[item.normHome, item.normAway].sort().join('|')}`
  return `id:${[item.homeId, item.awayId].sort().join('|')}`
}

function priorityIndex(sourceId) {
  const index = NAME_PRIORITY.indexOf(sourceId)
  return index === -1 ? NAME_PRIORITY.length : index
}

export function alignObservations(observations, mapping = {}) {
  const teams = mapping.teams || []
  const competitions = mapping.competitions || []
  const teamIndex = buildIndex(teams)
  const competitionIndex = buildIndex(competitions)
  const suggestions = []
  const seenSuggestions = new Set()

  function suggest(kind, hit, observedName) {
    if (!hit.id || hit.score < PENDING_THRESHOLD) return
    if (hit.status === 'confirmed' && hit.score >= CONFIRM_THRESHOLD) return
    const status = hit.score >= CONFIRM_THRESHOLD ? 'confirmed' : 'pending'
    const key = `${kind}:${hit.id}:${status}`
    if (seenSuggestions.has(key)) return
    seenSuggestions.add(key)
    suggestions.push({
      kind,
      id: hit.id,
      observed_name: observedName,
      score: hit.score,
      status,
      source: 'auto',
    })
  }

  const resolved = observations.map((obs) => {
    const home = scoreName(obs.home_name, teamIndex)
    const away = scoreName(obs.away_name, teamIndex)
    const competition = scoreName(obs.competition_name || obs.league_name, competitionIndex)
    suggest('team', home, obs.home_name)
    suggest('team', away, obs.away_name)
    suggest('competition', competition, obs.competition_name || obs.league_name)
    const confidence = confidenceOf(home.score, away.score)
    return {
      obs,
      home,
      away,
      competition,
      confidence,
      homeId: home.id,
      awayId: away.id,
      normHome: normalize(obs.home_name),
      normAway: normalize(obs.away_name),
    }
  })

  const clusters = []
  for (const item of resolved) {
    const key = clusterKey(item)
    const limit = windowFor(item.confidence)
    const kick = Date.parse(item.obs.kickoff_at)
    const cluster = clusters.find((candidate) => {
      if (candidate.key !== key || candidate.sport !== item.obs.sport) return false
      return candidate.members.some((member) => Math.abs(Date.parse(member.obs.kickoff_at) - kick) <= limit)
    })
    if (cluster) cluster.members.push(item)
    else clusters.push({ key, sport: item.obs.sport, members: [item] })
  }

  const matches = clusters.map((cluster) => {
    const canonical = [...cluster.members].sort(
      (a, b) => priorityIndex(a.obs.source_id) - priorityIndex(b.obs.source_id),
    )[0]
    const canonicalKick = Date.parse(canonical.obs.kickoff_at)
    const bySource = new Map(cluster.members.map((member) => [member.obs.source_id, member]))
    const sources = SOURCE_IDS.map((sourceId) => {
      const member = bySource.get(sourceId)
      if (!member) return { source_id: sourceId, cell: 'missing' }
      const swapped = member.homeId && canonical.homeId
        ? member.homeId === canonical.awayId && member.awayId === canonical.homeId
        : member.normHome === canonical.normAway && member.normAway === canonical.normHome && member.normHome !== member.normAway
      const delta = Math.round((Date.parse(member.obs.kickoff_at) - canonicalKick) / 60000)
      const cell = {
        source_id: sourceId,
        cell: delta === 0 ? 'ok' : 'mismatch',
        kickoff_at: member.obs.kickoff_at,
        league_name: member.obs.league_name || member.obs.competition_name || '',
        home_name: member.obs.home_name,
        away_name: member.obs.away_name,
      }
      if (swapped) cell.sides_swapped = true
      if (delta !== 0) cell.delta_minutes = delta
      return cell
    })
    const competitionBonus = canonical.competition.score >= CONFIRM_THRESHOLD ? 0.05 : 0
    const teamScore = Math.min(canonical.home.score, canonical.away.score)
    return {
      match_id: `aligned-${canonical.obs.sport}-${canonical.obs.kickoff_at.slice(0, 10)}-${cluster.key}`,
      sport: canonical.obs.sport,
      competition_id: canonical.competition.id || '',
      kickoff_at: canonical.obs.kickoff_at,
      home_name: canonical.obs.home_name,
      away_name: canonical.obs.away_name,
      home_team_id: canonical.homeId || '',
      away_team_id: canonical.awayId || '',
      confidence: Math.min(1, teamScore + competitionBonus),
      has_macau: sources.some((cell) => cell.source_id === 'macau_lottery' && cell.cell !== 'missing'),
      sources,
    }
  })

  return { matches, suggestions }
}

export function applyMappingSuggestions(workspace, suggestions) {
  const next = structuredClone(workspace)
  for (const suggestion of suggestions) {
    const list = suggestion.kind === 'competition' ? next.competitions : next.teams
    const idField = suggestion.kind === 'competition' ? 'competition_id' : 'team_id'
    const item = list.find((entry) => entry[idField] === suggestion.id)
    if (!item || item.source === 'manual') continue
    if (suggestion.status === 'confirmed') {
      item.status = 'confirmed'
      item.source = 'auto'
    } else if (item.status !== 'confirmed') {
      item.status = 'pending'
      item.source = 'auto'
    }
  }
  next.pending = [
    ...(next.competitions || []).filter((item) => item.status === 'pending'),
    ...(next.teams || []).filter((item) => item.status === 'pending'),
  ]
  return next
}

export function sampleObservations() {
  const kick = '2026-10-30T20:30:00+08:00'
  const later = '2026-10-30T22:30:00+08:00'
  return [
    { source_id: 'macau_lottery', sport: 'football', kickoff_at: kick, home_name: '曼聯', away_name: '利物浦', competition_name: '英超', league_name: '英超' },
    { source_id: 'betexplorer', sport: 'football', kickoff_at: later, home_name: '利物浦', away_name: '曼聯', competition_name: 'Premier League', league_name: 'Premier League' },
    { source_id: 'leisu', sport: 'football', kickoff_at: kick, home_name: '曼聯', away_name: '利物浦', competition_name: '英超', league_name: '英超' },
  ]
}

export function sampleMapping() {
  return {
    teams: [
      { team_id: 'fb-manutd', sport: 'football', name_zh: '曼聯', name_en: 'Manchester United', status: 'pending', source: 'auto', aliases: [{ name: '曼聯' }] },
      { team_id: 'fb-liverpool', sport: 'football', name_zh: '利物浦', name_en: 'Liverpool', status: 'confirmed', source: 'import', aliases: [{ name: '利物浦' }] },
      { team_id: 'fb-arsenal', sport: 'football', name_zh: '阿仙奴', name_en: 'Arsenal', status: 'pending', source: 'auto', aliases: [{ name: '阿仙奴' }] },
    ],
    competitions: [
      { competition_id: 'fb-epl', name_zh: '英超', name_en: 'Premier League', status: 'confirmed', source: 'import', aliases: [{ name: '英超' }, { name: 'Premier League' }] },
    ],
  }
}
