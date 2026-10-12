import type { Activity, ClaudeLog, FileTree, Now } from '../../../types'
import { TOUCH_SHOWN } from '../../core/constants'
import { shortPath } from '../../core/platform'
import type { Card, DesktopModel } from '../../desktop'
import { dirname, inside } from '../../tree'
import { relPath } from '../tree/model'

/** The desktop card: what Claude is doing, else the last thing it did, a git action or a file. */
export function cardOf(now: Now | null, git: Activity | undefined, where: (p: string) => string): Card {
  const gitRunning = git?.state === 'running'
  const nowRunning = now?.state === 'running'
  if (git && (!now || (gitRunning !== nowRunning ? gitRunning : git.at >= now.at))) {
    const phase = git.state === 'running' ? 'RIGHT NOW' : git.state === 'failed' ? 'FAILED' : 'DONE'
    const title = git.state === 'running' ? `Claude is ${git.label}` : git.state === 'failed' ? `Claude's ${git.label}` : `Claude ${git.label}`
    const icon = git.state === 'failed' ? 'x' : git.state === 'done' && git.kind === 'git commit' ? 'check' : 'git'
    return { tone: git.state === 'failed' ? 'red' : git.tone, phase, title, sub: git.detail, icon, live: git.state === 'running' }
  }
  if (!now) return { tone: '', phase: 'IDLE', title: 'Waiting for Claude', sub: 'What Claude reads, edits and commits shows here', icon: 'idle', live: false }
  const name = now.path.split('/').pop() || now.path
  const what = now.count > 1 ? `${now.count} files` : name
  const sub = now.verb === 'commit' ? now.detail : now.count > 1 ? `${where(now.path)} and more` : where(now.path)
  if (now.state === 'failed') {
    const title = now.verb === 'read' ? `Claude couldn't read ${name}` : now.verb === 'edit' ? `Claude's edit to ${name} failed` : 'Claude’s commit failed'
    return { tone: 'red', phase: 'FAILED', title, sub, icon: 'x', live: false }
  }
  const running = now.state === 'running'
  const phase = running ? 'RIGHT NOW' : 'DONE'
  if (now.verb === 'read') return { tone: 'purple', phase, title: running ? `Claude is reading ${name}` : `Claude read ${what}`, sub, icon: 'eye', live: running }
  if (now.verb === 'edit') return { tone: 'orange', phase, title: running ? `Claude is editing ${name}` : `Claude edited ${what}`, sub, icon: 'pencil', live: running }
  return { tone: 'green', phase, title: `Claude committed ${now.count} ${now.count === 1 ? 'file' : 'files'}`, sub, icon: 'check', live: false }
}

/** Where a file sits, as the card's subtitle says it. */
export function whereOf(root: string, p: string): string {
  const d = dirname(p)
  return d === root || !inside(root, d) ? (d === root ? 'in project root' : `in ${shortPath(d)}`) : `in ${relPath(root, d)}`
}

/** The desktop pane's card, branch, summary and touched list. */
export function desktopModel(t: FileTree, log: ClaudeLog, latest: Activity | undefined, totals: [number, number], header: string, muted: string): DesktopModel {
  const rel = (p: string) => relPath(t.root, p)
  const card = cardOf(log.now, latest ?? log.git, p => whereOf(t.root, p))
  const c = t.counts[t.root] ?? [0, 0, 0]
  const changed = c[0] + c[1] + c[2]
  const summary = !t.top
    ? { text: '', add: 0, del: 0 }
    : changed === 0 && totals[0] === 0 && totals[1] === 0
      ? { text: 'clean, nothing changed', add: 0, del: 0 }
      : { text: changed ? `${changed} changed` : 'changed', add: totals[0], del: totals[1] }
  const mine = log.touched.filter(x => inside(t.root, x.path) && x.path !== t.root)
  return {
    card,
    branch: t.top && t.branch ? { head: t.branch.head, upstream: t.branch.upstream, ahead: t.branch.ahead, behind: t.branch.behind } : null,
    summary,
    noRepo: !t.top,
    query: t.query,
    view: t.view,
    edited: Object.keys(t.changes).filter(p => p !== t.root && inside(t.root, p)).length,
    selected: t.selected ? rel(t.selected) : '',
    touched: mine.slice(0, TOUCH_SHOWN).map(x => {
      const d = dirname(x.path)
      return { path: x.path, name: x.path.split('/').pop() ?? x.path, dir: d === t.root ? '' : rel(d), state: x.state, folder: t.nodes.some(n => n.id === x.path && n.kind === 'dir') }
    }),
    more: Math.max(0, mine.length - TOUCH_SHOWN),
    project: header,
    muted,
  }
}
