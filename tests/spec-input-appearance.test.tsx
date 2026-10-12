import { expect, test } from 'claude-code/testing'

import { fileIcon } from '../hooks/icons'
import Rows, { type RowsProps } from '../hooks/rows'
import { type Ran, type World, NERD, STAMP, clientIn, paneProps, resync, shimmer, texts, world } from './harness'

const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

// The harness answers the font probe with "missing": `font` makes `sh` answer ok, stale or missing instead.
function withFont(on: any, ran: Ran, font?: string) {
  if (font === undefined) return on
  return (name: string, handler: any) =>
    name !== 'process.run'
      ? on(name, handler)
      : on(name, async ($: any, e: any) => {
          if (e.argv[0] !== 'sh') return handler($, e)
          ran.push([...e.argv])
          return done(`${font}\n`)
        })
}

type Setup = Partial<World> & { cwd: string; dirs: World['dirs']; surface?: 'terminal' | 'desktop'; font?: string; bodyRows?: number }

async function pane($: any, on: any, s: Setup) {
  const ran: Ran = []
  const { surface = 'terminal', font, bodyRows = 40, ...rest } = s
  const w: World = { os: 'linux', env: { HOME: '/home/k' }, top: '', status: '', numstat: '', ...rest }
  const clock = world(withFont(on, ran, font), w, ran)
  const copied: string[] = []
  on('ui.copy', (_$: any, e: any) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  await $.session.start({ cwd: w.cwd, surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: { ...paneProps(60), scroll: { offset: 0, bodyRows } } })
  await clock.settle()
  const rows = async (): Promise<RowsProps> => clientIn(await ui.drawn()).props.props
  const ids = async () => (await rows()).rows.map(r => r.id)
  const key = async (k: string) => {
    await ui.post({ key: k }, { in: 'rows' })
    await clock.settle()
  }
  const click = async (id: string, extra: Record<string, unknown> = {}) => {
    await ui.post({ press: id, ...extra }, { in: 'rows' })
    await clock.settle()
  }
  return { w, ran, clock, ui, rows, ids, key, click, copied }
}

const files = (n: number) => Array.from({ length: n }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'file'] as [string, 'file'])

function client(rows: RowsProps['rows'], columns = 40) {
  let pointer: (e: any) => void = () => undefined
  let keys: (e: any) => void = () => undefined
  const posts: unknown[] = []
  const surface: any = {
    elements: { Box: (p: any) => p, Text: (p: any) => p, Markdown: (p: any) => p, Code: (p: any) => p },
    state: undefined,
    setState(s: any) {
      surface.state = s
    },
    every: () => () => undefined,
    onPointer: (f: any) => {
      pointer = f
      return () => undefined
    },
    onKey: (f: any) => {
      keys = f
    },
    post: (m: unknown) => posts.push(m),
    columns,
  }
  ;(Rows as any)({ rows, active: '', activeBg: '', hoverBg: '', tones: {} }, surface)
  return { posts, pointer: (e: any) => pointer(e), keys: (e: any) => keys(e) }
}

test('INP-01: ↑/↓ and j/k move one row, PgUp/PgDn move 10, Home/End go to the first and last row', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/list'
  const { ui, rows, key } = await pane($, on, { cwd: root, dirs: { [root]: files(30) } })
  const at = async () => (await rows()).active
  await key('home')
  expect(await at()).toBe(`${root}/f00.txt`)
  await key('down')
  expect(await at()).toBe(`${root}/f01.txt`)
  await key('j')
  expect(await at()).toBe(`${root}/f02.txt`)
  await key('k')
  expect(await at()).toBe(`${root}/f01.txt`)
  await key('up')
  expect(await at()).toBe(`${root}/f00.txt`)
  await key('up')
  expect(await at()).toBe(`${root}/f00.txt`)
  await key('pagedown')
  expect(await at()).toBe(`${root}/f10.txt`)
  await key('pagedown')
  expect(await at()).toBe(`${root}/f20.txt`)
  await key('pageup')
  expect(await at()).toBe(`${root}/f10.txt`)
  await key('end')
  expect(await at()).toBe(`${root}/f29.txt`)
  await key('down')
  expect(await at()).toBe(`${root}/f29.txt`)
  await key('pageup')
  expect(await at()).toBe(`${root}/f19.txt`)
  await key('home')
  expect(await at()).toBe(`${root}/f00.txt`)
  await ui.unmount()
})

