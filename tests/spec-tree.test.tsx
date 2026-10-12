import { expect, test } from 'claude-code/testing'

import { toNodes } from '../hooks/features/tree/nodes'
import { type Ran, type World, STAMP, clientIn, paneProps, resync, world } from './harness'

type Seg = { t: string; c?: string }
type Spec = { id: string; left: Seg[]; right: Seg[] }

const MUTED = '#808a96'

const rowsIn = async (ui: any): Promise<Spec[]> => clientIn(await ui.drawn()).props.props.rows
const idsIn = async (ui: any): Promise<string[]> => (await rowsIn(ui)).map(r => r.id).filter(Boolean)
const rowOf = async (ui: any, id: string): Promise<Spec | undefined> => (await rowsIn(ui)).find(r => r.id === id)
const nameSeg = (row: Spec | undefined, name: string) => row?.left.find(s => s.t === name)
const rightText = (row: Spec | undefined) => (row?.right ?? []).map(s => s.t).join('')

// Wraps the shared host so a test can see, or answer, process runs before the fake does.
type Run = { argv: string[]; init: any }
function tapped(on: any, tap: (e: Run, run: () => Promise<any>) => Promise<any> | undefined) {
  return (name: string, fn: any) => (name === 'process.run' ? on(name, async ($: any, e: any) => tap(e, () => fn($, e)) ?? fn($, e)) : on(name, fn))
}

async function start($: any, clock: any, cwd: string, bodyRows = 40) {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: { ...paneProps(60), scroll: { offset: 0, bodyRows } } })
  await clock.settle()
  return ui
}

async function search(ui: any, clock: any, text: string) {
  await ui.input({ key: 'q', text, kind: 'change' })
  await clock.settle()
}

const files = (prefix: string, n: number, ext = '.txt') => Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(5, '0')}${ext}`, 'file'] as [string, 'file'])

test('TRE-01: the root is the cwd at start, even inside a parent folder', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const sub = `${root}/sub`
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: sub, top: '', dirs: { [root]: [['a.ts', 'file'], ['sub', 'dir']], [sub]: [['b.ts', 'file']] }, status: '', numstat: '' }, [])
  const ui = await start($, clock, sub)
  const ids = await idsIn(ui)
  expect(ids).toContain(`${sub}/b.ts`)
  expect(ids).not.toContain(`${root}/a.ts`)
  expect(ids).not.toContain(sub)
  await ui.unmount()
})

for (const command of ['cd /home/k/b', 'pushd /home/k/b', 'popd', 'make && cd /home/k/b']) {
  test(`TRE-01: the root follows the cwd after Bash \`${command}\``, { timeoutMs: 20_000 }, async ($, on) => {
    const a = '/home/k/a'
    const b = '/home/k/b'
    const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: a, top: '', dirs: { [a]: [['a.txt', 'file']], [b]: [['b.txt', 'file']] }, status: '', numstat: '' }
    const clock = world(on, w, [])
    const ui = await start($, clock, a)
    expect(await idsIn(ui)).toContain(`${a}/a.txt`)
    w.cwd = b
    await $.tool.call({ tool: 'Bash', command } as any)
    await clock.advance(1_000)
    await clock.settle()
    const ids = await idsIn(ui)
    expect(ids).toContain(`${b}/b.txt`)
    expect(ids).not.toContain(`${a}/a.txt`)
    await ui.unmount()
  })
}

for (const source of ['clear', 'resume', 'fork']) {
  test(`TRE-01: the root follows the cwd after ${source}`, { timeoutMs: 20_000 }, async ($, on) => {
    const a = '/home/k/a'
    const b = '/home/k/b'
    const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: a, top: '', dirs: { [a]: [['a.txt', 'file']], [b]: [['b.txt', 'file']] }, status: '', numstat: '' }
    const clock = world(on, w, [])
    on('classic.SessionStart', () => ({}))
    const ui = await start($, clock, a)
    w.cwd = b
    await $.classic.SessionStart({ source, cwd: b } as any)
    await clock.settle()
    const ids = await idsIn(ui)
    expect(ids).toContain(`${b}/b.txt`)
    expect(ids).not.toContain(`${a}/a.txt`)
    await ui.unmount()
  })
}

