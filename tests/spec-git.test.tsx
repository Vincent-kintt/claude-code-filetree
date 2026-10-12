import { expect, test } from 'claude-code/testing'

import { parseBranch, parseGit } from '../hooks/tree'
import { type Ran, type World, clientIn, paneProps, world } from './harness'

type Row = { id: string; left: { t: string; c?: string }[]; right: { t: string; c?: string }[] }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// world() with a hook around process.run, for slow or prefixed git.
function hosted(on: any, w: World, ran: Ran, wrap: (e: any, run: (e: any) => Promise<any>) => Promise<any>) {
  const own = (name: string, ...args: any[]) => {
    if (name !== 'process.run') return on(name, ...args)
    const inner = args[0]
    return on(name, (_$: any, e: any) => wrap(e, (x: any) => inner(_$, x)))
  }
  return world(own, w, ran)
}

async function mount($: any, clock: any, root: string) {
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(80) })
  await clock.settle()
  return ui
}

const rowsOf = async (ui: any): Promise<Row[]> => clientIn(await ui.drawn()).props.props.rows
const rowOf = async (ui: any, id: string): Promise<Row> => {
  const hit = (await rowsOf(ui)).find(r => r.id === id)
  if (!hit) throw new Error(`no row ${id}`)
  return hit
}
const right = (r: Row) => r.right.map(s => s.t).join('')
const nameColor = (r: Row) => r.left.at(-1)?.c

function outside(node: any): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object' || node.type === 'Client') return ''
  return (node.children ?? []).map(outside).join('')
}
const header = async (ui: any) => outside(await ui.drawn())

const gitCalls = (ran: Ran) => ran.filter(a => a[0] === 'git')
const verbOf = (a: string[]) => a.slice(4).find(x => !x.startsWith('-'))
const statuses = (ran: Ran) => gitCalls(ran).filter(a => verbOf(a) === 'status').length

const ORDER = ['U', 'D', 'M', 'T', 'R', 'C', 'A', '?']
const CODE: Record<string, string> = { U: 'UU', D: ' D', M: ' M', T: ' T', R: 'R ', C: 'C ', A: 'A ', '?': '??' }
const rec = (letter: string, path: string) => `${CODE[letter]} ${path}\0${letter === 'R' || letter === 'C' ? `${path}.orig\0` : ''}`

test('GIT-01: a folder takes its strongest child status in the order U > D > M > T > R > C > A > ?', () => {
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      const a = ORDER[i] ?? ''
      const b = ORDER[j] ?? ''
      for (const out of [rec(a, 'd/x') + rec(b, 'd/y'), rec(b, 'd/y') + rec(a, 'd/x')]) {
        const { git } = parseGit(`## main\0${out}`, '/r', '')
        expect(git['/r/d']).toBe(a)
        expect(git['/r']).toBe(a)
        expect(git['/r/d/y']).toBe(b)
      }
    }
  }
})

test('GIT-01: a file takes the strongest of its index and worktree status, in the same order', () => {
  const cases: [string, string][] = [
    ['UU', 'U'], ['AA', 'U'], ['DD', 'U'], ['AU', 'U'], ['UD', 'U'],
    ['MD', 'D'], ['AD', 'D'], ['RD', 'D'],
    ['AM', 'M'], ['RM', 'M'], ['CM', 'M'], ['TM', 'M'], ['MT', 'M'], ['MM', 'M'],
    ['AT', 'T'], ['RT', 'T'], ['T ', 'T'],
    ['R ', 'R'], ['C ', 'C'], ['A ', 'A'], [' A', 'A'], ['??', '?'],
  ]
  for (const [xy, want] of cases) {
    const extra = xy[0] === 'R' || xy[0] === 'C' ? 'old.ts\0' : ''
    const { git } = parseGit(`## main\0${xy} f.ts\0${extra}`, '/r', '')
    expect([xy, git['/r/f.ts']]).toEqual([xy, want])
  }
  expect(parseGit('## main\0', '/r', '').git).toEqual({})
})

