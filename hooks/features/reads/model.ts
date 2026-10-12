import type { Now } from '../../../types'
import { resolve } from '../../git'
import { posix } from '../../tree'

/** The files a Grep or Glob result lists; Grep in content mode lists none, so its lines' path prefixes stand in. */
export function searchNames(result: unknown, drives: boolean): string[] {
  const out = result as { filenames?: unknown; content?: unknown }
  const names = Array.isArray(out.filenames) ? out.filenames.filter((x): x is string => typeof x === 'string') : []
  if (!names.length && typeof out.content === 'string')
    for (const line of out.content.split('\n').slice(0, 400)) {
      const path = posix(line).match(drives ? /^((?:[A-Za-z]:)?[^:\0]+?):\d+[:-]/ : /^([^:\0]+?):\d+[:-]/)?.[1]
      if (path) names.push(path)
    }
  return names
}

export function searchReads(names: string[], cwd: string, home: string): string[] {
  return [...new Set(names.map(n => resolve(cwd, n, home)))].slice(0, 60)
}

export function reading(path: string, state: Now['state']): Omit<Now, 'at'> {
  return { verb: 'read', state, path, count: 1, detail: '' }
}