test('TRE-01: a double-click, ctrl-click or shift-click on a folder only toggles it, the root stays and nothing opens', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const sub = `${root}/sub`
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a.ts', 'file'], ['sub', 'dir']], [sub]: [['b.ts', 'file']] }, status: '', numstat: '' }, ran)
  const ui = await start($, clock, root)
  await ui.post({ press: sub }, { in: 'rows' })
  await ui.post({ press: sub }, { in: 'rows' })
  await clock.settle()
  let ids = await idsIn(ui)
  expect(ids).toEqual([sub, `${sub}/b.ts`, `${root}/a.ts`])
  await clock.advance(1_000)
  await ui.post({ press: sub, ctrl: true }, { in: 'rows' })
  await clock.settle()
  expect(await idsIn(ui)).toEqual([sub, `${root}/a.ts`])
  await clock.advance(1_000)
  await ui.post({ press: sub, shift: true }, { in: 'rows' })
  await clock.settle()
  ids = await idsIn(ui)
  expect(ids).toEqual([sub, `${sub}/b.ts`, `${root}/a.ts`])
  expect(ran.some(a => a.some(x => x.includes(sub)) && a[0] !== 'git')).toBe(false)
  expect(ran.some(a => a[0] === 'toast')).toBe(false)
  await ui.unmount()
})

test('TRE-03: directories first, then files, numeric-aware and case-insensitive, at every level', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '',
    dirs: {
      [root]: [['b.txt', 'file'], ['Zeta', 'dir'], ['file10.txt', 'file'], ['A.txt', 'file'], ['file2.txt', 'file'], ['dir10', 'dir'], ['alpha', 'dir'], ['dir9', 'dir']],
      [`${root}/dir9`]: [['x10', 'file'], ['X2', 'file'], ['sub', 'dir'], ['a1', 'file']],
    },
    status: '', numstat: '',
  }, [])
  const ui = await start($, clock, root)
  const top = ['alpha', 'dir9', 'dir10', 'Zeta', 'A.txt', 'b.txt', 'file2.txt', 'file10.txt'].map(n => `${root}/${n}`)
  expect(await idsIn(ui)).toEqual(top)
  await ui.post({ press: `${root}/dir9` }, { in: 'rows' })
  await clock.settle()
  const kids = ['sub', 'a1', 'X2', 'x10'].map(n => `${root}/dir9/${n}`)
  expect(await idsIn(ui)).toEqual([top[0], top[1], ...kids, ...top.slice(2)])
  await ui.unmount()
})

test('TRE-03: toNodes sorts folders before files, numbers by value, letters without case', () => {
  const e = (name: string, kind: 'file' | 'dir') => ({ name, kind, mtimeMs: 0, size: 0, isLink: false })
  const out = toNodes('/r', [e('img10.png', 'file'), e('Img9.png', 'file'), e('b', 'dir'), e('A', 'dir'), e('v1.10', 'dir'), e('v1.9', 'dir'), e('a.md', 'file')])
  expect(out.map(n => n.name)).toEqual(['A', 'b', 'v1.9', 'v1.10', 'a.md', 'Img9.png', 'img10.png'])
})

test('TRE-04: search matches the relative path as a case-insensitive substring, in folders not opened yet', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['top.md', 'file']], [`${root}/src`]: [['lib', 'dir'], ['other.ts', 'file']], [`${root}/src/lib`]: [['Deep.ts', 'file']] },
    status: '## main\0', numstat: '',
  }, [])
  const ui = await start($, clock, root)
  expect(await idsIn(ui)).not.toContain(`${root}/src/lib/Deep.ts`)
  await search(ui, clock, 'LIB/dE')
  let ids = await idsIn(ui)
  expect(ids).toContain(`${root}/src/lib/Deep.ts`)
  expect(ids).not.toContain(`${root}/src/other.ts`)
  expect(ids).not.toContain(`${root}/top.md`)
  await search(ui, clock, 'c/OTH')
  ids = await idsIn(ui)
  expect(ids).toContain(`${root}/src/other.ts`)
  expect(ids).not.toContain(`${root}/src/lib/Deep.ts`)
  await search(ui, clock, 'proj')
  ids = await idsIn(ui)
  expect(ids).not.toContain(`${root}/top.md`)
  expect(ids).not.toContain(`${root}/src/other.ts`)
  await ui.unmount()
})

