import { expect, test } from 'claude-code/testing'

import { type Ran, type World, NERD, clientIn, paneProps, texts, world } from './harness'

const HOME = '/Users/k'

async function desktop($: any, on: any, w: Partial<World> & { dirs: World['dirs'] }, ran: Ran = [], props = paneProps(60)) {
  const root = w.cwd ?? `${HOME}/proj`
  const full: World = { os: 'darwin', env: { HOME, TMPDIR: '/var/folders/x/T/' }, cwd: root, top: root, status: '## main\0', numstat: '', ...w }
  const clock = world(on, full, ran)
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props })
  await clock.settle()
  return { root, clock, ui, w: full }
}

const rowsOf = async (ui: any) => clientIn(await ui.drawn()).props.props.rows as { id: string; left: { t: string }[] }[]

function find(node: any, hit: (n: any) => boolean): any[] {
  if (!node || typeof node !== 'object') return []
  const out = hit(node) ? [node] : []
  for (const c of node.children ?? []) out.push(...find(c, hit))
  return out
}

test('DSK-01: the card says IDLE before Claude acts, with the branch, its upstream, ahead/behind and a change summary below', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { ui } = await desktop($, on, {
    dirs: { [root]: [['src', 'dir'], ['notes.md', 'file']], [`${root}/src`]: [['a.ts', 'file']] },
    status: '## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0?? notes.md\0', numstat: '3\t1\tsrc/a.ts\0',
  })
  const shown = await texts(ui)
  for (const word of ['IDLE', '"main"', '" ↑2"', '" ↓1"', '" origin/main"', '2 changed', '" +3"', '" -1"']) expect(shown).toContain(word)
  expect(shown).not.toContain('RIGHT NOW')
  expect(shown.indexOf('IDLE')).toBeLessThan(shown.indexOf('" ↑2"'))
  await ui.unmount()
})

test('DSK-01: a clean repo says so, and no ahead/behind shows when there is none', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { ui } = await desktop($, on, { dirs: { [root]: [['a.txt', 'file']] }, status: '## main...origin/main\0' })
  const shown = await texts(ui)
  expect(shown).toContain('clean, nothing changed')
  expect(shown).not.toContain('↑')
  expect(shown).not.toContain('↓')
  await ui.unmount()
})

test('DSK-01: RIGHT NOW while a tool runs, DONE with the last action once nothing runs, FAILED for a denied one', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { clock, ui, w } = await desktop($, on, { dirs: { [root]: [['a.ts', 'file'], ['b.ts', 'file']] } })
  let during = ''
  w.tool = (e: any) => {
    if (e.file_path?.endsWith('b.ts')) return { deny: 'no' }
    return (async () => {
      during = await texts(ui)
      return { result: {} }
    })()
  }
  await $.tool.call({ tool: 'Read', file_path: `${root}/a.ts` } as any)
  await clock.settle()
  expect(during).toContain('RIGHT NOW')
  expect(during).toContain('Claude is reading a.ts')
  let shown = await texts(ui)
  expect(shown).toContain('DONE')
  expect(shown).toContain('Claude read a.ts')
  expect(shown).not.toContain('RIGHT NOW')
  await clock.advance(120_000)
  await clock.settle()
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  shown = await texts(ui)
  expect(shown).toContain('DONE')
  expect(shown).toContain('Claude read a.ts')
  await $.tool.call({ tool: 'Edit', file_path: `${root}/b.ts`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  shown = await texts(ui)
  expect(shown).toContain('FAILED')
  expect(shown).not.toContain('"DONE"')
  await ui.unmount()
})

test('DSK-01: a running git command shows RIGHT NOW on the card', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { clock, ui, w } = await desktop($, on, { dirs: { [root]: [['a.txt', 'file']] } })
  let during = ''
  w.tool = (e: any) =>
    e.tool === 'Bash'
      ? (async () => {
          during = await texts(ui)
          return { result: { stdout: '', stderr: '' } }
        })()
      : undefined
  await $.tool.call({ tool: 'Bash', command: 'git fetch' } as any)
  await clock.settle()
  expect(during).toContain('RIGHT NOW')
  const shown = await texts(ui)
  expect(shown).toContain('DONE')
  expect(shown).toContain('Claude fetched')
  await ui.unmount()
})

