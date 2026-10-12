import type { BuiltinToolResults } from 'claude-code'
import type { Activity, FileNode, Now } from '../../../types'
import { ACTIVITY_TTL_MS, FIND_LIMIT, READ_REVEAL_LIMIT } from '../../core/constants'
import type { GitOperation, Job, Outcome, Pending, Since } from '../../core/types'
import { chainOf, type GitAction, resolve } from '../../git'
import { dirname, inside, underAny } from '../../tree'

export const PROOF: Record<string, (op: GitOperation) => boolean> = {
  push: op => Boolean(op.push),
  merge: op => op.branch?.action === 'merged',
  rebase: op => op.branch?.action === 'rebased',
  'pr create': op => op.pr?.action === 'created',
  'pr merge': op => op.pr?.action === 'merged',
  'pr comment': op => op.pr?.action === 'commented',
}

/** The activity list once `actions` start: expired entries dropped, a running entry per action. */
export function started(cur: Activity[], actions: GitAction[], ids: number[], now: number): Activity[] {
  return [
    ...cur.filter(a => a.state === 'running' || now - a.at < ACTIVITY_TTL_MS),
    ...actions.map((a, i) => ({
      id: ids[i] ?? 0,
      kind: a.kind,
      label: a.running,
      state: 'running' as const,
      detail: '',
      at: now,
      tone: a.tone,
      nerd: a.icon.nerd,
      plain: a.icon.plain,
    })),
  ]
}

// A commit the tool reported no sha for is proven by HEAD moving.
export function needsHead(p: Pending, op: GitOperation | undefined): boolean {
  return p.actions.some(a => a.verb === 'commit') && !op?.commit
}

export function outcomesOf(p: Pending, ok: boolean, op: GitOperation | undefined, after: string): Outcome[] {
  const chain = chainOf(p.command)
  return p.actions.map(a => {
    if (a.verb === 'commit') {
      const sha = op?.commit?.sha || (after && after !== p.head ? after : '')
      return sha ? { state: 'done', label: a.done, detail: sha.slice(0, 7) } : { state: 'failed', label: `${a.verb} failed`, detail: '' }
    }
    if ((op && PROOF[a.verb]?.(op)) || (ok && chain.and)) return { state: 'done', label: a.done, detail: '' }
    if (!ok && chain.and && chain.size === 1) return { state: 'failed', label: `${a.verb} failed`, detail: '' }
    return { state: 'unknown', label: '', detail: '' }
  })
}

/** The activity list with `ids` settled to `results`: unknown ones taken down, the last settled one returned. */
export function settled(cur: Activity[], ids: number[], results: Outcome[], now: number): { list: Activity[]; last: Activity | undefined } {
  let last: Activity | undefined
  const list = cur.flatMap(a => {
    const i = ids.indexOf(a.id)
    const result = i < 0 ? undefined : results[i]
    if (result?.state === 'unknown') return []
    if (!result) return [a]
    last = { ...a, ...result, at: now } as Activity
    return [last]
  })
  return { list, last }
}

export function expired(cur: Activity[], now: number): Activity[] {
  return cur.filter(a => a.state === 'running' || a.at > now)
}

export function withoutIds(cur: Activity[], ids: number[]): Activity[] {
  return cur.filter(a => !ids.includes(a.id))
}

export function failAll(p: Pending): Outcome[] {
  return p.actions.map(a => ({ state: 'failed', label: `${a.verb} failed`, detail: '' }))
}

// Only actions with evidence they succeeded.
export function proven(p: Pending | null, results: Outcome[], cwd: string, home: string): GitAction[] {
  if (!p) return []
  return p.actions
    .filter((a, i) => results[i]?.state === 'done' && results[i]?.label === a.done)
    .map(a => (a.paths ? { ...a, paths: a.paths.map(x => resolve(cwd, x, home)) } : a))
}

export function taskEnds(text: string): [string, string][] {
  return [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)].flatMap(m => {
    const id = /<task-id>([^<]*)<\/task-id>/.exec(m[1] ?? '')?.[1]?.trim()
    const status = /<status>([^<]*)<\/status>/.exec(m[1] ?? '')?.[1]?.trim()
    return id && status ? [[id, status] as [string, string]] : []
  })
}

