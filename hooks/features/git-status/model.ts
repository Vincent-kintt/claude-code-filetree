import type { FileTree } from '../../../types'
import { type Change, type GitStatus, join, mapper, parseNumstat, rollCounts, rollUp } from '../../tree'

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