test('DSK-02: the pane shows a "Find a file" search box', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { clock, ui } = await desktop($, on, { dirs: { [root]: [['lib', 'dir']], [`${root}/lib`]: [['deep.ts', 'file']] } })
  const inputs = find(await ui.drawn(), n => n.type === 'Input')
  expect(inputs.length).toBe(1)
  expect(inputs[0].props.placeholder).toBe('Find a file')
  await ui.input({ key: 'q', text: 'deep' })
  await clock.settle()
  expect(await texts(ui)).toContain(`"id":"${root}/lib/deep.ts"`)
  await ui.unmount()
})

test('DSK-03: the touched list keeps 40 files, shows the newest 8, and says "+32 more"', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const names = Array.from({ length: 45 }, (_, i) => `f${String(i).padStart(2, '0')}.txt`)
  const { clock, ui } = await desktop($, on, { dirs: { [root]: names.map(n => [n, 'file'] as [string, 'file']) } })
  let shown = await texts(ui)
  expect(shown).toContain('CLAUDE TOUCHED')
  expect(shown).toContain('0 FILES')
  for (const n of names) await $.tool.call({ tool: 'Read', file_path: `${root}/${n}` } as any)
  await clock.settle()
  shown = await texts(ui)
  expect(shown).toContain('40 FILES')
  expect(shown).toContain('+32 more')
  const touched = find(await ui.drawn(), n => n.type === 'Button' && String(n.key ?? n.props?.key ?? '').startsWith('touch:'))
  const keys = touched.map(n => String(n.key ?? n.props.key))
  expect(keys.length).toBe(8)
  expect(keys).toEqual(names.slice(37).reverse().map(n => `touch:${root}/${n}`))
  await ui.unmount()
})

test('DSK-03: the list shows only files inside the root, and no "+N more" line under 9 of them', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const other = `${HOME}/other`
  const { clock, ui } = await desktop($, on, {
    dirs: { [root]: [['a.ts', 'file'], ['b.ts', 'file']], [other]: [['x.ts', 'file'], ['y.ts', 'file'], ['z.ts', 'file']] },
  })
  for (const p of [`${other}/x.ts`, `${root}/a.ts`, `${other}/y.ts`, `${root}/b.ts`, `${other}/z.ts`]) await $.tool.call({ tool: 'Read', file_path: p } as any)
  await clock.settle()
  const shown = await texts(ui)
  expect(shown).toContain('2 FILES')
  expect(shown).toContain(`touch:${root}/a.ts`)
  expect(shown).toContain(`touch:${root}/b.ts`)
  expect(shown).not.toContain(`touch:${other}`)
  expect(shown).not.toMatch(/\+\d+ more/)
  await ui.unmount()
})

test('DSK-04: a view menu offers All files and Edited files, and Edited files shows only changed files', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { clock, ui } = await desktop($, on, {
    dirs: { [root]: [['a.ts', 'file'], ['b.ts', 'file']] },
    status: '## main\0 M a.ts\0', numstat: '1\t0\ta.ts\0',
  })
  const menu = find(await ui.drawn(), n => n.type === 'Select')
  expect(menu.length).toBe(1)
  const labels = (menu[0].props.options as { value: string; label: string }[]).map(o => o.label.toLowerCase())
  expect(labels.length).toBe(2)
  expect(labels[0]).toContain('all files')
  expect(labels[1]).toContain('edited files')
  expect(menu[0].props.value).toBe('all')
  await ui.select({ key: menu[0].key ?? menu[0].props.key ?? 'view', value: 'edited' })
  await clock.settle()
  expect((await rowsOf(ui)).map(r => r.id)).toEqual([`${root}/a.ts`])
  await ui.select({ key: 'view', value: 'all' })
  await clock.settle()
  expect((await rowsOf(ui)).map(r => r.id)).toEqual([`${root}/a.ts`, `${root}/b.ts`])
  await ui.unmount()
})