test('TRE-04: search reveals at most 60 matches from unopened folders', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const dirs: World['dirs'] = { [root]: Array.from({ length: 100 }, (_, i) => [`d${String(i).padStart(3, '0')}`, 'dir'] as [string, 'dir']) }
  for (let i = 0; i < 100; i++) dirs[`${root}/d${String(i).padStart(3, '0')}`] = [['hit.txt', 'file']]
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs, status: '## main\0', numstat: '' }, [])
  const ui = await start($, clock, root, 400)
  await search(ui, clock, 'HIT')
  const hits = (await idsIn(ui)).filter(id => id.endsWith('/hit.txt'))
  expect(hits.length).toBe(60)
  await ui.unmount()
})

test('TRE-04: one unopened folder with more than 60 matches still reveals at most 60', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['many', 'dir']], [`${root}/many`]: files('hit', 100) }, status: '## main\0', numstat: '' }, [])
  const ui = await start($, clock, root, 400)
  await search(ui, clock, 'hit')
  const hits = (await idsIn(ui)).filter(id => id.includes('/many/hit'))
  expect(hits.length).toBeLessThanOrEqual(60)
  expect(hits.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('TRE-04: a folder you opened before searching shows all its matches, past 60', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['many', 'dir']], [`${root}/many`]: files('hit', 100) }, status: '## main\0', numstat: '' }, [])
  const ui = await start($, clock, root, 400)
  await ui.post({ press: `${root}/many` }, { in: 'rows' })
  await ui.post({ press: `${root}/many` }, { in: 'rows' })
  await clock.settle()
  expect((await idsIn(ui)).filter(id => id.includes('/many/hit')).length).toBe(100)
  await search(ui, clock, 'hit')
  expect((await idsIn(ui)).filter(id => id.includes('/many/hit')).length).toBe(100)
  await ui.unmount()
})

test('TRE-05: in a repo the index is git ls-files of tracked and untracked files with the standard excludes, at any depth', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  const dirs: World['dirs'] = { [root]: [['a', 'dir']] }
  chain.forEach((name, i) => {
    const here = `${root}/${chain.slice(0, i + 1).join('/')}`
    const next = chain[i + 1]
    dirs[here] = next ? [[next, 'dir']] : [['deep.txt', 'file']]
  })
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs, status: '## main\0', numstat: '' }, ran)
  const ui = await start($, clock, root)
  await search(ui, clock, 'deep')
  expect(await idsIn(ui)).toContain(`${root}/${chain.join('/')}/deep.txt`)
  const index = ran.filter(a => a[0] === 'git' && a.includes('ls-files')).map(a => a.slice(a.indexOf('ls-files') + 1)).find(args => {
    const short = args.filter(x => /^-[a-z]+$/.test(x)).join('')
    return short.includes('c') || args.includes('--cached')
  })
  expect(index).toBeDefined()
  const args = index ?? []
  const short = args.filter(x => /^-[a-z]+$/.test(x)).join('')
  expect(short.includes('o') || args.includes('--others')).toBe(true)
  expect(args).toContain('--exclude-standard')
  expect(args.some(x => x.startsWith('--max-depth'))).toBe(false)
  expect(ran.some(a => a[0] === 'find')).toBe(false)
  await ui.unmount()
})

test('TRE-05: in a subfolder of a repo the index is limited to the cwd', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const sub = `${root}/pkg`
  const seen: Run[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const tap = tapped(on, (e, run) => {
    seen.push(e)
    if (e.argv[0] === 'git' && e.argv.includes('rev-parse') && e.argv.at(-1) !== 'HEAD') return Promise.resolve(ok(`pkg/\n${root}\n`))
    if (e.argv[0] === 'git' && e.argv.includes('ls-files')) return Promise.resolve(ok(e.argv[3] === sub ? 'x.ts\0' : 'pkg/x.ts\0y.ts\0'))
    return run()
  })
  const clock = world(tap, { os: 'linux', env: { HOME: '/home/k' }, cwd: sub, top: root, dirs: { [root]: [['pkg', 'dir'], ['y.ts', 'file']], [sub]: [['x.ts', 'file']] }, status: '## main\0', numstat: '' }, ran)
  const ui = await start($, clock, sub)
  await search(ui, clock, 'ts')
  expect(await idsIn(ui)).toContain(`${sub}/x.ts`)
  const lists = seen.filter(e => e.argv[0] === 'git' && e.argv.includes('ls-files'))
  expect(lists.length).toBeGreaterThan(0)
  for (const e of lists) expect(e.argv.slice(0, 4)).toEqual(['git', '--no-optional-locks', '-C', sub])
  await ui.unmount()
})

