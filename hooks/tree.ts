import type { Branch, FileNode, FileTree, Theme } from '../types'
import { stronger } from './icons'

export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; size: number; isLink: boolean }
export type Row = { node: FileNode; depth: number; open: boolean }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const DEFAULT_THEME: Theme = {
  fg: '',
  accent: '#5b9bd5',
  muted: '#808a96',
  urgent: '#d0605e',
  selection: '#6b7280',
  bg: '',
}

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

export function parseTheme(toml: string): Theme {
  const get = (k: string) => toml.match(new RegExp(`^${k}\\s*=\\s*"(#[0-9a-fA-F]{6})"`, 'm'))?.[1]
  return {
    fg: get('foreground') ?? get('color7') ?? DEFAULT_THEME.fg,
    accent: get('accent') ?? get('color4') ?? DEFAULT_THEME.accent,
    muted: get('muted') ?? get('color8') ?? DEFAULT_THEME.muted,
    urgent: get('red') ?? get('color1') ?? DEFAULT_THEME.urgent,
    selection: get('selection') ?? DEFAULT_THEME.selection,
    bg: get('dark_background') ?? get('background') ?? DEFAULT_THEME.bg,
  }
}

export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

let drives = false

export function dirname(path: string): string {
  if (drives && /^[A-Za-z]:\/[^/]*$/.test(path)) return path.slice(0, 3)
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function useDrives(on: boolean): void {
  drives = on
}

export function drivesOn(): boolean {
  return drives
}

export function posix(path: string): string {
  if (!drives) return path
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z])(\/|$)/, (_, d: string) => `${d.toUpperCase()}:/`)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || (drives && /^[A-Za-z]:\//.test(path))
}

export function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
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

export type GitStatus = {
  git: Record<string, string>
  ignored: string[]
  untrackedDirs: string[]
  branch: Branch | null
  files: Record<string, Change>
}

export type Change = 'new' | 'mod' | 'del'

export function parseBranch(record: string): Branch {
  const body = record.replace(/^## /, '')
  if (body.startsWith('HEAD (no branch)')) return { head: 'detached', upstream: '', ahead: 0, behind: 0 }
  const head = body.match(/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/)?.[1] ?? body
  const upstream = body.match(/\.\.\.(\S+)/)?.[1] ?? ''
  const ahead = Number(body.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(body.match(/behind (\d+)/)?.[1] ?? 0)
  return { head, upstream, ahead, behind }
}

export function mapper(root: string, prefix: string): (rel: string) => string | null {
  return rel => (rel.startsWith(prefix) ? join(root, rel.slice(prefix.length).replace(/\/$/, '')).replace(/\/$/, '') : null)
}

export function parseGit(stdout: string, root: string, prefix: string): GitStatus {
  const map = mapper(root, prefix)
  const git: Record<string, string> = {}
  const ignored: string[] = []
  const untrackedDirs: string[] = []
  const files: Record<string, Change> = {}
  let branch: Branch | null = null
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (rec.startsWith('## ')) {
      branch = parseBranch(rec)
      continue
    }
    if (rec.length < 4) continue
    const xy = rec.slice(0, 2)
    const raw = rec.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const path = map(raw)
    if (!path) continue
    if (xy === '!!') {
      ignored.push(path)
      continue
    }
    if (xy === '??' && raw.endsWith('/')) untrackedDirs.push(path)
    else files[path] = xy === '??' || (xy.includes('A') && !xy.includes('D')) ? 'new' : xy.includes('D') && !/U/.test(xy) ? 'del' : 'mod'
    const letter =
      xy === '??'
        ? '?'
        : /U/.test(xy) || xy === 'AA' || xy === 'DD'
          ? 'U'
          : (['D', 'M', 'T', 'R', 'C', 'A'].find(c => xy.includes(c)) ?? '')
    if (!letter) continue
    git[path] = stronger(git[path], letter)
    let dir = dirname(path)
    while (dir.length >= root.length && dir !== '/') {
      git[dir] = stronger(git[dir], letter)
      if (dir === root) break
      dir = dirname(dir)
    }
  }
  return { git, ignored, untrackedDirs, branch, files }
}

export function parseNumstat(stdout: string, root: string, prefix: string, into: Record<string, [number, number]>): void {
  const map = mapper(root, prefix)
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (!rec) continue
    const m = rec.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (!m) continue
    let path = m[3] ?? ''
    if (path === '') {
      i += 2
      path = parts[i] ?? ''
    }
    if (!path) continue
    const add = m[1] === '-' ? 0 : Number(m[1])
    const del = m[2] === '-' ? 0 : Number(m[2])
    const abs = map(path)
    if (!abs) continue
    const prev = into[abs] ?? [0, 0]
    into[abs] = [prev[0] + add, prev[1] + del]
  }
}

export function rollUp(diff: Record<string, [number, number]>, root: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = { ...diff }
  for (const [path, [add, del]] of Object.entries(diff)) {
    let dir = dirname(path)
    while (dir.length >= root.length && dir !== '/') {
      const prev = out[dir] ?? [0, 0]
      out[dir] = [prev[0] + add, prev[1] + del]
      if (dir === root) break
      dir = dirname(dir)
    }
  }
  return out
}

export function rollCounts(files: Record<string, Change>, root: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {}
  const slot = { new: 0, mod: 1, del: 2 } as const
  for (const [path, change] of Object.entries(files)) {
    let dir = dirname(path)
    while (dir.length >= root.length && dir !== '/') {
      const cur = out[dir] ?? [0, 0, 0]
      cur[slot[change]] += 1
      out[dir] = cur
      if (dir === root) break
      dir = dirname(dir)
    }
  }
  return out
}

export function underAny(id: string, set: Set<string>, root: string): boolean {
  if (set.size === 0) return false
  let cur = id
  while (cur.length >= root.length) {
    if (set.has(cur)) return true
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return false
}

export function ancestorsOf(id: string, root: string): string[] {
  const out: string[] = []
  if (!root) return out
  for (let dir = dirname(id), prev = id; dir !== prev && dir !== root && inside(root, dir); prev = dir, dir = dirname(dir)) out.push(dir)
  return out
}

export function relative(root: string, path: string): string {
  return path === root ? '' : path.slice(root.endsWith('/') ? root.length : root.length + 1)
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

export function stamp(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
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