/** The earliest start among the jobs that wrote, or among all of them when none did. */
export function sinceOf(jobs: Job[]): Since {
  const writers = jobs.filter(j => !j.readOnly)
  return (writers.length ? writers : jobs).reduce((a, j) => (j.since.ms < a.ms ? j.since : a), (writers[0] ?? jobs[0])?.since ?? { ms: 0, mark: '', os: 'linux' as const })
}

export function writes(jobs: Job[]): boolean {
  return !jobs.every(j => j.readOnly)
}

export function scanHits(hits: string[], root: string, ignored: Set<string>): string[] {
  return hits.filter(x => inside(root, x) && !underAny(x, ignored, root)).slice(0, FIND_LIMIT)
}

export function scanDirs(root: string, open: string[], hits: string[], gone: string[]): string[] {
  return [...new Set([root, ...open, ...hits.map(dirname), ...gone.map(dirname)])].filter(d => inside(root, d))
}

// Windows has no find: what changed is what the listing shows modified since.
export function newerListed(hits: string[], listed: Map<string, FileNode[]>, sinceMs: number): string[] {
  const out = [...hits]
  for (const kids of listed.values()) for (const n of kids) if (n.mtime > sinceMs && out.length < FIND_LIMIT) out.push(n.id)
  return out
}

export function touchTone(actions: GitAction[]): string {
  return actions.find(a => !['commit', 'push', 'add'].includes(a.verb))?.tone ?? 'orange'
}

export function readCandidate(r: string, root: string, ignored: Set<string>): boolean {
  return r !== root && inside(root, r) && !underAny(r, ignored, root)
}

// A commit shows what it committed; an add shows what it named, or all that is staged.
export function namedPaths(actions: GitAction[], committed: boolean): string[] | null {
  return committed ? null : actions.filter(a => a.verb === 'add').some(a => !a.paths) ? null : actions.flatMap(a => a.paths ?? [])
}

export function stagedShown(paths: string[], named: string[] | null, ignored: Set<string>, root: string): string[] {
  return paths.filter(x => !underAny(x, ignored, root) && (!named || named.some(n => x === n || inside(n, x)))).slice(0, READ_REVEAL_LIMIT)
}

export function branchTone(actions: GitAction[], committed: boolean): string | undefined {
  const pushLike = actions.find(a => ['push', 'pull', 'fetch', 'checkout', 'switch', 'branch', 'merge', 'rebase', 'tag'].includes(a.verb) || a.kind.startsWith('gh '))
  if (pushLike) return pushLike.tone
  if (committed) return 'green'
  return undefined
}

export function lastCommitSha(list: Activity[]): string {
  return [...list].reverse().find(a => a.kind === 'git commit' && a.state === 'done')?.detail ?? ''
}

/** `tones` with each shown id set to `tone`; with `over` false an id keeps a tone it has. */
export function paint(tones: Record<string, string>, ids: string[], shown: Set<string>, tone: string, over = true): Record<string, string> {
  const next = { ...tones }
  for (const id of ids) if (shown.has(id) && (over || !next[id])) next[id] = tone
  return next
}

export function done(verb: Now['verb'], paths: string[], detail = ''): Omit<Now, 'at'> {
  return { verb, state: 'done', path: paths[0] ?? '', count: paths.length, detail }
}

export function editing(path: string, state: Now['state']): Omit<Now, 'at'> {
  return { verb: 'edit' as const, state, path, count: 1, detail: '' }
}

export function editTarget(e: object): string {
  return 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : 'notebook_path' in e && typeof e.notebook_path === 'string' ? e.notebook_path : ''
}

export function changesDir(command: string): boolean {
  return /(^|[;&|\s])(cd|pushd|popd)(\s|$)/.test(command)
}

export function bashOutput(result: { isError?: boolean; result?: unknown }): Partial<BuiltinToolResults['Bash']> {
  return !result.isError && result.result && typeof result.result === 'object' ? (result.result as Partial<BuiltinToolResults['Bash']>) : {}
}

export function stdoutOf(out: Partial<BuiltinToolResults['Bash']>): string {
  return typeof out.stdout === 'string' ? out.stdout : ''
}

export function jobOf(since: Since, actions: GitAction[], quiet: boolean, isReadOnly: boolean | undefined): Job {
  return { actions: [], since, initRepo: actions.some(a => a.init), readOnly: quiet || isReadOnly === true }
}
