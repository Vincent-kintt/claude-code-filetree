import { expect, test } from 'claude-code/testing'

import { type Ran, type World, clientIn, paneProps, shimmer, texts, world } from './harness'

const RED = '#f87171'
const BLUE = '#60a5fa'
const ACCENT = '#5b9bd5'

type Chip = { label: string; bold: boolean; color: string }

function find(node: any, hit: (n: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined
  if (hit(node)) return node
  for (const c of node.children ?? []) {
    const got = find(c, hit)
    if (got) return got
  }
  return undefined
}

async function chipOf(ui: any): Promise<Chip | null> {
  const box = find(await ui.drawn(), n => n.type === 'Box' && n.props?.marginLeft === 2 && n.props?.flexDirection === 'row')
  const text = box?.children?.[1]
  if (!text) return null
  return { label: String(text.children?.[0] ?? ''), bold: Boolean(text.props?.bold), color: String(text.props?.color ?? '') }
}

async function branchColor(ui: any): Promise<string> {
  const row = find(await ui.drawn(), n => n.type === 'Box' && n.props?.height === 1 && n.props?.overflow === 'hidden')
  return String(row?.children?.[0]?.children?.[0]?.props?.color ?? '')
}

const rowsOf = async (ui: any) => clientIn(await ui.drawn()).props.props as { rows: { id: string }[]; active: string }

async function repo($: any, on: any, extra: Partial<World> = {}, surface: 'terminal' | 'desktop' = 'terminal') {
  const ran: Ran = []
  const root = '/home/k/proj'
  const w: World = {
    os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: root,
    dirs: { [root]: [['src', 'dir'], ['a.txt', 'file'], ['b.txt', 'file']], [`${root}/src`]: [['deep', 'dir'], ['m.ts', 'file']], [`${root}/src/deep`]: [['x.ts', 'file']] },
    status: '## main...origin/main\0', numstat: '', heads: ['abc1234def0'],
    ...extra,
  }
  const clock = world(on, w, ran)
  await $.session.start({ cwd: root, surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  return { root, w, ran, clock, ui }
}

async function scrolled($: any, on: any, surface: 'terminal' | 'desktop' = 'terminal') {
  const root = '/home/k/big'
  const files = Array.from({ length: 60 }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'file'] as [string, 'file'])
  const clock = world(on, { os: 'linux', env: { HOME: '/home/k' }, cwd: root, top: '', dirs: { [root]: [['a', 'dir'], ...files], [`${root}/a`]: [['a1.txt', 'file']] }, status: '', numstat: '' }, [])
  await $.session.start({ cwd: root, surface, isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface, component: 'Pane', requestId: 'filetree', props: { ...paneProps(60), scroll: { offset: 0, bodyRows: 20 } } })
  await clock.settle()
  if (surface === 'terminal') {
    await $.ui.scroll({ component: 'Pane', requestId: 'filetree', by: 1 } as any)
    await clock.settle()
  }
  const ids = async () => (await rowsOf(ui)).rows.map(r => r.id)
  return { root, clock, ui, ids }
}

test('ACT-06: follow on scrolls the terminal view to a file Claude reads and to one it writes', { timeoutMs: 20_000 }, async ($, on) => {
  const { root, clock, ui, ids } = await scrolled($, on)
  const top = (await ids())[0]
  expect(await ids()).not.toContain(`${root}/f55.txt`)
  await $.tool.call({ tool: 'Read', file_path: `${root}/f55.txt` } as any)
  await clock.settle()
  expect(await ids()).toContain(`${root}/f55.txt`)
  expect((await ids())[0]).not.toBe(top)
  await clock.advance(3_000)
  await clock.settle()
  await $.tool.call({ tool: 'Edit', file_path: `${root}/f03.txt`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  expect(await ids()).toContain(`${root}/f03.txt`)
  expect(await texts(ui)).toContain(shimmer('f03.txt', 'orange'))
  await ui.unmount()
})

test('ACT-06: follow off keeps the terminal view still, and the shimmer still shows', { timeoutMs: 20_000, options: { follow: 'off' } }, async ($, on) => {
  const { root, clock, ui, ids } = await scrolled($, on)
  const top = (await ids())[0]
  await $.tool.call({ tool: 'Read', file_path: `${root}/f55.txt` } as any)
  await clock.settle()
  expect((await ids())[0]).toBe(top)
  expect(await ids()).not.toContain(`${root}/f55.txt`)
  await $.tool.call({ tool: 'Read', file_path: `${root}/f06.txt` } as any)
  await clock.settle()
  expect((await ids())[0]).toBe(top)
  expect(await texts(ui)).toContain(shimmer('f06.txt', 'purple'))
  await ui.unmount()
})

async function desktopFollow($: any, on: any) {
  const { root, clock, ui } = await scrolled($, on, 'desktop')
  await $.tool.call({ tool: 'Read', file_path: `${root}/a/a1.txt` } as any)
  await clock.settle()
  const p = await rowsOf(ui)
  const files = Array.from({ length: 60 }, (_, i) => `${root}/f${String(i).padStart(2, '0')}.txt`)
  expect(p.rows.map(r => r.id)).toEqual([`${root}/a`, `${root}/a/a1.txt`, ...files])
  expect(p.bar).toBeUndefined()
  expect(await texts(ui)).toContain(shimmer('a1.txt', 'purple'))
  await ui.unmount()
}

test('ACT-06: in the Desktop app follow on draws every row and leaves the scrolling to the app', { timeoutMs: 20_000 }, async ($, on) => {
  await desktopFollow($, on)
})

test('ACT-06: in the Desktop app follow off draws exactly what follow on does', { timeoutMs: 20_000, options: { follow: 'off' } }, async ($, on) => {
  await desktopFollow($, on)
})

const VERBS: [string, string][] = [
  ['push', 'git push'], ['pull', 'git pull'], ['fetch', 'git fetch'], ['checkout', 'git checkout feat'], ['switch', 'git switch feat'],
  ['branch', 'git branch feat'], ['merge', 'git merge feat'], ['rebase', 'git rebase main'], ['cherry-pick', 'git cherry-pick abc1234'],
  ['stash', 'git stash'], ['reset', 'git reset --hard HEAD~1'], ['restore', 'git restore a.txt'], ['revert', 'git revert abc1234'],
  ['add', 'git add a.txt'], ['rm', 'git rm a.txt'], ['mv', 'git mv a.txt c.txt'], ['tag', 'git tag v1'], ['init', 'git init'],
  ['clone', 'git clone https://example.test/r.git'],
  ['pr create', 'gh pr create --fill'], ['pr merge', 'gh pr merge 1'], ['pr checkout', 'gh pr checkout 1'], ['pr comment', 'gh pr comment 1 -b hi'],
  ['pr review', 'gh pr review 1 --approve'], ['release create', 'gh release create v1'], ['issue create', 'gh issue create -t x'], ['repo clone', 'gh repo clone o/r'],
]

test('ACT-07: every listed git and gh action shows running, then done on a zero exit', { timeoutMs: 60_000 }, async ($, on) => {
  let during: Chip | null = null
  let fail = false
  const { clock, ui } = await repo($, on, {
    tool: (e: any) => (async () => {
      during = await chipOf(ui)
      return fail ? { isError: true, result: 'Exit code 1' } : { result: { stdout: '', stderr: '' } }
    })(),
  })
  for (const [verb, command] of VERBS) {
    for (const bad of [false, true]) {
      fail = bad
      during = null
      await $.tool.call({ tool: 'Bash', command } as any)
      await clock.settle()
      expect({ verb, running: during && (during as Chip).bold && (during as Chip).label.endsWith('…') }).toEqual({ verb, running: true })
      const after = await chipOf(ui)
      expect({ verb, bad, label: after?.label.endsWith('…'), failed: after?.color === RED && /fail/.test(after?.label ?? '') }).toEqual({ verb, bad, label: false, failed: bad })
      await clock.advance(50_000)
      await clock.settle()
    }
  }
  await ui.unmount()
})

test('ACT-07: a commit is done only with a new HEAD and failed without one, whatever the exit code', { timeoutMs: 20_000 }, async ($, on) => {
  const { w, clock, ui } = await repo($, on)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m one' } as any)
  await clock.settle()
  let chip = await chipOf(ui)
  expect(chip?.color).toBe(RED)
  expect(chip?.label).toContain('fail')
  w.heads = ['abc1234def0', 'fed4321cba9']
  await $.tool.call({ tool: 'Bash', command: 'git commit -m two; echo done' } as any)
  await clock.settle()
  chip = await chipOf(ui)
  expect(chip?.color).not.toBe(RED)
  expect(chip?.label.endsWith('…')).toBe(false)
  expect(await texts(ui)).toContain('fed4321')
  await ui.unmount()
})

test('ACT-07: done comes from the host report or a plain && chain; anything without evidence is taken off', { timeoutMs: 20_000 }, async ($, on) => {
  let reply: unknown = { result: { stdout: '', stderr: '' } }
  const { clock, ui } = await repo($, on, { tool: () => reply })
  const run = async (command: string) => {
    await $.tool.call({ tool: 'Bash', command } as any)
    await clock.settle()
    const chip = await chipOf(ui)
    await clock.advance(50_000)
    await clock.settle()
    return chip
  }
  expect(await run('git push; echo done')).toBe(null)
  expect(await run('git fetch | cat')).toBe(null)
  expect(await run('git fetch || true')).toBe(null)
  const chained = await run('git fetch && git status')
  expect(chained?.color).toBe(BLUE)
  expect(chained?.label.endsWith('…')).toBe(false)
  reply = { result: { stdout: '', stderr: '', gitOperation: { push: { branch: 'main' } } } }
  const reported = await run('git push; echo done')
  expect(reported).not.toBe(null)
  expect(reported?.color).not.toBe(RED)
  expect(reported?.label.endsWith('…')).toBe(false)
  reply = { isError: true, result: 'Exit code 1' }
  expect(await run('git fetch && git pull')).toBe(null)
  expect(await run('git push; echo done')).toBe(null)
  const single = await run('git push')
  expect(single?.color).toBe(RED)
  await ui.unmount()
})

const bg = (id: string, status: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Background command</summary>\n</task-notification>`

test('ACT-08: a background git command stays running until its notification arrives, then shows done or failed', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, ui } = await repo($, on, { tool: (e: any) => ({ result: { stdout: '', stderr: '', backgroundTaskId: e.command === 'git push' ? 'b1' : 'b2' } }) })
  await $.tool.call({ tool: 'Bash', command: 'git push', run_in_background: true } as any)
  await clock.settle()
  await clock.advance(120_000)
  await clock.settle()
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  let chip = await chipOf(ui)
  expect(chip?.label.endsWith('…')).toBe(true)
  await $.prompt.submit({ text: bg('b1', 'completed'), wait: false } as any)
  await clock.settle()
  chip = await chipOf(ui)
  expect(chip?.label.endsWith('…')).toBe(false)
  expect(chip?.color).not.toBe(RED)
  await $.tool.call({ tool: 'Bash', command: 'git pull', run_in_background: true } as any)
  await clock.settle()
  await $.prompt.submit({ text: bg('b2', 'failed'), wait: false } as any)
  await clock.settle()
  chip = await chipOf(ui)
  expect(chip?.color).toBe(RED)
  await ui.unmount()
})

test('ACT-08: a background git command with no notification is hidden from the footer after 10 minutes', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, ui } = await repo($, on, { tool: () => ({ result: { stdout: '', stderr: '', backgroundTaskId: 'b9' } }) })
  await $.tool.call({ tool: 'Bash', command: 'git push', run_in_background: true } as any)
  await clock.settle()
  await clock.advance(599_000)
  await clock.settle()
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  expect((await chipOf(ui))?.label.endsWith('…')).toBe(true)
  await clock.advance(2_000)
  await clock.settle()
  await ui.post({}, { in: 'rows' })
  await clock.settle()
  expect(await chipOf(ui)).toBe(null)
  await ui.unmount()
})

test('ACT-09: a failed Bash command still refreshes git and the tree', { timeoutMs: 20_000 }, async ($, on) => {
  const { root, w, ran, clock, ui } = await repo($, on, { tool: () => ({ isError: true, result: 'Exit code 2' }) })
  const before = ran.filter(a => a[0] === 'git' && a.includes('status')).length
  w.dirs[root] = [...w.dirs[root]!, ['new.txt', 'file']]
  w.status = '## main...origin/main\0?? new.txt\0'
  await $.tool.call({ tool: 'Bash', command: 'touch new.txt; exit 2' } as any)
  await clock.settle()
  expect(ran.filter(a => a[0] === 'git' && a.includes('status')).length).toBeGreaterThan(before)
  const shown = await texts(ui)
  expect(shown).toContain(`"id":"${root}/new.txt"`)
  expect(shown).toContain('?:1')
  await ui.unmount()
})

test('ACT-10: footer activity left running when the session was interrupted is marked failed on restart', { timeoutMs: 20_000 }, async ($, on) => {
  const { root, clock, ui } = await repo($, on, { tool: () => ({ result: { stdout: '', stderr: '', backgroundTaskId: 'b7' } }) })
  await $.tool.call({ tool: 'Bash', command: 'git push', run_in_background: true } as any)
  await clock.settle()
  expect((await chipOf(ui))?.label.endsWith('…')).toBe(true)
  await ui.unmount()
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const again = await $.ui.mount({ plugin: 'filetree', surface: 'terminal', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  const chip = await chipOf(again)
  expect(chip).not.toBe(null)
  expect(chip?.label.endsWith('…')).toBe(false)
  expect(chip?.bold).toBe(false)
  expect(chip?.color).toBe(RED)
  await again.unmount()
})

async function activityRun($: any, on: any) {
  const ctx = await repo($, on, { status: '## main...origin/main\0 M a.txt\0', numstat: '4\t2\ta.txt\0' })
  const { root, clock, ui } = ctx
  await $.tool.call({ tool: 'Read', file_path: `${root}/b.txt` } as any)
  await clock.settle()
  const read = await texts(ui)
  await clock.advance(3_000)
  await clock.settle()
  await $.tool.call({ tool: 'Edit', file_path: `${root}/src/m.ts`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  const wrote = await texts(ui)
  await clock.advance(3_000)
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git fetch' } as any)
  await clock.settle()
  const branch = await branchColor(ui)
  const shown = await texts(ui)
  const chip = await chipOf(ui)
  for (const word of ['+4', '-2', 'M:1']) expect(shown).toContain(word)
  expect(chip?.color).toBe(BLUE)
  expect(chip?.label.endsWith('…')).toBe(false)
  await ui.unmount()
  return { read, wrote, branch }
}

test('ACT-11: activity reads and writes shows read, write and branch-row shimmers', { timeoutMs: 20_000 }, async ($, on) => {
  const { read, wrote, branch } = await activityRun($, on)
  expect(read).toContain(shimmer('b.txt', 'purple'))
  expect(wrote).toContain(shimmer('m.ts', 'orange'))
  expect(branch).toBe(BLUE)
})

test('ACT-11: activity writes drops read shimmers and keeps writes and the branch flash', { timeoutMs: 20_000, options: { activity: 'writes' } }, async ($, on) => {
  const { read, wrote, branch } = await activityRun($, on)
  expect(read).not.toContain('"sh":"purple"')
  expect(wrote).toContain(shimmer('m.ts', 'orange'))
  expect(branch).toBe(BLUE)
})

test('ACT-11: activity reads keeps read shimmers and drops write shimmers', { timeoutMs: 20_000, options: { activity: 'reads' } }, async ($, on) => {
  const { read, wrote } = await activityRun($, on)
  expect(read).toContain(shimmer('b.txt', 'purple'))
  expect(wrote).not.toContain('"sh":"orange"')
})

test('ACT-11: activity none shows no shimmer and no branch flash, but git status, line counts and the footer stay', { timeoutMs: 20_000, options: { activity: 'none' } }, async ($, on) => {
  const { read, wrote, branch } = await activityRun($, on)
  expect(read).not.toContain('"sh":')
  expect(wrote).not.toContain('"sh":')
  expect(branch).not.toBe(BLUE)
  expect(branch).toBe(ACCENT)
})

async function touchedList($: any, on: any) {
  const root = '/Users/k/proj'
  const w: World = { os: 'darwin', env: { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' }, cwd: root, top: root, dirs: { [root]: [['a.txt', 'file'], ['b.txt', 'file']] }, status: '## main\0', numstat: '' }
  const clock = world(on, w, [])
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: `${root}/a.txt` } as any)
  await clock.settle()
  const read = await texts(ui)
  await $.tool.call({ tool: 'Edit', file_path: `${root}/b.txt`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  const wrote = await texts(ui)
  await ui.unmount()
  return { read, wrote }
}

test('ACT-11: activity writes keeps reads out of the Desktop card and touched list', { timeoutMs: 20_000, options: { activity: 'writes' } }, async ($, on) => {
  const { read, wrote } = await touchedList($, on)
  expect(read).toContain('0 FILES')
  expect(read).not.toContain('Claude read a.txt')
  expect(wrote).toContain('Claude edited b.txt')
  expect(wrote).toContain('1 FILE')
})

test('ACT-11: activity reads keeps edits out of the Desktop card and touched list', { timeoutMs: 20_000, options: { activity: 'reads' } }, async ($, on) => {
  const { read, wrote } = await touchedList($, on)
  expect(read).toContain('Claude read a.txt')
  expect(read).toContain('1 FILE')
  expect(wrote).not.toContain('Claude edited b.txt')
  expect(wrote).not.toContain('2 FILES')
})

test('ACT-11: activity none records nothing in the Desktop card or touched list', { timeoutMs: 20_000, options: { activity: 'none' } }, async ($, on) => {
  const { read, wrote } = await touchedList($, on)
  for (const shown of [read, wrote]) {
    expect(shown).toContain('0 FILES')
    expect(shown).not.toContain('Claude read a.txt')
    expect(shown).not.toContain('Claude edited b.txt')
  }
})

test('CTX-01: the selected file goes to Claude as context with each prompt, and nothing is sent with no selection', { timeoutMs: 20_000 }, async ($, on) => {
  const { root, clock, ui } = await repo($, on)
  let sent = await $.prompt.submit({ text: 'hello', wait: false } as any)
  expect(JSON.stringify(sent)).not.toContain(`${root}/a.txt`)
  await ui.post({ press: `${root}/a.txt` }, { in: 'rows' })
  await clock.settle()
  for (const text of ['what is this?', 'and now?']) {
    sent = await $.prompt.submit({ text, wait: false } as any)
    await clock.settle()
    expect(JSON.stringify((sent as any).context ?? sent)).toContain(`${root}/a.txt`)
  }
  await ui.unmount()
})

test('CTX-02: an @path mention reveals a file inside the root and moves the cursor to it', { timeoutMs: 20_000 }, async ($, on) => {
  const { root, clock, ui } = await repo($, on)
  expect(await texts(ui)).not.toContain(`"id":"${root}/src/deep/x.ts"`)
  await $.prompt.submit({ text: 'look at @src/deep/x.ts, please', wait: false } as any)
  await clock.settle()
  const p = await rowsOf(ui)
  expect(p.rows.map(r => r.id)).toContain(`${root}/src/deep/x.ts`)
  expect(p.active).toBe(`${root}/src/deep/x.ts`)
  await $.prompt.submit({ text: 'and @../other/y.ts', wait: false } as any)
  await clock.settle()
  expect((await rowsOf(ui)).active).toBe(`${root}/src/deep/x.ts`)
  await ui.unmount()
})

test('CTX-02: with follow off an @path mention still moves the cursor and the view to the file', { timeoutMs: 20_000, options: { follow: 'off' } }, async ($, on) => {
  const { root, clock, ui, ids } = await scrolled($, on)
  expect(await ids()).not.toContain(`${root}/f55.txt`)
  await $.prompt.submit({ text: 'open @f55.txt', wait: false } as any)
  await clock.settle()
  expect(await ids()).toContain(`${root}/f55.txt`)
  expect((await rowsOf(ui)).active).toBe(`${root}/f55.txt`)
  await $.prompt.submit({ text: 'and @a/a1.txt', wait: false } as any)
  await clock.settle()
  expect(await ids()).toContain(`${root}/a/a1.txt`)
  expect((await rowsOf(ui)).active).toBe(`${root}/a/a1.txt`)
  await ui.unmount()
})
