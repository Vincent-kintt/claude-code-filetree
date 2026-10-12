import type { Now } from '../../../types'
import { drivesOn, posix, resolve } from '../../core/paths'
import { segments, stripGlobals } from '../../core/shell'

export const READERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind', 'cat', 'head', 'tail', 'bat', 'less', 'more', 'ls', 'eza', 'tree', 'wc', 'sed', 'awk', 'jq'])
const PATTERN_FIRST = new Set(['rg', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'jq'])
const OUTPUT_PATHS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind'])

/** The files a Grep or Glob result lists; Grep in content mode lists none, so its lines' path prefixes stand in. */
export function searchNames(result: unknown, drives: boolean): string[] {
  const out = result as { filenames?: unknown; content?: unknown }
  const names = Array.isArray(out.filenames) ? out.filenames.filter((x): x is string => typeof x === 'string') : []
  if (!names.length && typeof out.content === 'string')
    for (const line of out.content.split('\n').slice(0, 400)) {
      const path = posix(line).match(drives ? /^((?:[A-Za-z]:)?[^:\0]+?):\d+[:-]/ : /^([^:\0]+?):\d+[:-]/)?.[1]
      if (path) names.push(path)
    }
  return names
}

export function searchReads(names: string[], cwd: string, home: string): string[] {
  return [...new Set(names.map(n => resolve(cwd, n, home)))].slice(0, 60)
}

export function reading(path: string, state: Now['state']): Omit<Now, 'at'> {
  return { verb: 'read', state, path, count: 1, detail: '' }
}

export function readTargets(command: string, sessionCwd: string, stdout: string, home = ''): string[] {
  let cwd = sessionCwd
  const out = new Set<string>()
  let listsPaths = false
  for (const raw of segments(command)) {
    const tokens = stripGlobals(raw).map(t => posix(t.replace(/^["']|["']$/g, '')))
    const head = tokens[0]?.split('/').pop() ?? ''
    if (head === 'cd' && tokens[1]) {
      cwd = resolve(cwd, tokens[1], home)
      continue
    }
    if (!READERS.has(head)) continue
    if (head === 'sed' && tokens.some(t => /^-i/.test(t))) continue
    if (OUTPUT_PATHS.has(head)) listsPaths = true
    const args = tokens.slice(1)
    let skipPattern = PATTERN_FIRST.has(head) && !args.some(t => t === '-e' || t === '-f' || t === '--files')
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (a.startsWith('-')) {
        if (/^-(e|f|g|t|T|m|A|B|C|-glob|-type|-max-count|name|iname|maxdepth|mindepth)$/.test(a)) i++
        continue
      }
      if (skipPattern) {
        skipPattern = false
        continue
      }
      if (/[*?<>|]/.test(a)) continue
      out.add(resolve(cwd, a, home))
    }
  }
  if (listsPaths) {
    for (const line of stdout.split('\n').slice(0, 400)) {
      const path = posix(line).match(drivesOn() ? /^((?:[A-Za-z]:)?[^:\0]+?)(?::\d+[:-]|$|:)/ : /^([^:\0]+?)(?::\d+[:-]|$|:)/)?.[1]?.trim()
      if (path && !path.includes(' ')) out.add(resolve(cwd, path, home))
    }
  }
  return [...out].slice(0, 60)
}
