import type { FileTree } from '../../../types'
import { inside, join } from '../../core/paths'

export const SIZE_TIMEOUT_MS = 15_000
export const SIZE_JOBS = 2
export const SIZE_WALK_LIMIT = 50_000

/** Bytes from `du -sk` output, or -1 when it says nothing usable. */
export function parseDu(stdout: string): number {
  const kb = Number(stdout.trim().split(/\s/)[0] || NaN)
  return Number.isFinite(kb) ? kb * 1024 : -1
}

/** One dir's entries counted into a walk: its file bytes and subdirs, or null past the limit. */
export function tallyDir(d: string, entries: { name: string; kind: string; isLink: boolean; size: number }[], seen: number): { bytes: number; dirs: string[]; seen: number } | null {
  if (seen + entries.length > SIZE_WALK_LIMIT) return null
  let bytes = 0
  const dirs: string[] = []
  for (const e of entries) {
    if (e.kind === 'dir' && !e.isLink) dirs.push(join(d, e.name))
    else if (e.kind === 'file') bytes += e.size
  }
  return { bytes, dirs, seen: seen + entries.length }
}

export function enqueue(queue: string[], sizing: Set<string>, dirs: string[]): string[] {
  const out = [...queue]
  for (const dir of dirs) if (!sizing.has(dir) && !out.includes(dir)) out.push(dir)
  return out
}

export function sizePatch(cur: FileTree, dir: string, bytes: number): Partial<FileTree> {
  return inside(cur.root, dir) ? { dirSizes: { ...cur.dirSizes, [dir]: bytes } } : {}
}

/** A size measured for a dropped epoch is measured again while it is still wanted. */
export function stillWanted(cur: FileTree, dir: string, queue: string[]): boolean {
  return cur.showSize && inside(cur.root, dir) && !(dir in cur.dirSizes) && !queue.includes(dir)
}

/** The sizes no changed path is inside; all of them go without `paths`. */
export function keptSizes(dirSizes: Record<string, number>, paths?: string[]): Record<string, number> {
  if (!paths) return {}
  const keep: Record<string, number> = {}
  for (const [dir, bytes] of Object.entries(dirSizes)) if (!paths.some(p => inside(dir, p))) keep[dir] = bytes
  return keep
}

export function formatSize(bytes: number): string {
  if (bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  const units = ['K', 'M', 'G', 'T']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 100 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
