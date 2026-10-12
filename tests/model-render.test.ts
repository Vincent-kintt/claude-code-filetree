import { expect, test } from 'claude-code/testing'

import { DEFAULT_THEME, emptyTree, toNodes } from '../hooks/tree'
import { cardOf, whereOf } from '../hooks/features/desktop/model'
import { cutLines, previewLines, previewWindow, scrollTop, shapePreview } from '../hooks/features/preview/model'
import { capRows, latestActivity, note, relPath, treeView } from '../hooks/features/tree/model'

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${String(i).padStart(3, '0')}.txt`, kind: 'file' as const, mtimeMs: 0, size: 10, isLink: false }))
const tree = (n: number) => ({ ...emptyTree('/p'), nodes: toNodes('/p', files(n)) })
const inputs = { theme: DEFAULT_THEME, unicode: true, width: 60, bodyRows: 20, nativeScroll: false, followClaude: true, latest: undefined }

test('a preview drops carriage returns and control characters and cuts a long line with an ellipsis', () => {
  const shaped = shapePreview(`a\r\nb\u0007c\n${'x'.repeat(2_500)}`, '')
  const lines = shaped.text.split('\n')
  expect(lines.slice(0, 2)).toEqual(['a', 'bc'])
  expect(lines[2]?.length).toBe(2_001)
  expect(lines[2]?.endsWith('…')).toBe(true)
  expect(shaped.note).toBe('')
})

test('a preview of a long file keeps whole lines and notes how much it shows', () => {
  const shaped = shapePreview('line\n'.repeat(30_000), '')
  expect(shaped.note.startsWith('first ')).toBe(true)
  expect(shaped.note.endsWith(' lines of 150,000 characters')).toBe(true)
})

test('scrolling a preview stops at the top and where the last line reaches the bottom', () => {
  const text = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n')
  expect(scrollTop(text, 20, 0, -5)).toBe(0)
  expect(scrollTop(text, 20, 25, 10)).toBe(30)
  expect(scrollTop(undefined, 20, 3, 3)).toBe(0)
})

test('a Markdown window that starts inside a code fence reopens the fence', () => {
  const text = ['# t', '```ts', 'a', 'b', '```', 'after'].join('\n')
  expect(previewLines(text, 3, 2, true)).toEqual({ text: '```ts\nb\n```', top: 3 })
  expect(previewLines(text, 3, 2, false)).toEqual({ text: 'b\n```', top: 3 })
})

test('the terminal preview window leaves a row for the note and names the file relative to the root', () => {
  const w = previewWindow('/p/docs/a.md', '/p', 'x\n'.repeat(100), 'a note', 500, 30, false)
  expect(w).toMatchObject({ name: 'docs/a.md', markdown: true, rows: 28 })
  expect(w.win.top).toBe(101 - 28)
})

test('a desktop preview is cut at a whole line within the drawing cap', () => {
  const text = `${'y'.repeat(1_000)}\n`.repeat(100)
  const cut = cutLines(text, 1_000)
  expect(cut.length).toBeLessThan(text.length)
  expect(cut.endsWith('\n')).toBe(true)
  expect(cutLines('short', 1_000)).toBe('short')
})

test('the tree window follows the scroll position and draws a scrollbar when rows are hidden', () => {
  const view = treeView({ ...inputs, t: { ...tree(100), scroll: 10 } })
  expect(view.from).toBe(10)
  expect(view.max).toBe(100 - 17)
  expect(view.specs[0]?.id).toBe('/p/f010.txt')
  expect(view.bar).toBeDefined()
  expect(view.sizes).toBe(null)
})

test('an empty tree shows one muted note and no scrollbar', () => {
  const view = treeView({ ...inputs, t: emptyTree('/p') })
  expect(view.specs).toEqual([note('empty', DEFAULT_THEME.muted)])
  expect(view.bar).toBeUndefined()
})

test('a tree too big to draw keeps the rows around the cursor with notes for the rest', () => {
  const specs = Array.from({ length: 2_000 }, (_, i) => ({ id: `/p/${i}`, left: [{ t: `row number ${i}` }], right: [] }))
  capRows(specs, 1_000, t => note(t, '#888'))
  expect(specs[0]?.left[0]?.t.endsWith('rows above')).toBe(true)
  expect(specs.at(-1)?.left[0]?.t.endsWith('more rows; search to find the rest')).toBe(true)
  expect(specs.some(s => s.id === '/p/1000')).toBe(true)
})

test('the footer chip prefers a running activity over a newer finished one and drops expired ones', () => {
  const a = { id: 1, kind: 'git push', label: 'pushing', state: 'running' as const, detail: '', at: 100, tone: 'teal', nerd: '', plain: '' }
  const b = { ...a, id: 2, state: 'done' as const, at: 200 }
  expect(latestActivity([a, b], 300)?.id).toBe(1)
  expect(latestActivity([b], 10_000_000)).toBeUndefined()
})

test('paths read relative to the root inside it and the card says where a file sits', () => {
  expect(relPath('/p', '/p/a/b.ts')).toBe('a/b.ts')
  expect(whereOf('/p', '/p/a.ts')).toBe('in project root')
  expect(whereOf('/p', '/p/src/a.ts')).toBe('in src')
})

test('with nothing done yet the desktop card waits for Claude', () => {
  expect(cardOf(null, undefined, p => p)).toMatchObject({ phase: 'IDLE', icon: 'idle', live: false })
})
