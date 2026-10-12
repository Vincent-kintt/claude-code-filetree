import { expect, test } from 'claude-code/testing'

import { TONES } from '../hooks/git'
import { type World, clientIn, world } from './harness'

const root = '/home/k/proj'
type Kids = [string, 'file' | 'dir'][]
const files = (prefix: string, n: number): Kids => Array.from({ length: n }, (_, i) => [`${prefix}${String(i + 1).padStart(2, '0')}.txt`, 'file'])

// The harness answers every other git call with nothing: commits list their files through diff-tree here.
function withCommit(on: any, w: { committed?: string }) {
  return (name: string, fn: any) =>
    on(name, name !== 'process.run' ? fn : async ($: any, e: any) => {
      const argv: string[] = [...e.argv]
      if (argv[0] === 'git' && argv.includes('diff-tree')) return { value: { exitCode: 0, stdout: w.committed ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return fn($, e)
    })
}

async function pane($: any, on: any, dirs: Record<string, Kids>, more: Partial<World> & { committed?: string } = {}) {
  const w: World & { committed?: string } = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs, status: '## main...origin/main\0', numstat: '', ...more }
  const clock = world(withCommit(on, w), w, [])
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: { title: 'Files', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } })
  await clock.settle()
  const rows = async (): Promise<{ id: string; left: { t: string; sh?: string; dim?: boolean; one?: boolean }[] }[]> => clientIn(await ui.drawn()).props.props.rows
  // The tone a row's name shimmers in, bright rows only: a folder opened to reveal a file shimmers dim.
  const tone = async (rel: string) => (await rows()).find(r => r.id === `${root}/${rel}`)?.left.find(s => s.sh && !s.one && !s.dim)?.sh
  const lit = async (sh?: string) => (await rows()).filter(r => r.left.some(s => s.sh && !s.one && !s.dim && (!sh || s.sh === sh))).map(r => r.id.slice(root.length + 1))
  const branch = async () => {
    const m = /"bold":true(?:,"color":"([^"]+)")?\},"children":\["main"\]/.exec(JSON.stringify(await ui.drawn()))
    return Object.entries(TONES).find(([, v]) => v.solid === m?.[1])?.[0]
  }
  const run = async (call: Record<string, unknown>) => {
    await $.tool.call(call as any)
    await clock.settle()
  }
  const calm = async () => {
    await clock.advance(3_000)
    await clock.settle()
  }
  return { w, clock, ui, rows, tone, lit, branch, run, calm }
}

const bash = (command: string) => ({ tool: 'Bash', command })

test('ACT-01: the Read, Grep and Glob tools shimmer what they read or list purple', { timeoutMs: 20_000 }, async ($, on) => {
  const results: Record<string, unknown> = {
    Glob: { filenames: ['src/b.ts'], numFiles: 1, durationMs: 1, truncated: false },
    Grep: { mode: 'files_with_matches', numFiles: 1, filenames: [`${root}/c.ts`] },
  }
  const p = await pane($, on, { [root]: [['src', 'dir'], ['a.txt', 'file'], ['c.ts', 'file']], [`${root}/src`]: [['b.ts', 'file']] }, { tool: (e: any) => ({ result: results[e.tool] ?? { stdout: '', stderr: '' } }) })
  await p.run({ tool: 'Read', file_path: `${root}/a.txt` })
  expect(await p.tone('a.txt')).toBe('purple')
  await p.calm()
  await p.run({ tool: 'Glob', pattern: '**/*.ts' })
  expect(await p.tone('src/b.ts')).toBe('purple')
  await p.calm()
  await p.run({ tool: 'Grep', pattern: 'c' })
  expect(await p.tone('c.ts')).toBe('purple')
  expect(await p.lit()).toEqual(['c.ts'])
  await p.ui.unmount()
})