const pruneOf = (argv: string[], name: string) => argv.some((x, i) => x === name && argv[i - 1] === '-name')
const indexFind = (ran: Ran) => ran.find(a => a[0] === 'find' && a.includes('-maxdepth'))

for (const [label, root, home, depth, broad] of [
  ['a project folder', '/home/k/scratch', '/home/k', '6', false],
  ['the home folder', '/home/k', '/home/k', '6', true],
  ['a disk root', '/', '/home/k', '3', true],
] as const) {
  test(`TRE-06: outside a repo at ${label}, find prunes the standard folders, stays on one filesystem and goes ${depth} levels deep`, { timeoutMs: 20_000 }, async ($, on) => {
    const ran: Ran = []
    const clock = world(on, { os: 'linux', env: { HOME: home }, cwd: root, top: '', dirs: { [root]: [['x', 'dir']], [`${root === '/' ? '' : root}/x`]: [['hit.txt', 'file']] }, status: '', numstat: '', find: `${root === '/' ? '' : root}/x/hit.txt\0` }, ran)
    const ui = await start($, clock, root)
    await search(ui, clock, 'hit')
    expect(await idsIn(ui)).toContain(`${root === '/' ? '' : root}/x/hit.txt`)
    const argv = indexFind(ran) ?? []
    expect(argv).toContain(root)
    expect(argv.includes('-xdev') || argv.includes('-mount')).toBe(true)
    expect(argv[argv.indexOf('-maxdepth') + 1]).toBe(depth)
    expect(argv).toContain('-prune')
    for (const name of ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']) expect(pruneOf(argv, name)).toBe(true)
    for (const name of ['Library', 'AppData', '.Trash']) expect(pruneOf(argv, name)).toBe(broad)
    expect(ran.some(a => a[0] === 'git' && a.includes('ls-files'))).toBe(false)
    await ui.unmount()
  })
}

test('TRE-06: on Windows outside a repo the walk skips the standard folders, follows linked folders, goes 6 deep and runs no find', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = 'C:/Users/k/proj'
  const deep = ['s', '1', '2', '3', '4', '5']
  const dirs: World['dirs'] = {
    [root]: [['node_modules', 'dir'], ['dist', 'dir'], ['ln', 'dir'], ['s', 'dir'], ['Library', 'dir']],
    [`${root}/node_modules`]: [['hit-nm.js', 'file']],
    [`${root}/dist`]: [['hit-dist.js', 'file']],
    [`${root}/ln`]: [['hit-ln.txt', 'file']],
    [`${root}/Library`]: [['hit-lib.txt', 'file']],
  }
  deep.forEach((name, i) => {
    const here = `${root}/${deep.slice(0, i + 1).join('/')}`
    const next = deep[i + 1]
    dirs[here] = next ? [[next, 'dir'], [`hit-${i + 2}.txt`, 'file']] : [[`hit-${i + 2}.txt`, 'file']]
  })
  const clock = world(on, { os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, cwd: root, top: '', dirs, links: ['/Users/k/proj/ln'], status: '', numstat: '' }, ran)
  const ui = await start($, clock, root, 200)
  await search(ui, clock, 'HIT')
  const ids = await idsIn(ui)
  expect(ids).toContain(`${root}/ln/hit-ln.txt`)
  expect(ids).toContain(`${root}/Library/hit-lib.txt`)
  expect(ids).toContain(`${root}/s/1/2/3/4/hit-6.txt`)
  expect(ids).not.toContain(`${root}/s/1/2/3/4/5/hit-7.txt`)
  expect(ids).not.toContain(`${root}/node_modules/hit-nm.js`)
  expect(ids).not.toContain(`${root}/dist/hit-dist.js`)
  expect(ran.some(a => a[0] === 'find' || a[0] === 'sh' || a[0] === 'du')).toBe(false)
  await ui.unmount()
})

// On a POSIX test host the engine resolves a bare drive root against the test folder: give the fake the drive back.
const driveRoot = (on: any) => (name: string, fn: any) =>
  on(name, name === 'fs.list' || name === 'fs.stat' ? ($: any, e: any) => fn($, { ...e, path: String(e.path).replace(/^.*\/([A-Za-z]):$/, '$1:/') }) : fn)

