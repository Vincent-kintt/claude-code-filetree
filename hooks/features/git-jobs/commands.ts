import { segments, stripGlobals } from '../../core/shell'
import { BRANCH_ICON } from '../../ui/tones'
import { READERS } from '../reads/model'

export type GitAction = {
  kind: string
  verb: string
  running: string
  done: string
  tone: string
  icon: { nerd: string; plain: string }
  init?: boolean
  // What `git add` named, or absent when it stages everything (`.`, -A, -u or a glob).
  paths?: string[]
}

const ICON = {
  commit: { nerd: '\u{f417}', plain: '●' },
  push: { nerd: '\u{f0552}', plain: '↑' },
  pull: { nerd: '\u{f0553}', plain: '↓' },
  branch: BRANCH_ICON,
  merge: { nerd: '\u{f419}', plain: '⑃' },
  pr: { nerd: '\u{f407}', plain: '⇄' },
  github: { nerd: '\u{f408}', plain: '◎' },
  stash: { nerd: '\u{f01bc}', plain: '≡' },
  undo: { nerd: '\u{f054c}', plain: '↶' },
  tag: { nerd: '\u{f412}', plain: '⌖' },
  git: { nerd: '\u{e702}', plain: '±' },
}

const GIT_VERBS: Record<string, Omit<GitAction, 'kind'>> = {
  commit: { verb: 'commit', running: 'committing', done: 'committed', tone: 'green', icon: ICON.commit },
  push: { verb: 'push', running: 'pushing', done: 'pushed', tone: 'teal', icon: ICON.push },
  pull: { verb: 'pull', running: 'pulling', done: 'pulled', tone: 'blue', icon: ICON.pull },
  fetch: { verb: 'fetch', running: 'fetching', done: 'fetched', tone: 'blue', icon: ICON.pull },
  checkout: { verb: 'checkout', running: 'checking out', done: 'checked out', tone: 'blue', icon: ICON.branch },
  switch: { verb: 'switch', running: 'switching', done: 'switched', tone: 'blue', icon: ICON.branch },
  branch: { verb: 'branch', running: 'branching', done: 'branched', tone: 'blue', icon: ICON.branch },
  merge: { verb: 'merge', running: 'merging', done: 'merged', tone: 'purple', icon: ICON.merge },
  rebase: { verb: 'rebase', running: 'rebasing', done: 'rebased', tone: 'purple', icon: ICON.merge },
  'cherry-pick': { verb: 'cherry-pick', running: 'cherry-picking', done: 'cherry-picked', tone: 'purple', icon: ICON.merge },
  stash: { verb: 'stash', running: 'stashing', done: 'stashed', tone: 'orange', icon: ICON.stash },
  reset: { verb: 'reset', running: 'resetting', done: 'reset', tone: 'red', icon: ICON.undo },
  restore: { verb: 'restore', running: 'restoring', done: 'restored', tone: 'red', icon: ICON.undo },
  revert: { verb: 'revert', running: 'reverting', done: 'reverted', tone: 'red', icon: ICON.undo },
  add: { verb: 'add', running: 'staging', done: 'staged', tone: 'green', icon: ICON.git },
  rm: { verb: 'rm', running: 'removing', done: 'removed', tone: 'red', icon: ICON.git },
  mv: { verb: 'mv', running: 'moving', done: 'moved', tone: 'orange', icon: ICON.git },
  tag: { verb: 'tag', running: 'tagging', done: 'tagged', tone: 'purple', icon: ICON.tag },
  init: { verb: 'init', running: 'initialising', done: 'initialised', tone: 'green', icon: ICON.git, init: true },
  clone: { verb: 'clone', running: 'cloning', done: 'cloned', tone: 'blue', icon: ICON.pull, init: true },
}

