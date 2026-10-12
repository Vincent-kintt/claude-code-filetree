import { type EngineInterface, type Register, type ResultOf, update } from 'claude-code'
import { LINUX_LAUNCH, openCommand, openWithCommand } from './open'

import type { Activity, ClaudeLog, FileNode, FileTree, Now, Theme, Touch } from '../types'
import { type Card, type DesktopModel, desktopPane, desktopPreview } from './desktop'
import { BRANCH_ICON, type GitAction, gitActions, readOnly, readTargets, resolve, TONES } from './git'
import type { RowSpec, RowsProps, Seg } from './rows'
import { CHEVRON_CLOSED, CHEVRON_OPEN, fileIcon, GIT_COLOR } from './icons'
import { VERSION } from './version'
import {
  ancestorsOf,
  type Change,
  DEFAULT_THEME,
  dirname,
  drivesOn,
  emptyTree,
  formatSize,
  inside,
  isAbsolute,
  join,
  mapper,
  parseGit,
  parseNumstat,
  parseTheme,
  posix,
  relative,
  useDrives,
  rollCounts,
  replaceChildren,
  rollUp,
  stamp,
  toNodes,
  underAny,
  rowsOf,
  SEARCH_REVEAL_LIMIT,
} from './tree'
import {
  ACTIVITY_TTL_MS,
  ADD_COLOR,
  BRANCH_ROW,
  DATE_MIN_COLUMNS,
  DEL_COLOR,
  DOUBLE_MS,
  FLASH_MS,
  HOME_PRUNE,
  MIN_COLUMNS,
  NO_REPO_DEPTH,
  PANE,
  PRUNE,
  READ_REVEAL_LIMIT,
  RENDER_CHARS,
  RUNNING_MAX_MS,
  SHIMMER,
  SHIMMER_DESKTOP,
  SIZE_JOBS,
  SIZE_TIMEOUT_MS,
  SIZE_WALK_LIMIT,
  TOUCH_SHOWN,
} from './core/constants'
import { broad, pruneArgs, rootOfDisk, shortPath } from './core/platform'
import { rt, settings } from './core/runtime'
import type { GitOperation, Job, OS, Outcome, Pending, Since } from './core/types'
import {
  bashOutput,
  branchTone,
  changesDir,
  done,
  editing,
  editTarget,
  expired,
  failAll,
  jobOf,
  lastCommitSha,
  namedPaths,
  needsHead,
  newerListed,
  outcomesOf,
  paint,
  proven,
  readCandidate,
  scanDirs,
  scanHits,
  settled,
  sinceOf,
  stagedShown,
  started,
  stdoutOf,
  taskEnds,
  touchTone,
  withoutIds,
  writes,
} from './features/git-jobs/model'
import { reading, searchNames, searchReads } from './features/reads/model'
import { clearFlash, flashPatch, withTouches } from './features/activity/model'
import { mentionsIn, selectedContext } from './features/context/model'
import { keyAction, pressedNode, scrollToRow, wheelScroll, wheelStep } from './features/input/model'
import { FONT_SCRIPT, fontStateOf, herdrPointerOk, homeOf, interruptActivities, interruptClaude, jumpPatch, layoutRefusal, paneTitle, revealPatch, settingsFrom, THEME_POLL_MS, themePath } from './features/session/model'

// The host lists what a module reads and writes from these literals, so they stay in this file.
const TREE = { plugin: 'filetree', key: 'tree' } as const
const THEME = { plugin: 'filetree', key: 'theme' } as const
const ACTIVITY = { plugin: 'filetree', key: 'activity' } as const
const CLAUDE = { plugin: 'filetree', key: 'claude' } as const

// Every function that takes $ is declared in this file: the host follows $ only into
// functions declared alongside the hooks, never across an import.

function osName($: EngineInterface): Promise<OS> {
  rt.platform ??= (async () => {
    if ((await $.env.get('OS')) === 'Windows_NT') return 'win32'
    try {
      return (await $.process.run(['uname', '-s'], { timeoutMs: 3_000 })).stdout.trim() === 'Darwin' ? 'darwin' : 'linux'
    } catch {
      return 'linux'
    }
  })()
  return rt.platform
}