test('TRE-06: on Windows at a disk root the walk goes 3 deep and also skips Library, AppData and .Trash', { timeoutMs: 20_000 }, async ($, on) => {
  const root = 'C:/'
  const clock = world(driveRoot(on), {
    os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, cwd: root, top: '',
    dirs: {
      [root]: [['a', 'dir'], ['AppData', 'dir'], ['Library', 'dir'], ['.Trash', 'dir']],
      'C:/a': [['b', 'dir'], ['hit-2.txt', 'file']], 'C:/a/b': [['c', 'dir'], ['hit-3.txt', 'file']], 'C:/a/b/c': [['hit-4.txt', 'file']],
      'C:/AppData': [['hit-app.txt', 'file']], 'C:/Library': [['hit-lib.txt', 'file']], 'C:/.Trash': [['hit-trash.txt', 'file']],
    },
    status: '', numstat: '',
  }, [])
  const ui = await start($, clock, root, 200)
  await search(ui, clock, 'hit')
  const ids = await idsIn(ui)
  expect(ids).toContain('C:/a/hit-2.txt')
  expect(ids).toContain('C:/a/b/hit-3.txt')
  expect(ids).not.toContain('C:/a/b/c/hit-4.txt')
  for (const skipped of ['C:/AppData/hit-app.txt', 'C:/Library/hit-lib.txt', 'C:/.Trash/hit-trash.txt']) expect(ids).not.toContain(skipped)
  await ui.unmount()
})

test('TRE-06: on Windows the walk stops after the folder that reaches 20,000 files', { timeoutMs: 60_000 }, async ($, on) => {
  const root = 'C:/Users/k/proj'
  const clock = world(on, {
    os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, cwd: root, top: '',
    dirs: { [root]: [['a', 'dir'], ['b', 'dir'], ['c', 'dir']], [`${root}/a`]: files('a', 15_000), [`${root}/b`]: files('b', 6_000), [`${root}/c`]: [['zz-hit.txt', 'file']] },
    status: '', numstat: '',
  }, [])
  const ui = await start($, clock, root)
  await search(ui, clock, 'b05999')
  expect(await idsIn(ui)).toContain(`${root}/b/b05999.txt`)
  await search(ui, clock, 'zz-hit')
  expect(await idsIn(ui)).not.toContain(`${root}/c/zz-hit.txt`)
  await ui.unmount()
})

test('TRE-07: hidden files and folders are shown in the muted colour, unless git colours them', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['.github', 'dir'], ['.env', 'file'], ['.gitignore', 'file'], ['.new', 'file'], ['a.txt', 'file']], [`${root}/.github`]: [['ci.yml', 'file']] },
    status: '## main\0 M .gitignore\0?? .new\0', numstat: '1\t1\t.gitignore\0',
  }, [])
  const ui = await start($, clock, root)
  const ids = await idsIn(ui)
  for (const n of ['.github', '.env', '.gitignore', '.new']) expect(ids).toContain(`${root}/${n}`)
  expect(nameSeg(await rowOf(ui, `${root}/.env`), '.env')?.c).toBe(MUTED)
  expect(nameSeg(await rowOf(ui, `${root}/.github`), '.github')?.c).toBe(MUTED)
  const modified = nameSeg(await rowOf(ui, `${root}/.gitignore`), '.gitignore')?.c
  const untracked = nameSeg(await rowOf(ui, `${root}/.new`), '.new')?.c
  expect(modified).toBeDefined()
  expect(modified).not.toBe(MUTED)
  expect(untracked).toBeDefined()
  expect(untracked).not.toBe(MUTED)
  expect(nameSeg(await rowOf(ui, `${root}/a.txt`), 'a.txt')?.c).not.toBe(MUTED)
  await ui.unmount()
})

test('TRE-08: the date column shows file dates, no date for folders, and +N -N instead of the date for a changed file', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['plain.txt', 'file'], ['changed.txt', 'file']], [`${root}/src`]: [['x.ts', 'file']] },
    status: '## main\0 M changed.txt\0', numstat: '3\t1\tchanged.txt\0',
  }, [])
  const ui = await start($, clock, root)
  expect(rightText(await rowOf(ui, `${root}/plain.txt`))).toMatch(STAMP)
  expect(rightText(await rowOf(ui, `${root}/src`))).not.toMatch(STAMP)
  const changed = rightText(await rowOf(ui, `${root}/changed.txt`))
  expect(changed).not.toMatch(STAMP)
  expect(changed).toContain('+3')
  expect(changed).toContain('-1')
  await ui.unmount()
})