test('ACT-01: every listed Bash reader shimmers the file it names purple, and sed -i is a write', { timeoutMs: 60_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['f.txt', 'file'], ['g.txt', 'file']] })
  const commands = [
    'rg foo f.txt', 'grep foo f.txt', 'egrep foo f.txt', 'fgrep foo f.txt', 'find f.txt', 'fd foo f.txt', 'fdfind foo f.txt',
    'cat f.txt', 'head f.txt', 'tail f.txt', 'bat f.txt', 'less f.txt', 'more f.txt', 'ls f.txt', 'eza f.txt', 'tree f.txt',
    'wc f.txt', 'sed -n 1p f.txt', 'awk {print} f.txt', 'jq . f.txt',
  ]
  const missed: string[] = []
  for (const c of commands) {
    await p.run(bash(c))
    if ((await p.tone('f.txt')) !== 'purple') missed.push(c)
    await p.calm()
  }
  expect(missed).toEqual([])
  p.w.find = `${root}/g.txt\0`
  await p.run(bash('sed -i s/a/b/ g.txt'))
  expect(await p.tone('g.txt')).toBe('orange')
  await p.ui.unmount()
})

test('ACT-01: rg, grep, egrep, fgrep, find, fd and fdfind shimmer the files they list; other readers do not', { timeoutMs: 60_000 }, async ($, on) => {
  let stdout = ''
  const p = await pane($, on, { [root]: [['src', 'dir'], ['a.txt', 'file'], ['f.txt', 'file']], [`${root}/src`]: [['b.ts', 'file']] }, { tool: () => ({ result: { stdout, stderr: '' } }) })
  const listers: [string, string, string][] = [
    ['rg -l foo', 'src/b.ts\n', 'src/b.ts'],
    ['grep -rn foo .', 'a.txt:3:foo\n', 'a.txt'],
    ['egrep -rl foo .', 'src/b.ts\n', 'src/b.ts'],
    ['fgrep -rn foo .', 'a.txt:1:foo\n', 'a.txt'],
    ['find . -name x', './src/b.ts\n', 'src/b.ts'],
    ['fd -e ts', 'src/b.ts\n', 'src/b.ts'],
    ['fdfind -e txt', 'a.txt\n', 'a.txt'],
  ]
  const missed: string[] = []
  for (const [c, out, want] of listers) {
    stdout = out
    await p.run(bash(c))
    if ((await p.tone(want)) !== 'purple') missed.push(c)
    await p.calm()
  }
  expect(missed).toEqual([])
  stdout = 'a.txt\n'
  await p.run(bash('head f.txt'))
  expect(await p.lit()).toEqual(['f.txt'])
  await p.ui.unmount()
})

test('ACT-01: a Bash read or a search lights at most 12 files, folders included for ls dir', { timeoutMs: 60_000 }, async ($, on) => {
  const names = files('f', 15).map(([n]) => n)
  let stdout = ''
  const p = await pane($, on, { [root]: [['src', 'dir'], ...files('f', 15)], [`${root}/src`]: [['b.ts', 'file']] }, {
    tool: (e: any) => ({ result: e.tool === 'Glob' ? { filenames: names, numFiles: 15, durationMs: 1, truncated: false } : { stdout, stderr: '' } }),
  })
  await p.run(bash(`cat ${names.join(' ')}`))
  expect((await p.lit('purple')).length).toBe(12)
  await p.calm()
  stdout = names.join('\n')
  await p.run(bash('rg -l foo'))
  expect((await p.lit('purple')).length).toBe(12)
  await p.calm()
  await p.run({ tool: 'Glob', pattern: '*.txt' })
  expect((await p.lit('purple')).length).toBe(12)
  await p.calm()
  stdout = ''
  await p.run(bash(`ls src ${names.join(' ')}`))
  const shown = await p.lit('purple')
  expect(shown.length).toBe(12)
  expect(shown).toContain('src')
  await p.ui.unmount()
})

