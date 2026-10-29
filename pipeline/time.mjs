export function todayInMacau(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addCalendarDays(isoDate, delta) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const stamp = new Date(Date.UTC(year, month - 1, day + delta))
  const y = stamp.getUTCFullYear()
  const m = String(stamp.getUTCMonth() + 1).padStart(2, '0')
  const d = String(stamp.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