test('TRE-08: with column size the right column shows sizes, for files and folders, and no dates', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['plain.txt', 'file']], [`${root}/src`]: [['x.ts', 'file']] },
    status: '## main\0', numstat: '', du: { [`${root}/src`]: `4\t${root}/src\n` },
  }, [])
  const ui = await start($, clock, root)
  const file = rightText(await rowOf(ui, `${root}/plain.txt`))
  const dir = rightText(await rowOf(ui, `${root}/src`))
  expect(file).toContain('1 B')
  expect(file).not.toMatch(STAMP)
  expect(dir).toContain('4.0 K')
  expect(dir).not.toMatch(STAMP)
  await ui.unmount()
})

test('TRE-08: below 40 columns the date column is hidden, so names get the room; +N -N still shows', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs: { [root]: [['marketplace-manifest.json', 'file'], ['changed.ts', 'file']] }, status: '## main\0 M changed.ts\0', numstat: '3\t1\tchanged.ts\0' }, [])
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  for (const [columns, dated] of [[39, false], [40, true]] as const) {
    const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(columns) })
    await clock.settle()
    const plain = await rowOf(ui, `${root}/marketplace-manifest.json`)
    expect(STAMP.test(rightText(plain))).toBe(dated)
    if (!dated) expect(nameSeg(plain, 'marketplace-manifest.json')).toBeDefined()
    expect(rightText(await rowOf(ui, `${root}/changed.ts`))).toContain('+3 -1')
    await ui.unmount()
  }
})

test('TRE-08: a narrow pane keeps the size column', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const root = '/home/k/proj'
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a.txt', 'file']] }, status: '', numstat: '' }, [])
  const ui = await start($, clock, root)
  await ui.unmount()
  const narrow = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(30) })
  await clock.settle()
  expect(rightText(await rowOf(narrow, `${root}/a.txt`))).toContain('1 B')
  await narrow.unmount()
})

test('TRE-09: folder sizes come from du with a 15 s timeout, 2 jobs at a time', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const names = ['a', 'b', 'c', 'd', 'e']
  const dirs: World['dirs'] = { [root]: names.map(n => [n, 'dir'] as [string, 'dir']) }
  const du: Record<string, string> = {}
  for (const n of names) {
    dirs[`${root}/${n}`] = []
    du[`${root}/${n}`] = `8\t${root}/${n}\n`
  }
  const dus: Run[] = []
  let active = 0
  let peak = 0
  const tap = tapped(on, (e, run) => {
    if (e.argv[0] !== 'du') return undefined
    dus.push(e)
    active += 1
    peak = Math.max(peak, active)
    return run().finally(() => {
      active -= 1
    })
  })
  const clock = world(tap, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs, status: '## main\0', numstat: '', du, duDelays: names.map(() => 5_000) }, ran)
  const ui = await start($, clock, root)
  expect(dus.length).toBe(2)
  for (let i = 0; i < 4; i++) {
    await clock.advance(5_000)
    await clock.settle()
  }
  expect(peak).toBe(2)
  expect(dus.map(e => e.argv.at(-1)).sort()).toEqual(names.map(n => `${root}/${n}`))
  for (const e of dus) {
    expect(e.argv[0]).toBe('du')
    expect(e.init?.timeoutMs).toBe(15_000)
  }
  for (const n of names) expect(rightText(await rowOf(ui, `${root}/${n}`))).toContain('8.0 K')
  await ui.unmount()
})

