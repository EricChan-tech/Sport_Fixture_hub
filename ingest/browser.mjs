import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const execFileAsync = promisify(execFile)

const BROWSERS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'msedge',
]

export async function resolveChrome() {
  if (process.env.SCHEDULE_CHROME) return process.env.SCHEDULE_CHROME
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
 * Ordinary headless Chrome. No proxy and no fingerprint evasion.
 * `dump-dom` returns before some schedule pages finish their own requests,
 * so this waits on the page target until the list is drawn or the site blocks.
 */
export async function openBrowser(options = {}) {
  const bin = options.chromePath || await resolveChrome()
  if (!bin) {
    const error = new Error('這台機器沒有 Chrome，無法渲染需要瀏覽器的賽程頁。')
    error.code = 'NO_BROWSER'
    throw error
  }
  const port = options.port || (9400 + Math.floor(Math.random() * 500))
  const dataDir = await mkdtemp(path.join(tmpdir(), 'schedule-chrome-'))
  const child = spawn(bin, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${dataDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  let pageSocket = null
  let seq = 0
  const pending = new Map()

  const fail = (error) => {
    stopProcess(child)
    void rm(dataDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  try {
    let version = null
    for (let i = 0; i < 50; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)
        if (response.ok) {
          version = await response.json()
          break
        }
      } catch {
        // browser still starting
      }
      await delay(200)
    }
    if (!version) fail(Object.assign(new Error('Chrome 沒有打開除錯埠。'), { code: 'NO_BROWSER' }))
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
    if (!page) fail(Object.assign(new Error('Chrome 沒有頁面目標。'), { code: 'NO_BROWSER' }))
    pageSocket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      pageSocket.addEventListener('open', resolve)
      pageSocket.addEventListener('error', () => reject(Object.assign(new Error('無法連上 Chrome。'), { code: 'NO_BROWSER' })))
    })
    pageSocket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    })
  } catch (error) {
    stopProcess(child)
    void rm(dataDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  function send(method, params = {}) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, resolve)
      try {
        pageSocket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  }

  async function pageHtml() {
    const evaluated = await send('Runtime.evaluate', {
      expression: 'document.documentElement ? document.documentElement.outerHTML : ""',
      returnByValue: true,
    })
    return evaluated.result?.result?.value || ''
  }

  return {
    async render(url, renderOptions = {}) {
      const timeoutMs = renderOptions.timeoutMs ?? 12000
      const ready = renderOptions.readyExpression || 'false'
      const navigated = await send('Page.navigate', { url })
      if (navigated.result?.errorText) {
        const error = new Error(`頁面沒有打開：${navigated.result.errorText}`)
        error.code = 'NAVIGATION'
        throw error
      }
      const started = Date.now()
      let html = ''
      while (Date.now() - started < timeoutMs) {
        await delay(500)
        html = await pageHtml()
        if (/Just a moment|Access Denied|cf-browser-verification|errors\.edgesuite\.net/i.test(html)) return html
        const probe = await send('Runtime.evaluate', { expression: `Boolean(${ready})`, returnByValue: true })
        if (probe.result?.result?.value) return html
      }
      return html || pageHtml()
    },
    close() {
      try {
        pageSocket?.close()
      } catch {
        // socket already gone
      }
      stopProcess(child)
      void rm(dataDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
