import { expect, test } from 'claude-code/testing'

import * as mod from '../hooks/register'
import { type Ran, type World, clientIn, opens, paneProps, texts, world } from './harness'

const term = (columns: number, isFullscreen = true) => ({ command: 'filetree', args: '', origin: { kind: 'person' }, presentation: { isFullscreen, columns } }) as any
const mountTerm = ($: any, columns: number, isFullscreen = true) =>
  $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(40), viewport: { columns, rows: 40, isFullscreen } } as any)

function linux(on: any, ran: Ran = [], extra: Partial<World> = {}) {
  const root = '/home/k/proj'
  return world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a.txt', 'file']] }, status: '', numstat: '', ...extra }, ran)
}

function tap(on: any, over: Record<string, (...a: any[]) => unknown>): any {
  return (name: string, ...rest: any[]) => {
    const hook = rest.at(-1)
    const mine = over[name]
    return on(name, ...rest.slice(0, -1), mine ? (...a: any[]) => mine(...a) ?? hook(...a) : hook)
  }
}

function closes(on: any): unknown[] {
  const closed: unknown[] = []
  on('ui.close', (_$: any, e: any) => {
    closed.push(e)
    return { value: undefined }
  })
  return closed
}

test('PLT-04: /filetree in the terminal refuses the default layout and opens nothing', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = linux(on)
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const before = opens.length
  const r = await $.command.run(term(200, false))
  await clock.settle()
  expect(JSON.stringify(r)).toContain('/tui fullscreen')
  expect(opens.length).toBe(before)
})

test('PLT-04: /filetree in the terminal needs at least 110 columns: 109 is refused, 110 opens', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = linux(on)
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const before = opens.length
  const narrow = await $.command.run(term(109))
  await clock.settle()
  expect(JSON.stringify(narrow)).toContain('110 columns')
  expect(opens.length).toBe(before)
  const wide = await $.command.run(term(110))
  await clock.settle()
  expect(JSON.stringify(wide)).toContain('File tree on')
  expect(opens.length).toBeGreaterThan(before)
  expect(opens.at(-1)).toMatchObject({ id: 'filetree', focus: true })
})

test('PLT-04: the session-start dock closes in a 109-column terminal', { timeoutMs: 20_000 }, async ($, on) => {
  const closed = closes(on)
  const clock = linux(on)
  const before = opens.length
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(opens.length).toBeGreaterThan(before)
  const ui = await mountTerm($, 109)
  await clock.settle()
  expect(closed).toHaveLength(1)
  await ui.unmount()
})

test('PLT-04: the session-start dock closes outside the fullscreen layout, however wide', { timeoutMs: 20_000 }, async ($, on) => {
  const closed = closes(on)
  const clock = linux(on)
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await mountTerm($, 300, false)
  await clock.settle()
  expect(closed).toHaveLength(1)
  await ui.unmount()
})

test('PLT-04: the session-start dock stays in a fullscreen terminal of exactly 110 columns', { timeoutMs: 20_000 }, async ($, on) => {
  const closed = closes(on)
  const clock = linux(on)
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await mountTerm($, 110)
  await clock.settle()
  expect(closed).toHaveLength(0)
  expect(await texts(ui)).toContain('a.txt')
  await ui.unmount()
})

