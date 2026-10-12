import type { ClaudeLog, FileTree, Now, Touch } from '../../../types'
import { BRANCH_ROW } from '../../core/constants'
import { ancestorsOf, posix } from '../../core/paths'
import { visibleRows } from '../tree/nodes'

export const TOUCH_KEEP = 40

/** Where the view sits when the tree grows: following Claude drops the scroll, else the top row stays put. */
export function keepTop(cur: FileTree, expanded: string[], followClaude: boolean, from: number): Partial<FileTree> {
  if (followClaude) return { scroll: null }
  const top = visibleRows(cur)[cur.scroll ?? from]?.node.id
  const at = top ? visibleRows({ ...cur, expanded }).findIndex(r => r.node.id === top) : -1
  return at < 0 ? {} : { scroll: at }
}

/** The shimmer for `tones` on top of any still running: rows bright, closed folders opened and dim. */
export function flashPatch(cur: FileTree, tones: Record<string, string>, keep: { followClaude: boolean; from: number }): Partial<FileTree> {
  const unique = Object.keys(tones)
  const open = new Set(cur.expanded)
  const bright = new Set([...(cur.flashOn ? cur.flash.filter(id => !unique.includes(id)) : []), ...unique])
  const dim = new Set<string>()
  const all: Record<string, string> = cur.flashOn ? { ...cur.flashTones } : {}
  if (cur.flashOn) {
    for (const id of cur.flashDim) dim.add(id)
  }
  for (const id of unique) {
    const tone = tones[id] ?? 'orange'
    all[id] = tone
    if (id === BRANCH_ROW) continue
    const chain = ancestorsOf(id, cur.root)
    if (!chain.some(a => !open.has(a))) continue
    for (const a of chain) {
      if (!open.has(a)) {
        dim.add(a)
        all[a] = all[a] ?? tone
      }
      open.add(a)
    }
  }
  for (const id of bright) dim.delete(id)
  return {
    flash: [...bright],
    flashDim: [...dim],
    flashOn: true,
    flashTones: all,
    expanded: [...open],
    ...keepTop(cur, [...open], keep.followClaude, keep.from),
  }
}

export function clearFlash(): Partial<FileTree> {
  return { flash: [], flashDim: [], flashOn: false, flashTones: {} }
}

/** The log after Claude did `state` to `paths` at `at`: they move to the front of the touched list. */
export function withTouches(log: ClaudeLog | undefined, paths: string[], state: Touch['state'] | null, at: number, now?: Omit<Now, 'at'>): ClaudeLog {
  const list = paths.map(posix)
  const cur = log ?? { now: null, touched: [] }
  const rest = cur.touched.filter(x => !list.includes(x.path))
  const touched = state ? [...list.map(path => ({ path, state, at })), ...rest] : rest
  return { now: now ? { ...now, at } : cur.now, touched: touched.slice(0, TOUCH_KEEP) }
}
