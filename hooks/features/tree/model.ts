import type { Activity, FileTree, Theme } from '../../../types'
import { ACTIVITY_TTL_MS, ADD_COLOR, BRANCH_ROW, DATE_MIN_COLUMNS, DEL_COLOR, RENDER_CHARS, RUNNING_MAX_MS, SHIMMER, SHIMMER_DESKTOP } from '../../core/constants'
import { shortPath } from '../../core/platform'
import { CHEVRON_CLOSED, CHEVRON_OPEN, fileIcon, GIT_COLOR } from '../../ui/icons'
import type { RowSpec, RowsProps, Seg } from '../../ui/rows'
import { dirname, inside, underAny } from '../../core/paths'
import { formatSize } from '../sizes/model'
import { type Row, rowsOf } from './nodes'

export type RowColors = Pick<RowsProps, 'activeBg' | 'hoverBg' | 'tones'>
export type Bar = NonNullable<RowsProps['bar']>
export type BranchView = { head: string; upstream: string; ahead: number; behind: number; flash: boolean; tone: string }

/** What the terminal pane draws around the rows. */
export type TreeModel = {
  header: string
  branch: BranchView | null
  totals: [number, number]
  rootCounts: Seg[]
  noRepo: boolean
  query: string
  selected: string
  selectedText: string
  latest: Activity | undefined
  theme: Theme
  unicode: boolean
  minHeight: number
}

export type TreeInputs = {
  t: FileTree
  theme: Theme
  unicode: boolean
  width: number
  bodyRows: number | undefined
  nativeScroll: boolean
  followClaude: boolean
  latest: Activity | undefined
}

export type TreeView = {
  specs: RowSpec[]
  bar: Bar | undefined
  from: number
  max: number
  // Folders on screen whose size is still to measure; null while the size column is off.
  sizes: string[] | null
  header: string
  totals: [number, number]
  rootCounts: Seg[]
}

export function clean(segs: Seg[]): Seg[] {
  for (const seg of segs) for (const k of Object.keys(seg) as (keyof Seg)[]) if (seg[k] === undefined) delete seg[k]
  return segs
}

export function faint(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(0x26 + (((v >> shift) & 255) - 0x26) * 0.3)
  return `#${[16, 8, 0].map(x => ch(x).toString(16).padStart(2, '0')).join('')}`
}

// A translucent accent reads on both of the desktop app's themes; the terminal keeps the theme's selection.
export function rowColors(theme: Theme, nativeScroll: boolean): RowColors {
  return nativeScroll ? { activeBg: `${theme.accent}38`, hoverBg: '#8080801f', tones: SHIMMER_DESKTOP } : { activeBg: theme.selection, hoverBg: faint(theme.selection), tones: SHIMMER }
}

/** The activity the footer chip shows: a running one first, else the newest still live. */
export function latestActivity(list: Activity[], now: number): Activity | undefined {
  const live = list.filter(a => now - a.at < (a.state === 'running' ? RUNNING_MAX_MS : ACTIVITY_TTL_MS))
  return [...live].reverse().find(a => a.state === 'running') ?? live[live.length - 1]
}

/** A path as the pane shows it: relative to the root inside it, shortened outside. */
export function relPath(root: string, p: string): string {
  return p !== root && inside(root, p) ? p.slice(root.endsWith('/') ? root.length : root.length + 1) : shortPath(p)
}

