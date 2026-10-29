import { existsSync } from 'node:fs'
import path from 'node:path'

function looksLikeRoot(dir) {
  return existsSync(path.join(dir, 'pipeline', 'sources.config.json'))
}

function walkToRoot(start) {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i += 1) {
    if (looksLikeRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

// Netlify may bundle these modules as CommonJS. import.meta is empty in that
// output and esbuild warns on it, so the root is found from the process entry
// and cwd. Both local runs and the function zip contain pipeline/sources.config.json.
export function repoRoot() {
  const starts = []
  if (process.argv[1]) starts.push(path.dirname(path.resolve(process.argv[1])))
  starts.push(process.cwd())
  for (const start of starts) {
    const found = walkToRoot(start)
    if (found) return found
  }
  return process.cwd()
}

export function pipelineFile(name) {
  return path.join(repoRoot(), 'pipeline', name)
}
