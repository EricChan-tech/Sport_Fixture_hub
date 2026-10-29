import type { SourceId, Sport } from '../types/schema'

export const CSV_HEADER: readonly string[]

export interface ParsedAlias {
  source_id: SourceId
  name_zh?: string
  name_en?: string
}

export interface ParsedImportItem {
  entity: 'competition' | 'team'
  sport: Sport
  id?: string
  name_zh: string
  name_en: string
  aliases: ParsedAlias[]
}

export type ImportParseResult =
  | { ok: true; items: ParsedImportItem[] }
  | { ok: false; error: string }

export function parseCsvTable(text: string): string[][]

export function parseMappingImport(text: string): ImportParseResult

export function allowedSourceIds(): SourceId[]