test('GIT-01: changed files and folders show a status colour, clean ones show none', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['lib', 'dir'], ['clean.txt', 'file'], ['new.md', 'file']], [`${root}/src`]: [['a.ts', 'file'], ['b.ts', 'file']], [`${root}/lib`]: [['c.ts', 'file']] },
    status: '## main\0 M src/a.ts\0UU src/b.ts\0?? new.md\0', numstat: '',
  }, [])
  const ui = await mount($, clock, root)
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await clock.settle()
  const clean = nameColor(await rowOf(ui, `${root}/clean.txt`))
  const cleanDir = nameColor(await rowOf(ui, `${root}/lib`))
  const a = nameColor(await rowOf(ui, `${root}/src/a.ts`))
  const b = nameColor(await rowOf(ui, `${root}/src/b.ts`))
  const fresh = nameColor(await rowOf(ui, `${root}/new.md`))
  const src = nameColor(await rowOf(ui, `${root}/src`))
  expect(clean).toBeUndefined()
  for (const c of [a, b, fresh, src]) {
    expect(c).toBeDefined()
    expect(c).not.toBe(clean)
    expect(c).not.toBe(cleanDir)
  }
  expect(new Set([a, b, fresh]).size).toBe(3)
  expect(src).toBe(b)
  await ui.unmount()
})

test('GIT-02: modified files show +N -N against HEAD, folders and the header sum them, new files show none', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['c.txt', 'file'], ['top.md', 'file']], [`${root}/src`]: [['deep', 'dir'], ['a.ts', 'file'], ['new.ts', 'file']], [`${root}/src/deep`]: [['b.ts', 'file']] },
    status: '## main\0 M src/a.ts\0 M src/deep/b.ts\0A  src/new.ts\0 M c.txt\0?? top.md\0',
    numstat: '3\t1\tsrc/a.ts\x002\t5\tsrc/deep/b.ts\x0010\t0\tsrc/new.ts\x001\t1\tc.txt\0',
  }, ran)
  const ui = await mount($, clock, root)
  expect(gitCalls(ran).find(a => verbOf(a) === 'diff')?.slice(4, 6)).toEqual(['diff', 'HEAD'])
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: `${root}/src/deep` }, { in: 'rows' })
  await clock.settle()
  expect(right(await rowOf(ui, `${root}/src/a.ts`))).toContain(' +3 -1')
  expect(right(await rowOf(ui, `${root}/src/deep/b.ts`))).toContain(' +2 -5')
  expect(right(await rowOf(ui, `${root}/c.txt`))).toContain(' +1 -1')
  expect(right(await rowOf(ui, `${root}/src/deep`))).toContain(' +2 -5')
  expect(right(await rowOf(ui, `${root}/src`))).toContain(' +5 -6')
  expect(right(await rowOf(ui, `${root}/src/new.ts`))).not.toMatch(/ [+-]\d/)
  expect(right(await rowOf(ui, `${root}/top.md`))).not.toMatch(/ [+-]\d/)
  expect(await header(ui)).toContain(' +6 -7')
  await ui.unmount()
})

test('GIT-03: a folder shows ?:N M:N D:N for new (untracked or staged-added), modified (renames included) and deleted', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['lib', 'dir']], [`${root}/src`]: [['n1.md', 'file'], ['n2.ts', 'file'], ['m1.ts', 'file'], ['r2.ts', 'file']], [`${root}/lib`]: [['x.ts', 'file']] },
    status: '## main\0?? src/n1.md\0A  src/n2.ts\0 M src/m1.ts\0R  src/r2.ts\0src/r1.ts\0 D src/d1.ts\0D  src/d2.ts\0',
    numstat: '1\t1\tsrc/m1.ts\0',
  }, [])
  const ui = await mount($, clock, root)
  expect(right(await rowOf(ui, `${root}/src`))).toContain(' ?:2 M:2 D:2')
  expect(right(await rowOf(ui, `${root}/lib`))).not.toMatch(/[?MD]:\d/)
  const head = await header(ui)
  expect(head).toContain(' ?:2 M:2 D:2')
  expect(head).not.toContain('clean')
  await ui.unmount()
})

