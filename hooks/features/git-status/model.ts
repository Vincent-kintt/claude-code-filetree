import type { Branch, FileTree } from '../../../types'
import { dirname, join, mapper } from '../../core/paths'
import { stronger } from '../../ui/icons'

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

/** `git rev-parse --show-prefix --show-toplevel` output: blank when not in a repo. */
export function parseRevParse(exitCode: number, stdout: string): { top: string; prefix: string } {
  const [p = '', tl = ''] = exitCode === 0 ? stdout.split('\n') : []
  return { top: tl.trim(), prefix: p.trim() }
}

export function parseHead(exitCode: number, stdout: string): string {
  return exitCode === 0 ? stdout.trim() : ''
}

/** The ls-files argv that lists the files inside untracked dirs. */
export function othersArgs(untrackedDirs: string[], root: string): string[] {
  return ['ls-files', '-o', '--exclude-standard', '-z', '--', ...untrackedDirs.map(d => d.slice(root.length + 1) || '.')]
}

/**
 * Status, numstat and ls-files output folded into the dirty files and the tree's git patch.
 * `numstat` and `others` are null when their command failed or did not run.
 */
export function assembleGit(parsed: GitStatus, numstat: string | null, others: string | null, root: string, prefix: string): { files: Record<string, Change>; patch: Partial<FileTree> } {
  const diff: Record<string, [number, number]> = {}
  if (numstat !== null) parseNumstat(numstat, root, prefix, diff)
  const files = { ...parsed.files }
  if (others !== null) for (const rel of others.split('\0').filter(Boolean)) files[join(root, rel)] = 'new'
  for (const path of Object.keys(diff)) if (files[path] === 'new') delete diff[path]
  return {
    files,
    patch: {
      git: parsed.git,
      ignored: parsed.ignored,
      untrackedDirs: parsed.untrackedDirs,
      branch: parsed.branch,
      counts: rollCounts(files, root),
      changes: files,
      diff: rollUp(diff, root),
    },
  }
}

export function gitPathsArgs(committed: boolean): string[] {
  return committed ? ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD', '--', '.'] : ['diff', '--cached', '--name-only', '-z', '--', '.']
}

export function mapGitPaths(stdout: string, root: string, prefix: string): string[] {
  const map = mapper(root, prefix)
  return stdout.split('\0').filter(Boolean).flatMap(rel => map(rel) ?? [])
}

/** The target of a `.git` file's `gitdir:` line, as written. */
export function gitdirRef(text: string): string | undefined {
  return /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
}

// Outside a repo the cwd's own .git is watched, so a git init there is seen as it lands.
export function watchFiles(gd: string, cwd: string): string[] {
  const dir = gd || join(cwd, '.git')
  return [join(dir, 'index'), join(dir, 'HEAD')]
}