test('ACT-01: each Read lights its own file, past 12, and writes have no cap of 12', { timeoutMs: 60_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [...files('f', 15), ...files('w', 15), ...files('b', 15)] })
  for (const [n] of files('f', 15)) await p.run({ tool: 'Read', file_path: `${root}/${n}` })
  expect((await p.lit('purple')).length).toBe(15)
  await p.calm()
  for (const [n] of files('w', 15)) await p.run({ tool: 'Edit', file_path: `${root}/${n}`, old_string: 'a', new_string: 'b' })
  expect((await p.lit('orange')).length).toBe(15)
  await p.calm()
  p.w.find = files('b', 15).map(([n]) => `${root}/${n}\0`).join('')
  await p.run(bash('for f in b*.txt; do echo x >> $f; done'))
  expect((await p.lit('orange')).length).toBe(15)
  await p.ui.unmount()
})

test('ACT-02: Edit, Write, NotebookEdit and a Bash write shimmer orange', { timeoutMs: 20_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file'], ['b.txt', 'file'], ['n.ipynb', 'file'], ['c.txt', 'file']] })
  await p.run({ tool: 'Edit', file_path: `${root}/a.txt`, old_string: 'a', new_string: 'b' })
  expect(await p.tone('a.txt')).toBe('orange')
  await p.calm()
  await p.run({ tool: 'Write', file_path: `${root}/b.txt`, content: 'x' })
  expect(await p.tone('b.txt')).toBe('orange')
  await p.calm()
  await p.run({ tool: 'NotebookEdit', notebook_path: `${root}/n.ipynb`, new_source: 'x' })
  expect(await p.tone('n.ipynb')).toBe('orange')
  await p.calm()
  p.w.find = `${root}/c.txt\0`
  await p.run(bash('echo hi > c.txt'))
  expect(await p.tone('c.txt')).toBe('orange')
  await p.ui.unmount()
})

test('ACT-02: a failed or denied edit does not shimmer', { timeoutMs: 20_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file'], ['b.txt', 'file']] }, {
    tool: (e: any) => (e.file_path?.endsWith('a.txt') ? { deny: 'no' } : e.file_path?.endsWith('b.txt') ? { isError: true, result: 'String not found' } : undefined),
  })
  for (const tool of ['Edit', 'Write']) {
    await p.run({ tool, file_path: `${root}/a.txt`, old_string: 'a', new_string: 'b', content: 'x' })
    await p.run({ tool, file_path: `${root}/b.txt`, old_string: 'a', new_string: 'b', content: 'x' })
  }
  expect(await p.lit()).toEqual([])
  await p.ui.unmount()
})

test('ACT-02: files a proven git or gh action changed take its colour', { timeoutMs: 120_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file']] }, { find: `${root}/a.txt\0` })
  const table: [string, string][] = [
    ['git checkout dev', 'blue'], ['git switch dev', 'blue'], ['git branch dev', 'blue'], ['git pull', 'blue'], ['git fetch', 'blue'], ['git clone https://example.test/r.git', 'blue'],
    ['git reset --hard', 'red'], ['git restore a.txt', 'red'], ['git revert HEAD', 'red'], ['git rm a.txt', 'red'], ['git checkout -- a.txt', 'red'],
    ['git merge dev', 'purple'], ['git rebase main', 'purple'], ['git cherry-pick abc123', 'purple'], ['git tag v1', 'purple'],
    ['git init', 'green'],
    ['gh pr checkout 1', 'blue'], ['gh repo clone o/r', 'blue'],
    ['gh pr create --fill', 'purple'], ['gh pr merge 1', 'purple'], ['gh pr comment 1 -b x', 'purple'], ['gh pr review 1 -a', 'purple'], ['gh release create v1', 'purple'], ['gh issue create -t x', 'purple'],
  ]
  const wrong: string[] = []
  for (const [c, want] of table) {
    await p.run(bash(c))
    const got = await p.tone('a.txt')
    if (got !== want) wrong.push(`${c}: ${got}`)
    await p.calm()
  }
  expect(wrong).toEqual([])
  await p.ui.unmount()
})

