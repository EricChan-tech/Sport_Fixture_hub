import {
  alignObservations,
  applyMappingSuggestions,
  applyObservedAliases,
  observationsFromSchedule,
} from './align.mjs'
import { ensureWorkspace, writeWorkspace } from './mapping-store.mjs'

/**
 * Align published schedule cells against the runtime mapping store.
 * High-confidence names become confirmed and fill empty source aliases.
 * Low-confidence names stay pending. This does not edit the Macau whitelist
 * or the Git seed.
 */
export async function syncScheduleMappings(days) {
  const workspace = await ensureWorkspace()
  const alignment = alignObservations(observationsFromSchedule(days), workspace)
  const withStatus = applyMappingSuggestions(workspace, alignment.suggestions)
  const withAliases = applyObservedAliases(withStatus, alignment.aliasWrites)
  return writeWorkspace(withAliases)
}
