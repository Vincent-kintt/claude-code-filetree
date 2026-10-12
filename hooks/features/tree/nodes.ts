import type { FileNode, FileTree } from '../../../types'
import { ancestorsOf, dirname, inside, join, relative } from '../../core/paths'

export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; size: number; isLink: boolean }
export type Row = { node: FileNode; depth: number; open: boolean }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function emptyTree(root: string): FileTree {
  return {
    root,
    nodes: [],
    expanded: [],
    cursor: '',
    selected: '',
    query: '',
    showSize: false,
    dirSizes: {},
    git: {},
    diff: {},
    ignored: [],
    untrackedDirs: [],
    top: '',
    prefix: '',
    branch: null,
    counts: {},
    flash: [],
    flashDim: [],
    flashOn: false,
    flashTones: {},
    scroll: null,
    preview: '',
    previewTop: 0,
    view: 'all',
    changes: {},
  }
}

export function toNodes(dir: string, list: Entry[]): FileNode[] {
  return list
    .map(e => ({
      id: join(dir, e.name),
      parent: dir,
      name: e.name,
      kind: e.isLink ? ('link' as const) : e.kind === 'dir' ? ('dir' as const) : ('file' as const),
      hidden: e.name.startsWith('.'),
      mtime: e.mtimeMs,
      size: e.size,
      loaded: false,
    }))
    .sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name))
}

export function replaceChildren(nodes: FileNode[], listed: Map<string, FileNode[]>): FileNode[] {
  if (listed.size === 0) return nodes
  const keep = new Map<string, FileNode>()
  for (const n of nodes) if (listed.has(n.parent)) keep.set(n.id, n)
  const freshIds = new Set<string>()
  for (const kids of listed.values()) for (const k of kids) freshIds.add(k.id)
  const gone = new Set([...keep.keys()].filter(id => !freshIds.has(id)))
  const under = (id: string) => {
    if (gone.size === 0) return false
    for (let dir = dirname(id), prev = id; dir !== prev; prev = dir, dir = dirname(dir)) if (gone.has(dir)) return true
    return false
  }
  const fresh: FileNode[] = []
  for (const kids of listed.values()) {
    for (const k of kids) {
      if (under(k.id)) continue
      const old = keep.get(k.id)
      fresh.push(old && old.kind === 'dir' && k.kind === 'dir' ? { ...k, loaded: old.loaded } : k)
    }
  }
  const out = nodes.filter(n => !listed.has(n.parent) && !under(n.id))
  return [...out.map(n => (listed.has(n.id) ? { ...n, loaded: true } : n)), ...fresh]
}

/** A search shows at most this many matches from folders you haven't opened (TRE-04). */
export const SEARCH_REVEAL_LIMIT = 60

export function visibleRows(t: FileTree): Row[] {
  const kids = new Map<string, FileNode[]>()
  for (const n of t.nodes) {
    const list = kids.get(n.parent)
    if (list) list.push(n)
    else kids.set(n.parent, [n])
  }
  const q = t.query.trim().toLowerCase()
  const open = new Set(t.expanded)
  let keep: Set<string> | null = null
  if (q) {
    keep = new Set()
    let revealed = 0
    for (const n of t.nodes) {
      if (!relative(t.root, n.id).toLowerCase().includes(q)) continue
      // A match in a folder you opened always shows; one the search had to load counts toward the cap.
      if (n.parent !== t.root && !open.has(n.parent) && revealed++ >= SEARCH_REVEAL_LIMIT) continue
      keep.add(n.id)
      for (const a of ancestorsOf(n.id, t.root)) keep.add(a)
    }
  }
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    for (const n of kids.get(dir) ?? []) {
      if (keep && !keep.has(n.id)) continue
      const isOpen = n.kind === 'dir' && (keep ? kids.has(n.id) : open.has(n.id))
      rows.push({ node: n, depth, open: isOpen })
      if (isOpen) walk(n.id, depth + 1)
    }
  }
  walk(t.root, 0)
  return rows
}

/** The rows the tree shows: every loaded row, or in the edited view only what git reports changed and its folders. */
export function rowsOf(t: FileTree): Row[] {
  return t.view === 'edited' ? changedRows(t) : visibleRows(t)
}

/** Changed files (added, modified, deleted) under the root, each with its folders, every folder open. */
export function changedRows(t: FileTree): Row[] {
  const q = t.query.trim().toLowerCase()
  const known = new Map(t.nodes.map(n => [n.id, n]))
  const kids = new Map<string, FileNode[]>()
  const seen = new Set<string>()
  const add = (n: FileNode) => {
    if (seen.has(n.id)) return
    seen.add(n.id)
    const list = kids.get(n.parent)
    if (list) list.push(n)
    else kids.set(n.parent, [n])
  }
  const node = (id: string, kind: 'dir' | 'file'): FileNode => {
    const name = id.slice(id.lastIndexOf('/') + 1)
    return known.get(id) ?? { id, parent: dirname(id), name, kind, hidden: name.startsWith('.'), mtime: 0, size: 0, loaded: false }
  }
  for (const path of Object.keys(t.changes)) {
    if (path === t.root || !inside(t.root, path)) continue
    if (q && !relative(t.root, path).toLowerCase().includes(q)) continue
    for (const a of ancestorsOf(path, t.root)) add(node(a, 'dir'))
    add(node(path, 'file'))
  }
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    const list = (kids.get(dir) ?? []).sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name))
    for (const n of list) {
      const isOpen = n.kind === 'dir' && kids.has(n.id)
      rows.push({ node: n, depth, open: isOpen })
      if (isOpen) walk(n.id, depth + 1)
    }
  }
  walk(t.root, 0)
  return rows
}
