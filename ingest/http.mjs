/** Normal browser identity. Not a custom fingerprint. */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function shortMessage(error, fallback) {
  const message = error instanceof Error ? error.message : fallback
  return String(message || fallback).replace(/\s+/g, ' ').slice(0, 240)
}

export async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-HK,zh;q=0.9,en;q=0.8',
      'user-agent': options.userAgent || BROWSER_UA,
      ...(options.referer ? { referer: options.referer } : {}),
    },
  })
  const text = await response.text()
  return { url: response.url || url, status: response.status, text }
}
