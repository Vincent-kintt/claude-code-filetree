import { expect, test } from 'claude-code/testing'
import { changedArgv, dirtySplit, foundPaths, markPath } from '../hooks/features/changes/model'
import { assembleGit, gitdirRef, parseRevParse, watchFiles } from '../hooks/features/git-status/model'
import { freshListings, linkEntry } from '../hooks/features/listing/model'
import { copyText, openPlan, pressOf } from '../hooks/features/open/model'
import { indexedPaths, matches, staleDirs } from '../hooks/features/search/model'
import { enqueue, keptSizes, parseDu, SIZE_WALK_LIMIT, tallyDir } from '../hooks/features/sizes/model'

test('git status: numstat and ls-files fold into the dirty files, and a new file keeps no diff', () => {
  const parsed = { git: {}, ignored: [], untrackedDirs: ['/r/out'], branch: null, files: { '/r/a.ts': 'mod' as const, '/r/b.ts': 'new' as const } }
  const { files, patch } = assembleGit(parsed, '3\t1\ta.ts\x004\t0\tb.ts\x00', 'out/c.ts\x00', '/r', '')
  expect(files).toEqual({ '/r/a.ts': 'mod', '/r/b.ts': 'new', '/r/out/c.ts': 'new' })
  expect(patch.diff).toEqual({ '/r/a.ts': [3, 1], '/r': [3, 1] })
  expect(patch.counts?.['/r']).toEqual([2, 1, 0])
  expect(assembleGit(parsed, null, null, '/r', '').files).toEqual(parsed.files)
})

test('git status: rev-parse gives top and prefix only when it succeeded, and a gitdir file names its dir', () => {
  expect(parseRevParse(0, 'sub/\n/r\n')).toEqual({ top: '/r', prefix: 'sub/' })
  expect(parseRevParse(128, 'fatal')).toEqual({ top: '', prefix: '' })
  expect(gitdirRef('gitdir: ../.git/worktrees/x \n')).toBe('../.git/worktrees/x')
  expect(gitdirRef('nothing here')).toBe(undefined)
  expect(watchFiles('', '/w')).toEqual(['/w/.git/index', '/w/.git/HEAD'])
})

test('changes: find tests a mark file when there is one, else the clock, and leaves the root out', () => {
  expect(changedArgv('/r', { ms: 1500, mark: '', os: 'linux' }, 4, ['P'])).toEqual(['find', '-H', '/r', '-xdev', '-maxdepth', '4', 'P', '-newermt', '@1.500', '-print0'])
  expect(changedArgv('/r', { ms: 1500, mark: '/t/m', os: 'darwin' }, 0, [])).toEqual(['find', '-H', '/r', '-xdev', '-newer', '/t/m', '-print0'])
  expect(foundPaths('/r\x00/r/a\x00', '/r')).toEqual(['/r/a'])
  expect(markPath('/tmp/x//', 's1', 3)).toBe('/tmp/x/filetree-s1-3.mark')
  expect(markPath('', 's1', 3)).toBe('/tmp/filetree-s1-3.mark')
})

test('changes on Windows: only deletions new since before are gone, and another root has none', () => {
  const dirty = { root: '/r', files: { '/r/a': 'del' as const, '/r/b': 'del' as const, '/r/c': 'mod' as const } }
  expect(dirtySplit(dirty, '/r', { '/r/a': 'del' })).toEqual({ live: ['/r/c'], gone: ['/r/b'] })
  expect(dirtySplit(dirty, '/s', {})).toBe(null)
})

test('sizes: du output reads as bytes, a walk skips linked dirs and stops past its limit', () => {
  expect(parseDu('12\t/r\n')).toBe(12 * 1024)
  expect(parseDu('')).toBe(-1)
  const entries = [
    { name: 'a', kind: 'file', isLink: false, size: 5 },
    { name: 'd', kind: 'dir', isLink: false, size: 0 },
    { name: 'l', kind: 'dir', isLink: true, size: 0 },
  ]
  expect(tallyDir('/r', entries, 0)).toEqual({ bytes: 5, dirs: ['/r/d'], seen: 3 })
  expect(tallyDir('/r', entries, SIZE_WALK_LIMIT - 2)).toBe(null)
  expect(enqueue(['/a'], new Set(['/b']), ['/a', '/b', '/c'])).toEqual(['/a', '/c'])
  expect(keptSizes({ '/r': 1, '/r/x': 2, '/r/y': 3 }, ['/r/x/f'])).toEqual({ '/r/y': 3 })
  expect(keptSizes({ '/r': 1 })).toEqual({})
})

test('search: matches are relative and capped, truncated listings drop their last path', () => {
  expect(matches(['/r/src/Foo.ts', '/r/foo/x', '/r/bar'], '/r', 'foo')).toEqual(['/r/src/Foo.ts', '/r/foo/x'])
  expect(matches(Array.from({ length: 100 }, (_, i) => `/r/f${i}`), '/r', 'f').length).toBe(60)
  expect(indexedPaths('a\x00/abs/b\x00cut', true, '/r')).toEqual(['/r/a', '/abs/b'])
  expect(staleDirs(['/r/a/x', '/r/a/y', '/r/b/z'], new Set(['/r/b/z']), '/r')).toEqual(['/r/a'])
})

test('listing: a link to a dir lists as a dir, a broken link as other, and a superseded load is dropped', () => {
  expect(linkEntry('l', { kind: 'dir', mtimeMs: 7, size: 9 })).toEqual({ name: 'l', kind: 'dir', mtimeMs: 7, size: 0, isLink: false })
  expect(linkEntry('l', null)).toEqual({ name: 'l', kind: 'other', mtimeMs: 0, size: 0, isLink: true })
  const { listed, done } = freshListings([['/a', []], ['/b', null], ['/c', []]], new Map([['/a', 2], ['/b', 2], ['/c', 3]]), 2)
  expect([...listed.keys()]).toEqual(['/a'])
  expect(done).toEqual(['/a', '/b'])
})

test('open: a custom opener on linux runs detached and is named on failure, and paths copy relative', () => {
  const plan = openPlan('linux', 'zed', false, '/w/a.md')
  expect(plan.argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(plan.argv.slice(-2)).toEqual(['zed', '/w/a.md'])
  expect(plan.tool).toBe('zed')
  expect(openPlan('darwin', 'zed', true, '/w/a.md').argv).toEqual(['open', '--', '/w/a.md'])
  expect(openPlan('win32', 'code {path}', false, 'C:/w/a.md').argv).toEqual(['code', 'C:\\w\\a.md'])
  expect(copyText('/w', '/w/src/a.md', false)).toBe('src/a.md')
  expect(copyText('/w', '/w/src/a.md', true)).toBe('/w/src/a.md')
  expect(copyText('/w', '/w', false)).toBe('/w')
})

test('press: a second press on the same row soon after is a double press and resets the pair', () => {
  const first = pressOf({ key: '', at: 0 }, '/a', 1000)
  expect(first).toEqual({ isDouble: false, last: { key: '/a', at: 1000 } })
  expect(pressOf(first.last, '/a', 1200)).toEqual({ isDouble: true, last: { key: '', at: 1200 } })
  expect(pressOf(first.last, '/a', 2000).isDouble).toBe(false)
  expect(pressOf(first.last, '/b', 1100).isDouble).toBe(false)
})