test('PLT-05: the Desktop app docks the pane at session start with no command, and /filetree reopens it', { timeoutMs: 20_000 }, async ($, on) => {
  const closed = closes(on)
  const clock = linux(on)
  on('session.surfaces', () => ({ value: ['desktop'] }))
  const before = opens.length
  await $.session.start({ cwd: '/home/k/proj', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opens.length).toBeGreaterThan(before)
  expect(opens.at(-1)).toMatchObject({ id: 'filetree' })
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  expect(closed).toHaveLength(0)
  expect(await texts(ui)).toContain('a.txt')
  await ui.unmount()
  const mid = opens.length
  const r = await $.command.run({ command: 'filetree', args: '', origin: { kind: 'person' }, presentation: { isFullscreen: false, columns: 80 } } as any)
  await clock.settle()
  expect(JSON.stringify(r)).toContain('File tree on')
  expect(opens.length).toBeGreaterThan(mid)
  expect(opens.at(-1)).toMatchObject({ id: 'filetree', focus: true })
})

test('PLT-06: the mod exports only its register hook and works with no Node, Bun or Deno globals', { timeoutMs: 20_000 }, async ($, on) => {
  expect(Object.keys(mod)).toEqual(['register'])
  const g = globalThis as any
  for (const name of ['process', 'require', 'Bun', 'Deno', 'fetch', 'XMLHttpRequest', 'WebSocket']) expect(typeof g[name]).toBe('undefined')
  const ran: Ran = []
  const lists: string[] = []
  const clock = linux(tap(on, { 'fs.list': (_$: any, e: any) => void lists.push(e.path) }), ran)
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await mountTerm($, 160)
  await clock.settle()
  expect(await texts(ui)).toContain('a.txt')
  expect(lists).toContain('/home/k/proj')
  expect(ran.some(a => a[0] === 'git')).toBe(true)
  await ui.unmount()
})

type Os = 'darwin' | 'linux' | 'win32'

const SETUPS: Record<Os, { root: string; cwd: string; env: Record<string, string> }> = {
  darwin: { root: '/Users/k/proj', cwd: '/Users/k/proj', env: { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' } },
  linux: { root: '/home/k/proj', cwd: '/home/k/proj', env: { HOME: '/home/k' } },
  win32: { root: 'C:/Users/k/proj', cwd: 'C:\\Users\\k\\proj', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' } },
}

async function everything($: any, on: any, os: Os, repo: boolean, env: Record<string, string> = {}): Promise<Ran> {
  const ran: Ran = []
  const { root, cwd } = SETUPS[os]
  const clock = world(on, {
    os, env: { ...SETUPS[os].env, ...env }, cwd, top: repo ? root : '',
    dirs: { [root]: [['src', 'dir'], ['a.txt', 'file']], [`${root}/src`]: [['b.ts', 'file']] },
    status: repo ? '## main...origin/main\0 M src/b.ts\0' : '', numstat: repo ? '1\t0\tsrc/b.ts\0' : '',
    heads: ['aaa', 'bbb'],
    tool: (e: any) => ({ result: { stdout: '', stderr: '', interrupted: false, ...(e.command?.startsWith('gh') ? { stdout: 'https://github.com/o/r/pull/1' } : {}) } }),
  }, ran)
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await mountTerm($, 160)
  await clock.settle()
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await clock.settle()
  for (const command of ['echo hi > a.txt', 'git add -A && git commit -m x', 'git push', 'gh pr create --fill', 'gh pr merge 1 --squash', 'gh repo clone o/r']) {
    await $.tool.call({ tool: 'Bash', command } as any)
    await clock.settle()
  }
  await $.tool.call({ tool: 'Edit', file_path: `${root}/src/b.ts`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  await ui.post({ press: `${root}/a.txt` }, { in: 'rows' })
  await ui.post({ press: `${root}/a.txt` }, { in: 'rows' })
  await clock.settle()
  await ui.unmount()
  return ran
}

const ALLOWED: Record<Os, string[]> = {
  darwin: ['git', 'du', 'find', 'uname', 'touch', 'rm', 'sh', 'open'],
  linux: ['git', 'du', 'find', 'uname', 'sh'],
  win32: ['git', 'uname', 'powershell'],
}
const REQUIRED: Record<Os, string[]> = {
  darwin: ['git', 'du', 'find', 'uname', 'touch', 'rm', 'sh', 'open'],
  linux: ['git', 'du', 'find', 'uname', 'sh'],
  win32: ['git', 'powershell'],
}

for (const os of ['darwin', 'linux', 'win32'] as const) {
  for (const repo of [true, false]) {
    test(`PLT-02, PLT-07: ${os} ${repo ? 'in a repo' : 'outside a repo'} runs only ${ALLOWED[os].join(', ')}, and never gh`, { timeoutMs: 30_000, options: { open: 'app', column: 'size' } }, async ($, on) => {
      const ran = await everything($, on, os, repo)
      const exes = new Set(ran.filter(a => a[0] !== 'toast' && a[0] !== 'theme-stat').map(a => a[0] ?? ''))
      expect([...exes].filter(x => !ALLOWED[os].includes(x))).toEqual([])
      expect(exes.has('gh')).toBe(false)
      if (repo) for (const x of REQUIRED[os]) expect(exes.has(x)).toBe(true)
      if (os === 'win32') for (const x of ['find', 'du', 'sh']) expect(exes.has(x)).toBe(false)
      if (os !== 'darwin') for (const x of ['touch', 'rm', 'open']) expect(exes.has(x)).toBe(false)
    })
  }
}

test('PLT-07: on macOS touch and rm only handle change markers in the temp folder', { timeoutMs: 30_000, options: { open: 'app' } }, async ($, on) => {
  const ran = await everything($, on, 'darwin', true)
  const marks = ran.filter(a => a[0] === 'touch' || a[0] === 'rm')
  expect(marks.length).toBeGreaterThan(0)
  for (const m of marks) expect(m.slice(1).filter(x => !x.startsWith('-')).every(x => x.startsWith('/var/folders/x/T/filetree-'))).toBe(true)
})

for (const os of ['darwin', 'linux'] as const) {
  test(`PLT-07: the font probe runs sh -c with fc-list on ${os}`, { timeoutMs: 20_000 }, async ($, on) => {
    const ran: Ran = []
    const { root, cwd, env } = SETUPS[os]
    const clock = world(on, { os, env, cwd, top: '', dirs: { [root]: [['a.txt', 'file']] }, status: '', numstat: '' }, ran)
    await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
    await clock.settle()
    expect(ran.find(a => a[0] === 'sh' && a[1] === '-c' && a[2]?.includes('fc-list'))).toBeDefined()
  })
}

for (const os of ['darwin', 'linux', 'win32'] as const) {
  test(`PLT-07: on ${os} the open setting runs its own command and no default opener`, { timeoutMs: 30_000, options: { open: 'zed {path}' } }, async ($, on) => {
    const ran = await everything($, on, os, false)
    const zed = ran.find(a => a.includes('zed'))
    expect(zed).toBeDefined()
    if (os !== 'linux') expect(zed?.[0]).toBe('zed')
    const openers = ran.filter(a => ['open', 'powershell', 'gio', 'xdg-open', 'setsid'].includes(a[0] ?? '') || (a[0] === 'sh' && /setsid|xdg-open|gio/.test(a[2] ?? '')))
    expect(openers.filter(a => !a.includes('zed'))).toEqual([])
  })
}

test('PLT-07: under herdr it runs herdr --version', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await everything($, on, 'linux', true, { HERDR_ENV: '1' })).toContainEqual(['herdr', '--version'])
})

test('PLT-07: outside herdr it never runs herdr', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await everything($, on, 'linux', true)).some(a => a[0] === 'herdr')).toBe(false)
})

async function pointerUnder($: any, on: any, version: string | null): Promise<{ pointer: unknown; ran: Ran }> {
  const ran: Ran = []
  const herdr = (_$: any, e: any) => {
    if (e.argv[0] !== 'herdr') return undefined
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: `herdr ${version}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  }
  const clock = linux(tap(on, { 'process.run': herdr }), ran, { env: { HOME: '/home/k', ...(version === null ? {} : { HERDR_ENV: '1' }) } })
  await $.session.start({ cwd: '/home/k/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const ui = await mountTerm($, 160)
  await clock.settle()
  const pointer = clientIn(await ui.drawn()).props.props.pointer
  await ui.unmount()
  return { pointer, ran }
}

for (const [version, ok] of [['0.9.0', false], ['0.8.9', false], ['0.9.1', true], ['0.9.12', true], ['0.10.0', true], ['1.0.0', true]] as const) {
  test(`PLT-08: under herdr ${version} the rows ${ok ? 'take' : 'ignore'} the mouse`, { timeoutMs: 20_000 }, async ($, on) => {
    const { pointer, ran } = await pointerUnder($, on, version)
    expect(ran.some(a => a[0] === 'herdr' && a[1] === '--version')).toBe(true)
    expect(pointer).toBe(ok)
  })
}

test('PLT-08: outside herdr the rows take the mouse', { timeoutMs: 20_000 }, async ($, on) => {
  const { pointer, ran } = await pointerUnder($, on, null)
  expect(ran.some(a => a[0] === 'herdr')).toBe(false)
  expect(pointer).toBe(true)
})