test('ACT-02: the first git action other than commit, push and add sets the colour, and only with evidence', { timeoutMs: 60_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file']] }, { find: `${root}/a.txt\0` })
  await p.run(bash('git add a.txt && git checkout dev && git merge x'))
  expect(await p.tone('a.txt')).toBe('blue')
  await p.calm()
  await p.run(bash('git push && git rebase main && git reset --hard'))
  expect(await p.tone('a.txt')).toBe('purple')
  await p.calm()
  await p.run(bash('git add a.txt && git push'))
  expect(await p.tone('a.txt')).toBe('orange')
  await p.calm()
  await p.run(bash('git checkout dev; echo done'))
  expect(await p.tone('a.txt')).toBe('orange')
  await p.ui.unmount()
})

test('ACT-03: a proven commit shimmers its files green, at most 12, and flashes the branch green', { timeoutMs: 20_000 }, async ($, on) => {
  const names = files('c', 14).map(([n]) => n)
  const p = await pane($, on, { [root]: files('c', 14) }, { heads: ['abc1234def0'], committed: names.map(n => `${n}\0`).join('') })
  p.w.heads = ['abc1234def0', 'fed4321cba9']
  await p.run(bash('git commit -m x'))
  expect((await p.lit('green')).length).toBe(12)
  expect(await p.branch()).toBe('green')
  await p.calm()
  expect(await p.branch()).toBe(undefined)
  p.w.heads = ['fed4321cba9']
  await p.run(bash('git commit -m y || true'))
  expect(await p.lit('green')).toEqual([])
  expect(await p.branch()).toBe(undefined)
  await p.ui.unmount()
})

test('ACT-03: git add shimmers green the staged files under the paths it named, or all staged for ., -A, -u or a glob', { timeoutMs: 60_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['src', 'dir'], ['a.txt', 'file'], ['d.md', 'file']], [`${root}/src`]: [['b.ts', 'file'], ['c.ts', 'file']] }, {
    status: '## main\0M  a.txt\0M  d.md\0M  src/b.ts\0M  src/c.ts\0', cached: 'a.txt\0d.md\0src/b.ts\0src/c.ts\0',
  })
  await p.run(bash('git add src'))
  expect((await p.lit('green')).sort()).toEqual(['src/b.ts', 'src/c.ts'])
  await p.calm()
  for (const c of ['git add .', 'git add -A', 'git add -u', "git add '*.md'"]) {
    await p.run(bash(c))
    expect((await p.lit('green')).sort()).toEqual(['a.txt', 'd.md', 'src/b.ts', 'src/c.ts'])
    await p.calm()
  }
  await p.ui.unmount()
})

test('ACT-03: git add -A lights at most 12 staged files', { timeoutMs: 20_000 }, async ($, on) => {
  const names = files('s', 14).map(([n]) => n)
  const p = await pane($, on, { [root]: files('s', 14) }, { status: `## main\0${names.map(n => `M  ${n}\0`).join('')}`, cached: names.map(n => `${n}\0`).join('') })
  await p.run(bash('git add -A'))
  expect((await p.lit('green')).length).toBe(12)
  await p.ui.unmount()
})

test('ACT-03: the branch row flashes in the colour of push, pull, fetch, checkout, switch, branch, merge, rebase, tag and gh', { timeoutMs: 120_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file']] }, { heads: ['abc1234def0'] })
  const table: [string, string][] = [
    ['git push', 'teal'], ['git pull', 'blue'], ['git fetch', 'blue'], ['git checkout dev', 'blue'], ['git switch dev', 'blue'], ['git branch dev', 'blue'],
    ['git merge dev', 'purple'], ['git rebase main', 'purple'], ['git tag v1', 'purple'],
    ['gh pr create --fill', 'purple'], ['gh pr merge 1', 'purple'], ['gh pr checkout 1', 'blue'], ['gh pr comment 1 -b x', 'purple'], ['gh pr review 1 -a', 'purple'],
    ['gh release create v1', 'purple'], ['gh issue create -t x', 'purple'], ['gh repo clone o/r', 'blue'],
  ]
  const wrong: string[] = []
  for (const [c, want] of table) {
    await p.run(bash(c))
    const got = await p.branch()
    if (got !== want) wrong.push(`${c}: ${got}`)
    await p.calm()
  }
  expect(wrong).toEqual([])
  p.w.heads = ['abc1234def0', 'fed4321cba9']
  await p.run(bash('git commit -m x && git push'))
  expect(await p.branch()).toBe('teal')
  await p.ui.unmount()
})

