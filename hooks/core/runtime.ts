import type { Timer } from 'claude-code'
import type { Change } from '../tree'
import type { Background, Job, OS } from './types'

/** The plugin's options, read once when register runs. */
export const settings = {
  glyphs: 'auto',
  openWith: 'preview',
  followClaude: true,
  showReads: true,
  showWrites: true,
  sizeDefault: false,
}

/**
 * Session state that lives outside the host store: timers, queues, caches and in-flight
 * work. Every module reads and writes it through this one object, so nothing else keeps
 * mutable state at module level.
 */
export const rt = {
  blink: null as Timer | null,
  themePoll: null as Timer | null,
  themeMtime: null as number | null,
  gitWatched: [] as string[],
  gitSettle: null as Timer | null,
  generation: 0,
  lastPress: { key: '', at: 0 },
  noNerd: false,
  previewed: null as { path: string; text: string; note: string } | null,
  previewRows: 20,
  scanning: null as Promise<void> | null,
  scanJobs: [] as Job[],
  gitRun: null as Promise<void> | null,
  gitNext: null as Promise<void> | null,
  queuedReads: [] as string[],
  searchIndex: null as { root: string; paths: Promise<string[]> } | null,
  activityId: 0,
  pointer: true,
  view: { from: 0, max: 0 },
  nativeScroll: false,
  // The desktop page can press a Button with a handle from a drawing the engine has already
  // replaced, which no onPress answers; the latest drawing's actions are kept here by key instead.
  routePress: (() => undefined) as (key: string) => (() => void) | undefined,
  lastSync: 0,
  noDock: false,
  // Set by an open nobody asked for, so the first terminal drawing checks the layout /filetree checks.
  autoDock: false,
  home: '',
  platform: null as Promise<OS> | null,
  dirty: { root: '', files: {} } as { root: string; files: Record<string, Change> },
  markId: 0,
  listSeq: 0,
  sizeEpoch: 0,
  sizeActive: 0,
  sizeQueue: [] as string[],
  sizing: new Set<string>(),
  listLatest: new Map<string, number>(),
  unreadable: new Set<string>(),
  background: new Map<string, Background>(),
}
