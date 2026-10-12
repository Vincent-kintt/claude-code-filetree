import { expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import type { GitOperation, Job, Pending } from '../hooks/core/types'
import { gitActions } from '../hooks/git'
import { branchTone, failAll, namedPaths, outcomesOf, paint, proven, settled, sinceOf, started, taskEnds, touchTone, writes } from '../hooks/features/git-jobs/model'
import { searchNames, searchReads } from '../hooks/features/reads/model'

const pending = (command: string, head = 'aaa'): Pending => ({ actions: gitActions(command), ids: gitActions(command).map((_, i) => i + 1), command, head })

test('a commit is done with the sha the tool reported, or with HEAD once it moved', () => {
  const p = pending('git commit -m x')
  expect(outcomesOf(p, true, { commit: { sha: '1234567890' } } as GitOperation, '')[0]).toEqual({ state: 'done', label: p.actions[0]?.done ?? '', detail: '1234567' })
  expect(outcomesOf(p, true, undefined, 'bbbbbbbbb')[0]?.detail).toBe('bbbbbbb')
  expect(outcomesOf(p, true, undefined, 'aaa')[0]?.state).toBe('failed')
})

test('a push is proven by the git operation, a lone failed command fails, a chain without evidence is unknown', () => {
  expect(outcomesOf(pending('git push'), false, { push: {} } as GitOperation, '')[0]?.state).toBe('done')
  expect(outcomesOf(pending('git push'), false, undefined, '')[0]?.state).toBe('failed')
  expect(outcomesOf(pending('git push; ls'), true, undefined, '')[0]?.state).toBe('unknown')
  expect(outcomesOf(pending('git push && ls'), true, undefined, '')[0]?.state).toBe('done')
})

test('proven keeps only the actions that succeeded, with their paths resolved', () => {
  const p = pending('git add a.ts && git push')
  const results = [...outcomesOf(p, true, undefined, '')]
  expect(proven(p, results, '/w', '').map(a => a.paths)).toEqual([['/w/a.ts'], undefined])
  expect(proven(p, failAll(p), '/w', '')).toEqual([])
  expect(proven(null, [], '/w', '')).toEqual([])
})

test('taskEnds reads each finished background task id and status', () => {
  const text = 'x<task-notification><task-id> b1 </task-id><status>completed</status></task-notification><task-notification><task-id>b2</task-id></task-notification>'
  expect(taskEnds(text)).toEqual([['b1', 'completed']])
})

test('the scan starts from the earliest job that wrote, or the earliest of all when none wrote', () => {
  const job = (ms: number, readOnly: boolean): Job => ({ actions: [], since: { ms, mark: '', os: 'linux' }, initRepo: false, readOnly })
  expect(sinceOf([job(5, true), job(9, false), job(7, false)]).ms).toBe(7)
  expect(sinceOf([job(5, true), job(3, true)]).ms).toBe(3)
  expect(sinceOf([]).ms).toBe(0)
  expect(writes([job(1, true)])).toBe(false)
  expect(writes([job(1, true), job(2, false)])).toBe(true)
})

test('starting git actions drops expired entries and settling takes unknown ones down', () => {
  const old: Activity = { id: 9, kind: 'git push', label: 'x', state: 'done', detail: '', at: 0, tone: 'blue', nerd: '', plain: '' }
  const p = pending('git push; ls')
  const list = started([old], p.actions, p.ids, 1_000_000)
  expect(list.map(a => [a.id, a.state])).toEqual([[1, 'running']])
  expect(settled(list, p.ids, [{ state: 'unknown', label: '', detail: '' }], 5)).toEqual({ list: [], last: undefined })
  const done = settled(list, p.ids, [{ state: 'done', label: 'pushed', detail: '' }], 5)
  expect(done.last?.label).toBe('pushed')
  expect(done.last?.at).toBe(5)
})

test('tones: a touch takes the first non-commit action tone, the branch row follows push-like actions or a commit', () => {
  expect(touchTone(gitActions('git commit -m x'))).toBe('orange')
  expect(branchTone(gitActions('git push'), false)).toBe(gitActions('git push')[0]?.tone)
  expect(branchTone(gitActions('git commit -m x'), true)).toBe('green')
  expect(branchTone([], false)).toBe(undefined)
  expect(paint({ a: 'orange' }, ['a', 'b', 'c'], new Set(['a', 'b']), 'purple', false)).toEqual({ a: 'orange', b: 'purple' })
})

test('an add names its paths unless it stages everything; a commit names none', () => {
  expect(namedPaths(gitActions('git add a.ts b.ts'), false)).toEqual(['a.ts', 'b.ts'])
  expect(namedPaths(gitActions('git add .'), false)).toBe(null)
  expect(namedPaths(gitActions('git add a.ts'), true)).toBe(null)
})

test('a search result lists its filenames, or the path prefixes of its content lines', () => {
  expect(searchNames({ filenames: ['a.ts', 3, 'b.ts'] }, false)).toEqual(['a.ts', 'b.ts'])
  expect(searchNames({ content: 'src/a.ts:12:hit\nsrc/b.ts:3-ctx\nnoise' }, false)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(searchReads(['a.ts', 'a.ts', '/x/b.ts'], '/w', '')).toEqual(['/w/a.ts', '/x/b.ts'])
})
