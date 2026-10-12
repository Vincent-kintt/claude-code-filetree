import { inside } from '../tree'
import { HOME_PRUNE, PRUNE } from './constants'
import { rt } from './runtime'

export function shortPath(path: string): string {
  return rt.home && inside(rt.home, path) ? `~${path.slice(rt.home.length)}` : path
}

export function broad(root: string): boolean {
  return root === rt.home || root === '/' || /^[A-Za-z]:\/$/.test(root)
}

export function rootOfDisk(root: string): boolean {
  return root === '/' || /^[A-Za-z]:\/$/.test(root)
}

export function pruneArgs(root: string, ignored: string[] = []): string[] {
  const names = broad(root) ? [...PRUNE, ...HOME_PRUNE] : PRUNE
  return ['(', ...names.flatMap((name, i) => (i === 0 ? ['-name', name] : ['-o', '-name', name])), ...ignored.flatMap(p => ['-o', '-path', p]), ')', '-prune', '-o']
}