test('DSK-05: the file view has "← Back to files" and "Open in app ↗", which open the OS app and return to the tree', { timeoutMs: 20_000 }, async ($, on) => {
  const ran: Ran = []
  const root = `${HOME}/proj`
  const { clock, ui } = await desktop($, on, { dirs: { [root]: [['a.ts', 'file']] }, files: { [`${root}/a.ts`]: 'const a = 1\n' } }, ran)
  await ui.post({ press: `${root}/a.ts` }, { in: 'rows' })
  await ui.post({ press: `${root}/a.ts` }, { in: 'rows' })
  await clock.settle()
  const labels = find(await ui.drawn(), n => n.type === 'Button').map(n => n.props.label)
  expect(labels).toContain('← Back to files')
  expect(labels).toContain('Open in app ↗')
  await ui.press({ key: 'external' })
  await clock.settle()
  expect(ran).toContainEqual(['open', '--', `${root}/a.ts`])
  await ui.press({ key: 'back' })
  await clock.settle()
  const shown = await texts(ui)
  expect(shown).not.toContain('← Back to files')
  expect(shown).toContain('CLAUDE TOUCHED')
  await ui.unmount()
})

test('DSK-06: every row of an open tree is drawn, with no pane scrollbar, and the wheel goes to the app', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/big`
  const files = Array.from({ length: 50 }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'file'] as [string, 'file'])
  const kids = Array.from({ length: 25 }, (_, i) => [`k${String(i).padStart(2, '0')}.txt`, 'file'] as [string, 'file'])
  const appScrolls: number[] = []
  on('ui.scroll', (_$: any, e: any) => (appScrolls.push(e.by), {}))
  const { clock, ui } = await desktop($, on, { cwd: root, top: '', dirs: { [root]: [['sub', 'dir'], ...files], [`${root}/sub`]: kids } }, [], { ...paneProps(60), scroll: { offset: 0, bodyRows: 10 } })
  await ui.post({ press: `${root}/sub` }, { in: 'rows' })
  await ui.post({ key: 'right' }, { in: 'rows' })
  await clock.settle()
  let p = clientIn(await ui.drawn()).props.props
  expect(p.bar).toBeUndefined()
  expect(p.rows.length).toBe(76)
  expect(p.rows.at(-1).id).toBe(`${root}/f49.txt`)
  expect(await $.ui.scroll({ component: 'Pane', requestId: 'filetree', by: 3, offset: 3, bodyRows: 10, contentRows: 80, origin: { kind: 'person' } } as any)).toEqual({})
  expect(appScrolls).toEqual([3])
  await clock.settle()
  p = clientIn(await ui.drawn()).props.props
  expect(p.rows.length).toBe(76)
  expect(p.rows[0].id).toBe(`${root}/sub`)
  await ui.unmount()
})

test('DSK-07: a long file view stays within 60,000 serialized characters and is cut at a line break', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const lines = Array.from({ length: 3000 }, (_, i) => `line ${i} ${'x'.repeat(40 + (i % 17))}`)
  const { clock, ui } = await desktop($, on, { top: '', dirs: { [root]: [['big.txt', 'file']] }, files: { [`${root}/big.txt`]: lines.join('\n') } })
  await ui.post({ press: `${root}/big.txt` }, { in: 'rows' })
  await ui.post({ press: `${root}/big.txt` }, { in: 'rows' })
  await clock.settle()
  const drawn = await ui.drawn()
  expect(JSON.stringify(drawn).length).toBeLessThanOrEqual(60_000)
  const code = find(drawn, n => n.type === 'Code')[0]
  const source = String(code.props.source)
  expect(source.length).toBeGreaterThan(0)
  const got = source.replace(/\n$/, '').split('\n')
  expect(got.length).toBeLessThan(lines.length)
  expect(got).toEqual(lines.slice(0, got.length))
  await ui.unmount()
})

test('DSK-07: a big tree stays within 60,000 characters, keeps the top rows when the cursor is not among them, and counts what it left out below', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/huge`
  const names = Array.from({ length: 3000 }, (_, i) => `file-with-a-longish-name-${String(i).padStart(4, '0')}.txt`)
  const { ui } = await desktop($, on, { cwd: root, top: '', dirs: { [root]: names.map(n => [n, 'file'] as [string, 'file']) } })
  expect(JSON.stringify(await ui.drawn({ in: 'rows' })).length).toBeLessThanOrEqual(60_000)
  const rows = await rowsOf(ui)
  expect(rows[0]!.id).toBe(`${root}/${names[0]}`)
  const kept = rows.filter(r => r.id).length
  expect(kept).toBeGreaterThan(10)
  expect(kept).toBeLessThan(3000)
  const last = JSON.stringify(rows.at(-1))
  expect(last).toContain(`${(3000 - kept).toLocaleString('en')} more rows`)
  expect(rows.some(r => JSON.stringify(r).includes('rows above'))).toBe(false)
  await ui.unmount()
})