test('INP-01: the rows forward every key the terminal sends them', () => {
  const c = client([{ id: '/a/b', left: [{ t: 'b' }], right: [] }])
  for (const k of ['up', 'down', 'j', 'k', 'pageup', 'pagedown', 'home', 'end']) c.keys({ key: k })
  expect(c.posts.map((p: any) => p.key)).toEqual(['up', 'down', 'j', 'k', 'pageup', 'pagedown', 'home', 'end'])
})

test('INP-02: →/l expands a folder, ←/h collapses it, and on a file or a closed folder goes to the parent', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const a = `${root}/a`
  const b = `${a}/b`
  const { ui, rows, ids, key } = await pane($, on, { cwd: root, dirs: { [root]: [['a', 'dir'], ['z.txt', 'file']], [a]: [['b', 'dir'], ['x.txt', 'file']], [b]: [['y.txt', 'file']] } })
  const at = async () => (await rows()).active
  await key('home')
  expect(await at()).toBe(a)
  expect(await ids()).not.toContain(`${a}/x.txt`)
  await key('right')
  expect(await ids()).toContain(`${a}/x.txt`)
  await key('left')
  expect(await ids()).not.toContain(`${a}/x.txt`)
  expect(await at()).toBe(a)
  await key('l')
  expect(await ids()).toContain(`${a}/x.txt`)
  await key('down')
  expect(await at()).toBe(b)
  await key('l')
  expect(await ids()).toContain(`${b}/y.txt`)
  await key('down')
  expect(await at()).toBe(`${b}/y.txt`)
  await key('h')
  expect(await at()).toBe(b)
  expect(await ids()).toContain(`${b}/y.txt`)
  await key('h')
  expect(await ids()).not.toContain(`${b}/y.txt`)
  expect(await at()).toBe(b)
  await key('left')
  expect(await at()).toBe(a)
  await key('h')
  expect(await ids()).not.toContain(b)
  await ui.unmount()
})

test('INP-03: Enter opens a file and toggles a folder, Space toggles a folder', { timeoutMs: 20_000, options: { open: 'viewer' } }, async ($, on) => {
  const root = '/Users/k/proj'
  const sub = `${root}/sub`
  const { ui, ran, rows, ids, key } = await pane($, on, { os: 'darwin', env: { HOME: '/Users/k' }, cwd: root, dirs: { [root]: [['sub', 'dir'], ['a.md', 'file']], [sub]: [['b.md', 'file']] } })
  await key('home')
  expect((await rows()).active).toBe(sub)
  await key('return')
  expect(await ids()).toContain(`${sub}/b.md`)
  await key('return')
  expect(await ids()).not.toContain(`${sub}/b.md`)
  await key(' ')
  expect(await ids()).toContain(`${sub}/b.md`)
  await key(' ')
  expect(await ids()).not.toContain(`${sub}/b.md`)
  expect(ran.some(a => a[0] === 'viewer')).toBe(false)
  await key('down')
  expect((await rows()).active).toBe(`${root}/a.md`)
  await key('return')
  expect(ran).toContainEqual(['viewer', `${root}/a.md`])
  await ui.unmount()
})

test('INP-04: y copies the relative path and Y the absolute path', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const { ui, key, copied, ran } = await pane($, on, { cwd: root, dirs: { [root]: [['src', 'dir']], [`${root}/src`]: [['b.txt', 'file']] } })
  await key('home')
  await key('right')
  await key('down')
  await key('y')
  await key('Y')
  expect(copied).toEqual(['src/b.txt', `${root}/src/b.txt`])
  expect(ran.filter(a => a[0] === 'toast').map(a => a[1])).toEqual(['Copied src/b.txt', `Copied ${root}/src/b.txt`])
  await ui.unmount()
})

