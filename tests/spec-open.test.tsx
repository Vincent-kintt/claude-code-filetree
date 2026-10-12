import { expect, test } from 'claude-code/testing'

import { LINUX_LAUNCH, LINUX_OPEN } from '../hooks/features/open/model'
import { type Ran, type World, envs, paneProps, world } from './harness'

type Os = World['os']
type Over = Record<string, (orig: (...a: any[]) => any) => (...a: any[]) => any>
type Rig = { ran: Ran; inits: { argv: string[]; init: any }[]; reads: string[]; ui: any; clock: any; root: string }

const ROOTS: Record<Os, string> = { darwin: '/Users/k/proj', linux: '/home/k/proj', win32: 'C:/Users/k/proj' }
const ENVS: Record<Os, Record<string, string>> = { darwin: { HOME: '/Users/k' }, linux: { HOME: '/home/k' }, win32: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' } }
const OPENERS = ['open', 'sh', 'powershell', 'zed', 'code', 'glow', 'evince', 'my-viewer']

async function rig($: any, on: any, os: Os, files: Record<string, string>, opts: { surface?: string; over?: Over; exits?: World['exits'] } = {}): Promise<Rig> {
  const root = ROOTS[os]
  const ran: Ran = []
  const inits: Rig['inits'] = []
  const reads: string[] = []
  const user = opts.over ?? {}
  const over: Over = {
    ...user,
    'process.run': h => (_$: any, e: any) => {
      inits.push({ argv: [...e.argv], init: e.init })
      return (user['process.run']?.(h) ?? h)(_$, e)
    },
    'fs.read': h => (_$: any, e: any) => {
      reads.push(e.path)
      return (user['fs.read']?.(h) ?? h)(_$, e)
    },
  }
  const hook = (name: string, ...rest: any[]) => {
    const h = rest.at(-1)
    const wrap = over[name]
    return wrap ? on(name, ...rest.slice(0, -1), wrap(h)) : on(name, ...rest)
  }
  const w: World = {
    os, env: ENVS[os], cwd: os === 'win32' ? root.replace(/\//g, '\\') : root, top: '', status: '', numstat: '',
    dirs: { [root]: Object.keys(files).map(name => [name, 'file'] as [string, 'file']) },
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [`${root.replace(/^[A-Za-z]:/, '')}/${name}`, text])),
    exits: opts.exits,
  }
  const clock = world(hook, w, ran)
  const surface = opts.surface ?? 'terminal'
  await $.session.start({ cwd: w.cwd, surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  return { ran, inits, reads, ui, clock, root }
}

const openers = (r: Rig) => r.inits.filter(x => OPENERS.includes(x.argv[0] ?? '') && !(x.argv[0] === 'sh' && !x.argv[2]?.includes('setsid')))
const toasts = (r: Rig) => r.ran.filter(a => a[0] === 'toast').map(a => a[1] ?? '')

async function dbl(r: Rig, name: string): Promise<void> {
  await r.ui.post({ press: `${r.root}/${name}` }, { in: 'rows' })
  await r.ui.post({ press: `${r.root}/${name}` }, { in: 'rows' })
  await r.clock.settle()
}

const drawn = async (r: Rig) => JSON.stringify(await r.ui.drawn())
const rowsDrawn = async (r: Rig) => JSON.stringify(await r.ui.drawn({ in: 'rows' }).catch(() => null))

const appArgv = (os: Os, path: string) =>
  os === 'darwin' ? ['open', '--', path] : os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', 'sh', '-c', LINUX_OPEN, 'sh', path] : null

for (const surface of ['terminal', 'desktop']) {
  test(`OPN-01: on ${surface}, a double-click, Enter, Ctrl-click and Shift-click each open a file; a single click does not`, { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
    const r = await rig($, on, 'darwin', { 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c', 'd.ts': 'd' }, { surface })
    await r.ui.post({ press: `${r.root}/a.ts` }, { in: 'rows' })
    await r.clock.settle()
    expect(openers(r)).toEqual([])
    await r.ui.post({ press: `${r.root}/a.ts` }, { in: 'rows' })
    await r.clock.settle()
    expect(openers(r).map(x => x.argv)).toEqual([['open', '--', `${r.root}/a.ts`]])
    await r.ui.post({ press: `${r.root}/b.ts`, ctrl: true }, { in: 'rows' })
    await r.clock.settle()
    expect(openers(r).at(-1)?.argv).toEqual(['open', '--', `${r.root}/b.ts`])
    await r.ui.post({ press: `${r.root}/c.ts`, shift: true }, { in: 'rows' })
    await r.clock.settle()
    expect(openers(r).at(-1)?.argv).toEqual(['open', '--', `${r.root}/c.ts`])
    await r.ui.post({ key: 'end' }, { in: 'rows' })
    await r.ui.post({ key: 'return' }, { in: 'rows' })
    await r.clock.settle()
    expect(openers(r).at(-1)?.argv).toEqual(['open', '--', `${r.root}/d.ts`])
    expect(openers(r).length).toBe(4)
    await r.ui.unmount()
  })
}

test('OPN-01: two clicks on different files are not a double-click and open nothing', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.ts': 'a', 'b.ts': 'b' })
  await r.ui.post({ press: `${r.root}/a.ts` }, { in: 'rows' })
  await r.ui.post({ press: `${r.root}/b.ts` }, { in: 'rows' })
  await r.clock.settle()
  expect(openers(r)).toEqual([])
  await r.ui.unmount()
})

for (const [label, options] of [['unset', {}], ['empty', { open: '' }], ['blank', { open: '   ' }], ['whitespace', { open: '\t \n' }], ['preview', { open: 'preview' }]] as const) {
  test(`OPN-02, CFG-05: open ${label} counts as preview: a double-click shows the viewer and runs no opener`, { timeoutMs: 20_000, options }, async ($, on) => {
    const r = await rig($, on, 'darwin', { 'notes.md': '# Title\n\nbody text\n' })
    await dbl(r, 'notes.md')
    expect(await drawn(r) + await rowsDrawn(r)).toContain('# Title')
    expect(await drawn(r)).toContain('Open in app ↗')
    expect(openers(r)).toEqual([])
    expect(toasts(r)).toEqual([])
    await r.ui.unmount()
  })
}

test('CFG-05: open app opens in the default app, not the viewer', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'notes.md': '# Title\n' })
  await dbl(r, 'notes.md')
  expect(openers(r).map(x => x.argv)).toEqual([['open', '--', `${r.root}/notes.md`]])
  expect(await drawn(r)).not.toContain('Open in app ↗')
  expect(r.reads.some(p => p.endsWith('notes.md'))).toBe(false)
  await r.ui.unmount()
})