export function headerOf(t: FileTree): string {
  return t.top ? [t.top.split('/').pop() ?? t.top, t.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : t.root.split('/').pop() || t.root
}

export function countSegs(c: [number, number, number] | undefined, urgent: string): Seg[] {
  if (!c) return []
  const out: Seg[] = []
  if (c[0] > 0) out.push({ t: ` ?:${c[0]}`, c: GIT_COLOR['?'] ?? ADD_COLOR })
  if (c[1] > 0) out.push({ t: ` M:${c[1]}`, c: GIT_COLOR.M ?? '#e5c07b' })
  if (c[2] > 0) out.push({ t: ` D:${c[2]}`, c: urgent })
  return out
}

export function note(text: string, muted: string): RowSpec {
  return { id: '', left: [{ t: text, c: muted }], right: [] }
}

// What rows.tsx draws for a row, serialized: a row box, a Text per segment, and a Text per
// character while a segment shimmers. Measured at about 160 + 70 a segment + its text,
// with the text counted as JSON escapes it.
export function drawnSize(r: RowSpec): number {
  let n = 160
  for (const s of [...r.left, ...r.right]) n += s.sh && !s.one ? [...s.t].reduce((a, ch) => a + 78 + JSON.stringify(ch).length, 40) : 68 + JSON.stringify(s.t).length
  return n
}

// The desktop draws every row, so a big open tree is cut to RENDER_CHARS drawn: the rows
// centred on the cursor, with a note above and below saying how many were left out.
export function capRows(specs: RowSpec[], at: number, note: (text: string) => RowSpec): void {
  const size = specs.map(drawnSize)
  if (size.reduce((a, b) => a + b, 0) <= RENDER_CHARS) return
  // Room for the two notes, the list box around the rows and the cursor row's highlight.
  const budget = RENDER_CHARS - 2 * drawnSize(note(`  ⋮ ${specs.length.toLocaleString('en')} more rows; search to find the rest`)) - 400
  let from = Math.min(Math.max(0, at), specs.length - 1)
  let to = from + 1
  let used = size[from]!
  for (let grew = true; grew; ) {
    grew = false
    if (to < specs.length && used + size[to]! <= budget) {
      used += size[to++]!
      grew = true
    }
    if (from > 0 && used + size[from - 1]! <= budget) {
      used += size[--from]!
      grew = true
    }
  }
  const kept = specs.slice(from, to)
  const above = from
  const below = specs.length - to
  specs.length = 0
  if (above) specs.push(note(`  ⋮ ${above.toLocaleString('en')} rows above`))
  specs.push(...kept)
  if (below) specs.push(note(`  ⋮ ${below.toLocaleString('en')} more rows; search to find the rest`))
}

/** The rows the pane shows, the window onto them and the header figures around them. */
export function treeView({ t, theme, unicode, width, bodyRows, nativeScroll, followClaude, latest }: TreeInputs): TreeView {
  const bright = new Set(t.flashOn ? t.flash : [])
  const dimmed = new Set(t.flashOn ? t.flashDim : [])
  const ignored = new Set(t.ignored)
  const untracked = new Set(t.untrackedDirs)
  const rows = rowsOf(t)
  const fixed = 2 + (t.top ? (t.branch ? 1 : 0) : 1) + (t.selected || latest ? 1 : 0)
  const room = nativeScroll ? Math.max(1, rows.length) : Math.max(5, (bodyRows ?? 40) - fixed)
  const isLit = (id: string) => bright.has(id) || dimmed.has(id)
  const focus = followClaude && t.flashOn ? ([...t.flash].reverse().find(id => id !== BRANCH_ROW) ?? t.cursor) : t.cursor
  const at = Math.max(0, rows.findIndex(r => r.node.id === focus))
  const lit = followClaude && t.flashOn ? rows.findIndex(r => isLit(r.node.id)) : -1
  const cap = Math.max(1, Math.floor(room / 3))
  let from = Math.max(0, Math.min(lit >= 0 && at - lit < room - 2 ? Math.max(0, lit - 1) : at - Math.floor(room / 2), rows.length - room))
  let pinned = !nativeScroll && followClaude && t.flashOn ? rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap) : []
  if (pinned.length) {
    const rest = Math.max(3, room - pinned.length)
    from = Math.max(0, Math.min(at - Math.floor(rest / 2), rows.length - rest))
    pinned = rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap)
  }
  const max = Math.max(0, rows.length - room)
  if (t.scroll !== null) {
    from = Math.max(0, Math.min(t.scroll, max))
    pinned = []
  }
  const shown = rows.slice(from, from + room - pinned.length)
  const sizes = t.showSize ? [...pinned, ...shown].filter(r => r.node.kind === 'dir' && !(r.node.id in t.dirSizes)).map(r => r.node.id) : null
  const totals: [number, number] = t.top ? (t.diff[t.root] ?? [0, 0]) : [0, 0]
  const rootCounts = t.top ? countSegs(t.counts[t.root], theme.urgent) : []
  const header = headerOf(t)

  const rowSpec = (r: Row): RowSpec => {
    const n = r.node
    const own = t.git[n.id]
    const status = own ?? (underAny(dirname(n.id), untracked, t.root) ? '?' : undefined)
    const isIgnored = !status && underAny(n.id, ignored, t.root)
    const gitColor = status === 'D' || status === 'U' ? theme.urgent : status ? (GIT_COLOR[status] ?? theme.muted) : undefined
    const isBright = bright.has(n.id)
    const isDim = !isBright && dimmed.has(n.id)
    const tone = t.flashTones[n.id] ?? 'orange'
    const iconColor = isIgnored ? theme.muted : (gitColor ?? (n.hidden ? theme.muted : n.kind === 'dir' ? theme.accent : theme.muted))
    const nameColor = isIgnored ? theme.muted : (gitColor ?? (n.hidden ? theme.muted : theme.fg || undefined))
    const loc = t.diff[n.id]
    const meta = t.showSize
      ? n.kind === 'dir'
        ? n.id in t.dirSizes
          ? formatSize(t.dirSizes[n.id] ?? -1)
          : '…'
        : n.kind === 'file' || (n.kind === 'link' && n.size > 0)
          ? formatSize(n.size)
          : ''
      : loc || width < DATE_MIN_COLUMNS
        ? ''
        : (n.kind === 'file' || (n.kind === 'link' && n.size > 0)) && n.mtime > 0
          ? stamp(n.mtime)
          : ''
    const locText = loc ? `${loc[0] ? ` +${loc[0]}` : ''}${loc[1] ? ` -${loc[1]}` : ''}` : ''
    const dirCounts = n.kind === 'dir' ? countSegs(t.counts[n.id], theme.urgent) : []
    const badge = dirCounts.length ? '' : status ? ` ${status}` : isIgnored ? (unicode ? ' ⊘' : ' \u{f05e}') : '  '
    const countsText = dirCounts.map(c => c.t).join('')
    const cols = Math.max(4, width - r.depth * 2 - 6 - (meta ? meta.length + 1 : 0) - locText.length - badge.length - countsText.length)
    const name = n.name.length > cols ? n.name.slice(0, cols - 1) + '…' : n.name
    const caret = n.kind === 'dir' ? (unicode ? (r.open ? '▾' : '▸') : r.open ? CHEVRON_OPEN : CHEVRON_CLOSED) + ' ' : '  '
    const isRepo = n.kind === 'dir' && n.id === t.top
    const glyph = unicode ? (n.kind === 'dir' ? '■' : '·') : fileIcon(n, r.open, isRepo)
    const lit = isBright || isDim
    const left: Seg[] = [
      { t: '  '.repeat(r.depth) },
      { t: caret, c: theme.muted },
      lit ? { t: glyph + ' ', sh: tone, dim: isDim, one: true } : { t: glyph + ' ', c: iconColor },
      lit ? { t: name, sh: tone, dim: isDim, b: isBright } : { t: name, c: nameColor, b: n.id === t.selected, s: status === 'D' && n.kind !== 'dir' },
    ]
    const right: Seg[] = []
    if (meta) right.push({ t: ` ${meta}`, c: theme.muted })
    if (loc && loc[0] > 0) right.push({ t: ` +${loc[0]}`, c: ADD_COLOR })
    if (loc && loc[1] > 0) right.push({ t: ` -${loc[1]}`, c: DEL_COLOR })
    right.push(...dirCounts)
    if (badge) right.push({ t: badge, c: status ? gitColor : theme.muted, b: true })
    return { id: n.id, left: clean(left), right: clean(right) }
  }

  const muted = (text: string) => note(text, theme.muted)
  const specs: RowSpec[] = [
    ...(rows.length === 0 ? [muted('empty')] : []),
    ...pinned.map(rowSpec),
    ...(pinned.length > 0 ? [muted('  ⋮')] : []),
    ...shown.map(rowSpec),
  ]
  if (nativeScroll) capRows(specs, Math.max(0, specs.findIndex(s => s.id === t.cursor)), muted)
  const barSize = Math.max(1, Math.round((specs.length * shown.length) / Math.max(1, rows.length)))
  const bar =
    !nativeScroll && rows.length > shown.length + pinned.length
      ? { pos: max ? Math.round((from / max) * (specs.length - barSize)) : 0, size: barSize, thumb: theme.accent, track: theme.muted }
      : undefined
  return { specs, bar, from, max, sizes, header, totals, rootCounts }
}

/** The terminal pane's chrome around the rows. */
export function treeModel(t: FileTree, view: TreeView, theme: Theme, unicode: boolean, latest: Activity | undefined, bodyRows: number | undefined): TreeModel {
  const b = t.branch
  return {
    header: view.header,
    branch: t.top && b ? { head: b.head, upstream: b.upstream, ahead: b.ahead, behind: b.behind, flash: t.flashOn && t.flash.includes(BRANCH_ROW), tone: t.flashTones[BRANCH_ROW] ?? 'teal' } : null,
    totals: view.totals,
    rootCounts: view.rootCounts,
    noRepo: !t.top,
    query: t.query,
    selected: t.selected,
    selectedText: t.selected ? relPath(t.root, t.selected) : '',
    latest,
    theme,
    unicode,
    minHeight: Math.max(1, bodyRows ?? 1),
  }
}

function stamp(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
