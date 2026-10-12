import type { FileNode, FileTree } from '../../../types'
import { rowsOf } from '../tree/nodes'

/** What a key in the pane asks for; the shell carries it out. */
export type KeyAction =
  | { kind: 'none' }
  | { kind: 'patch'; patch: Partial<FileTree> }
  | { kind: 'toggle'; node: FileNode }
  | { kind: 'open'; node: FileNode }
  | { kind: 'copy'; id: string; absolute: boolean }
  | { kind: 'closePreview' }
  | { kind: 'scrollPreview'; by: number }

const NONE: KeyAction = { kind: 'none' }

export function keyAction(key: string, shift: boolean, t: FileTree, previewRows: number): KeyAction {
  if (t.preview) {
    const page = Math.max(1, previewRows - 2)
    const by: Record<string, number> = { up: -1, k: -1, down: 1, j: 1, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }
    if (key === 'left' || key === 'h') return { kind: 'closePreview' }
    if (key in by) return { kind: 'scrollPreview', by: by[key] ?? 0 }
    return NONE
  }
  const rows = rowsOf(t)
  const at = rows.findIndex(r => r.node.id === t.cursor)
  const cur = rows[at]?.node
  const move = (d: number): KeyAction => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + d))]
    return target ? { kind: 'patch', patch: { cursor: target.node.id, scroll: null } } : NONE
  }
  if (key === 'up' || key === 'k') return move(-1)
  if (key === 'down' || key === 'j') return move(1)
  if (key === 'pageup') return move(-10)
  if (key === 'pagedown') return move(10)
  if (key === 'home') return move(-rows.length)
  if (key === 'end') return move(rows.length)
  if (cur && (key === 'y' || key === 'Y')) return { kind: 'copy', id: cur.id, absolute: key === 'Y' || shift }
  if (cur && (key === 'right' || key === 'l') && cur.kind === 'dir' && !t.expanded.includes(cur.id)) return { kind: 'toggle', node: cur }
  if (cur && (key === 'left' || key === 'h')) {
    if (cur.kind === 'dir' && t.expanded.includes(cur.id)) return { kind: 'toggle', node: cur }
    if (cur.parent !== t.root) return { kind: 'patch', patch: { cursor: cur.parent } }
    return NONE
  }
  if (cur && key === 'return') return cur.kind !== 'dir' ? { kind: 'open', node: cur } : { kind: 'toggle', node: cur }
  if (cur && key === ' ') return { kind: 'toggle', node: cur }
  return NONE
}

/** The node a press names, loaded or only drawn. */
export function pressedNode(t: FileTree, id: string): FileNode | undefined {
  return t.nodes.find(x => x.id === id) ?? rowsOf(t).find(r => r.node.id === id)?.node
}

/** The scroll row for a scrollbar position between 0 and 1. */
export function scrollToRow(fraction: number, max: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * max)
}

/** A wheel turn moves at least three rows. */
export function wheelStep(by: number): number {
  return Math.sign(by) * Math.max(3, Math.abs(by))
}

export function wheelScroll(by: number, scroll: number | null, from: number, max: number): number {
  return Math.max(0, Math.min(max, (scroll ?? from) + wheelStep(by)))
}