test('CFG-05: any other value runs as a command, not the viewer and not the default app', { timeoutMs: 20_000, options: { open: 'my-viewer' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'notes.md': '# Title\n' })
  await dbl(r, 'notes.md')
  expect(openers(r).map(x => x.argv)).toEqual([['my-viewer', `${r.root}/notes.md`]])
  expect(await drawn(r)).not.toContain('Open in app ↗')
  await r.ui.unmount()
})

test('OPN-03: in the terminal the viewer renders Markdown for .md and highlighted Code for source files', { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'notes.md': '# Title\n\n*em*\n', 'a.ts': 'const a: number = 1\n' })
  await dbl(r, 'notes.md')
  let shown = await rowsDrawn(r)
  expect(shown).toContain('"type":"Markdown"')
  expect(shown).toContain('# Title')
  expect(shown).not.toContain('"type":"Code"')
  await r.ui.post({ key: 'left' }, { in: 'rows' })
  await r.clock.settle()
  await dbl(r, 'a.ts')
  shown = await rowsDrawn(r)
  expect(shown).toContain('"type":"Code"')
  expect(shown).toContain(`"path":"${r.root}/a.ts"`)
  expect(shown).toContain('const a: number = 1')
  expect(openers(r)).toEqual([])
  await r.ui.unmount()
})

