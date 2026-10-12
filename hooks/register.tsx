import { type EngineInterface, type Register, type ResultOf, update } from 'claude-code'

import type { Activity, ClaudeLog, FileNode, FileTree, Now, Theme, Touch } from '../types'
import { desktopPane, desktopPreview } from './desktop'
import { desktopModel } from './features/desktop/model'
import { desktopText, previewWindow, scrollTop, shapePreview } from './features/preview/model'
import { terminalPreview } from './features/preview/view'
import { latestActivity, rowColors, treeModel, treeView } from './features/tree/model'
import { terminalPane } from './features/tree/view'
import { type GitAction, gitActions, readOnly, readTargets, resolve } from './git'
import type { RowsProps } from './rows'
import { VERSION } from './version'
import {
  type Change,
  DEFAULT_THEME,
  dirname,
  drivesOn,
  emptyTree,
  formatSize,
  inside,
  join,
  parseGit,
  parseTheme,
  posix,
  useDrives,
  replaceChildren,
  toNodes,
} from './tree'
import {
  ACTIVITY_TTL_MS,
  BRANCH_ROW,
  FLASH_MS,
  MIN_COLUMNS,
  NO_REPO_DEPTH,
  PANE,
  READ_REVEAL_LIMIT,
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
import { changedArgv, dirtySplit, foundPaths, markPath, scopedIgnored } from './features/changes/model'
import { assembleGit, gitdirRef, gitPathsArgs, mapGitPaths, othersArgs, parseHead, parseRevParse, watchFiles } from './features/git-status/model'
import { entryOf, freshListings, linkEntry, listError, missingDirs, openDirs } from './features/listing/model'
import { copyText, openFailed, openPlan, openSetting, pressOf, togglePatch } from './features/open/model'
import { findFilesArgv, indexedPaths, listDepth, matches, searchTerm, staleDirs, walkSkip } from './features/search/model'
import { enqueue, keptSizes, parseDu, SIZE_JOBS, SIZE_TIMEOUT_MS, sizePatch, stillWanted, tallyDir } from './features/sizes/model'

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

async function list($: EngineInterface, dir: string): Promise<FileNode[] | null> {
  try {
    const entries = await $.fs.list(dir)
    const resolved = await Promise.all(
      entries.map(async e => {
        if (!e.isLink) return entryOf(e)
        try {
          return linkEntry(e.name, await $.fs.stat(join(dir, e.name)))
        } catch {
          return linkEntry(e.name, null)
        }
      }),
    )
    rt.unreadable.delete(dir)
    return toNodes(dir, resolved)
  } catch (err) {
    if (!(await exists($, dir))) return []
    if (!rt.unreadable.has(dir)) {
      rt.unreadable.add(dir)
      $.ui.toast(listError(shortPath(dir), err))
    }
    return null
  }
}

async function loadDirs($: EngineInterface, dirs: string[]): Promise<Map<string, FileNode[]>> {
  const root = (await get($)).root
  const seq = ++rt.listSeq
  for (const dir of dirs) rt.listLatest.set(dir, seq)
  const results = await Promise.all(dirs.map(async dir => [dir, await list($, dir)] as const))
  const { listed, done } = freshListings(results, rt.listLatest, seq)
  for (const dir of done) rt.listLatest.delete(dir)
  await patch($, t => (t.root === root ? { nodes: replaceChildren(t.nodes, listed) } : {}))
  return listed
}

async function detectRepo($: EngineInterface): Promise<void> {
  const t = await get($)
  if (!t.root) return
  let found = { top: '', prefix: '' }
  try {
    const run = await git($, t.root, ['rev-parse', '--show-prefix', '--show-toplevel'], 5_000)
    found = parseRevParse(run.exitCode, run.stdout)
  } catch {
    // No git: not a repo.
  }
  const { top, prefix } = found
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
    const head = await git($, root, ['diff', 'HEAD', '--numstat', '-z', '--', '.'])
    const others = parsed.untrackedDirs.length ? await git($, root, othersArgs(parsed.untrackedDirs, root)) : null
    const { files, patch: found } = assembleGit(parsed, head.exitCode === 0 ? head.stdout : null, others?.exitCode === 0 ? others.stdout : null, root, t.prefix)
    rt.dirty = { root, files }
    await patch($, cur => (cur.root === root ? found : {}))
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
    const need = missingDirs(await get($), paths, tried)
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
  try {
    const run = await $.process.run(changedArgv(root, since, depth, pruneArgs(root, scopedIgnored(root, ignored))), { timeoutMs: 8_000 })
    return foundPaths(run.stdout, root)
  } catch {
    return []
  }
}

async function changedInRepo($: EngineInterface, root: string, since: Since, before: Record<string, Change>, ignored: string[]): Promise<{ hits: string[]; gone: string[] }> {
  if (since.os !== 'win32') return { hits: await changedSince($, root, since, 0, ignored), gone: [] }
  const split = dirtySplit(rt.dirty, root, before)
  if (!split) return { hits: [], gone: [] }
  return { hits: await newer($, split.live, since.ms), gone: split.gone }
}

async function sinceNow($: EngineInterface, writes: boolean): Promise<Since> {
  const ms = await $.clock.now()
  const os = await osName($)
  if (os !== 'darwin' || !writes) return { ms, mark: '', os }
  const mark = markPath((await $.env.get('TMPDIR')) || '', await $.session.id(), ++rt.markId)
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
      const counted = tallyDir(d, entries, seen)
      if (!counted) return -1
      seen = counted.seen
      total += counted.bytes
      next.push(...counted.dirs)
    }
    level = next
  }
  return total
}