test('GIT-03: a folder shows only the counts it has, and the header says clean when nothing in the root changed', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const w: World = {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['a.txt', 'file']], [`${root}/src`]: [['m.ts', 'file']] },
    status: '## main\0 M src/m.ts\0', numstat: '',
  }
  const clock = world(on, w, [])
  const ui = await mount($, clock, root)
  const src = right(await rowOf(ui, `${root}/src`))
  expect(src).toContain(' M:1')
  expect(src).not.toMatch(/[?D]:\d/)
  expect(await header(ui)).not.toContain('clean')
  w.status = '## main\0'
  await clock.advance(2_100)
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  expect(right(await rowOf(ui, `${root}/src`))).not.toMatch(/[?MD]:\d/)
  expect(await header(ui)).toContain('clean')
  await ui.unmount()
})

test('GIT-04: the header shows the branch, its upstream, and ahead/behind counts', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['a.txt', 'file']] }, status: '## feat/x...origin/feat/x [ahead 2, behind 3]\0', numstat: '' }
  const clock = world(on, w, [])
  const ui = await mount($, clock, root)
  let head = await header(ui)
  for (const part of ['feat/x', ' origin/feat/x', ' ↑2', ' ↓3']) expect(head).toContain(part)
  w.status = '## main...upstream/main [behind 7]\0'
  await clock.advance(2_100)
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  head = await header(ui)
  for (const part of ['main', ' upstream/main', ' ↓7']) expect(head).toContain(part)
  expect(head).not.toContain('↑')
  expect(parseBranch('## main...origin/main [ahead 12]')).toEqual({ head: 'main', upstream: 'origin/main', ahead: 12, behind: 0 })
  expect(parseBranch('## solo')).toEqual({ head: 'solo', upstream: '', ahead: 0, behind: 0 })
  expect(parseBranch('## No commits yet on main')).toEqual({ head: 'main', upstream: '', ahead: 0, behind: 0 })
  await ui.unmount()
})

test('GIT-05: every git call uses --no-optional-locks -C <root>, and status and diffs are limited to the cwd', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const top = '/home/k/repo'
  const root = `${top}/sub`
  const w: World = {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top,
    dirs: { [top]: [['.git', 'dir'], ['sub', 'dir'], ['other', 'dir']], [`${top}/.git`]: [['index', 'file'], ['HEAD', 'file']], [root]: [['a.ts', 'file'], ['b.ts', 'file']], [`${top}/other`]: [['o.ts', 'file']] },
    status: '## main\0 M sub/a.ts\0 M other/o.ts\0?? other/n.md\0', numstat: '2\t1\tsub/a.ts\x009\t9\tother/o.ts\0', cached: 'sub/a.ts\0', heads: ['abc1234def0'],
  }
  const clock = hosted(on, w, ran, async (e, run) => {
    const argv: string[] = e.argv
    if (argv[0] === 'git' && verbOf(argv) === 'rev-parse' && argv.includes('--show-prefix')) {
      ran.push(argv)
      return ok(`sub/\n${top}\n`)
    }
    return run(e)
  })
  const ui = await mount($, clock, root)
  await ui.input({ key: 'q', text: 'b.ts', kind: 'change' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git add a.ts' } as any)
  await clock.settle()
  w.heads = ['abc1234def0', 'fed4321cba9']
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as any)
  await clock.settle()
  const calls = gitCalls(ran)
  const verbs = new Set(calls.map(verbOf))
  for (const v of ['rev-parse', 'status', 'diff', 'ls-files']) expect(verbs.has(v)).toBe(true)
  for (const a of calls) expect(a.slice(0, 4)).toEqual(['git', '--no-optional-locks', '-C', root])
  for (const a of calls.filter(a => ['status', 'diff', 'diff-tree'].includes(verbOf(a) ?? ''))) expect(a.slice(a.indexOf('--'))).toEqual(['--', '.'])
  expect(await header(ui)).toContain(' +2 -1')
  expect(await header(ui)).toContain(' M:1')
  expect(await header(ui)).not.toContain('?:')
  expect(JSON.stringify(await rowsOf(ui))).not.toContain('other')
  await ui.unmount()
})

