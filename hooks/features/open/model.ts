import type { FileNode, FileTree } from '../../../types'
import { DOUBLE_MS } from '../../core/constants'
import type { OS } from '../../core/types'
import { LINUX_LAUNCH, openCommand, openWithCommand } from '../../open'
import { dirname, inside } from '../../core/paths'

// The setting always has a value: a blank one falls back to the default, preview.
export function openSetting(openWith: string): string {
  return openWith.trim() || 'preview'
}

/** How a file opens outside the pane: the argv to run and the tool named when it fails. */
export function openPlan(os: OS, setting: string, external: boolean, path: string): { argv: string[]; init: ReturnType<typeof openCommand>['init']; tool: string } {
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external || setting === 'app' ? null : openWithCommand(setting, native(path), native(dirname(path)))
  const { argv, init } = custom ? { argv: os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', ...custom] : custom, init: { timeoutMs: 10_000 } } : openCommand(os, path)
  return { argv, init, tool: custom?.[0] ?? argv[0] }
}

export function openFailed(path: string, tool: string, run?: { exitCode: number; stderr: string }): string {
  if (!run) return `could not open ${path} with ${tool}`
  return `could not open ${path} with ${tool}: ${run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`}`
}

export function togglePatch(t: FileTree, n: FileNode): Partial<FileTree> {
  const open = new Set(t.expanded)
  if (n.kind === 'dir') open.has(n.id) ? open.delete(n.id) : open.add(n.id)
  return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
}

/** A second press on the same row within DOUBLE_MS is a double press, and resets the pair. */
export function pressOf(last: { key: string; at: number }, id: string, now: number): { isDouble: boolean; last: { key: string; at: number } } {
  const isDouble = last.key === id && now - last.at < DOUBLE_MS
  return { isDouble, last: { key: isDouble ? '' : id, at: now } }
}

/** The path as copied: relative to the root unless asked for whole, or outside it. */
export function copyText(root: string, id: string, absolute: boolean): string {
  return !absolute && id !== root && inside(root, id) ? id.slice(root.endsWith('/') ? root.length : root.length + 1) : id
}
