import { expect, test } from 'claude-code/testing'

import { VERSION } from '../hooks/version'
import { frame, paneProps, world } from './harness'

const root = '/Users/k/proj'
const scene = (on: any) => world(on, { os: 'darwin', env: { HOME: '/Users/k' }, cwd: root, top: root, dirs: { [root]: [['a.ts', 'file']] }, status: '## main\0', numstat: '' }, [])

test('VER-01: /filetree says which version of filetree is loaded', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = scene(on)
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
  const r = await $.command.run({ command: 'filetree', args: '', origin: { kind: 'person' }, presentation: { isFullscreen: true, columns: 160 } } as any)
  expect(JSON.stringify(r)).toContain(`filetree ${VERSION}: File tree on`)
})

test('VER-01: the Desktop pane ends with the loaded version', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = scene(on)
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'filetree', surface: 'desktop', component: 'Pane', requestId: 'filetree', props: paneProps(60) })
  await clock.settle()
  expect(frame(await ui.drawn()).trimEnd().split('\n').at(-1)?.trim()).toBe(`filetree ${VERSION}`)
  await ui.unmount()
})
