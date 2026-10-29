import type { SourceId } from '../types/schema'

export const SOURCE_IDS: readonly SourceId[]

export const SOURCE_META: Record<SourceId, { zh: string; en: string }>

export const NAME_PRIORITY: readonly SourceId[]

export const NAME_ORIGIN: Record<SourceId, string>

export function isSourceId(value: string): value is SourceId
