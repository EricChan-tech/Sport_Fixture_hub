const MACAU = 'Asia/Macau'

export function todayInMacau(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MACAU,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  const stamp = new Date(Date.UTC(year, month - 1, day + delta))
  const y = stamp.getUTCFullYear()
  const m = String(stamp.getUTCMonth() + 1).padStart(2, '0')
  const d = String(stamp.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatMacauDay(isoDate: string): string {
  const stamp = new Date(`${isoDate}T12:00:00+08:00`)
  if (Number.isNaN(stamp.getTime())) return isoDate
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    timeZone: MACAU,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(stamp)
}

export function formatMacauStamp(iso: string): string {
  const stamp = new Date(iso)
  if (Number.isNaN(stamp.getTime())) return iso
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    timeZone: MACAU,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(stamp)
}

export function kickoffClock(iso: string): string {
  const stamp = new Date(iso)
  if (Number.isNaN(stamp.getTime())) return '--:--'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MACAU,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(stamp)
}

export function monthCells(year: number, month: number): string[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const offset = (firstWeekday + 6) % 7
  const start = Date.UTC(year, month - 1, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const stamp = new Date(start + index * 86_400_000)
    return stamp.toISOString().slice(0, 10)
  })
}