test('GIT-06: outside a repo only git rev-parse runs, whatever happens in the pane', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/scratch'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['src', 'dir'], ['c.txt', 'file']], [`${root}/src`]: [['d.ts', 'file']] }, status: '## main\0 M c.txt\0', numstat: '1\t1\tc.txt\0' }, ran)
  on('classic.FileChanged', () => ({}))
  const ui = await mount($, clock, root)
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await ui.input({ key: 'q', text: 'd.ts', kind: 'change' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'echo hi > c.txt' } as any)
  await $.tool.call({ tool: 'Bash', command: 'git add c.txt && git commit -m x' } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${root}/c.txt`, old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Write', file_path: `${root}/src/d.ts`, content: 'x' } as any)
  await clock.settle()
  await clock.advance(2_100)
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  const verbs = gitCalls(ran).map(verbOf)
  expect(verbs.length).toBeGreaterThan(0)
  expect(verbs.filter(v => v !== 'rev-parse')).toEqual([])
  const shown = await header(ui)
  expect(shown).not.toContain('main')
  expect(shown).not.toContain('+1')
  await ui.unmount()
})

test('GIT-07: a change to .git/index or HEAD refreshes git 300 ms after the last change in a burst, and nothing else does', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['.git', 'dir'], ['a.txt', 'file']], [`${root}/.git`]: [['index', 'file'], ['HEAD', 'file'], ['config', 'file']] }, status: '## main\0', numstat: '' }, ran)
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  const started = await $.classic.SessionStart({ source: 'startup', cwd: root } as any)
  expect((started as any).watchPaths).toEqual(expect.arrayContaining([`${root}/.git/index`, `${root}/.git/HEAD`]))
  const ui = await mount($, clock, root)
  for (const f of ['index', 'HEAD']) {
    const before = statuses(ran)
    await $.classic.FileChanged({ file_path: `${root}/.git/${f}`, event: 'change' } as any)
    await clock.advance(299)
    expect(statuses(ran)).toBe(before)
    await clock.advance(1)
    await clock.settle()
    expect(statuses(ran)).toBe(before + 1)
  }
  const before = statuses(ran)
  for (const f of ['index', 'HEAD', 'index', 'HEAD']) {
    await $.classic.FileChanged({ file_path: `${root}/.git/${f}`, event: 'change' } as any)
    await clock.advance(250)
  }
  expect(statuses(ran)).toBe(before)
  await clock.advance(49)
  expect(statuses(ran)).toBe(before)
  await clock.advance(1)
  await clock.settle()
  expect(statuses(ran)).toBe(before + 1)
  await clock.advance(5_000)
  for (const p of [`${root}/.git/config`, `${root}/a.txt`, `${root}/index`, `${root}/HEAD`]) await $.classic.FileChanged({ file_path: p, event: 'change' } as any)
  await clock.advance(1_000)
  await clock.settle()
  expect(statuses(ran)).toBe(before + 1)
  await ui.unmount()
})

test('GIT-07: the watch follows the cwd into another repo and drops the old one', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const a = '/home/k/a'
  const b = '/home/k/b'
  const w: World = {
    os: 'linux', env: { HOME: '/home/k' }, cwd: a, top: a,
    dirs: { [a]: [['.git', 'dir'], ['x.txt', 'file']], [`${a}/.git`]: [['index', 'file'], ['HEAD', 'file']], [b]: [['.git', 'dir'], ['sub', 'dir']], [`${b}/.git`]: [['index', 'file'], ['HEAD', 'file']], [`${b}/sub`]: [['y.txt', 'file']] },
    status: '## main\0', numstat: '',
  }
  const clock = world(on, w, ran)
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  on('classic.CwdChanged', () => ({}))
  await $.classic.SessionStart({ source: 'startup', cwd: a } as any)
  const ui = await mount($, clock, a)
  w.cwd = `${b}/sub`
  w.top = b
  const moved = await $.classic.CwdChanged({ old_cwd: a, new_cwd: `${b}/sub` } as any)
  expect((moved as any).watchPaths).toEqual(expect.arrayContaining([`${b}/.git/index`, `${b}/.git/HEAD`]))
  expect(JSON.stringify((moved as any).watchPaths)).not.toContain(`${a}/`)
  await clock.settle()
  await clock.advance(5_000)
  await clock.settle()
  const quiet = statuses(ran)
  await $.classic.FileChanged({ file_path: `${a}/.git/index`, event: 'change' } as any)
  await clock.advance(1_000)
  await clock.settle()
  expect(statuses(ran)).toBe(quiet)
  await $.classic.FileChanged({ file_path: `${b}/.git/index`, event: 'change' } as any)
  await clock.advance(300)
  await clock.settle()
  expect(statuses(ran)).toBe(quiet + 1)
  expect(gitCalls(ran).filter(x => verbOf(x) === 'status').at(-1)?.[3]).toBe(`${b}/sub`)
  await ui.unmount()
})

test('GIT-07: outside a repo the watch catches a git init in the cwd', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/scratch'
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a.txt', 'file']] }, status: '## No commits yet on main\0?? a.txt\0', numstat: '' }
  const clock = world(on, w, ran)
  on('classic.SessionStart', () => ({}))
  on('classic.FileChanged', () => ({}))
  const started = await $.classic.SessionStart({ source: 'startup', cwd: root } as any)
  expect((started as any).watchPaths).toEqual(expect.arrayContaining([`${root}/.git/index`, `${root}/.git/HEAD`]))
  const ui = await mount($, clock, root)
  expect(statuses(ran)).toBe(0)
  w.top = root
  w.dirs[root] = [['.git', 'dir'], ['a.txt', 'file']]
  w.dirs[`${root}/.git`] = [['HEAD', 'file']]
  await $.classic.FileChanged({ file_path: `${root}/.git/HEAD`, event: 'create' } as any)
  await clock.advance(299)
  expect(statuses(ran)).toBe(0)
  await clock.advance(1)
  await clock.settle()
  expect(statuses(ran)).toBe(1)
  const head = await header(ui)
  expect(head).toContain('main')
  expect(head).toContain(' ?:1')
  await ui.unmount()
})

test('GIT-08: git refreshes never overlap, and requests during one run as a single follow-up', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  let slow = false
  let live = 0
  let peak = 0
  let started = 0
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['a.txt', 'file'], ['b.txt', 'file']] }, status: '## main\0 M a.txt\0', numstat: '1\t0\ta.txt\0' }
  const clock: any = hosted(on, w, ran, async (e, run) => {
    if (e.argv[0] !== 'git' || verbOf(e.argv) !== 'status') return run(e)
    started++
    live++
    peak = Math.max(peak, live)
    try {
      if (slow) await clock.sleep(1_000)
      return await run(e)
    } finally {
      live--
    }
  })
  const ui = await mount($, clock, root)
  slow = true
  const before = started
  const edit = (f: string) => $.tool.call({ tool: 'Edit', file_path: `${root}/${f}`, old_string: 'a', new_string: 'b' } as any)
  const calls = [edit('a.txt')]
  await clock.advance(100)
  expect(started - before).toBe(1)
  for (const f of ['a.txt', 'b.txt', 'a.txt']) {
    calls.push(edit(f))
    await clock.advance(100)
  }
  expect(started - before).toBe(1)
  for (let i = 0; i < 40; i++) await clock.advance(100)
  await Promise.all(calls)
  await clock.settle()
  expect(peak).toBe(1)
  expect(started - before).toBe(2)
  await ui.unmount()
})