const GH_VERBS: Record<string, Omit<GitAction, 'kind'>> = {
  'pr create': { verb: 'pr create', running: 'opening PR', done: 'opened PR', tone: 'purple', icon: ICON.pr },
  'pr merge': { verb: 'pr merge', running: 'merging PR', done: 'merged PR', tone: 'purple', icon: ICON.merge },
  'pr checkout': { verb: 'pr checkout', running: 'checking out PR', done: 'checked out PR', tone: 'blue', icon: ICON.pr },
  'pr comment': { verb: 'pr comment', running: 'commenting on PR', done: 'commented on PR', tone: 'purple', icon: ICON.pr },
  'pr review': { verb: 'pr review', running: 'reviewing PR', done: 'reviewed PR', tone: 'purple', icon: ICON.pr },
  'repo clone': { verb: 'repo clone', running: 'cloning', done: 'cloned', tone: 'blue', icon: ICON.github, init: true },
  'release create': { verb: 'release create', running: 'releasing', done: 'released', tone: 'purple', icon: ICON.tag },
  'issue create': { verb: 'issue create', running: 'opening issue', done: 'opened issue', tone: 'purple', icon: ICON.github },
}

const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'describe', 'config', 'remote', 'reflog', 'shortlog', 'help', 'version', 'check-ignore'])

function gitVerb(tokens: string[]): number {
  let i = 1
  while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '-c') i++
    i++
  }
  return i
}

function gitReadOnly(verb: string, rest: string[]): boolean {
  if (!verb || READ_ONLY_GIT.has(verb)) return true
  if (verb === 'stash') return ['list', 'show'].includes(rest[0] ?? '')
  if (verb === 'branch') return rest.every(t => t.startsWith('-'))
  if (verb === 'tag') return rest.length === 0 || rest.some(t => /^(-l|--list|-n\d*|--contains|--points-at|--merged|--no-merged|-v|--verify)$/.test(t))
  return false
}

export function chainOf(command: string): { size: number; and: boolean } {
  const seps: string[] = []
  const size = segments(command, seps).length
  return { size, and: seps.every(s => s === '&&') }
}

function addPaths(rest: string[]): { paths?: string[] } {
  if (rest.some(t => /^(-A|--all|-u|--update|--pathspec-from-file.*)$/.test(t))) return {}
  const named = rest.filter(t => !t.startsWith('-')).map(t => t.replace(/^["']|["']$/g, ''))
  return named.length && !named.some(t => t === '.' || /[*?[]/.test(t)) ? { paths: named } : {}
}

export function gitActions(command: string): GitAction[] {
  const out: GitAction[] = []
  for (const raw of segments(command)) {
    const tokens = stripGlobals(raw)
    const head = tokens[0]?.split('/').pop()
    if (head === 'git') {
      const i = gitVerb(tokens)
      const verb = tokens[i] ?? ''
      const rest = tokens.slice(i + 1)
      if (gitReadOnly(verb, rest)) continue
      const spec = verb === 'checkout' && rest.includes('--') ? GIT_VERBS.restore : GIT_VERBS[verb]
      if (spec) out.push({ kind: `git ${verb}`, ...spec, ...(verb === 'add' ? addPaths(rest) : {}) })
    } else if (head === 'gh') {
      const pair = `${tokens[1] ?? ''} ${tokens[2] ?? ''}`
      const spec = GH_VERBS[pair]
      if (spec) out.push({ kind: `gh ${pair}`, ...spec })
    }
  }
  return out
}

const WRITE_FLAGS = /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls|x|X|-exec|-exec-batch)$/

export function readOnly(command: string): boolean {
  const bare = ` ${command}`.replace(/\d*>&\d/g, ' ').replace(/(\d*|&)>>?\s*\/dev\/null/g, ' ')
  if (/[^>]>[^>&]|>>/.test(bare)) return false
  return segments(command).every(raw => {
    const tokens = stripGlobals(raw)
    const head = tokens[0]?.split('/').pop() ?? ''
    if (head === 'cd' || head === 'echo' || head === 'printf' || head === 'true' || head === 'pwd') return true
    if (head === 'git') {
      const i = gitVerb(tokens)
      return gitReadOnly(tokens[i] ?? '', tokens.slice(i + 1))
    }
    if (head === 'sed') return !tokens.some(t => /^-i/.test(t))
    if (head === 'find' || head === 'fd' || head === 'fdfind') return !tokens.some(t => WRITE_FLAGS.test(t))
    return READERS.has(head)
  })
}

