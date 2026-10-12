import { expect, test } from 'claude-code/testing'
import type { FileNode, FileTree } from '../types'
import { clearFlash, flashPatch, withTouches } from '../hooks/features/activity/model'
import { mentionsIn, selectedContext } from '../hooks/features/context/model'
import { keyAction, scrollToRow, wheelScroll } from '../hooks/features/input/model'
import { fontStateOf, herdrPointerOk, interruptClaude, layoutRefusal, settingsFrom } from '../hooks/features/session/model'
import { emptyTree } from '../hooks/features/tree/nodes'

const root = '/w'
const node = (id: string, kind: 'dir' | 'file', loaded = false): FileNode => ({ id, parent: id.slice(0, id.lastIndexOf('/')), name: id.split('/').pop() ?? id, kind, hidden: false, mtime: 0, size: 0, loaded })
const tree = (over: Partial<FileTree> = {}): FileTree => ({
  ...emptyTree(root),
  nodes: [node('/w/src', 'dir', true), node('/w/src/a.ts', 'file'), node('/w/src/b.ts', 'file'), node('/w/z.md', 'file')],
  ...over,
})
const keep = { followClaude: true, from: 0 }

test('flashPatch lights a file bright, opens its closed folders dim, and drops the scroll when following Claude', () => {
  const p = flashPatch(tree({ scroll: 4 }), { '/w/src/a.ts': 'purple' }, keep)
  expect(p.flash).toEqual(['/w/src/a.ts'])
  expect(p.flashDim).toEqual(['/w/src'])
  expect(p.flashOn).toBe(true)
  expect(p.flashTones).toEqual({ '/w/src/a.ts': 'purple', '/w/src': 'purple' })
  expect(p.expanded).toEqual(['/w/src'])
  expect(p.scroll).toBe(null)
})

test('flashPatch keeps a running shimmer and opens nothing for a file whose folders are already open', () => {
  const cur = tree({ expanded: ['/w/src'], flashOn: true, flash: ['/w/z.md'], flashDim: [], flashTones: { '/w/z.md': 'orange' } })
  const p = flashPatch(cur, { '/w/src/b.ts': 'orange' }, keep)
  expect(p.flash).toEqual(['/w/z.md', '/w/src/b.ts'])
  expect(p.flashDim).toEqual([])
  expect(p.flashTones).toEqual({ '/w/z.md': 'orange', '/w/src/b.ts': 'orange' })
})

test('flashPatch without follow keeps the top row in place as folders open above it', () => {
  const p = flashPatch(tree({ scroll: 1 }), { '/w/src/a.ts': 'orange' }, { followClaude: false, from: 0 })
  expect(p.scroll).toBe(3)
  expect(clearFlash()).toEqual({ flash: [], flashDim: [], flashOn: false, flashTones: {} })
})

test('withTouches moves touched paths to the front and a null state only forgets them', () => {
  const log = { now: null, touched: [{ path: '/w/a', state: 'read' as const, at: 1 }, { path: '/w/b', state: 'edited' as const, at: 1 }] }
  const next = withTouches(log, ['/w/b'], 'editing', 5, { verb: 'edit', state: 'running', path: '/w/b', count: 1, detail: '' })
  expect(next.touched.map(x => x.path)).toEqual(['/w/b', '/w/a'])
  expect(next.now?.at).toBe(5)
  expect(withTouches(log, ['/w/a'], null, 5).touched.map(x => x.path)).toEqual(['/w/b'])
})