test('DSK-07: a big tree centres the kept rows on the cursor and says how many it left out above and below', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/huge`
  const names = Array.from({ length: 3000 }, (_, i) => `file-with-a-longish-name-${String(i).padStart(4, '0')}.txt`)
  const { clock, ui } = await desktop($, on, { cwd: root, top: '', dirs: { [root]: names.map(n => [n, 'file'] as [string, 'file']) } })
  const cursor = `${root}/${names[1500]}`
  await ui.post({ press: cursor }, { in: 'rows' })
  await clock.settle()
  const props = clientIn(await ui.drawn()).props.props
  expect(props.active).toBe(cursor)
  expect(JSON.stringify(await ui.drawn({ in: 'rows' })).length).toBeLessThanOrEqual(60_000)
  const rows = props.rows as { id: string }[]
  const ids = rows.filter(r => r.id).map(r => r.id)
  const at = ids.indexOf(cursor)
  expect(at).toBeGreaterThan(0)
  expect(Math.abs(at - (ids.length - 1 - at))).toBeLessThanOrEqual(1)
  const first = names.indexOf(ids[0]!.slice(root.length + 1))
  const below = 3000 - first - ids.length
  expect(JSON.stringify(rows[0])).toContain(`${first.toLocaleString('en')} rows above`)
  expect(JSON.stringify(rows.at(-1))).toContain(`${below.toLocaleString('en')} more rows`)
  await ui.unmount()
})

test('DSK-08: with glyphs auto the Desktop app draws plain Unicode glyphs, where glyphs nerd would draw Nerd Font icons', { timeoutMs: 20_000 }, async ($, on) => {
  const root = `${HOME}/proj`
  const { clock, ui } = await desktop($, on, {
    dirs: { [root]: [['src', 'dir'], ['a.ts', 'file'], ['README.md', 'file']], [`${root}/src`]: [['b.ts', 'file']] },
    status: '## main...origin/main\0 M a.ts\0', numstat: '1\t1\ta.ts\0',
  })
  await ui.post({ press: `${root}/src` }, { in: 'rows' })
  await ui.post({ key: 'right' }, { in: 'rows' })
  await clock.settle()
  const shown = await texts(ui)
  expect(NERD.test(shown)).toBe(false)
  const glyphs = (await rowsOf(ui)).map(r => r.left.map(s => s.t).join(''))
  expect(glyphs.find(g => g.includes('src'))).toContain('■')
  expect(glyphs.find(g => g.includes('a.ts'))).toContain('·')
  await ui.unmount()
})

test('DSK-08: control, glyphs nerd on the Desktop app does draw Nerd Font icons', { timeoutMs: 20_000, options: { glyphs: 'nerd' } }, async ($, on) => {
  const root = `${HOME}/proj`
  const { ui } = await desktop($, on, { dirs: { [root]: [['src', 'dir'], ['a.ts', 'file']], [`${root}/src`]: [['b.ts', 'file']] } })
  expect(NERD.test(await texts(ui))).toBe(true)
  await ui.unmount()
})
