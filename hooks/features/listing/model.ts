import type { FileNode, FileTree } from '../../../types'
import { ancestorsOf } from '../../core/paths'
import { type Entry } from '../tree/nodes'

type Listed = { name: string; kind: Entry['kind']; mtimeMs: number; size: number; isLink: boolean }
type Target = { kind: Entry['kind']; mtimeMs: number; size: number }

/** A plain listing entry as the tree takes it. */
export function entryOf(e: Listed): Entry {
  return { name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size, isLink: false }
}

/** A link resolved to what it points at, or `null` when it points nowhere. */
export function linkEntry(name: string, target: Target | null): Entry {
  if (!target) return { name, kind: 'other', mtimeMs: 0, size: 0, isLink: true }
  return target.kind === 'dir'
    ? { name, kind: 'dir', mtimeMs: target.mtimeMs, size: 0, isLink: false }
    : { name, kind: 'file', mtimeMs: target.mtimeMs, size: target.size, isLink: true }
}

export function listError(shown: string, err: unknown): string {
  return `could not list ${shown}: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * The listings still current for this load: a later load of the same dir supersedes it.
 * `done` are the dirs whose latest load this was.
 */
export function freshListings(results: (readonly [string, FileNode[] | null])[], latest: Map<string, number>, seq: number): { listed: Map<string, FileNode[]>; done: string[] } {
  const listed = new Map<string, FileNode[]>()
  const done: string[] = []
  for (const [dir, kids] of results) {
    if (latest.get(dir) !== seq || done.includes(dir)) continue
    done.push(dir)
    if (kids) listed.set(dir, kids)
  }
  return { listed, done }
}

/** The first unloaded dir on the way to each path, skipping dirs already tried. */
export function missingDirs(t: FileTree, paths: string[], tried: Set<string>): Set<string> {
  const loaded = new Set(t.nodes.filter(n => n.loaded).map(n => n.id))
  if (t.nodes.some(n => n.parent === t.root)) loaded.add(t.root)
  const need = new Set<string>()
  for (const p of paths) {
    for (const dir of [t.root, ...ancestorsOf(p, t.root).reverse()]) {
      if (!loaded.has(dir)) {
        if (!tried.has(dir)) need.add(dir)
        break
      }
    }
  }
  return need
}

export function openDirs(t: FileTree): string[] {
  const open = new Set(t.expanded)
  return t.nodes.filter(n => n.kind === 'dir' && n.loaded && open.has(n.id)).map(n => n.id)
}