test('ACT-04: a shimmer lasts 2.7 s, for reads, writes and the branch row', { timeoutMs: 20_000 }, async ($, on) => {
  const p = await pane($, on, { [root]: [['a.txt', 'file'], ['b.txt', 'file']] })
  await p.run({ tool: 'Read', file_path: `${root}/a.txt` })
  await p.clock.advance(2_650)
  await p.clock.settle()
  expect(await p.tone('a.txt')).toBe('purple')
  await p.clock.advance(100)
  await p.clock.settle()
  expect(await p.lit()).toEqual([])
  await p.run({ tool: 'Edit', file_path: `${root}/b.txt`, old_string: 'a', new_string: 'b' })
  await p.clock.advance(2_650)
  await p.clock.settle()
  expect(await p.tone('b.txt')).toBe('orange')
  await p.clock.advance(100)
  await p.clock.settle()
  expect(await p.lit()).toEqual([])
  await p.run(bash('git fetch'))
  await p.clock.advance(2_650)
  await p.clock.settle()
  expect(await p.branch()).toBe('blue')
  await p.clock.advance(100)
  await p.clock.settle()
  expect(await p.branch()).toBe(undefined)
  await p.ui.unmount()
})

test('ACT-05: collapsed folders open to reveal a file Claude reads, searches, edits, writes in Bash or stages', { timeoutMs: 60_000 }, async ($, on) => {
  const dirs: Record<string, Kids> = { [root]: [] }
  for (const d of ['r', 'g', 'e', 'b', 's']) {
    dirs[root]!.push([d, 'dir'])
    dirs[`${root}/${d}`] = [['deep', 'dir']]
    dirs[`${root}/${d}/deep`] = [['x.ts', 'file']]
  }
  const p = await pane($, on, dirs, {
    status: '## main\0M  s/deep/x.ts\0', cached: 's/deep/x.ts\0',
    tool: (e: any) => ({ result: e.tool === 'Glob' ? { filenames: ['g/deep/x.ts'], numFiles: 1, durationMs: 1, truncated: false } : { stdout: '', stderr: '' } }),
  })
  const shown = async () => (await p.rows()).map(r => r.id.slice(root.length + 1))
  expect(await shown()).toEqual(['b', 'e', 'g', 'r', 's'])
  await p.run({ tool: 'Read', file_path: `${root}/r/deep/x.ts` })
  expect(await p.tone('r/deep/x.ts')).toBe('purple')
  await p.run({ tool: 'Glob', pattern: '**/*.ts' })
  expect(await p.tone('g/deep/x.ts')).toBe('purple')
  await p.run({ tool: 'Edit', file_path: `${root}/e/deep/x.ts`, old_string: 'a', new_string: 'b' })
  expect(await p.tone('e/deep/x.ts')).toBe('orange')
  p.w.find = `${root}/b/deep/x.ts\0`
  await p.run(bash('echo x >> b/deep/x.ts'))
  expect(await p.tone('b/deep/x.ts')).toBe('orange')
  p.w.find = ''
  await p.run(bash('git add s'))
  expect(await p.tone('s/deep/x.ts')).toBe('green')
  for (const d of ['r', 'g', 'e', 'b', 's']) for (const id of [d, `${d}/deep`, `${d}/deep/x.ts`]) expect(await shown()).toContain(id)
  await p.ui.unmount()
})