test('INP-04: right-click copies the path and Shift+right-click the absolute path', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const row = { id: `${root}/src/b.txt`, left: [{ t: 'b.txt' }], right: [] }
  const c = client([row])
  c.pointer({ type: 'down', button: 'right', x: 2, y: 0 })
  c.pointer({ type: 'down', button: 'right', x: 2, y: 0, shift: true })
  expect(c.posts).toEqual([{ copy: row.id, shift: false }, { copy: row.id, shift: true }])
  const { ui, clock, copied } = await pane($, on, { cwd: root, dirs: { [root]: [['src', 'dir']], [`${root}/src`]: [['b.txt', 'file']] } })
  for (const p of c.posts) await ui.post(p, { in: 'rows' })
  await clock.settle()
  expect(copied).toEqual(['src/b.txt', `${root}/src/b.txt`])
  await ui.unmount()
})

test('INP-05: two clicks on a file within 450 ms open it, slower clicks do not', { timeoutMs: 20_000, options: { open: 'viewer' } }, async ($, on) => {
  const root = '/Users/k/proj'
  const { ui, ran, clock, click } = await pane($, on, { os: 'darwin', env: { HOME: '/Users/k' }, cwd: root, dirs: { [root]: [['a.md', 'file'], ['b.md', 'file'], ['c.md', 'file']] } })
  const opened = (p: string) => ran.filter(a => a[0] === 'viewer' && a[1] === p).length
  await click(`${root}/a.md`)
  await clock.advance(449)
  await click(`${root}/a.md`)
  expect(opened(`${root}/a.md`)).toBe(1)
  await clock.advance(1_000)
  await click(`${root}/b.md`)
  await clock.advance(460)
  await click(`${root}/b.md`)
  expect(opened(`${root}/b.md`)).toBe(0)
  await clock.advance(1_000)
  await click(`${root}/a.md`)
  await clock.advance(100)
  await click(`${root}/c.md`)
  expect(opened(`${root}/a.md`)).toBe(1)
  expect(opened(`${root}/c.md`)).toBe(0)
  await ui.unmount()
})

test('INP-05: a left click posts a press for the row under the pointer', () => {
  const c = client([{ id: '/r/a.md', left: [{ t: 'a.md' }], right: [] }, { id: '/r/b.md', left: [{ t: 'b.md' }], right: [] }])
  c.pointer({ type: 'down', button: 'left', x: 1, y: 1 })
  c.pointer({ type: 'down', button: 'left', x: 1, y: 1, ctrl: true })
  expect(c.posts).toEqual([{ press: '/r/b.md', ctrl: false, shift: false }, { press: '/r/b.md', ctrl: true, shift: false }])
})

test('INP-06: the mouse wheel moves at least 3 rows a tick, and more when the host asks for more', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/big'
  const { ui, clock, ids } = await pane($, on, { cwd: root, dirs: { [root]: files(60) }, bodyRows: 20 })
  const wheel = async (by: number) => {
    await $.ui.scroll({ component: 'Pane', requestId: 'filetree', by } as any)
    await clock.settle()
    return (await ids())[0]
  }
  expect((await ids())[0]).toBe(`${root}/f00.txt`)
  expect(await wheel(1)).toBe(`${root}/f03.txt`)
  expect(await wheel(1)).toBe(`${root}/f06.txt`)
  expect(await wheel(-1)).toBe(`${root}/f03.txt`)
  expect(await wheel(5)).toBe(`${root}/f08.txt`)
  expect(await wheel(-2)).toBe(`${root}/f05.txt`)
  await ui.unmount()
})

