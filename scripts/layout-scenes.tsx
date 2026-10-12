// Desktop scenes for scripts/check-desktop-layout.ts. Not a test file: the script copies it into a
// scratch mod as tests/scenes.test.tsx, runs it, and reads each drawn tree from the SCENE lines.
import { test } from 'claude-code/testing'

import { paneProps, world } from './harness'

const HOME = '/Users/k'
const root = `${HOME}/Projects/claude-code-filetree`
const changed = Array.from({ length: 14 }, (_, i) => `f${i}.ts`)
const specs = ['spec-activity-footer', 'spec-git', 'spec-tree', 'spec-input-appearance', 'spec-open', 'spec-activity-shimmer', 'spec-desktop-frames'].map(n => `${n}.test.tsx`)

async function desktop($: any, on: any, branch = 'main') {
  const clock = world(on, {
    os: 'darwin', env: { HOME, TMPDIR: '/var/folders/x/T/' }, cwd: root, top: root,
    dirs: {
      [root]: [['hooks', 'dir'], ['tests', 'dir'], ...changed.map(f => [f, 'file'] as [string, 'file'])],
      [`${root}/hooks`]: [['register.tsx', 'file']],
      [`${root}/tests`]: specs.map(f => [f, 'file'] as [string, 'file']),
    },
    status: `## ${branch}...origin/${branch}\0${changed.map(f => ` M ${f}\0`).join('')}`,
    numstat: `2\t139\tf0.ts\0${changed.slice(1).map(f => `0\t0\t${f}\0`).join('')}`,
    files: { [`${root}/tests/spec-activity-shimmer.test.tsx`]: "import { expect, test } from 'claude-code/testing'\n\ntest('ACT-01: the Read, Grep and Glob tools shimmer the files they read or list purple', async () => {\n  expect(1).toBe(1)\n})\n" },
  }, [])
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  return { clock, ui }
}

const scene = async (name: string, ui: any) => console.log(`SCENE:${name}:${JSON.stringify(await ui.drawn())}`)

test('scene: idle', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await desktop($, on)
  await scene('idle', ui)
  await ui.unmount()
})

test('scene: busy, as in the bug report', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, ui } = await desktop($, on)
  for (const f of specs) await $.tool.call({ tool: 'Read', file_path: `${root}/tests/${f}` } as any)
  await $.tool.call({ tool: 'Read', file_path: `${root}/hooks/register.tsx` } as any)
  await $.tool.call({ tool: 'Bash', command: 'ls tests' } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${root}/tests/spec-open.test.tsx`, old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${HOME}/.claude/projects/-Users-k-Projects-claude-code-filetree/memory/test-runner-quirks.md`, old_string: 'a', new_string: 'b' } as any)
  await clock.settle()
  await scene('busy', ui)
  await ui.unmount()
})

test('scene: file view', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, ui } = await desktop($, on)
  const file = `${root}/tests/spec-activity-shimmer.test.tsx`
  await ui.post({ press: `${root}/tests` }, { in: 'rows' })
  await clock.settle()
  await ui.post({ press: file }, { in: 'rows' })
  await ui.post({ press: file }, { in: 'rows' })
  await clock.settle()
  await scene('file-view', ui)
  await ui.unmount()
})

test('scene: a long branch name', { timeoutMs: 20_000 }, async ($, on) => {
  const { ui } = await desktop($, on, 'feature/NAV-12345-desktop-pane-layout-at-narrow-widths')
  await scene('long-branch', ui)
  await ui.unmount()
})
