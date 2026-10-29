import path from 'node:path'
import { fileURLToPath } from 'node:url'

function moduleDir() {
  if (!import.meta.url) return null
  return path.dirname(fileURLToPath(import.meta.url))
}

// Local modules live in pipeline/. Netlify's esbuild bundle emits one file at
// netlify/functions/<name>.mjs, so import.meta.url no longer points at pipeline/.
export function repoRoot() {
  const here = moduleDir()
  if (!here) return process.cwd()
  if (path.basename(here) === 'functions' && path.basename(path.dirname(here)) === 'netlify') {
    return path.resolve(here, '../..')
  }
  return path.resolve(here, '..')
}

export function pipelineFile(name) {
  const here = moduleDir()
  if (here && path.basename(here) === 'pipeline') return path.join(here, name)
  return path.join(repoRoot(), 'pipeline', name)
}
