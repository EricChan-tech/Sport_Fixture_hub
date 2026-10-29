import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function storeRoot() {
  return process.env.SCHEDULE_STORE_DIR || path.join(process.cwd(), '.schedule-store')
}

export function objectKey(sport, date) {
  return `${sport}/days/${date}.json`
}

const REMOTE_ENV = {
  s3: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  r2: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  'netlify-blobs': ['NETLIFY_BLOBS_SITE_ID', 'NETLIFY_AUTH_TOKEN'],
}

export function missingRemoteEnv(driver) {
  const names = REMOTE_ENV[driver] ?? []
  return names.filter((name) => !process.env[name])
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

export function createStore() {
  const driver = process.env.SCHEDULE_STORE || 'local'
  if (driver === 'local') return localStore(storeRoot())
  if (driver === 's3' || driver === 'r2' || driver === 'netlify-blobs') {
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
