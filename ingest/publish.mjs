import { alignObservations } from '../pipeline/align.mjs'

function observationFromFixture(fixture) {
  return {
    source_id: fixture.source_id,
    sport: fixture.sport,
    kickoff_at: fixture.kickoff_at,
    home_name: fixture.home_name,
    away_name: fixture.away_name,
    competition_name: fixture.league_name || '',
    league_name: fixture.league_name || '',
  }
}

export function daysFromFixtures({ sport, dates, fixtures, workspace, updatedAt }) {
  const relevant = (fixtures || []).filter((fixture) => fixture.sport === sport)
  const aligned = alignObservations(relevant.map(observationFromFixture), workspace || {})
  const extras = new Map()
  for (const fixture of relevant) {
    extras.set([fixture.source_id, fixture.kickoff_at, fixture.home_name, fixture.away_name].join('\0'), fixture)
  }
  const byDate = new Map((dates || []).map((date) => [date, []]))
  for (const match of aligned.matches) {
    const date = String(match.kickoff_at || '').slice(0, 10)
    if (!byDate.has(date)) continue
    const sources = match.sources.map((cell) => {
      if (!cell || cell.cell === 'missing') return cell
      const fixture = extras.get([cell.source_id, cell.kickoff_at, cell.home_name, cell.away_name].join('\0'))
      if (!fixture?.external_id) return cell
      return { ...cell, external_id: fixture.external_id }
    })
    const canonical = sources.find((cell) => cell?.cell !== 'missing' && cell.home_name === match.home_name)
      || sources.find((cell) => cell?.cell !== 'missing')
    const statusFixture = relevant.find((fixture) => (
      fixture.source_id === canonical?.source_id
      && fixture.kickoff_at === match.kickoff_at
      && fixture.home_name === canonical?.home_name
    ))
    byDate.get(date).push({
      ...match,
      league_name: canonical?.league_name || '',
      status: statusFixture?.status || 'scheduled',
      sources,
      updated_at: updatedAt,
    })
  }
  return (dates || []).map((date) => ({
    schema_version: '1.0.0',
    sport,
    date,
    timezone: 'Asia/Macau',
    matches: (byDate.get(date) || []).sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || a.match_id.localeCompare(b.match_id)),
  }))
}