async function dirSize($: EngineInterface, dir: string): Promise<number> {
  if (rootOfDisk(dir)) return -1
  if ((await osName($)) === 'win32') return walkSize($, dir)
  try {
    return parseDu((await $.process.run(['du', '-skxH', dir], { timeoutMs: SIZE_TIMEOUT_MS })).stdout)
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
        if (epoch === rt.sizeEpoch) return patch($, cur => sizePatch(cur, dir, bytes))
        if (stillWanted(await get($), dir, rt.sizeQueue)) rt.sizeQueue.push(dir)
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
  rt.sizeQueue = enqueue(rt.sizeQueue, rt.sizing, dirs)
  pumpSizes($)
}

async function staleSizes($: EngineInterface, paths?: string[]): Promise<void> {
  rt.sizeEpoch += 1
  rt.sizeQueue = []
  await patch($, cur => ({ dirSizes: keptSizes(cur.dirSizes, paths) }))
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
    return parseHead(run.exitCode, run.stdout)
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
  try {
    const run = await git($, root, gitPathsArgs(committed), 5_000)
    return run.exitCode === 0 ? mapGitPaths(run.stdout, root, prefix) : []
  } catch {
    return []
  }
}

async function gitWatch($: EngineInterface, cwd: string): Promise<string[]> {
  rt.gitWatched = watchFiles(await gitDir($, cwd), cwd)
  return rt.gitWatched
}

async function gitDir($: EngineInterface, cwd: string): Promise<string> {
  for (let dir = cwd, i = 0; i < 64; i++) {
    try {
      const dot = join(dir, '.git')
      const st = await $.fs.stat(dot)
      if (st.kind === 'dir') return dot
      const ref = gitdirRef(String(await $.fs.read(dot)))
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
  const text = copyText(t.root, id, absolute)
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
  const skip = walkSkip(broad(root))
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
    if (!t.top && (await osName($)) === 'win32') return await walk($, t.root, listDepth(rootOfDisk(t.root)), 20_000)
    const run = t.top
      ? await git($, t.root, ['ls-files', '-co', '--exclude-standard', '-z'], 10_000)
      : await $.process.run(findFilesArgv(t.root, rootOfDisk(t.root), pruneArgs(t.root)), { timeoutMs: 10_000 })
    if (t.top && run.exitCode !== 0) return null
    return indexedPaths(run.stdout, !!run.isStdoutTruncated, t.root)
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
  const q = searchTerm(query)
  if (!q) return []
  const t = await get($)
  const hits = matches(await indexPaths($, t), t.root, q)
  if ((await get($)).query !== query) return []
  await revealPaths($, hits)
  const shown = await get($)
  const stale = staleDirs(hits, new Set(shown.nodes.map(n => n.id)), shown.root)
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
  rt.previewed = { path, ...shapePreview(text, note) }
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
  const top = scrollTop(rt.previewed?.text, rt.previewRows, t.previewTop, by)
  if (top !== t.previewTop) await patch($, () => ({ previewTop: top }))
}

async function openFile($: EngineInterface, path: string, external = false): Promise<void> {
  const setting = openSetting(settings.openWith)
  if (!external && setting === 'preview') return showPreview($, path)
  const { argv, init, tool } = openPlan(await osName($), setting, external, path)
  try {
    const run = await $.process.run(argv, init)
    if (run.exitCode !== 0) $.ui.toast(openFailed(path, tool, run))
  } catch {
    $.ui.toast(openFailed(path, tool))
  }
}

async function toggle($: EngineInterface, n: FileNode): Promise<void> {
  if (n.kind === 'dir' && !(await get($)).expanded.includes(n.id)) await loadDirs($, [n.id])
  await patch($, t => togglePatch(t, n))
}

async function press($: EngineInterface, n: FileNode): Promise<void> {
  const { isDouble, last } = pressOf(rt.lastPress, n.id, await $.clock.now())
  rt.lastPress = last
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
    const { Client } = $.ui.resolve(e)
    const t = await get($)
    const theme: Theme = (await $.state.get(THEME)).value ?? DEFAULT_THEME
    // The desktop tab never hands the wheel or the scrollbar drag to the pane, so
    // there it draws every row and lets the engine scroll the body.
    rt.nativeScroll = e.surface === 'desktop'
    const colors = rowColors(theme, rt.nativeScroll)
    const bodyRows = e.props.scroll?.bodyRows
    if (t.preview) {
      if (rt.previewed?.path !== t.preview) await loadPreview($, t.preview)
      const p = rt.previewed
      const path = t.preview
      const w = previewWindow(path, t.root, p?.text ?? '', p?.note ?? '', t.previewTop, bodyRows, rt.nativeScroll)
      rt.previewRows = w.rows
      const actions = { back: () => void closePreview($), external: () => void openFile($, path, true) }
      if (e.surface === 'desktop') {
        // The desktop page refuses a Code or Markdown drawn inside a Client, so the preview is
        // the pane's own tree there; the app scrolls it natively.
        const cut = desktopText(path, p?.text ?? '', p?.note ?? '')
        rt.routePress = key => (key === 'back' ? actions.back : key === 'external' ? actions.external : undefined)
        return desktopPreview($.ui.resolve(e), { name: w.name, note: cut.note, markdown: w.markdown, text: cut.text, path }, actions, theme.muted)
      }
      const lines = (
        <Client
          key="rows"
          module="./rows.tsx"
          props={{ rows: [], active: '', ...colors, pointer: false, preview: { text: w.win.text, path, startLine: w.win.top + 1, markdown: w.markdown } } satisfies RowsProps}
        />
      )
      return terminalPreview($.ui.resolve(e), { name: w.name, note: p?.note ?? '', unicode, minHeight: Math.max(1, bodyRows ?? 1), bg: theme.bg }, actions, lines)
    }
    const now = await $.clock.now()
    const latest = latestActivity(await activities($), now)
    const view = treeView({ t, theme, unicode, width: Math.max(24, e.props.bodyColumns), bodyRows, nativeScroll: rt.nativeScroll, followClaude: settings.followClaude, latest })
    rt.view = { from: view.from, max: view.max }
    if (view.sizes) wantSizes($, view.sizes)
    const tree = (
      <Client
        key="rows"
        module="./rows.tsx"
        props={{ rows: view.specs, active: t.cursor, ...colors, pointer: rt.pointer, ...(view.bar ? { bar: view.bar } : {}) } satisfies RowsProps}
      />
    )

    if (e.surface === 'desktop') {
      const model = desktopModel(t, await claudeLog($), latest, view.totals, view.header, theme.muted)
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

    const model = treeModel(t, view, theme, unicode, latest, bodyRows)
    return terminalPane($.ui.resolve(e), model, { search: v => void search($, v), jump: v => void jump($, v), clear: () => void search($, '') }, tree)
  })
}
