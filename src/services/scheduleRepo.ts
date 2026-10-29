import type { DayFile, Manifest } from '../types/schema'

export class ScheduleLoadError extends Error {}

export interface LoadedSchedule {
  manifest: Manifest
  days: DayFile[]
  origin: 'store' | 'fixtures'
  notice: string
}

function trimBase(value: string | undefined, fallback: string): string {
  const configured = value?.trim()
  return (configured || fallback).replace(/\/$/, '')
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    throw new ScheduleLoadError(`無法連線 ${url}`)
  }
  if (!response.ok) throw new ScheduleLoadError(`無法讀取 ${url}（${response.status}）`)
  return (await response.json()) as T
}

function dayUrl(base: string, dayPath: string): string {
  if (dayPath.startsWith('/')) return dayPath
  return `${base}/${dayPath}`
}

async function loadFrom(base: string, manifestUrl: string): Promise<{ manifest: Manifest; days: DayFile[] }> {
  const manifest = await getJson<Manifest>(manifestUrl)
  const days = await Promise.all(
    manifest.sports.flatMap((sport) => sport.days.map((day) => getJson<DayFile>(dayUrl(base, day.path)))),
  )
  return { manifest, days }
}

export async function loadSchedule(): Promise<LoadedSchedule> {
  const scheduleBase = trimBase(import.meta.env.VITE_SCHEDULE_BASE, '/schedule')
  try {
    const stored = await loadFrom(scheduleBase, `${scheduleBase}/manifest.json`)
    return { ...stored, origin: 'store', notice: '' }
  } catch {
    const fixtureBase = trimBase(import.meta.env.VITE_FIXTURE_BASE, '')
    const fixtures = await loadFrom(fixtureBase, `${fixtureBase}/fixtures/manifest.json`)
    return {
      ...fixtures,
      origin: 'fixtures',
      notice: '物件儲存暫無可用賽程，正在顯示上一份示範資料，內容可能過期。',
    }
  }
}
