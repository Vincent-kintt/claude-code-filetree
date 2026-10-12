import { HOME_PRUNE, PRUNE } from '../../core/constants'
import { dirname, inside, isAbsolute, join, relative } from '../../core/paths'
import { SEARCH_REVEAL_LIMIT } from '../tree/nodes'

export function searchTerm(query: string): string {
  return query.trim().toLowerCase()
}

export function matches(paths: string[], root: string, q: string): string[] {
  return paths.filter(p => relative(root, p).toLowerCase().includes(q)).slice(0, SEARCH_REVEAL_LIMIT)
}

/** The dirs of hits the tree does not show yet, to list again. */
export function staleDirs(hits: string[], ids: Set<string>, root: string): string[] {
  return [...new Set(hits.filter(p => !ids.has(p)).map(dirname))].filter(d => inside(root, d))
}

export function walkSkip(broad: boolean): string[] {
  return broad ? [...PRUNE, ...HOME_PRUNE] : PRUNE
}

export function listDepth(disk: boolean): number {
  return disk ? 3 : 6
}

export function findFilesArgv(root: string, disk: boolean, prune: string[]): string[] {
  return ['find', '-H', root, '-xdev', '-maxdepth', String(listDepth(disk)), ...prune, '-type', 'f', '-print0']
}

/** Listed paths made absolute; a truncated listing drops its cut-off last path. */
export function indexedPaths(stdout: string, truncated: boolean, root: string): string[] {
  const paths = stdout.split('\0').filter(Boolean)
  if (truncated) paths.pop()
  return paths.map(p => (isAbsolute(p) ? p : join(root, p)))
}
