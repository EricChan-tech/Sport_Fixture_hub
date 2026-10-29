/** Convert a wall-clock time in `timeZone` to an absolute instant. */
export function zonedWallTimeToDate(parts, timeZone) {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  let guess = wanted
  for (let i = 0; i < 3; i += 1) {
    const shown = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
    )
    const hour = shown.hour === '24' ? 0 : Number(shown.hour)
    const shownUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), hour, Number(shown.minute), Number(shown.second))
    const delta = shownUtc - wanted
    if (delta === 0) return new Date(guess)
    guess -= delta
  }
  return new Date(guess)
}

/** Absolute instant as an Asia/Macau calendar date and offset timestamp. */
export function macauStamp(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Macau',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const shown = Object.fromEntries(
    fmt.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  const hour = shown.hour === '24' ? '00' : shown.hour
  const dateText = `${shown.year}-${shown.month}-${shown.day}`
  return {
    date: dateText,
    kickoff_at: `${dateText}T${hour}:${shown.minute}:${shown.second}+08:00`,
  }
}

export function macauWallTime(dateText, hour, minute) {
  const [year, month, day] = dateText.split('-').map(Number)
  return macauStamp(zonedWallTimeToDate({
    year,
    month,
    day,
    hour: Number(hour),
    minute: Number(minute),
  }, 'Asia/Macau'))
}