test('INP-06: a click never jumps the view, at the top, in the middle or at the bottom row', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/big'
  const { ui, clock, ids, rows, click } = await pane($, on, { cwd: root, dirs: { [root]: files(60) }, bodyRows: 20 })
  await $.ui.scroll({ component: 'Pane', requestId: 'filetree', by: 4 } as any)
  await clock.settle()
  expect((await ids())[0]).toBe(`${root}/f04.txt`)
  for (const at of ['top', 'middle', 'bottom']) {
    const view = await ids()
    const id = view[at === 'top' ? 0 : at === 'middle' ? Math.floor(view.length / 2) : view.length - 1] ?? ''
    await clock.advance(1_000)
    await click(id)
    expect((await ids())[0]).toBe(`${root}/f04.txt`)
    expect(await ids()).toContain(id)
    expect((await rows()).active).toBe(id)
  }
  await ui.unmount()
})

test('APP-01: glyphs auto uses Nerd Font icons when a Nerd Font is installed and the terminal started after it', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const { ui, ran } = await pane($, on, { cwd: root, dirs: { [root]: [['src', 'dir'], ['a.ts', 'file']] }, font: 'ok' })
  expect(ran.some(a => a[0] === 'sh' && a[1] === '-c')).toBe(true)
  expect(NERD.test(await texts(ui))).toBe(true)
  await ui.unmount()
})

for (const font of ['stale', 'missing']) {
  test(`APP-01: glyphs auto uses plain Unicode when the Nerd Font is ${font === 'stale' ? 'newer than the terminal' : 'not installed'}`, { timeoutMs: 20_000 }, async ($, on) => {
    const root = '/home/k/proj'
    const { ui } = await pane($, on, { cwd: root, dirs: { [root]: [['src', 'dir'], ['a.ts', 'file']] }, font })
    const shown = await texts(ui)
    expect(NERD.test(shown)).toBe(false)
    expect(shown).toContain('■ ')
    expect(shown).toContain('· ')
    await ui.unmount()
  })
}

for (const ssh of ['SSH_CONNECTION', 'SSH_TTY']) {
  test(`APP-01: glyphs auto uses Nerd Font icons over SSH (${ssh}), whatever fonts the host has`, { timeoutMs: 20_000 }, async ($, on) => {
    const root = '/home/k/proj'
    const { ui } = await pane($, on, { env: { HOME: '/home/k', [ssh]: '10.0.0.2 5000 10.0.0.1 22' }, cwd: root, dirs: { [root]: [['a.ts', 'file']] }, font: 'missing' })
    expect(NERD.test(await texts(ui))).toBe(true)
    await ui.unmount()
  })
}