test('TRE-09: only folders on visible rows are sized', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const names = Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, '0')}`)
  const dirs: World['dirs'] = { [root]: names.map(n => [n, 'dir'] as [string, 'dir']) }
  for (const n of names) dirs[`${root}/${n}`] = []
  dirs[`${root}/d00`] = [['inner', 'dir']]
  dirs[`${root}/d00/inner`] = []
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root, dirs, status: '## main\0', numstat: '' }, ran)
  const ui = await start($, clock, root, 10)
  await clock.advance(1_000)
  await clock.settle()
  const sized = ran.filter(a => a[0] === 'du').map(a => a.at(-1))
  expect(sized).toContain(`${root}/d00`)
  expect(sized).not.toContain(`${root}/d00/inner`)
  expect(sized).not.toContain(`${root}/d39`)
  expect(sized.length).toBeLessThanOrEqual(10)
  await ui.unmount()
})

test('TRE-09: on Windows a folder is sized by a summed listing that gives up after 50,000 entries', { timeoutMs: 60_000, options: { column: 'size' } }, async ($, on) => {
  const ran: Ran = []
  const root = 'C:/Users/k/proj'
  const clock = world(on, {
    os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, cwd: root, top: '',
    dirs: { [root]: [['fits', 'dir'], ['over', 'dir']], [`${root}/fits`]: files('f', 50_000), [`${root}/over`]: files('o', 50_001) },
    status: '', numstat: '',
  }, ran)
  const ui = await start($, clock, root)
  await clock.advance(1_000)
  await clock.settle()
  expect(rightText(await rowOf(ui, `${root}/fits`))).toContain('48.8 K')
  const over = rightText(await rowOf(ui, `${root}/over`))
  expect(over).not.toMatch(/\d/)
  expect(over).not.toContain('…')
  expect(ran.some(a => a[0] === 'du')).toBe(false)
  await ui.unmount()
})

test('TRE-10: a write re-sizes the folders above the written file', { timeoutMs: 20_000, options: { column: 'size' } }, async ($, on) => {
  const ran: Ran = []
  const root = '/home/k/proj'
  const w: World = {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['other', 'dir']], [`${root}/src`]: [['lib', 'dir']], [`${root}/src/lib`]: [['x.ts', 'file']], [`${root}/other`]: [] },
    status: '## main\0', numstat: '',
    du: { [`${root}/src`]: `4\t${root}/src\n`, [`${root}/src/lib`]: `2\t${root}/src/lib\n`, [`${root}/other`]: `1\t${root}/other\n` },
  }
  const clock = world(on, w, ran)
  const ui = await start($, clock, root)
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await clock.settle()
  await clock.advance(1_000)
  await ui.post({ press: `${root}/src/lib` }, { in: 'rows' })
  await clock.settle()
  expect(rightText(await rowOf(ui, `${root}/src`))).toContain('4.0 K')
  expect(rightText(await rowOf(ui, `${root}/src/lib`))).toContain('2.0 K')
  w.du = { [`${root}/src`]: `40\t${root}/src\n`, [`${root}/src/lib`]: `20\t${root}/src/lib\n`, [`${root}/other`]: `1\t${root}/other\n` }
  await $.tool.call({ tool: 'Write', file_path: `${root}/src/lib/x.ts`, content: 'x' } as any)
  await clock.settle()
  await clock.advance(1_000)
  await clock.settle()
  expect(rightText(await rowOf(ui, `${root}/src`))).toContain('40.0 K')
  expect(rightText(await rowOf(ui, `${root}/src/lib`))).toContain('20.0 K')
  await ui.unmount()
})

test('TRE-11: an older listing of an opened folder never overwrites a newer one', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const src = `${root}/src`
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['src', 'dir']], [src]: [['old.ts', 'file']] }, status: '', numstat: '', delays: {} }
  const clock = world(on, w, [])
  const ui = await start($, clock, root)
  await ui.post({ press: src }, { in: 'rows' })
  await clock.settle()
  expect(await idsIn(ui)).toContain(`${src}/old.ts`)
  w.delays = { [src]: [5_000] }
  await resync(ui, clock)
  w.dirs[src] = [['new.ts', 'file']]
  await resync(ui, clock)
  await clock.settle()
  expect(await idsIn(ui)).toContain(`${src}/new.ts`)
  await clock.advance(5_000)
  await clock.settle()
  const ids = await idsIn(ui)
  expect(ids).toContain(`${src}/new.ts`)
  expect(ids).not.toContain(`${src}/old.ts`)
  await ui.unmount()
})

test('TRE-11: a failed listing keeps the cached rows, at the root and in an opened folder', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const src = `${root}/src`
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['src', 'dir'], ['a.txt', 'file']], [src]: [['b.ts', 'file']] }, status: '', numstat: '' }
  const clock = world(on, w, [])
  const ui = await start($, clock, root)
  await ui.post({ press: src }, { in: 'rows' })
  await clock.settle()
  const before = await idsIn(ui)
  expect(before).toEqual([src, `${src}/b.ts`, `${root}/a.txt`])
  w.denied = [src]
  await resync(ui, clock)
  await clock.settle()
  expect(await idsIn(ui)).toEqual(before)
  w.denied = [root, src]
  await resync(ui, clock)
  await clock.settle()
  expect(await idsIn(ui)).toEqual(before)
  await ui.unmount()
})
