import type { Activity, ClaudeLog, FileTree } from '../../../types'
import { MIN_COLUMNS } from '../../core/constants'
import { ancestorsOf, posix } from '../../tree'

export const THEME_FILE = '.local/state/omarchy/current/theme/colors.toml'
export const THEME_POLL_MS = 2000
export const FONT_SCRIPT =
  'if command -v fc-list >/dev/null 2>&1; then f=$(fc-list ":charset=$1" file | head -n1 | cut -d: -f1); ' +
  'else f=$(ls "$HOME"/Library/Fonts/*Nerd* /Library/Fonts/*Nerd* 2>/dev/null | head -n1); fi; ' +
  '[ -n "$f" ] || { echo missing; exit 0; }; m=$(stat -c %Z "$f" 2>/dev/null || stat -f %c "$f"); p=$PPID; ' +
  'while [ -n "$p" ] && [ "$p" -gt 1 ]; do c=$(ps -o comm= -p "$p" 2>/dev/null); c=$(basename "$c" 2>/dev/null | tr -d " "); case "$c" in ' +
  'ghostty|kitty|alacritty|Alacritty|foot|footclient|wezterm-gui|konsole|gnome-terminal-|xterm|urxvt|st|Terminal|iTerm2) ' +
  'e=$(ps -o etime= -p "$p" 2>/dev/null | awk -F\'[-:]\' \'{n=NF; s=$n+60*$(n-1); if (n>2) s+=3600*$(n-2); if (n>3) s+=86400*$(n-3); print s}\'); [ -n "$e" ] && [ $(( $(date +%s) - e )) -lt "$m" ] && echo stale || echo ok; exit 0;; esac; ' +
  'p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); done; echo ok'

export type Settings = { glyphs: string; openWith: string; followClaude: boolean; showReads: boolean; showWrites: boolean; sizeDefault: boolean }

/** The plugin's options as settings, each falling back to its default. */
export function settingsFrom(options: Record<string, unknown> | undefined): Settings {
  const activity = typeof options?.activity === 'string' ? options.activity : 'reads and writes'
  return {
    glyphs: typeof options?.glyphs === 'string' ? options.glyphs : 'auto',
    showReads: activity.includes('reads'),
    showWrites: activity.includes('writes'),
    followClaude: options?.follow !== 'off',
    sizeDefault: options?.column === 'size',
    openWith: typeof options?.open === 'string' ? options.open : 'preview',
  }
}

export function homeOf(raw: string): string {
  return posix(raw.replace(/[\\/]+$/, ''))
}

export function paneTitle(root: string): string {
  return `Files: ${root.split('/').pop() || root}`
}

export function themePath(home: string | undefined): string {
  return `${home ?? ''}/${THEME_FILE}`
}

export function herdrPointerOk(version: string): boolean {
  const [major = 0, minor = 0, fix = 0] = (/(\d+)\.(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number)
  return major * 1e6 + minor * 1e3 + fix >= 9_001
}

export function fontStateOf(out: string): 'ok' | 'stale' | 'missing' {
  const s = out.trim()
  return s === 'stale' || s === 'missing' ? s : 'ok'
}

/** A session that ended mid-action leaves it running; the next one marks it interrupted. */
export function interruptActivities(list: Activity[]): Activity[] {
  return list.map(a => (a.state === 'running' ? { ...a, state: 'failed', label: `${a.kind} interrupted` } : a))
}

export function interruptClaude(cur: ClaudeLog | undefined): ClaudeLog {
  return cur?.now?.state === 'running' ? { ...cur, now: { ...cur.now, state: 'failed' as const }, touched: cur.touched.filter(x => x.state !== 'reading' && x.state !== 'editing') } : (cur ?? { now: null, touched: [] })
}

/** Why /filetree cannot dock in this terminal, or null when it can. */
export function layoutRefusal(terminal: boolean, isFullscreen: boolean, columns: number): string | null {
  if (terminal && !isFullscreen) return 'filetree shows in the sidebar, which needs the fullscreen layout. Run /tui fullscreen, then /filetree.'
  if (terminal && columns < MIN_COLUMNS) return 'filetree shows in the sidebar, which needs a terminal at least 110 columns wide. Widen it, then run /filetree.'
  return null
}

function openTo(cur: FileTree, paths: string[]): string[] {
  const open = new Set(cur.expanded)
  for (const p of paths) for (const a of ancestorsOf(p, cur.root)) open.add(a)
  return [...open]
}

/** Opens the folders down to `paths` and puts the cursor on the last. */
export function revealPatch(cur: FileTree, paths: string[]): Partial<FileTree> {
  return { expanded: openTo(cur, paths), cursor: paths[paths.length - 1] ?? cur.cursor, scroll: null }
}

/** Opens the folders down to the search hits, puts the cursor on the first and clears the query. */
export function jumpPatch(cur: FileTree, hits: string[]): Partial<FileTree> {
  return { query: '', expanded: openTo(cur, hits), cursor: hits[0] ?? cur.cursor, scroll: null }
}