test('keyAction moves the cursor, toggles and opens nodes, copies, and steps to the parent', () => {
  const t = tree({ expanded: ['/w/src'], cursor: '/w/src/a.ts' })
  expect(keyAction('down', false, t, 20)).toEqual({ kind: 'patch', patch: { cursor: '/w/src/b.ts', scroll: null } })
  expect(keyAction('home', false, t, 20)).toEqual({ kind: 'patch', patch: { cursor: '/w/src', scroll: null } })
  expect(keyAction('end', false, t, 20)).toEqual({ kind: 'patch', patch: { cursor: '/w/z.md', scroll: null } })
  expect(keyAction('return', false, t, 20)).toMatchObject({ kind: 'open', node: { id: '/w/src/a.ts' } })
  expect(keyAction('y', true, t, 20)).toEqual({ kind: 'copy', id: '/w/src/a.ts', absolute: true })
  expect(keyAction('y', false, t, 20)).toEqual({ kind: 'copy', id: '/w/src/a.ts', absolute: false })
  expect(keyAction('left', false, t, 20)).toEqual({ kind: 'patch', patch: { cursor: '/w/src' } })
  const onDir = tree({ expanded: ['/w/src'], cursor: '/w/src' })
  expect(keyAction('left', false, onDir, 20)).toMatchObject({ kind: 'toggle', node: { id: '/w/src' } })
  expect(keyAction('right', false, onDir, 20)).toEqual({ kind: 'none' })
  expect(keyAction('q', false, t, 20)).toEqual({ kind: 'none' })
})

test('keyAction in a preview scrolls it by line or page and left closes it', () => {
  const t = tree({ preview: '/w/z.md' })
  expect(keyAction('j', false, t, 20)).toEqual({ kind: 'scrollPreview', by: 1 })
  expect(keyAction('pageup', false, t, 20)).toEqual({ kind: 'scrollPreview', by: -18 })
  expect(keyAction('end', false, t, 20)).toEqual({ kind: 'scrollPreview', by: Infinity })
  expect(keyAction('h', false, t, 20)).toEqual({ kind: 'closePreview' })
  expect(keyAction('return', false, t, 20)).toEqual({ kind: 'none' })
})

test('scrollbar and wheel positions clamp to the scroll range, the wheel moving at least three rows', () => {
  expect(scrollToRow(0.5, 40)).toBe(20)
  expect(scrollToRow(2, 40)).toBe(40)
  expect(wheelScroll(1, null, 5, 40)).toBe(8)
  expect(wheelScroll(-10, 4, 0, 40)).toBe(0)
  expect(wheelScroll(10, 38, 0, 40)).toBe(40)
})

test('mentionsIn resolves @paths inside the root and trims trailing punctuation', () => {
  expect(mentionsIn('see @src/a.ts, and @../out.txt or @/w/z.md.', root, '/home/u')).toEqual(['/w/src/a.ts', '/w/z.md'])
  expect(mentionsIn('no mentions here', root, '')).toEqual([])
  expect(selectedContext('/w/z.md')).toContain('selected in the file tree')
})

test('settingsFrom falls back to the defaults and reads each option', () => {
  expect(settingsFrom(undefined)).toEqual({ glyphs: 'auto', showReads: true, showWrites: true, followClaude: true, sizeDefault: false, openWith: 'preview' })
  expect(settingsFrom({ glyphs: 'plain', activity: 'writes', follow: 'off', column: 'size', open: 'zed' })).toEqual({ glyphs: 'plain', showReads: false, showWrites: true, followClaude: false, sizeDefault: true, openWith: 'zed' })
  expect(settingsFrom({ activity: 'none' })).toMatchObject({ showReads: false, showWrites: false })
})

test('session checks: layout refusal, herdr version, font state, an interrupted Claude log', () => {
  expect(layoutRefusal(true, false, 200)).toContain('fullscreen layout')
  expect(layoutRefusal(true, true, 80)).toContain('110 columns')
  expect(layoutRefusal(false, false, 80)).toBe(null)
  expect(herdrPointerOk('herdr 0.9.1')).toBe(true)
  expect(herdrPointerOk('herdr 0.9.0')).toBe(false)
  expect(fontStateOf(' stale\n')).toBe('stale')
  expect(fontStateOf('whatever')).toBe('ok')
  const log = interruptClaude({ now: { verb: 'read', state: 'running', path: '/w/a', count: 1, detail: '', at: 1 }, touched: [{ path: '/w/a', state: 'reading', at: 1 }] })
  expect(log.now?.state).toBe('failed')
  expect(log.touched).toEqual([])
  expect(interruptClaude(undefined)).toEqual({ now: null, touched: [] })
})
