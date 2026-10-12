import type { Since } from '../../core/types'
import { type Change, inside } from '../../tree'

/** The ignored paths a find under `root` prunes. */
export function scopedIgnored(root: string, ignored: string[]): string[] {
  return ignored.filter(p => inside(root, p)).slice(0, 40)
}

export function changedArgv(root: string, since: Since, depth: number, prune: string[]): string[] {
  const test = since.mark ? ['-newer', since.mark] : ['-newermt', `@${(since.ms / 1000).toFixed(3)}`]
  return ['find', '-H', root, '-xdev', ...(depth ? ['-maxdepth', String(depth)] : []), ...prune, ...test, '-print0']
}

export function foundPaths(stdout: string, root: string): string[] {
  return stdout.split('\0').filter(p => p && p !== root)
}

/**
 * Windows has no find, so the repo's dirty files stand in: deletions new since `before`
 * are gone, the rest are checked for a newer mtime. `null` when the files are another root's.
 */
export function dirtySplit(dirty: { root: string; files: Record<string, Change> }, root: string, before: Record<string, Change>): { live: string[]; gone: string[] } | null {
  if (dirty.root !== root) return null
  const entries = Object.entries(dirty.files)
  const gone = entries.filter(([p, c]) => c === 'del' && before[p] !== 'del').map(([p]) => p)
  const live = entries.filter(([, c]) => c !== 'del').map(([p]) => p)
  return { live: live.slice(0, 4_000), gone }
}

export function markPath(tmpdir: string, sessionId: string, id: number): string {
  return `${(tmpdir || '/tmp').replace(/\/+$/, '')}/filetree-${sessionId}-${id}.mark`
}