test('OPN-03: in the Desktop app the viewer renders Markdown for .md and highlighted Code for source files', { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'notes.md': '# Title\n\n*em*\n', 'a.ts': 'const a: number = 1\n' }, { surface: 'desktop' })
  await dbl(r, 'notes.md')
  let shown = await drawn(r)
  expect(shown).toContain('"type":"Markdown"')
  expect(shown).toContain('# Title')
  expect(shown).toContain('Open in app ↗')
  await r.ui.press({ key: 'back' })
  await r.clock.settle()
  await dbl(r, 'a.ts')
  shown = await drawn(r)
  expect(shown).toContain('"type":"Code"')
  expect(shown).toContain(`"path":"${r.root}/a.ts"`)
  expect(shown).toContain('const a: number = 1')
  expect(openers(r)).toEqual([])
  await r.ui.unmount()
})

for (const os of ['darwin', 'linux', 'win32'] as const) {
  for (const surface of ['terminal', 'desktop']) {
    test(`OPN-03, OPN-08: on ${os} ${surface}, Open in app ↗ in the viewer uses the OS default app`, { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
      const r = await rig($, on, os, { 'a.ts': 'const a = 1\n' }, { surface })
      await dbl(r, 'a.ts')
      expect(openers(r)).toEqual([])
      await r.ui.press({ key: 'external' })
      await r.clock.settle()
      const run = openers(r)
      expect(run.length).toBe(1)
      const want = appArgv(os, `${r.root}/a.ts`)
      if (want) expect(run[0]?.argv).toEqual(want)
      else {
        expect(run[0]?.argv[0]).toBe('powershell')
        expect(run[0]?.argv.at(-1)).toContain('Diagnostics.Process]::Start')
        expect(run[0]?.argv.at(-1)).toContain('UseShellExecute = $true')
        expect(envs.at(-1)).toEqual({ PANE_OPEN_TARGET: 'C:\\Users\\k\\proj\\a.ts' })
      }
      await r.ui.unmount()
    })
  }
}

test('OPN-04: the preview refuses a file over 4 MB without reading it', { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
  const sizes: Record<string, number> = { 'big.log': 4_194_305, 'edge.log': 4_000_000 }
  const over: Over = {
    'fs.stat': h => (_$: any, e: any) => {
      const name = String(e.path).split('/').pop() ?? ''
      return name in sizes ? { value: { kind: 'file', size: sizes[name], mtimeMs: 1_700_000_000_000, isLink: false } } : h(_$, e)
    },
  }
  const r = await rig($, on, 'darwin', { 'big.log': 'SECRET BIG BODY', 'edge.log': 'edge body' }, { over })
  await dbl(r, 'big.log')
  const shown = await drawn(r) + await rowsDrawn(r)
  expect(shown).toContain('too large to preview')
  expect(shown).not.toContain('SECRET BIG BODY')
  expect(r.reads.some(p => p.endsWith('big.log'))).toBe(false)
  expect(openers(r)).toEqual([])
  expect(toasts(r)).toEqual([])
  await r.ui.post({ key: 'left' }, { in: 'rows' })
  await r.clock.settle()
  await dbl(r, 'edge.log')
  const edge = await drawn(r) + await rowsDrawn(r)
  expect(edge).toContain('edge body')
  expect(edge).not.toContain('too large')
  await r.ui.unmount()
})

for (const surface of ['terminal', 'desktop']) {
  test(`OPN-04: on ${surface}, the preview says when a file is binary and draws none of it`, { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
    const r = await rig($, on, 'darwin', { 'blob.bin': `MAGIC\u0000\u0001\u0002${'x'.repeat(100)}` }, { surface })
    await dbl(r, 'blob.bin')
    const shown = await drawn(r) + await rowsDrawn(r)
    expect(shown).toContain('binary file')
    expect(shown).not.toContain('MAGIC')
    expect(openers(r)).toEqual([])
    expect(toasts(r)).toEqual([])
    await r.ui.unmount()
  })
}

