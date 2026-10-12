import { expect, test } from 'claude-code/testing'

import { badgeOf } from '../hooks/desktop'
import { block, frame, paneProps, world } from './harness'

const root = '/Users/k/claude-code-filetree'
const changed = Array.from({ length: 14 }, (_, i) => `f${i}.ts`)

async function screenshotScene($: any, on: any) {
  const clock = world(on, {
    os: 'darwin', env: { HOME: '/Users/k', TMPDIR: '/var/folders/x/T/' }, cwd: root, top: root,
    dirs: { [root]: [['hooks', 'dir'], ['tests', 'dir'], ...changed.map(f => [f, 'file'] as [string, 'file'])], [`${root}/hooks`]: [['register.tsx', 'file']], [`${root}/tests`]: [['spec-git.test.tsx', 'file']] },
    status: `## main...origin/main\0${changed.map(f => ` M ${f}\0`).join('')}`,
    numstat: `2\t139\tf0.ts\0${changed.slice(1).map(f => `0\t0\t${f}\0`).join('')}`,
  }, [])
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: `${root}/hooks/register.tsx` } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls tests' } as any)
  await clock.settle()
  return { ui, text: frame(await ui.drawn()) }
}

// Two neighbours in a row with no gap and no space at the seam: a spacer that collapses in a narrow pane joins them.
function seams(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const p = node.props ?? {}
  if (node.type === 'Box' && p.flexDirection !== 'column' && !(p.columnGap ?? p.gap)) {
    const parts = (node.children ?? []).map((c: any) => block(c)[0] ?? '').filter((t: string) => t.trim())
    for (let i = 1; i < parts.length; i++) {
      const [a, b] = [parts[i - 1], parts[i]]
      if (!/\s$/.test(a) && !/^\s/.test(b)) out.push(`${a}|${b}`)
    }
  }
  for (const c of node.children ?? []) seams(c, out)
  return out
}

test('DSK-09: the upstream and the change summary never run together on the branch line', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui, text } = await screenshotScene($, on)
  expect(text.split('\n').find(l => l.includes('origin/main'))).toMatch(/origin\/main\s+14 changed \+2 -139/)
  await ui.unmount()
})

test('DSK-09: no two texts in a desktop row run together when the pane is too narrow for its spacers', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await screenshotScene($, on)
  expect(seams(await ui.drawn())).toEqual([])
  await ui.unmount()
})

test('DSK-03: a folder Claude touched is badged as a folder, not by its name', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui, text } = await screenshotScene($, on)
  const row = text.split('\n').find(l => /\btests\s+Read\b/.test(l))
  expect(row).toBeDefined()
  expect(row).toMatch(/^\s*DIR\s+tests\b/)
  expect(row).not.toContain('TEST')
  await ui.unmount()
})

test('DSK-09: the change summary never shrinks or truncates, so a row too narrow for it wraps it whole onto the next line', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await screenshotScene($, on)
  const drawn = await ui.drawn()
  const holder = (n: any): any => (n?.type === 'Box' && (n.children ?? []).some((c: any) => c?.type === 'Text' && block(c)[0]?.includes('14 changed')) ? n : (n?.children ?? []).map(holder).find(Boolean))
  const summary = holder(drawn)
  expect(summary).toBeDefined()
  expect(summary.props.flexShrink).toBe(0)
  for (const t of summary.children.filter((c: any) => c?.type === 'Text')) expect(String(t.props.wrap ?? 'wrap')).not.toContain('truncate')
  const line = (n: any): any => (n?.type === 'Box' && n.children?.includes(summary) ? n : (n?.children ?? []).map(line).find(Boolean))
  expect(line(drawn).props.flexWrap).toBe('wrap')
  await ui.unmount()
})

test('DSK-03: a file with no extension is badged FILE, not by the start of its name', () => {
  for (const name of ['pre-commit', 'Makefile', 'LICENSE']) expect(badgeOf(name).text).toBe('FILE')
  expect(badgeOf('.env').text).toBe('ENV')
  expect(badgeOf('a.test.tsx').text).toBe('TSX')
  expect(badgeOf('hooks', true).text).toBe('DIR')
})

test('DSK-09: the view menu never shrinks, so its label is never cut', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await screenshotScene($, on)
  const parentOf = (n: any, hit: (c: any) => boolean): any => (n?.children ?? []).some(hit) ? n : (n?.children ?? []).map((c: any) => parentOf(c, hit)).find(Boolean)
  const holder = parentOf(await ui.drawn(), (c: any) => c?.type === 'Select')
  expect(holder?.type).toBe('Box')
  expect(holder.props.flexShrink).toBe(0)
  expect(holder.children.length).toBe(1)
  await ui.unmount()
})

test('DSK-09: a branch name too long for the line shrinks and ends in an ellipsis', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await screenshotScene($, on)
  const drawn = await ui.drawn()
  const holder = (n: any): any => (n?.type === 'Box' && (n.children ?? []).some((c: any) => c?.type === 'Text' && block(c)[0] === '⑂ ') ? n : (n?.children ?? []).map(holder).find(Boolean))
  const branch = holder(drawn)
  expect(branch).toBeDefined()
  expect(branch.props.flexShrink).toBe(1)
  expect(branch.props.minWidth).toBe(0)
  const head = branch.children.find((c: any) => c?.type === 'Text' && block(c)[0] === 'main')
  expect(String(head?.props.wrap)).toContain('truncate')
  await ui.unmount()
})