async function cwdOf($: EngineInterface): Promise<string> {
  return posix(await $.session.cwd())
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function git($: EngineInterface, cwd: string, args: string[], timeoutMs = 20_000) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

async function get($: EngineInterface): Promise<FileTree> {
  return { ...emptyTree(''), ...(await $.state.get(TREE)).value }
}

async function put($: EngineInterface, fn: (t: FileTree) => FileTree): Promise<void> {
  await update($, TREE, cur => fn({ ...emptyTree(''), ...cur }))
}

function patch($: EngineInterface, fn: (t: FileTree) => Partial<FileTree>) {
  return put($, t => ({ ...t, ...fn(t) }))
}

async function activities($: EngineInterface): Promise<Activity[]> {
  return (await $.state.get(ACTIVITY)).value ?? []
}

async function setActivities($: EngineInterface, fn: (list: Activity[]) => Activity[]): Promise<void> {
  await update($, ACTIVITY, cur => fn(cur ?? []).slice(-6))
}

async function claudeLog($: EngineInterface): Promise<ClaudeLog> {
  return (await $.state.get(CLAUDE)).value ?? { now: null, touched: [] }
}

/** Records what Claude did to `paths` for the desktop card and its touched list. */
async function record($: EngineInterface, paths: string[], state: Touch['state'] | null, now?: Omit<Now, 'at'>): Promise<void> {
  const at = await $.clock.now()
  await update($, CLAUDE, cur => withTouches(cur, paths, state, at, now))
}

function clean(segs: Seg[]): Seg[] {
  for (const seg of segs) for (const k of Object.keys(seg) as (keyof Seg)[]) if (seg[k] === undefined) delete seg[k]
  return segs
}

function faint(hex: string): string {
  const v = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(0x26 + (((v >> shift) & 255) - 0x26) * 0.3)
  return `#${[16, 8, 0].map(x => ch(x).toString(16).padStart(2, '0')).join('')}`
}

async function list($: EngineInterface, dir: string): Promise<FileNode[] | null> {
  try {
    const entries = await $.fs.list(dir)
    const resolved = await Promise.all(
      entries.map(async e => {
        if (!e.isLink) return { name: e.name, kind: e.kind, mtimeMs: e.mtimeMs, size: e.size, isLink: false }
        try {
          const target = await $.fs.stat(join(dir, e.name))
          return target.kind === 'dir'
            ? { name: e.name, kind: 'dir' as const, mtimeMs: target.mtimeMs, size: 0, isLink: false }
            : { name: e.name, kind: 'file' as const, mtimeMs: target.mtimeMs, size: target.size, isLink: true }
        } catch {
          return { name: e.name, kind: 'other' as const, mtimeMs: 0, size: 0, isLink: true }
        }
      }),
    )
    rt.unreadable.delete(dir)
    return toNodes(dir, resolved)
  } catch (err) {
    if (!(await exists($, dir))) return []
    if (!rt.unreadable.has(dir)) {
      rt.unreadable.add(dir)
      $.ui.toast(`could not list ${shortPath(dir)}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return null
  }
}

async function loadDirs($: EngineInterface, dirs: string[]): Promise<Map<string, FileNode[]>> {
  const root = (await get($)).root
  const seq = ++rt.listSeq
  for (const dir of dirs) rt.listLatest.set(dir, seq)
  const results = await Promise.all(dirs.map(async dir => [dir, await list($, dir)] as const))
  const listed = new Map<string, FileNode[]>()
  for (const [dir, kids] of results) {
    if (rt.listLatest.get(dir) !== seq) continue
    rt.listLatest.delete(dir)
    if (kids) listed.set(dir, kids)
  }
  await patch($, t => (t.root === root ? { nodes: replaceChildren(t.nodes, listed) } : {}))
  return listed
}

async function detectRepo($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root) return
  let top = ''
  let prefix = ''
  try {
    const run = await git($, t.root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5_000)
    const [p = '', tl = ''] = run.exitCode === 0 ? run.stdout.split('\n') : []
    prefix = p.trim()
    top = tl.trim()
  } catch {
    top = ''
  }
  await patch($, cur => (cur.root === t.root ? { top, prefix } : {}))
}

async function readGit($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root || !t.top) return
  const root = t.root
  try {
    const status = await git($, root, ['status', '--porcelain=v1', '-b', '-z', '--ignored=traditional', '--untracked-files=normal', '--', '.'])
    if (status.exitCode !== 0) return
    const parsed = parseGit(status.stdout, root, t.prefix)
    const diff: Record<string, [number, number]> = {}
    const head = await git($, root, ['diff', 'HEAD', '--numstat', '-z', '--', '.'])
    if (head.exitCode === 0) parseNumstat(head.stdout, root, t.prefix, diff)
    const files = { ...parsed.files }
    if (parsed.untrackedDirs.length) {
      const others = await git($, root, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...parsed.untrackedDirs.map(d => d.slice(root.length + 1) || '.')])
      if (others.exitCode === 0) for (const rel of others.stdout.split('\0').filter(Boolean)) files[join(root, rel)] = 'new'
    }
    for (const path of Object.keys(diff)) if (files[path] === 'new') delete diff[path]
    rt.dirty = { root, files }
    await patch($, cur =>
      cur.root === root
        ? {
            git: parsed.git,
            ignored: parsed.ignored,
            untrackedDirs: parsed.untrackedDirs,
            branch: parsed.branch,
            counts: rollCounts(files, root),
            changes: files,
            diff: rollUp(diff, root),
          }
        : {},
    )
  } catch {
    return
  }
}

function refreshGit($: EngineInterface): Promise<void> {
  if (!rt.gitRun) {
    rt.gitRun = readGit($).finally(() => {
      rt.gitRun = null
    })
    return rt.gitRun
  }
  const rerun = () => {
    rt.gitNext = null
    return refreshGit($)
  }
  rt.gitNext ??= rt.gitRun.then(rerun, rerun)
  return rt.gitNext
}

async function reset($: EngineInterface, root: string, focus = false): Promise<void> {
  const prev = await get($)
  rt.generation += 1
  rt.blink?.cancel()
  rt.blink = null
  rt.searchIndex = null
  rt.sizeEpoch += 1
  rt.sizeQueue = []
  await put($, () => ({ ...emptyTree(root), showSize: settings.sizeDefault }))
  const title = paneTitle(root)
  rt.autoDock = !focus
  if (focus) await $.ui.open({ id: PANE, title, focus: true })
  else if (!rt.noDock) await $.ui.open({ id: PANE, title })
  await loadDirs($, [root])
  await detectRepo($)
  await refreshGit($)
}

async function revealPaths($: EngineInterface, paths: string[]): Promise<void> {
  const tried = new Set<string>()
  for (let pass = 0; pass < 32; pass++) {
    const t = await get($)
    const loaded = new Set(t.nodes.filter(n => n.loaded).map(n => n.id))
    if (t.nodes.some(n => n.parent === t.root)) loaded.add(t.root)
    const need = new Set<string>()
    for (const p of paths) {
      for (const dir of [t.root, ...ancestorsOf(p, t.root).reverse()]) {
        if (!loaded.has(dir)) {
          if (!tried.has(dir)) need.add(dir)
          break
        }
      }
    }
    if (need.size === 0) return
    for (const dir of need) tried.add(dir)
    await loadDirs($, [...need])
  }
}

async function newer($: EngineInterface, paths: string[], sinceMs: number): Promise<string[]> {
  const stats = await Promise.all(
    paths.map(async p => {
      try {
        return (await $.fs.stat(p)).mtimeMs > sinceMs ? p : ''
      } catch {
        return ''
      }
    }),
  )
  return stats.filter(Boolean)
}

async function changedSince($: EngineInterface, root: string, since: Since, depth: number, ignored: string[] = []): Promise<string[]> {
  if (rootOfDisk(root)) return []
  const test = since.mark ? ['-newer', since.mark] : ['-newermt', `@${(since.ms / 1000).toFixed(3)}`]
  try {
    const run = await $.process.run(['find', '-H', root, '-xdev', ...(depth ? ['-maxdepth', String(depth)] : []), ...pruneArgs(root, ignored.filter(p => inside(root, p)).slice(0, 40)), ...test, '-print0'], { timeoutMs: 8_000 })
    return run.stdout.split('\0').filter(p => p && p !== root)
  } catch {
    return []
  }
}

async function changedInRepo($: EngineInterface, root: string, since: Since, before: Record<string, Change>, ignored: string[]): Promise<{ hits: string[]; gone: string[] }> {
  if (since.os !== 'win32') return { hits: await changedSince($, root, since, 0, ignored), gone: [] }
  if (rt.dirty.root !== root) return { hits: [], gone: [] }
  const entries = Object.entries(rt.dirty.files)
  const gone = entries.filter(([p, c]) => c === 'del' && before[p] !== 'del').map(([p]) => p)
  const live = entries.filter(([, c]) => c !== 'del').map(([p]) => p)
  return { hits: await newer($, live.slice(0, 4_000), since.ms), gone }
}

async function sinceNow($: EngineInterface, writes: boolean): Promise<Since> {
  const ms = await $.clock.now()
  const os = await osName($)
  if (os !== 'darwin' || !writes) return { ms, mark: '', os }
  const mark = `${((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')}/filetree-${await $.session.id()}-${++rt.markId}.mark`
  try {
    await $.process.run(['touch', mark], { timeoutMs: 3_000 })
    return { ms, mark, os }
  } catch {
    return { ms, mark: '', os }
  }
}

async function walkSize($: EngineInterface, dir: string): Promise<number> {
  let total = 0
  let seen = 0
  let level = [dir]
  while (level.length) {
    const next: string[] = []
    for (const d of level) {
      let entries
      try {
        entries = await $.fs.list(d)
      } catch {
        continue
      }
      for (const e of entries) {
        if (++seen > SIZE_WALK_LIMIT) return -1
        if (e.kind === 'dir' && !e.isLink) next.push(join(d, e.name))
        else if (e.kind === 'file') total += e.size
      }
    }
    level = next
  }
  return total
}

async function dirSize($: EngineInterface, dir: string): Promise<number> {
  if (rootOfDisk(dir)) return -1
  if ((await osName($)) === 'win32') return walkSize($, dir)
  try {
    const run = await $.process.run(['du', '-skxH', dir], { timeoutMs: SIZE_TIMEOUT_MS })
    const kb = Number(run.stdout.trim().split(/\s/)[0] || NaN)
    return Number.isFinite(kb) ? kb * 1024 : -1
  } catch {
    return -1
  }
}

function pumpSizes($: EngineInterface): void {
  while (rt.sizeActive < SIZE_JOBS && rt.sizeQueue.length) {
    const dir = rt.sizeQueue.shift() ?? ''
    const epoch = rt.sizeEpoch
    rt.sizing.add(dir)
    rt.sizeActive += 1
    void dirSize($, dir)
      .then(async bytes => {
        if (epoch === rt.sizeEpoch) return patch($, cur => (inside(cur.root, dir) ? { dirSizes: { ...cur.dirSizes, [dir]: bytes } } : {}))
        const cur = await get($)
        if (cur.showSize && inside(cur.root, dir) && !(dir in cur.dirSizes) && !rt.sizeQueue.includes(dir)) rt.sizeQueue.push(dir)
      })
      .catch(() => undefined)
      .finally(() => {
        rt.sizing.delete(dir)
        rt.sizeActive -= 1
        pumpSizes($)
      })
  }
}

function wantSizes($: EngineInterface, dirs: string[]): void {
  for (const dir of dirs) if (!rt.sizing.has(dir) && !rt.sizeQueue.includes(dir)) rt.sizeQueue.push(dir)
  pumpSizes($)
}

async function staleSizes($: EngineInterface, paths?: string[]): Promise<void> {
  rt.sizeEpoch += 1
  rt.sizeQueue = []
  await patch($, cur => {
    if (!paths) return { dirSizes: {} }
    const keep: Record<string, number> = {}
    for (const [dir, bytes] of Object.entries(cur.dirSizes)) if (!paths.some(p => inside(dir, p))) keep[dir] = bytes
    return { dirSizes: keep }
  })
}

function openDirs(t: FileTree): string[] {
  const open = new Set(t.expanded)
  return t.nodes.filter(n => n.kind === 'dir' && n.loaded && open.has(n.id)).map(n => n.id)
}

async function flash($: EngineInterface, tones: Record<string, string>): Promise<void> {
  const unique = Object.keys(tones)
  if (unique.length === 0) return
  const mine = ++rt.generation
  const root = (await get($)).root
  rt.blink?.cancel()
  rt.blink = null
  await patch($, cur => (cur.root !== root ? {} : flashPatch(cur, tones, { followClaude: settings.followClaude, from: rt.view.from })))
  if (rt.generation !== mine) return
  rt.blink = $.clock.after(FLASH_MS, () => {
    if (rt.generation !== mine) return
    rt.blink = null
    void patch($, () => (rt.generation === mine ? clearFlash() : {}))
  })
}

async function followCwd($: EngineInterface): Promise<boolean> {
  const cwd = await cwdOf($)
  const t = await get($)
  if (t.root === cwd) return false
  await reset($, cwd)
  return true
}

async function startGit($: EngineInterface, actions: GitAction[]): Promise<number[]> {
  const now = await $.clock.now()
  const ids = actions.map(() => ++rt.activityId)
  await setActivities($, cur => started(cur, actions, ids, now))
  return ids
}

async function headOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const run = await git($, cwd, ['rev-parse', 'HEAD'], 5_000)
    return run.exitCode === 0 ? run.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function outcomes($: EngineInterface, p: Pending, ok: boolean, op: GitOperation | undefined): Promise<Outcome[]> {
  const after = needsHead(p, op) ? await headOf($, (await get($)).root || (await cwdOf($))) : ''
  return outcomesOf(p, ok, op, after)
}

async function finishGit($: EngineInterface, p: Pending, results: Outcome[]): Promise<void> {
  const now = await $.clock.now()
  let last: Activity | undefined
  await setActivities($, cur => {
    const next = settled(cur, p.ids, results, now)
    last = next.last
    return next.list
  })
  // The desktop card shows the last git action after its footer chip expires.
  const latest = last
  if (latest) await update($, CLAUDE, cur => ({ ...(cur ?? { now: null, touched: [] }), git: latest }))
  $.clock.after(ACTIVITY_TTL_MS + 500, () => void setActivities($, cur => expired(cur, now)))
}

async function settleBackground($: EngineInterface, text: string): Promise<void> {
  if (rt.background.size === 0 || !text.includes('<task-notification>')) return
  for (const [id, status] of taskEnds(text)) {
    const task = rt.background.get(id)
    if (!task) continue
    rt.background.delete(id)
    const ok = status === 'completed'
    const results = task.p ? await outcomes($, task.p, ok, undefined) : []
    if (task.p) await finishGit($, task.p, results)
    if (settings.showReads) rt.queuedReads.push(...task.reads)
    scheduleScan($, { ...task.job, actions: proven(task.p, results, task.cwd, rt.home) })
  }
}

async function gitPaths($: EngineInterface, root: string, prefix: string, committed: boolean): Promise<string[]> {
  const map = mapper(root, prefix)
  try {
    const run = committed
      ? await git($, root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD', '--', '.'], 5_000)
      : await git($, root, ['diff', '--cached', '--name-only', '-z', '--', '.'], 5_000)
    return run.exitCode === 0 ? run.stdout.split('\0').filter(Boolean).flatMap(rel => map(rel) ?? []) : []
  } catch {
    return []
  }
}

// Outside a repo the cwd's own .git is watched, so a git init there is seen as it lands.
async function gitWatch($: EngineInterface, cwd: string): Promise<string[]> {
  const gd = (await gitDir($, cwd)) || join(cwd, '.git')
  rt.gitWatched = [join(gd, 'index'), join(gd, 'HEAD')]
  return rt.gitWatched
}

async function gitDir($: EngineInterface, cwd: string): Promise<string> {
  for (let dir = cwd, i = 0; i < 64; i++) {
    try {
      const dot = join(dir, '.git')
      const st = await $.fs.stat(dot)
      if (st.kind === 'dir') return dot
      const ref = /^gitdir:\s*(.+)$/m.exec(String(await $.fs.read(dot)))?.[1]?.trim()
      if (ref) return resolve(dir, ref, rt.home)
    } catch {
      const up = dirname(dir)
      if (up === dir) return ''
      dir = up
      continue
    }
    return ''
  }
  return ''
}

async function sync($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - rt.lastSync < 2_000) return
  rt.lastSync = now
  rt.searchIndex = null
  if (!rt.themePoll) await loadTheme($)
  const t = await get($)
  if (!t.root) return
  await loadDirs($, [t.root, ...openDirs(t)])
  if (t.top) await refreshGit($)
}

async function copyPath($: EngineInterface, id: string, absolute: boolean, surface?: string): Promise<void> {
  const t = await get($)
  const text = !absolute && id !== t.root && inside(t.root, id) ? id.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : id
  const done = await $.ui.copy({ text, ...(surface ? { surface: surface as 'terminal' } : {}) })
  $.ui.toast(done.isCopied ? `Copied ${text}` : 'Could not copy the path')
}

async function afterBash($: EngineInterface, jobs: Job[]): Promise<void> {
  const reads = rt.queuedReads
  rt.queuedReads = []
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const actions = jobs.flatMap(j => j.actions)
  const since = sinceOf(jobs)
  const wrote = writes(jobs)
  const before = rt.dirty.root === t.root ? rt.dirty.files : {}
  if (jobs.some(j => j.initRepo)) await detectRepo($)
  else if (!t.top && (await exists($, join(t.root, '.git')))) await detectRepo($)
  const probed = await get($)
  if (probed.top && (wrote || probed.top !== t.top)) await refreshGit($)
  if (wrote) {
    rt.searchIndex = null
    await staleSizes($)
  }
  const fresh = await get($)
  const ignored = new Set(fresh.ignored)
  let tones: Record<string, string> = {}
  if (wrote) {
    const found = fresh.top
      ? await changedInRepo($, t.root, since, before, fresh.ignored)
      : { hits: since.os === 'win32' ? [] : await changedSince($, t.root, since, NO_REPO_DEPTH), gone: [] }
    let hits = scanHits(found.hits, t.root, ignored)
    await revealPaths($, hits)
    const loaded = await get($)
    const listed = await loadDirs($, scanDirs(loaded.root, openDirs(loaded), hits, found.gone))
    if (!fresh.top && since.os === 'win32') hits = newerListed(hits, listed, since.ms)
    await patch($, cur => {
      const ids = new Set(cur.nodes.map(n => n.id))
      return { expanded: cur.expanded.filter(id => ids.has(id)) }
    })
    const present = new Set((await get($)).nodes.map(n => n.id))
    if (settings.showWrites) tones = paint(tones, hits, present, touchTone(actions))
    const edited = hits.filter(id => present.has(id))
    if (settings.showWrites && edited.length) await record($, edited, 'edited', done('edit', edited))
  }
  if (settings.showReads) {
    const found: string[] = []
    for (const r of reads) {
      if (found.length >= READ_REVEAL_LIMIT) break
      if (readCandidate(r, t.root, ignored) && (await exists($, r))) found.push(r)
    }
    if (found.length) {
      await revealPaths($, found)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      tones = paint(tones, found, shown, 'purple', false)
      await record($, found, 'read', done('read', found))
    }
  }
  if (settings.showWrites && actions.length) {
    const final = await get($)
    const committed = actions.some(a => a.verb === 'commit')
    if ((committed || actions.some(a => a.verb === 'add')) && final.top) {
      const paths = stagedShown(await gitPaths($, final.root, final.prefix, committed), namedPaths(actions, committed), ignored, final.root)
      await revealPaths($, paths)
      const shown = new Set((await get($)).nodes.map(n => n.id))
      tones = paint(tones, paths, shown, 'green')
      if (committed && paths.length) await record($, paths, 'committed', done('commit', paths, lastCommitSha(await activities($))))
    }
    const branch = branchTone(actions, committed)
    if (branch) tones[BRANCH_ROW] = branch
  }
  await flash($, tones)
}

function scheduleScan($: EngineInterface, job: Job): void {
  rt.scanJobs.push(job)
  if (rt.scanning) return
  rt.scanning = (async () => {
    while (rt.scanJobs.length) {
      const jobs = rt.scanJobs
      rt.scanJobs = []
      try {
        await afterBash($, jobs)
      } finally {
        const marks = jobs.map(j => j.since.mark).filter(Boolean)
        if (marks.length) await $.process.run(['rm', '-f', ...marks], { timeoutMs: 3_000 }).catch(() => undefined)
      }
    }
  })().finally(() => {
    rt.scanning = null
  })
}

async function touched($: EngineInterface, paths: string[], tone: string, show: boolean): Promise<void> {
  if (tone !== 'purple' && rt.previewed && paths.map(posix).includes(rt.previewed.path)) rt.previewed = null
  if (await followCwd($)) return
  const t = await get($)
  if (!t.root) return
  const within = paths.map(posix).filter(p => inside(t.root, p))
  if (within.length === 0) return
  if (tone !== 'purple') {
    rt.searchIndex = null
    await staleSizes($, within)
    await revealPaths($, within.map(dirname))
    await loadDirs($, [...new Set(within.map(dirname))].filter(d => inside(t.root, d)))
    await refreshGit($)
  } else await revealPaths($, within)
  if (!show) return
  const tones: Record<string, string> = {}
  for (const p of within) tones[p] = tone
  await flash($, tones)
}

async function reveal($: EngineInterface, paths: string[]): Promise<void> {
  if (await followCwd($)) return
  await revealPaths($, paths)
  await patch($, cur => revealPatch(cur, paths))
}

async function walk($: EngineInterface, root: string, depth: number, limit: number): Promise<string[]> {
  const out: string[] = []
  const skip = broad(root) ? [...PRUNE, ...HOME_PRUNE] : PRUNE
  let level = [root]
  for (let d = 0; d < depth && level.length && out.length < limit; d++) {
    const next: string[] = []
    for (const dir of level) {
      for (const n of (await list($, dir)) ?? []) {
        if (n.kind === 'dir') {
          if (!skip.includes(n.name)) next.push(n.id)
        } else out.push(n.id)
      }
      if (out.length >= limit) break
    }
    level = next
  }
  return out
}

async function listAll($: EngineInterface, t: FileTree): Promise<string[] | null> {
  try {
    if (!t.top && (await osName($)) === 'win32') return await walk($, t.root, rootOfDisk(t.root) ? 3 : 6, 20_000)
    const run = t.top
      ? await git($, t.root, ['ls-files', '-co', '--exclude-standard', '-z'], 10_000)
      : await $.process.run(['find', '-H', t.root, '-xdev', '-maxdepth', rootOfDisk(t.root) ? '3' : '6', ...pruneArgs(t.root), '-type', 'f', '-print0'], { timeoutMs: 10_000 })
    if (t.top && run.exitCode !== 0) return null
    const paths = run.stdout.split('\0').filter(Boolean)
    if (run.isStdoutTruncated) paths.pop()
    return paths.map(p => (isAbsolute(p) ? p : join(t.root, p)))
  } catch {
    return null
  }
}

function indexPaths($: EngineInterface, t: FileTree): Promise<string[]> {
  if (rt.searchIndex?.root !== t.root) {
    const index: { root: string; paths: Promise<string[]> } = {
      root: t.root,
      paths: listAll($, t).then(paths => {
        if (paths === null && rt.searchIndex === index) rt.searchIndex = null
        return paths ?? []
      }),
    }
    rt.searchIndex = index
  }
  return rt.searchIndex.paths
}

async function search($: EngineInterface, query: string): Promise<string[]> {
  if (!(await get($)).query.trim()) rt.searchIndex = null
  await patch($, () => ({ query }))
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = await get($)
  const hits = (await indexPaths($, t)).filter(p => relative(t.root, p).toLowerCase().includes(q)).slice(0, SEARCH_REVEAL_LIMIT)
  if ((await get($)).query !== query) return []
  await revealPaths($, hits)
  const shown = await get($)
  const ids = new Set(shown.nodes.map(n => n.id))
  const stale = [...new Set(hits.filter(p => !ids.has(p)).map(dirname))].filter(d => inside(shown.root, d))
  if (stale.length) await loadDirs($, stale)
  return hits
}

async function jump($: EngineInterface, query: string): Promise<void> {
  const hits = (await search($, query)).slice(0, 10)
  await patch($, cur => jumpPatch(cur, hits))
}

async function fontState($: EngineInterface, charset: string): Promise<'ok' | 'stale' | 'missing'> {
  try {
    return fontStateOf((await $.process.run(['sh', '-c', FONT_SCRIPT, 'sh', charset], { timeoutMs: 5_000 })).stdout)
  } catch {
    return 'missing'
  }
}

async function finePointerOk($: EngineInterface): Promise<boolean> {
  if (!(await $.env.get('HERDR_ENV'))) return true
  try {
    return herdrPointerOk((await $.process.run([(await $.env.get('HERDR_BIN_PATH')) || 'herdr', '--version'], { timeoutMs: 3_000 })).stdout)
  } catch {
    return false
  }
}

const PREVIEW_CHARS = 90_000
const PREVIEW_LINE = 2_000

function fitSerialized(lines: string[], max: number): string[] {
  let size = 0
  for (let i = 0; i < lines.length; i++) {
    size += JSON.stringify(lines[i]).length
    if (size > max) return lines.slice(0, i)
  }
  return lines
}

async function loadPreview($: EngineInterface, path: string): Promise<void> {
  let text = ''
  let note = ''
  try {
    const stat = await $.fs.stat(path)
    if (stat.size > 4_000_000) note = `${formatSize(stat.size)}, too large to preview`
    else {
      text = await $.fs.read(path)
      if (text.slice(0, 8000).includes('\0')) {
        text = ''
        note = `binary file, ${formatSize(stat.size)}`
      }
    }
  } catch (err) {
    note = `could not read: ${String((err as Error)?.message ?? err).split('\n')[0]}`
  }
  const total = text.length
  let lines = text.slice(0, PREVIEW_CHARS).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  if (total > PREVIEW_CHARS && lines.length > 1) lines.pop()
  lines = lines.map(l => (l.length > PREVIEW_LINE ? `${l.slice(0, PREVIEW_LINE)}…` : l))
  const fit = fitSerialized(lines, PREVIEW_CHARS)
  if (total > PREVIEW_CHARS || fit.length < lines.length) note = `first ${fit.length.toLocaleString('en')} lines of ${total.toLocaleString('en')} characters`
  rt.previewed = { path, text: fit.join('\n'), note }
}

async function showPreview($: EngineInterface, path: string): Promise<void> {
  await loadPreview($, path)
  await patch($, () => ({ preview: path, previewTop: 0, selected: path }))
}

async function closePreview($: EngineInterface): Promise<void> {
  await patch($, () => ({ preview: '', previewTop: 0 }))
}

async function scrollPreview($: EngineInterface, by: number): Promise<void> {
  const t = await get($)
  const last = Math.max(0, (rt.previewed?.text.split('\n').length ?? 1) - rt.previewRows)
  const top = Math.max(0, Math.min(last, t.previewTop + by))
  if (top !== t.previewTop) await patch($, () => ({ previewTop: top }))
}

function previewLines(text: string, top: number, rows: number, markdown: boolean): { text: string; top: number } {
  const lines = text.split('\n')
  const from = Math.max(0, Math.min(top, lines.length - 1))
  let shown = lines.slice(from, from + rows)
  if (markdown) {
    // Reopen a code fence the window starts inside, so the rest is not read as prose.
    let fence = ''
    let opener = ''
    for (const line of lines.slice(0, from)) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const mark = m[1] ?? ''
      if (!fence) {
        fence = mark
        opener = line.trimStart()
      } else if (mark[0] === fence[0] && mark.length >= fence.length && !(m[2] ?? '').trim()) fence = ''
    }
    if (fence) shown = [opener, ...shown]
  }
  return { text: shown.join('\n'), top: from }
}

async function openFile($: EngineInterface, path: string, external = false): Promise<void> {
  // The setting always has a value: a blank one falls back to the default, preview.
  const setting = settings.openWith.trim() || 'preview'
  if (!external && setting === 'preview') return showPreview($, path)
  const os = await osName($)
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external || setting === 'app' ? null : openWithCommand(setting, native(path), native(dirname(path)))
  const { argv, init } = custom ? { argv: os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', ...custom] : custom, init: { timeoutMs: 10_000 } } : openCommand(os, path)
  try {
    const run = await $.process.run(argv, init)
    if (run.exitCode !== 0) $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}: ${run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`}`)
  } catch {
    $.ui.toast(`could not open ${path} with ${custom?.[0] ?? argv[0]}`)
  }
}

async function toggle($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir' && !(await get($)).expanded.includes(n.id)) await loadDirs($, [n.id])
  await patch($, t => {
    const open = new Set(t.expanded)
    if (n.kind === 'dir') open.has(n.id) ? open.delete(n.id) : open.add(n.id)
    return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
  })
}

async function press($: EngineInterface, n: FileNode): Promise<void> {
  const now = await $.clock.now()
  const isDouble = rt.lastPress.key === n.id && now - rt.lastPress.at < DOUBLE_MS
  rt.lastPress = { key: isDouble ? '' : n.id, at: now }
  if (!isDouble) {
    await toggle($, n)
    return
  }
  if (n.kind !== 'dir') await openFile($, n.id)
}

async function openNode($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir') await toggle($, n)
  else await openFile($, n.id)
}

// The built-in search tools read like rg and find do: the files they list shimmer purple.
// Grep in content mode lists no filenames, so its lines' path prefixes stand in.
async function searched($: EngineInterface, e: { tool: string }, next: (e: { tool: string }) => Promise<ResultOf['tool.call']>): Promise<ResultOf['tool.call']> {
  if ((e.tool !== 'Grep' && e.tool !== 'Glob') || !settings.showReads) return next(e)
  const result = await next(e)
  if (result.deny || result.isError || !result.result || typeof result.result !== 'object') return result
  const names = searchNames(result.result, drivesOn())
  if (!names.length) return result
  const cwd = await cwdOf($)
  rt.queuedReads.push(...searchReads(names, cwd, rt.home))
  scheduleScan($, { actions: [], since: await sinceNow($, false), initRepo: false, readOnly: true })
  return result
}

// What rows.tsx draws for a row, serialized: a row box, a Text per segment, and a Text per
// character while a segment shimmers. Measured at about 160 + 70 a segment + its text,
// with the text counted as JSON escapes it.
function drawnSize(r: RowSpec): number {
  let n = 160
  for (const s of [...r.left, ...r.right]) n += s.sh && !s.one ? [...s.t].reduce((a, ch) => a + 78 + JSON.stringify(ch).length, 40) : 68 + JSON.stringify(s.t).length
  return n
}

// The desktop draws every row, so a big open tree is cut to RENDER_CHARS drawn: the rows
// centred on the cursor, with a note above and below saying how many were left out.
function capRows(specs: RowSpec[], at: number, note: (text: string) => RowSpec): void {
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

// The longest run of whole lines whose JSON form, with the rt.view's buttons, name, note and
// path around it, stays within RENDER_CHARS. loadPreview already cuts each line to 2,000
// characters, so the first line always fits.
function cutLines(text: string, chrome: number): string {
  const room = RENDER_CHARS - chrome
  if (JSON.stringify(text).length <= room) return text
  let used = 2
  let end = 0
  for (const line of text.split('\n')) {
    const cost = JSON.stringify(line).length
    if (used + cost > room) break
    used += cost
    end += line.length + 1
  }
  return text.slice(0, end)
}

// A theme found starts the poll and a theme gone stops it, so a theme installed mid-session
// is followed from the next resync, and a session without one polls nothing.
async function loadTheme($: EngineInterface): Promise<void> {
  const path = themePath(await $.env.get('HOME'))
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') throw new Error('no theme file')
    rt.themePoll ??= $.clock.every(THEME_POLL_MS, () => void loadTheme($))
    if (stat.mtimeMs === rt.themeMtime) return
    await $.state.set(THEME, parseTheme(String(await $.fs.read(path))))
    rt.themeMtime = stat.mtimeMs
  } catch {
    rt.themePoll?.cancel()
    rt.themePoll = null
    if (rt.themeMtime === 0) return
    await $.state.set(THEME, DEFAULT_THEME)
    rt.themeMtime = 0
  }
}

/** The desktop card: what Claude is doing, else the last thing it did, a git action or a file. */
function cardOf(now: Now | null, git: Activity | undefined, where: (p: string) => string): Card {
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

export const register: Register = (on, options) => {
  Object.assign(settings, settingsFrom(options))
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'filetree', description: 'Show the file tree of the working directory' })
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    useDrives(windows)
    rt.home = homeOf((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '')
    rt.activityId = Math.max(rt.activityId, ...(await activities($)).map(a => a.id))
    void (async () => {
      rt.pointer = await finePointerOk($)
      try {
        const remote = Boolean((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
        rt.noNerd = !remote && (windows || (await fontState($, 'f04eb')) !== 'ok')
      } catch {
        rt.noNerd = true
      }
      rt.themePoll?.cancel()
      rt.themePoll = null
      await loadTheme($)
      const t = await get($)
      if (t.flashOn) await patch($, () => clearFlash())
      if (t.preview) await patch($, () => ({ preview: '', previewTop: 0 }))
      await setActivities($, interruptActivities)
      await update($, CLAUDE, interruptClaude)
      const cwd = await cwdOf($)
      if (!t.root || t.nodes.length === 0 || t.root !== cwd) await reset($, cwd)
      else if (!rt.noDock) {
        rt.autoDock = true
        await $.ui.open({ id: PANE, title: paneTitle(t.root) })
      }
    })()
    return next(e)
  })

  on('command.run', { command: 'filetree' }, async ($, e) => {
    // The layout checks are the terminal's: the desktop app docks the pane itself and
    // reports no fullscreen layout, so a session no terminal draws skips them.
    const terminal = await $.session.surfaces().then(s => s.includes('terminal'), () => true)
    const refusal = layoutRefusal(terminal, e.presentation.isFullscreen, e.presentation.columns)
    if (refusal) return { text: refusal }
    rt.noDock = false
    const cwd = await cwdOf($)
    await reset($, cwd, true)
    return { text: `filetree ${VERSION}: File tree on ${shortPath(cwd)}.` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit' && e.tool !== 'Bash') return next(e)
    const command = e.tool === 'Bash' ? e.command : ''
    const cwd = e.tool === 'Bash' ? await cwdOf($) : ''
    const file = posix(editTarget(e))
    const was = file && settings.showWrites ? (await claudeLog($)).touched.find(x => x.path === file) : undefined
    if (file && settings.showWrites) await record($, [file], 'editing', editing(file, 'running'))
    const actions = gitActions(command)
    const quiet = !actions.length && readOnly(command)
    const since = await sinceNow($, e.tool === 'Bash' && !quiet)
    const before = actions.some(a => a.verb === 'commit') ? await get($) : null
    const head = before?.top ? await headOf($, before.root) : ''
    const pending: Pending | null = actions.length ? { actions, ids: await startGit($, actions), command, head } : null
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      if (file && settings.showWrites) await record($, [file], was?.state ?? null, editing(file, 'failed'))
      if (pending) await finishGit($, pending, failAll(pending))
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      throw err
    }
    if (pending && result.deny) {
      const ids = pending.ids
      void setActivities($, cur => withoutIds(cur, ids))
    }
    if (file && settings.showWrites) {
      const ok = !result.deny && !result.isError
      await record($, [file], ok ? 'edited' : (was?.state ?? null), editing(file, ok ? 'done' : 'failed'))
    }
    if (result.deny || (result.isError && e.tool !== 'Bash')) {
      if (since.mark) void $.process.run(['rm', '-f', since.mark], { timeoutMs: 3_000 }).catch(() => undefined)
      return result
    }
    if (e.tool === 'Bash') {
      const out = bashOutput(result)
      const reads = settings.showReads ? readTargets(command, cwd, stdoutOf(out), rt.home) : []
      const job = jobOf(since, actions, quiet, result.isReadOnly)
      if (out.backgroundTaskId) rt.background.set(out.backgroundTaskId, { p: pending, job, reads, cwd })
      else void (async () => {
        const results = pending ? await outcomes($, pending, !result.isError, out.gitOperation) : []
        if (pending) await finishGit($, pending, results)
        rt.queuedReads.push(...reads)
        scheduleScan($, { ...job, actions: proven(pending, results, cwd, rt.home) })
      })()
      if (changesDir(command)) $.clock.after(400, () => void followCwd($))
    } else if (file) void touched($, [file], 'orange', settings.showWrites)
    return result
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (e.tool !== 'Read' || !settings.showReads) return next(e)
    const file = posix(e.file_path)
    const was = (await claudeLog($)).touched.find(x => x.path === file)
    await record($, [file], 'reading', reading(file, 'running'))
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (err) {
      await record($, [file], was?.state ?? null, reading(file, 'failed'))
      throw err
    }
    const ok = !result.deny && !result.isError
    await record($, [file], ok ? 'read' : (was?.state ?? null), reading(file, ok ? 'done' : 'failed'))
    if (ok) void touched($, [file], 'purple', true)
    return result
  })

  on('tool.call', { tool: 'Grep' }, searched)
  on('tool.call', { tool: 'Glob' }, searched)

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'rows' || !e.data || typeof e.data !== 'object') return next(e)
    const data = e.data as { press?: unknown; key?: unknown; ctrl?: unknown; shift?: unknown; scrollTo?: unknown; copy?: unknown }
    void sync($)
    const t = await get($)
    if (typeof data.copy === 'string') {
      await copyPath($, data.copy, Boolean(data.shift), e.surface)
      return {}
    }
    if (typeof data.scrollTo === 'number') {
      const to = scrollToRow(data.scrollTo, rt.view.max)
      if (to !== t.scroll) await patch($, () => ({ scroll: to }))
      return {}
    }
    if (typeof data.press === 'string') {
      const n = pressedNode(t, data.press)
      if (!n) return {}
      if (t.scroll === null) await patch($, () => ({ scroll: rt.view.from }))
      if (data.ctrl || data.shift) await openNode($, n)
      else await press($, n)
      return {}
    }
    if (typeof data.key !== 'string') return {}
    const act = keyAction(data.key, Boolean(data.shift), t, rt.previewRows)
    if (act.kind === 'patch') await patch($, () => act.patch)
    else if (act.kind === 'toggle') await toggle($, act.node)
    else if (act.kind === 'open') await openNode($, act.node)
    else if (act.kind === 'copy') await copyPath($, act.id, act.absolute, e.surface)
    else if (act.kind === 'closePreview') await closePreview($)
    else if (act.kind === 'scrollPreview') await scrollPreview($, act.by)
    return {}
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      void (async () => {
        await loadTheme($)
        const root = await cwdOf($)
        const t = await get($)
        if (t.root !== root || t.nodes.length === 0) await reset($, root)
      })()
    }
    return { ...result, watchPaths: [...(result.watchPaths ?? []), ...(await gitWatch($, posix(e.cwd)))] }
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    void followCwd($)
    return { ...result, watchPaths: [...(result.watchPaths ?? []), ...(await gitWatch($, posix(e.new_cwd)))] }
  })

  // Only the cwd's own index and HEAD count, and a burst of changes, as a commit makes,
  // settles into one resync 300 ms after the last.
  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    if (rt.gitWatched.includes(posix(e.file_path))) {
      rt.gitSettle?.cancel()
      rt.gitSettle = $.clock.after(300, () => {
        rt.gitSettle = null
        void (async () => {
          if (!(await get($)).top) await detectRepo($)
          await sync($, true)
        })()
      })
    }
    return result
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    void sync($)
    return result
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (rt.nativeScroll) return next(e)
    const t = await get($)
    if (t.preview) {
      await scrollPreview($, wheelStep(e.by))
      return {}
    }
    const to = wheelScroll(e.by, t.scroll, rt.view.from, rt.view.max)
    if (to !== t.scroll) await patch($, () => ({ scroll: to }))
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    void settleBackground($, e.text)
    if (!(await followCwd($))) void sync($)
    const t = await get($)
    const context = [...(e.context ?? [])]
    if (t.selected && (await exists($, t.selected))) context.push(selectedContext(t.selected))
    const mentions = mentionsIn(e.text, t.root, rt.home)
    if (mentions.length) {
      void (async () => {
        const found: string[] = []
        for (const p of mentions) {
          try {
            await $.fs.stat(p)
            found.push(p.replace(/\/$/, ''))
          } catch {
            continue
          }
        }
        if (found.length) await reveal($, found)
      })()
    }
    return next(context.length ? { ...e, context } : e)
  })

  on('prompt.attachment', async ($, e, next) => {
    void settleBackground($, e.text)
    return next(e)
  })

  on('ui.press', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const run = e.surface === 'desktop' ? rt.routePress(e.element) : undefined
    if (!run) return next(e)
    run()
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const vp = e.viewport
    const cramped = e.surface === 'terminal' && rt.autoDock && vp !== undefined && (vp.isFullscreen === false || vp.columns < MIN_COLUMNS)
    if (e.surface === 'terminal' && vp !== undefined) rt.autoDock = false
    if (e.surface === 'terminal' && (e.props.placement === 'inline' || cramped)) {
      rt.noDock = true
      void $.ui.close({ id: PANE }).catch(() => undefined)
      const { Box: Empty } = $.ui.resolve(e)
      return <Empty />
    }
    const unicode = settings.glyphs === 'plain' || (settings.glyphs === 'auto' && (rt.noNerd || e.surface === 'desktop'))
    const { Box, Text, Button, Input, Client } = $.ui.resolve(e)
    const t = await get($)
    const theme: Theme = (await $.state.get(THEME)).value ?? DEFAULT_THEME
    // The desktop tab never hands the wheel or the scrollbar drag to the pane, so
    // there it draws every row and lets the engine scroll the body.
    rt.nativeScroll = e.surface === 'desktop'
    // A translucent accent reads on both of the desktop app's themes; the terminal keeps the theme's selection.
    const rowColors = rt.nativeScroll
      ? { activeBg: `${theme.accent}38`, hoverBg: '#8080801f', tones: SHIMMER_DESKTOP }
      : { activeBg: theme.selection, hoverBg: faint(theme.selection), tones: SHIMMER }
    if (t.preview) {
      if (rt.previewed?.path !== t.preview) await loadPreview($, t.preview)
      const p = rt.previewed
      const markdown = /\.(md|markdown|mdx)$/i.test(t.preview)
      const all = (p?.text ?? '').split('\n').length
      rt.previewRows = rt.nativeScroll ? all : Math.max(4, (e.props.scroll?.bodyRows ?? 40) - (p?.note ? 2 : 1))
      const win = previewLines(p?.text ?? '', rt.nativeScroll ? 0 : Math.min(t.previewTop, Math.max(0, all - rt.previewRows)), rt.previewRows, markdown)
      const name = t.preview !== t.root && inside(t.root, t.preview) ? relative(t.root, t.preview) : shortPath(t.preview)
      if (e.surface === 'desktop') {
        // The desktop page refuses a Code or Markdown drawn inside a Client, so the preview is
        // the pane's own tree there; the app scrolls it natively.
        const whole = p?.text ?? ''
        const cut = cutLines(whole, 1_500 + 2 * JSON.stringify(t.preview).length + JSON.stringify(p?.note ?? '').length)
        const shownLines = cut.split('\n').length - (cut.endsWith('\n') ? 1 : 0)
        const note = [p?.note ?? '', cut.length < whole.length ? `first ${shownLines.toLocaleString('en')} of ${whole.split('\n').length.toLocaleString('en')} lines; Open in app shows the rest` : ''].filter(Boolean).join(' · ')
        const path = t.preview
        const actions = { back: () => void closePreview($), external: () => void openFile($, path, true) }
        rt.routePress = key => (key === 'back' ? actions.back : key === 'external' ? actions.external : undefined)
        return desktopPreview($.ui.resolve(e), { name, note, markdown, text: cut, path }, actions, theme.muted)
      }
      return (
        <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)} backgroundColor={theme.bg || undefined}>
          <Box flexDirection="row">
            <Button key="back" plain label={unicode ? '← files' : '\u{f004d} files'} onPress={() => void closePreview($)} />
            <Text> </Text>
            <Box flexShrink={1} flexGrow={1}>
              <Text bold wrap="truncate-start">{name}</Text>
            </Box>
            <Button key="external" plain dimColor label="Open in app ↗" onPress={() => void openFile($, t.preview, true)} />
          </Box>
          {p?.note ? <Text dimColor>{p.note}</Text> : null}
          <Client
            key="rows"
            module="./rows.tsx"
            props={{ rows: [], active: '', ...rowColors, pointer: false, preview: { text: win.text, path: t.preview, startLine: win.top + 1, markdown } } satisfies RowsProps}
          />
        </Box>
      )
    }
    const now = await $.clock.now()
    const live = (await activities($)).filter(a => now - a.at < (a.state === 'running' ? RUNNING_MAX_MS : ACTIVITY_TTL_MS))
    const latest = [...live].reverse().find(a => a.state === 'running') ?? live[live.length - 1]
    const bright = new Set(t.flashOn ? t.flash : [])
    const dimmed = new Set(t.flashOn ? t.flashDim : [])
    const ignored = new Set(t.ignored)
    const untracked = new Set(t.untrackedDirs)
    const width = Math.max(24, e.props.bodyColumns)
    const rows = rowsOf(t)
    const fixed = 2 + (t.top ? (t.branch ? 1 : 0) : 1) + (t.selected || latest ? 1 : 0)
    const room = rt.nativeScroll ? Math.max(1, rows.length) : Math.max(5, (e.props.scroll?.bodyRows ?? 40) - fixed)
    const isLit = (id: string) => bright.has(id) || dimmed.has(id)
    const focus = settings.followClaude && t.flashOn ? ([...t.flash].reverse().find(id => id !== BRANCH_ROW) ?? t.cursor) : t.cursor
    const at = Math.max(0, rows.findIndex(r => r.node.id === focus))
    const lit = settings.followClaude && t.flashOn ? rows.findIndex(r => isLit(r.node.id)) : -1
    const cap = Math.max(1, Math.floor(room / 3))
    let from = Math.max(0, Math.min(lit >= 0 && at - lit < room - 2 ? Math.max(0, lit - 1) : at - Math.floor(room / 2), rows.length - room))
    let pinned = !rt.nativeScroll && settings.followClaude && t.flashOn ? rows.slice(0, from).filter(r => isLit(r.node.id)).slice(-cap) : []
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
    rt.view = { from, max }
    const shown = rows.slice(from, from + room - pinned.length)
    if (t.showSize) wantSizes($, [...pinned, ...shown].filter(r => r.node.kind === 'dir' && !(r.node.id in t.dirSizes)).map(r => r.node.id))
    const totals: [number, number] = t.top ? (t.diff[t.root] ?? [0, 0]) : [0, 0]
    const countSegs = (c: [number, number, number] | undefined): Seg[] => {
      if (!c) return []
      const out: Seg[] = []
      if (c[0] > 0) out.push({ t: ` ?:${c[0]}`, c: GIT_COLOR['?'] ?? ADD_COLOR })
      if (c[1] > 0) out.push({ t: ` M:${c[1]}`, c: GIT_COLOR.M ?? '#e5c07b' })
      if (c[2] > 0) out.push({ t: ` D:${c[2]}`, c: theme.urgent })
      return out
    }
    const rootCounts = t.top ? countSegs(t.counts[t.root]) : []
    const header = t.top ? [t.top.split('/').pop() ?? t.top, t.prefix.replace(/\/$/, '')].filter(Boolean).join('/') : t.root.split('/').pop() || t.root

    const rowSpec = (r: (typeof rows)[number]): RowSpec => {
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
      const dirCounts = n.kind === 'dir' ? countSegs(t.counts[n.id]) : []
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

    const note = (text: string): RowSpec => ({ id: '', left: [{ t: text, c: theme.muted }], right: [] })
    const specs: RowSpec[] = [
      ...(rows.length === 0 ? [note('empty')] : []),
      ...pinned.map(rowSpec),
      ...(pinned.length > 0 ? [note('  ⋮')] : []),
      ...shown.map(rowSpec),
    ]
    if (rt.nativeScroll) capRows(specs, Math.max(0, specs.findIndex(s => s.id === t.cursor)), note)
    const barSize = Math.max(1, Math.round((specs.length * shown.length) / Math.max(1, rows.length)))
    const bar =
      !rt.nativeScroll && rows.length > shown.length + pinned.length
        ? { pos: max ? Math.round((from / max) * (specs.length - barSize)) : 0, size: barSize, thumb: theme.accent, track: theme.muted }
        : undefined

    const branchRow = () => {
      if (!t.top || !t.branch) return null
      const b = t.branch
      const isFlash = bright.has(BRANCH_ROW)
      const tone = t.flashTones[BRANCH_ROW] ?? 'teal'
      const label = b.head
      return (
        <Box flexDirection="row" height={1} overflow="hidden">
          <Box flexDirection="row" flexShrink={0}>
            <Text color={isFlash ? (TONES[tone]?.solid ?? theme.accent) : theme.accent}>{(unicode ? BRANCH_ICON.plain : BRANCH_ICON.nerd) + ' '}</Text>
            <Text bold color={isFlash ? (TONES[tone]?.solid ?? (theme.fg || undefined)) : theme.fg || undefined}>
              {label}
            </Text>
            {b.ahead > 0 && <Text color={TONES.teal?.solid}>{` ↑${b.ahead}`}</Text>}
            {b.behind > 0 && <Text color={TONES.blue?.solid}>{` ↓${b.behind}`}</Text>}
          </Box>
          {b.upstream && (
            <Box flexShrink={1} overflow="hidden">
              <Text color={theme.muted} wrap="truncate-end">
                {` ${b.upstream}`}
              </Text>
            </Box>
          )}
          <Box flexGrow={1} />
          <Box flexDirection="row" flexShrink={0}>
            {totals[0] > 0 && <Text color={ADD_COLOR}>{` +${totals[0]}`}</Text>}
            {totals[1] > 0 && <Text color={DEL_COLOR}>{` -${totals[1]}`}</Text>}
            {rootCounts.map(c => (
              <Text color={c.c}>{c.t}</Text>
            ))}
            {rootCounts.length === 0 && totals[0] === 0 && totals[1] === 0 && <Text color={theme.muted}> clean</Text>}
          </Box>
        </Box>
      )
    }

    const rel = (p: string) => (p !== t.root && inside(t.root, p) ? p.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : shortPath(p))
    const tree = (
      <Client
        key="rows"
        module="./rows.tsx"
        props={{ rows: specs, active: t.cursor, ...rowColors, pointer: rt.pointer, ...(bar ? { bar } : {}) } satisfies RowsProps}
      />
    )

    if (e.surface === 'desktop') {
      const log = await claudeLog($)
      const where = (p: string) => {
        const d = dirname(p)
        return d === t.root || !inside(t.root, d) ? (d === t.root ? 'in project root' : `in ${shortPath(d)}`) : `in ${rel(d)}`
      }
      const card = cardOf(log.now, latest ?? log.git, where)
      const c = t.counts[t.root] ?? [0, 0, 0]
      const changed = c[0] + c[1] + c[2]
      const summary = !t.top
        ? { text: '', add: 0, del: 0 }
        : changed === 0 && totals[0] === 0 && totals[1] === 0
          ? { text: 'clean, nothing changed', add: 0, del: 0 }
          : { text: changed ? `${changed} changed` : 'changed', add: totals[0], del: totals[1] }
      const mine = log.touched.filter(x => inside(t.root, x.path) && x.path !== t.root)
      const model: DesktopModel = {
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
        muted: theme.muted,
      }
      const openTouch = (path: string) =>
        void (async () => {
          if (!(await exists($, path))) return
          await reveal($, [path])
          await patch($, () => ({ selected: path, cursor: path }))
        })()
      rt.routePress = key => (key.startsWith('touch:') ? () => openTouch(key.slice(6)) : undefined)
      return desktopPane(
        $.ui.resolve(e),
        model,
        {
          search: v => void search($, v),
          jump: v => void jump($, v),
          setView: v => void patch($, () => ({ view: v, scroll: null })),
          openTouch,
        },
        tree,
      )
    }

    const chip = (a: Activity) => {
      const tone = a.state === 'failed' ? 'red' : a.tone
      const color = TONES[tone]?.solid ?? theme.accent
      const icon = unicode ? a.plain : a.nerd
      const hash = a.state === 'done' && a.kind === 'git commit' ? a.detail.split(' ')[0] ?? '' : ''
      return (
        <Box flexDirection="row" marginLeft={2}>
          <Text color={color}>{icon + ' '}</Text>
          <Text bold={a.state === 'running'} color={color}>
            {a.state === 'running' ? `${a.label}…` : a.label}
          </Text>
          {hash && <Text color={theme.muted}>{` ${hash}`}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" minHeight={Math.max(1, e.props.scroll?.bodyRows ?? 1)} backgroundColor={theme.bg || undefined}>
        <Box flexDirection="row">
          <Text bold color={theme.accent} wrap="truncate-start">
            {header}
          </Text>
        </Box>
        {branchRow()}
        {!t.top && <Text color={theme.muted}>{unicode ? '± ' : '\u{e702} '}no git repo · git status starts after git init</Text>}
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Input
              key="q"
              label="/ "
              placeholder="search"
              submitLabel="jump"
              autoFocus
              value={t.query}
              onInput={(v: string) => void search($, v)}
              onSubmit={(v: string) => void jump($, v)}
            />
          </Box>
          {t.query ? <Button key="clear" plain dimColor label={unicode ? '×' : '\u{f0156}'} onPress={() => void search($, '')} /> : null}
        </Box>
        {tree}
        <Box flexGrow={1} />
        {(t.selected || latest) && (
          <Box flexDirection="row">
            {t.selected ? (
              <Box flexShrink={1}>
                <Text dimColor wrap="truncate-start">
                  selected: {t.selected !== t.root && inside(t.root, t.selected) ? t.selected.slice(t.root.endsWith('/') ? t.root.length : t.root.length + 1) : shortPath(t.selected)}
                </Text>
              </Box>
            ) : null}
            <Box flexGrow={1} />
            {latest && chip(latest)}
          </Box>
        )}
      </Box>
    )
  })
}