test('OPN-05: a command without {path} gets the path added at the end, run directly with no shell', { timeoutMs: 20_000, options: { open: 'zed --new -w' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a b.md': 'x' })
  await dbl(r, 'a b.md')
  expect(openers(r).map(x => x.argv)).toEqual([['zed', '--new', '-w', `${r.root}/a b.md`]])
  expect(r.inits.some(x => x.argv.includes('zed --new -w'))).toBe(false)
  await r.ui.unmount()
})

test('OPN-05: {path} and {dir} are replaced wherever they appear, quotes keep a word whole, and the path is not added again', { timeoutMs: 20_000, options: { open: `code --goto {path}:1 --folder "{dir}" '--label=in {dir}'` } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  expect(openers(r).map(x => x.argv)).toEqual([['code', '--goto', `${r.root}/a.ts:1`, '--folder', r.root, `--label=in ${r.root}`]])
  await r.ui.unmount()
})

test('OPN-05: {dir} alone still gets the path added at the end', { timeoutMs: 20_000, options: { open: 'my-viewer --cwd {dir}' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  expect(openers(r).map(x => x.argv)).toEqual([['my-viewer', '--cwd', r.root, `${r.root}/a.ts`]])
  await r.ui.unmount()
})

test('OPN-05: on Windows the command runs directly with native paths, without a shell', { timeoutMs: 20_000, options: { open: 'code -g {path} --dir {dir}' } }, async ($, on) => {
  const r = await rig($, on, 'win32', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  expect(openers(r).map(x => x.argv)).toEqual([['code', '-g', 'C:\\Users\\k\\proj\\a.ts', '--dir', 'C:\\Users\\k\\proj']])
  expect(r.inits.some(x => ['cmd', 'powershell', 'sh'].includes(x.argv[0] ?? ''))).toBe(false)
  await r.ui.unmount()
})

test('OPN-05: on Linux the command words stay separate arguments to the detached launcher, never one shell string', { timeoutMs: 20_000, options: { open: 'evince --page 2 {path}' } }, async ($, on) => {
  const r = await rig($, on, 'linux', { 'a.pdf': 'x' })
  await dbl(r, 'a.pdf')
  expect(openers(r).map(x => x.argv)).toEqual([['sh', '-c', LINUX_LAUNCH, 'sh', 'evince', '--page', '2', `${r.root}/a.pdf`]])
  expect(LINUX_LAUNCH).toContain('"$@"')
  expect(LINUX_LAUNCH).not.toContain('evince')
  await r.ui.unmount()
})

const NASTY = `x $(touch pwned); rm -rf ~ \`id\` "q" 'q' & | * %USERNAME% {dir}.md`

for (const os of ['darwin', 'linux', 'win32'] as const) {
  test(`OPN-06: on ${os}, the default app gets a hostile file name as one literal argument, outside any script`, { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
    const r = await rig($, on, os, { [NASTY]: 'x' })
    await dbl(r, NASTY)
    const run = openers(r)
    expect(run.length).toBe(1)
    const argv = run[0]?.argv ?? []
    if (os === 'win32') {
      expect(argv.join(' ')).not.toContain('pwned')
      expect(envs.at(-1)).toEqual({ PANE_OPEN_TARGET: `C:\\Users\\k\\proj\\${NASTY}` })
    } else {
      expect(argv.at(-1)).toBe(`${r.root}/${NASTY}`)
      expect(argv.slice(0, -1).some(a => a.includes('pwned'))).toBe(false)
    }
    await r.ui.unmount()
  })

  test(`OPN-06: on ${os}, a custom command gets a hostile file name as one literal argument`, { timeoutMs: 20_000, options: { open: 'my-viewer --file={path}' } }, async ($, on) => {
    const r = await rig($, on, os, { [NASTY]: 'x' })
    await dbl(r, NASTY)
    const argv = openers(r)[0]?.argv ?? []
    const path = os === 'win32' ? `C:\\Users\\k\\proj\\${NASTY}` : `${r.root}/${NASTY}`
    expect(argv.at(-1)).toBe(`--file=${path}`)
    expect(argv.slice(0, -1).some(a => a.includes('pwned'))).toBe(false)
    await r.ui.unmount()
  })
}

test('OPN-07: a default opener that exits non-zero shows a toast', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.xyz': 'x' }, { exits: { open: [1, 'No application knows how to open a.xyz\n'] } })
  await dbl(r, 'a.xyz')
  expect(toasts(r).length).toBe(1)
  expect(toasts(r)[0]).toContain('a.xyz')
  expect(toasts(r)[0]).toContain('No application knows how to open')
  await r.ui.unmount()
})

test('OPN-07: a custom command that exits non-zero with no stderr still shows a toast', { timeoutMs: 20_000, options: { open: 'my-viewer' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.ts': 'x' }, { exits: { 'my-viewer': [3, ''] } })
  await dbl(r, 'a.ts')
  expect(toasts(r).length).toBe(1)
  expect(toasts(r)[0]).toContain('a.ts')
  await r.ui.unmount()
})

for (const [label, options] of [['default app', { open: 'app' }], ['custom command', { open: 'my-viewer' }]] as const) {
  test(`OPN-07: a ${label} that fails to start shows a toast`, { timeoutMs: 20_000, options }, async ($, on) => {
    const over: Over = {
      'process.run': h => (_$: any, e: any) => {
        if (['open', 'my-viewer'].includes(e.argv[0])) throw new Error('spawn ENOENT')
        return h(_$, e)
      },
    }
    const r = await rig($, on, 'darwin', { 'a.ts': 'x' }, { over })
    await dbl(r, 'a.ts')
    expect(toasts(r).length).toBe(1)
    expect(toasts(r)[0]).toContain('could not open')
    await r.ui.unmount()
  })
}

test('OPN-07: an opener that exits zero shows no toast', { timeoutMs: 20_000, options: { open: 'my-viewer' } }, async ($, on) => {
  const r = await rig($, on, 'darwin', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  expect(openers(r).length).toBe(1)
  expect(toasts(r)).toEqual([])
  await r.ui.unmount()
})

for (const os of ['darwin', 'win32'] as const) {
  test(`OPN-07: on ${os}, a custom command gets a 10 s limit and one that outlives it is reported`, { timeoutMs: 20_000, options: { open: 'code --wait' } }, async ($, on) => {
    const over: Over = {
      'process.run': h => (_$: any, e: any) => {
        if (e.argv[0] === 'code') throw new Error(`process timed out after ${e.init?.timeoutMs} ms`)
        return h(_$, e)
      },
    }
    const r = await rig($, on, os, { 'a.ts': 'x' }, { over })
    await dbl(r, 'a.ts')
    const run = r.inits.find(x => x.argv[0] === 'code')
    expect(run?.argv.slice(0, 2)).toEqual(['code', '--wait'])
    expect(run?.init?.timeoutMs).toBe(10_000)
    expect(toasts(r).length).toBe(1)
    expect(toasts(r)[0]).toContain('could not open')
    await r.ui.unmount()
  })
}

for (const [label, options, tail] of [['default app', { open: 'app' }, ['sh', 'sh', '-c', LINUX_OPEN, 'sh']], ['custom command', { open: 'code --wait' }, ['sh', 'code', '--wait']]] as const) {
  test(`OPN-07: on Linux the ${label} runs detached and only its first second counts`, { timeoutMs: 20_000, options }, async ($, on) => {
    const r = await rig($, on, 'linux', { 'a.ts': 'x' })
    await dbl(r, 'a.ts')
    const run = openers(r)
    expect(run.length).toBe(1)
    expect(run[0]?.argv).toEqual(['sh', '-c', LINUX_LAUNCH, ...tail, `${r.root}/a.ts`])
    expect(LINUX_LAUNCH).toContain('setsid -f')
    expect(LINUX_LAUNCH).toContain('</dev/null >/dev/null 2>&1 &')
    expect(LINUX_LAUNCH).toContain('sleep 1; kill -0 "$p" 2>/dev/null && exit 0')
    await r.ui.unmount()
  })
}

test('OPN-07: on Linux a detached opener that fails within its first second shows a toast', { timeoutMs: 20_000, options: { open: 'evince' } }, async ($, on) => {
  const r = await rig($, on, 'linux', { 'a.pdf': 'x' }, { exits: { sh: [127, 'evince: not found\n'] } })
  await dbl(r, 'a.pdf')
  expect(toasts(r).some(t => t.includes('evince: not found'))).toBe(true)
  await r.ui.unmount()
})

for (const surface of ['terminal', 'desktop']) {
  test(`OPN-07: on ${surface}, a file the preview can't read gets a note in the viewer, not a toast`, { timeoutMs: 20_000, options: { open: 'preview' } }, async ($, on) => {
    const over: Over = {
      'fs.read': h => (_$: any, e: any) => {
        if (String(e.path).endsWith('locked.txt')) return { deny: 'EACCES: permission denied' }
        return h(_$, e)
      },
    }
    const r = await rig($, on, 'darwin', { 'locked.txt': 'hidden' }, { surface, over })
    await dbl(r, 'locked.txt')
    const shown = await drawn(r) + await rowsDrawn(r)
    expect(shown).toContain('could not read')
    expect(shown).toContain('EACCES')
    expect(toasts(r)).toEqual([])
    expect(openers(r)).toEqual([])
    await r.ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop']) {
  test(`OPN-08: on ${surface}, open app on macOS runs open -- <path>`, { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
    const r = await rig($, on, 'darwin', { 'a.ts': 'x' }, { surface })
    await dbl(r, 'a.ts')
    expect(openers(r).map(x => x.argv)).toEqual([['open', '--', `${r.root}/a.ts`]])
    await r.ui.unmount()
  })
}

test('OPN-08: open app on Linux runs gio, falling back to xdg-open, detached through setsid', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const r = await rig($, on, 'linux', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  expect(openers(r).map(x => x.argv)).toEqual([['sh', '-c', LINUX_LAUNCH, 'sh', 'sh', '-c', LINUX_OPEN, 'sh', `${r.root}/a.ts`]])
  expect(LINUX_OPEN).toContain('gio open "$f"')
  expect(LINUX_OPEN).toContain('exec xdg-open "$f"')
  expect(LINUX_LAUNCH).toContain('setsid -f')
  expect(r.inits.some(x => ['open', 'powershell'].includes(x.argv[0] ?? ''))).toBe(false)
  await r.ui.unmount()
})

test('OPN-08: open app on Windows runs PowerShell Process.Start with the shell-execute default app', { timeoutMs: 20_000, options: { open: 'app' } }, async ($, on) => {
  const r = await rig($, on, 'win32', { 'a.ts': 'x' })
  await dbl(r, 'a.ts')
  const run = openers(r)
  expect(run.length).toBe(1)
  expect(run[0]?.argv.slice(0, 3)).toEqual(['powershell', '-NoProfile', '-NonInteractive'])
  expect(run[0]?.argv.at(-1)).toContain('[Diagnostics.Process]::Start')
  expect(run[0]?.argv.at(-1)).toContain('UseShellExecute = $true')
  expect(run[0]?.init?.env).toEqual({ PANE_OPEN_TARGET: 'C:\\Users\\k\\proj\\a.ts' })
  expect(r.inits.some(x => ['open', 'sh', 'cmd'].includes(x.argv[0] ?? ''))).toBe(false)
  await r.ui.unmount()
})
