import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']

/** Container flags only. They do not change the client fingerprint. */
const CHROME_ARGS = [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--virtual-time-budget=15000',
  '--timeout=22000',
  '--dump-dom',
]

export async function resolveChrome() {
  if (process.env.MACAU_CHROME) return process.env.MACAU_CHROME
  for (const name of BROWSERS) {
    try {
      const { stdout } = await execFileAsync('sh', ['-c', `command -v ${name}`])
      const found = stdout.trim()
      if (found) return found
    } catch {
      // try the next binary
    }
  }
  return null
}

function stopProcess(child) {
  if (!child?.pid || child.killed) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
}

/**
 * Open a public page in ordinary headless Chrome and return the rendered DOM.
 * No proxy, no custom user agent, no fingerprint evasion.
 */
export async function renderPublicPage(url, options = {}) {
  const bin = options.chromePath || await resolveChrome()
  if (!bin) {
    const error = new Error('這台機器沒有 Chrome，無法渲染澳彩公開賽程頁。')
    error.code = 'NO_BROWSER'
    throw error
  }
  const timeoutMs = options.timeoutMs ?? 32000
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...CHROME_ARGS, url], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (handler) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stopProcess(child)
      handler()
    }
    const timer = setTimeout(() => {
      finish(() => {
        if (stdout.includes('<html') || stdout.includes('<HTML')) {
          resolve(stdout)
          return
        }
        const error = new Error('渲染澳彩賽程頁逾時。')
        error.code = 'TIMEOUT'
        reject(error)
      })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (error) => {
      finish(() => reject(error))
    })
    child.on('close', () => {
      finish(() => {
        if (stdout.includes('<html') || stdout.includes('<HTML')) {
          resolve(stdout)
          return
        }
        const error = new Error('澳彩賽程頁沒有回傳 HTML。')
        error.code = 'EMPTY'
        error.detail = stderr.slice(-300)
        reject(error)
      })
    })
  })
}