test('APP-01: on Windows outside SSH glyphs auto uses plain Unicode, even with a Nerd Font installed', { timeoutMs: 20_000 }, async ($, on) => {
  const root = 'C:/Users/k/proj'
  const dirs = { [root]: [['a.ts', 'file']] as [string, 'file'][] }
  const { ui, ran } = await pane($, on, { os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k' }, cwd: 'C:\\Users\\k\\proj', dirs, font: 'ok' })
  expect(NERD.test(await texts(ui))).toBe(false)
  expect(ran.some(a => a[0] === 'sh')).toBe(false)
  await ui.unmount()
})

test('APP-01: on Windows over SSH glyphs auto uses Nerd Font icons', { timeoutMs: 20_000 }, async ($, on) => {
  const root = 'C:/Users/k/proj'
  const dirs = { [root]: [['a.ts', 'file']] as [string, 'file'][] }
  const { ui } = await pane($, on, { os: 'win32', env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\k', SSH_CONNECTION: '10.0.0.2 5000 10.0.0.1 22' }, cwd: 'C:\\Users\\k\\proj', dirs, font: 'missing' })
  expect(NERD.test(await texts(ui))).toBe(true)
  await ui.unmount()
})

test('APP-01: the Desktop app always uses plain Unicode with glyphs auto, even with a Nerd Font installed', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const { ui } = await pane($, on, { env: { HOME: '/home/k', SSH_CONNECTION: '10.0.0.2 5000 10.0.0.1 22' }, cwd: root, dirs: { [root]: [['src', 'dir'], ['a.ts', 'file']] }, surface: 'desktop', font: 'ok' })
  const shown = await texts(ui)
  expect(shown).toContain('a.ts')
  expect(NERD.test(shown)).toBe(false)
  await ui.unmount()
})

const NAMED: Record<string, number> = {
  'agents.md': 0xf0354, 'changelog.md': 0xf0354, 'contributing.md': 0xf0354, 'todo.md': 0xf0354, 'readme.md': 0xf0354,
  license: 0xe60a, dockerfile: 0xf0868, makefile: 0xf1064, 'cmakelists.txt': 0xf1064, justfile: 0xf05b7, gemfile: 0xf0d2d, rakefile: 0xf0d2d,
  'cargo.toml': 0xe6b2, 'cargo.lock': 0xe6b2, 'pyproject.toml': 0xe6b2, 'requirements.txt': 0xf160e, 'go.mod': 0xf0afa, 'go.sum': 0xf07d3,
  'package.json': 0xf0626, 'package-lock.json': 0xf0626, 'tsconfig.json': 0xf0626, '.prettierrc': 0xf0626, '.eslintrc': 0xf0626,
  'pnpm-lock.yaml': 0xe6a8, 'yarn.lock': 0xe6a8, '.gitignore': 0xf02a2, '.gitmodules': 0xf0493, '.editorconfig': 0xe652,
}

const EXTS: Record<string, number> = {
  lua: 0xe620, py: 0xe606, pyi: 0xe606, js: 0xe60c, mjs: 0xe60c, cjs: 0xe60c, ts: 0xe628, jsx: 0xe625, tsx: 0xe7ba, json: 0xe60b, jsonc: 0xe60b,
  yaml: 0xe6a8, yml: 0xe6a8, sh: 0xe795, bash: 0xe795, zsh: 0xe795, fish: 0xe795, md: 0xf0354, markdown: 0xf0354, css: 0xe6b8, scss: 0xf031c,
  html: 0xe736, htm: 0xe736, go: 0xe627, rs: 0xe68b, rb: 0xe791, php: 0xe608, java: 0xe738, cs: 0xf031b, sql: 0xe706, graphql: 0xf20e, gql: 0xf20e,
  xml: 0xf05c0, toml: 0xe6b2, ini: 0xf0bc2, conf: 0xf0493, pdf: 0xeaeb, svg: 0xf0721, jpg: 0xf0225, jpeg: 0xf0225, png: 0xe60d, gif: 0xf0d78,
  webp: 0xf021f, mp4: 0xf022b, mkv: 0xf022b, mov: 0xf022b, mp3: 0xf0223, wav: 0xf0223, flac: 0xf0223, zip: 0xf05c4, gz: 0xf05c4, xz: 0xf05c4,
  tar: 0xf05c4, qml: 0xf375, cpp: 0xe61d, cc: 0xe61d, cxx: 0xe61d, c: 0xe61e, h: 0xf0af5, hpp: 0xf0af5, vue: 0xe6a0, svelte: 0xe697, csv: 0xe64a,
  txt: 0xf09aa,
}

const FALLBACK = String.fromCodePoint(0xf0214)
const icon = (name: string) => fileIcon({ id: `/r/${name}`, name, kind: 'file', parent: '/r' } as any, false, false)

test('APP-02: icons.ts maps 28 exact filenames to icons, matched case-insensitively', () => {
  expect(Object.keys(NAMED).length).toBe(28)
  for (const [name, code] of Object.entries(NAMED)) {
    expect(icon(name)).toBe(String.fromCodePoint(code))
    expect(icon(name.toUpperCase())).toBe(String.fromCodePoint(code))
  }
  for (const name of ['procfile', 'vagrantfile', 'brewfile', 'gruntfile', '.npmrc', '.env', '.dockerignore', 'copying', 'authors', 'notice', 'gnumakefile', 'podfile', 'containerfile', 'jenkinsfile', 'snakefile', 'build', 'workspace', 'cname'])
    expect(icon(name)).toBe(FALLBACK)
})

test('APP-02: icons.ts maps 64 extensions to icons, and anything else gets the plain file icon', () => {
  expect(Object.keys(EXTS).length).toBe(64)
  for (const [ext, code] of Object.entries(EXTS)) {
    expect(icon(`x.${ext}`)).toBe(String.fromCodePoint(code))
    expect(icon(`X.${ext.toUpperCase()}`)).toBe(String.fromCodePoint(code))
  }
  const others = ['kt', 'kts', 'swift', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'ml', 'fs', 'dart', 'r', 'jl', 'pl', 'pm', 'ps1', 'bat', 'cmd', 'lock', 'log', 'env', 'tf', 'hcl', 'proto', 'sass', 'less', 'styl', 'ico', 'bmp', 'tiff', 'avi', 'webm', 'ogg', 'm4a', 'aac', 'bz2', '7z', 'rar', 'tgz', 'jar', 'war', 'class', 'o', 'so', 'dll', 'exe', 'wasm', 'ipynb', 'rst', 'tex', 'adoc', 'org', 'zig', 'nim', 'v', 'sv', 'vhd', 'm', 'mm', 'hh', 'hxx', 'cjsx', 'mts', 'cts', 'astro', 'elm', 'groovy', 'gradle', 'cfg', 'properties', 'plist', 'nix', 'dockerfile', 'patch', 'diff', 'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'heic', 'avif', 'psd']
  for (const ext of others) expect(icon(`x.${ext}`)).toBe(FALLBACK)
  expect(icon('noext')).toBe(FALLBACK)
})

test('APP-03: with an Omarchy theme the pane takes its colours and background, and follows a switch within 2 s', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const toml = 'foreground = "#cdd6f4"\naccent = "#89b4fa"\nmuted = "#585b70"\nbackground = "#1e1e2e"\n'
  const { ui, clock, w, rows } = await pane($, on, { cwd: root, dirs: { [root]: [['src', 'dir'], ['a.ts', 'file']] }, theme: { toml, mtimeMs: 1 } })
  let shown = await texts(ui)
  expect(shown).toContain('"backgroundColor":"#1e1e2e"')
  expect(shown).toContain('"color":"#89b4fa"')
  expect(shown).toContain('"color":"#585b70"')
  expect(shown).toContain('"color":"#cdd6f4"')
  expect(shown).not.toContain('#808a96')
  expect(shown).not.toContain('#5b9bd5')
  expect((await rows()).rows[0]?.left.some(s => s.c === '#585b70')).toBe(true)
  w.theme = { toml: 'foreground = "#1e1e2e"\naccent = "#d20f39"\nmuted = "#9ca0b0"\nbackground = "#fafafa"\n', mtimeMs: 2 }
  await clock.advance(2_000)
  await clock.settle()
  shown = await texts(ui)
  expect(shown).toContain('"backgroundColor":"#fafafa"')
  expect(shown).toContain('"color":"#d20f39"')
  expect(shown).not.toContain('#1e1e2e"}')
  expect(shown).not.toContain('#89b4fa')
  await ui.unmount()
})

test('APP-03: a theme installed mid-session is picked up on the next resync, and with no theme nothing is polled', { timeoutMs: 20_000 }, async ($, on) => {
  const root = '/home/k/proj'
  const { ui, clock, w, ran } = await pane($, on, { cwd: root, dirs: { [root]: [['a.ts', 'file']] } })
  const stats = () => ran.filter(a => a[0] === 'theme-stat').length
  const before = stats()
  await clock.advance(30_000)
  await clock.settle()
  expect(stats()).toBe(before)
  expect(await texts(ui)).not.toContain('"backgroundColor":"#')
  w.theme = { toml: 'background = "#1e1e2e"\n', mtimeMs: 1 }
  await clock.advance(10_000)
  await clock.settle()
  expect(await texts(ui)).not.toContain('"backgroundColor":"#1e1e2e"')
  await resync(ui, clock)
  await clock.settle()
  expect(await texts(ui)).toContain('"backgroundColor":"#1e1e2e"')
  w.theme = { toml: 'background = "#fafafa"\n', mtimeMs: 2 }
  await clock.advance(2_000)
  await clock.settle()
  expect(await texts(ui)).toContain('"backgroundColor":"#fafafa"')
  await ui.unmount()
})

async function activity($: any, on: any) {
  const root = '/home/k/proj'
  const p = await pane($, on, { cwd: root, dirs: { [root]: [['read.txt', 'file'], ['wrote.txt', 'file']] } })
  await $.tool.call({ tool: 'Read', file_path: `${root}/read.txt` } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${root}/wrote.txt`, old_string: 'a', new_string: 'b' } as any)
  await p.clock.settle()
  const shown = await texts(p.ui)
  await p.ui.unmount()
  return { reads: shown.includes(shimmer('read.txt', 'purple')), writes: shown.includes(shimmer('wrote.txt', 'orange')) }
}

test('CFG-01: activity defaults to reads and writes', { timeoutMs: 20_000 }, async ($, on) => {
  expect(await activity($, on)).toEqual({ reads: true, writes: true })
})

for (const [value, want] of [['reads and writes', { reads: true, writes: true }], ['writes', { reads: false, writes: true }], ['reads', { reads: true, writes: false }], ['none', { reads: false, writes: false }]] as const) {
  test(`CFG-01: activity "${value}" shimmers ${value === 'none' ? 'nothing' : value}`, { timeoutMs: 20_000, options: { activity: value } }, async ($, on) => {
    expect(await activity($, on)).toEqual(want)
  })
}

for (const [label, options, ok, missing] of [['defaults to auto', {}, true, false], ['auto', { glyphs: 'auto' }, true, false], ['nerd', { glyphs: 'nerd' }, true, true], ['plain', { glyphs: 'plain' }, false, false]] as const) {
  for (const [font, nerd] of [['ok', ok], ['missing', missing]] as const) {
    test(`CFG-02: glyphs ${label}: ${nerd ? 'Nerd Font icons' : 'plain Unicode'} when the font probe says ${font}`, { timeoutMs: 20_000, options }, async ($, on) => {
      const root = '/home/k/proj'
      const { ui } = await pane($, on, { cwd: root, dirs: { [root]: [['a.ts', 'file']] }, font })
      expect(NERD.test(await texts(ui))).toBe(nerd)
      await ui.unmount()
    })
  }
}

async function followed($: any, on: any) {
  const root = '/home/k/big'
  const { ui, clock, ids } = await pane($, on, { cwd: root, dirs: { [root]: files(60) }, bodyRows: 20 })
  await $.tool.call({ tool: 'Read', file_path: `${root}/f55.txt` } as any)
  await clock.settle()
  const shown = await ids()
  await ui.unmount()
  return shown.includes(`${root}/f55.txt`)
}

for (const [label, options, want] of [['defaults to on', {}, true], ['on', { follow: 'on' }, true], ['off', { follow: 'off' }, false]] as const) {
  test(`CFG-03: follow ${label}`, { timeoutMs: 20_000, options }, async ($, on) => {
    expect(await followed($, on)).toBe(want)
  })
}

for (const [label, options, size] of [['defaults to date', {}, false], ['date', { column: 'date' }, false], ['size', { column: 'size' }, true]] as const) {
  test(`CFG-04: column ${label}`, { timeoutMs: 20_000, options }, async ($, on) => {
    const root = '/home/k/proj'
    const { ui } = await pane($, on, { cwd: root, dirs: { [root]: [['a.txt', 'file']] } })
    const shown = await texts(ui)
    expect(STAMP.test(shown)).toBe(!size)
    expect(shown.includes('" 1 B"')).toBe(size)
    await ui.unmount()
  })
}
