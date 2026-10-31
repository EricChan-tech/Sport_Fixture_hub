import { getStore } from '@netlify/blobs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function storeRoot() {
  return process.env.SCHEDULE_STORE_DIR || path.join(process.cwd(), '.schedule-store')
}

export function objectKey(sport, date) {
  return `${sport}/days/${date}.json`
}

const BLOB_STORE_NAME = 'schedule'

const REMOTE_ENV = {
  s3: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  r2: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
}

/**
 * Netlify Functions 的檔案系統在實例結束後就沒了。
 * 函式裡即使 SCHEDULE_STORE 仍是 local（或未設），也改走站點級 Blobs。
 * 本機 Vite、檢查腳本與 GitHub Actions 沒有這些訊號，繼續用 .schedule-store。
 */
export function runningInNetlifyFunction(env = process.env) {
  if (env.NETLIFY_BLOBS_CONTEXT || env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT) return true
  if (env !== process.env) return false
  if (globalThis.netlifyBlobsContext) return true
  const netlifyEnv = globalThis.Netlify?.env
  if (netlifyEnv && typeof netlifyEnv.get === 'function') {
    if (netlifyEnv.get('NETLIFY_BLOBS_CONTEXT') || netlifyEnv.get('AWS_LAMBDA_FUNCTION_NAME')) return true
  }
  return false
}

export function resolveStoreDriver(env = process.env) {
  const configured = String(env.SCHEDULE_STORE ?? '').trim()
  if (configured && configured !== 'local') return configured
  if (runningInNetlifyFunction(env)) return 'netlify-blobs'
  return 'local'
}

function missingBlobsCredentials(env = process.env) {
  if (runningInNetlifyFunction(env)) return []
  return ['NETLIFY_BLOBS_SITE_ID', 'NETLIFY_AUTH_TOKEN'].filter((name) => !env[name])
}

export function missingRemoteEnv(driver, env = process.env) {
  if (driver === 'netlify-blobs') return missingBlobsCredentials(env)
  const names = REMOTE_ENV[driver] ?? []
  return names.filter((name) => !env[name])
}

function localStore(root) {
  async function fileFor(key) {
    const full = path.join(root, key)
    await mkdir(path.dirname(full), { recursive: true })
    return full
  }

  return {
    driver: 'local',
    root,
    async put(key, value) {
      const full = await fileFor(key)
      await writeFile(full, value, 'utf8')
    },
    async get(key) {
      try {
        return await readFile(path.join(root, key), 'utf8')
      } catch (error) {
        if (error && error.code === 'ENOENT') return null
        throw error
      }
    },
    async delete(key) {
      try {
        await unlink(path.join(root, key))
      } catch (error) {
        if (error && error.code !== 'ENOENT') throw error
      }
    },
  }
}

function remoteStore(driver) {
  return {
    driver,
    root: null,
    async put() {
      throw new Error(`${driver} 適配器只預留了環境變數，尚未在此環境寫入。請改用 SCHEDULE_STORE=local，或稍後接上密鑰。`)
    },
    async get() {
      throw new Error(`${driver} 適配器尚未讀取。`)
    },
    async delete() {
      throw new Error(`${driver} 適配器尚未刪除。`)
    },
  }
}

function openNetlifyBlobs() {
  const siteID = process.env.NETLIFY_BLOBS_SITE_ID
  const token = process.env.NETLIFY_AUTH_TOKEN
  const options = { name: BLOB_STORE_NAME, consistency: 'strong' }
  if (siteID && token) {
    options.siteID = siteID
    options.token = token
  }
  try {
    return getStore(options)
  } catch (error) {
    if (error && error.name === 'MissingBlobsEnvironmentError') {
      const wrapped = new Error('這個環境還沒有 Netlify Blobs 憑證，不能把對照寫進會消失的暫存檔。正式站函式會自動帶上憑證；函式外請設定 NETLIFY_BLOBS_SITE_ID 與 NETLIFY_AUTH_TOKEN。')
      wrapped.code = 'STORE_NOT_CONFIGURED'
      throw wrapped
    }
    throw error
  }
}

export function createNetlifyBlobsStore(client = openNetlifyBlobs()) {
  return {
    driver: 'netlify-blobs',
    root: null,
    async put(key, value) {
      await client.set(key, value)
    },
    async get(key) {
      const value = await client.get(key, { type: 'text', consistency: 'strong' })
      return value == null ? null : value
    },
    async delete(key) {
      await client.delete(key)
    },
  }
}

export function createStore() {
  const driver = resolveStoreDriver()
  if (driver === 'local') return localStore(storeRoot())
  if (driver === 'netlify-blobs') {
    const missing = missingRemoteEnv(driver)
    if (missing.length > 0) {
      const error = new Error(`儲存驅動 ${driver} 缺少環境變數：${missing.join(', ')}`)
      error.code = 'STORE_NOT_CONFIGURED'
      throw error
    }
    return createNetlifyBlobsStore()
  }
  if (driver === 's3' || driver === 'r2') {
    const missing = missingRemoteEnv(driver)
    if (missing.length > 0) {
      const error = new Error(`儲存驅動 ${driver} 缺少環境變數：${missing.join(', ')}`)
      error.code = 'STORE_NOT_CONFIGURED'
      throw error
    }
    return remoteStore(driver)
  }
  throw new Error(`未知 SCHEDULE_STORE：${driver}`)
}
