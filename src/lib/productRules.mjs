import { NAME_PRIORITY } from './sources.mjs'

export function uniqueIds(ids) {
  const seen = new Set()
  const out = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Preference is null when the user has no saved whitelist.
 * An empty array is an explicit "select none" and still unions Macau locks.
 */
export function effectiveCompetitionIds({ stored, defaults, macauLocked }) {
  const base = stored === null || stored === undefined ? defaults : stored
  return uniqueIds([...base, ...macauLocked])
}

export function selectNoneIds(macauLocked) {
  return uniqueIds(macauLocked)
}

export function clearedPreferenceIds({ defaults, macauLocked }) {
  return effectiveCompetitionIds({ stored: null, defaults, macauLocked })
}

export function macauLockedCompetitionIds(matches) {
  const ids = []
  for (const match of matches) {
    if (match.has_macau) ids.push(match.competition_id)
  }
  return uniqueIds(ids)
}

export function resolveDisplayName(sources, field) {
  for (const sourceId of NAME_PRIORITY) {
    const cell = sources.find((item) => item.source_id === sourceId)
    if (!cell || cell.cell === 'missing') continue
    const value = cell[field]
    if (typeof value === 'string' && value.trim()) {
      return { text: value.trim(), source_id: sourceId }
    }
  }
  return { text: '', source_id: null }
}

export function sortByTime(matches) {
  return [...matches].sort((a, b) => {
    const byTime = a.kickoff_at.localeCompare(b.kickoff_at)
    if (byTime !== 0) return byTime
    return a.match_id.localeCompare(b.match_id)
  })
}

/** Groups by competition. Groups follow the earliest kickoff; rows inside a group follow kickoff. */
export function sortByCompetition(matches) {
  const groups = new Map()
  for (const match of matches) {
    const list = groups.get(match.competition_id) ?? []
    list.push(match)
    groups.set(match.competition_id, list)
  }

  const ordered = [...groups.entries()].sort((a, b) => {
    const aEarliest = [...a[1]].map((match) => match.kickoff_at).sort()[0] ?? ''
    const bEarliest = [...b[1]].map((match) => match.kickoff_at).sort()[0] ?? ''
    const byTime = aEarliest.localeCompare(bEarliest)
    if (byTime !== 0) return byTime
    return a[0].localeCompare(b[0])
  })

  const result = []
  for (const [, list] of ordered) {
    list.sort(
      (a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || a.match_id.localeCompare(b.match_id),
    )
    result.push(...list)
  }
  return result
}

function dayNumber(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** Inclusive manual refresh window around today in Asia/Macau calendar dates. */
export function withinManualWindow(date, today, windowDays = 3) {
  const delta = Math.abs(dayNumber(date) - dayNumber(today))
  return Number.isFinite(delta) && delta <= windowDays
}
