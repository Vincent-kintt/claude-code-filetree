import type { FileNode, FileTree } from '../../../types'
import type { OS } from '../../core/types'
import { dirname, inside } from '../../core/paths'

export const DOUBLE_MS = 450

export const LINUX_LAUNCH = 'setsid -f -w "$@" </dev/null >/dev/null 2>&1 & p=$!; sleep 1; kill -0 "$p" 2>/dev/null && exit 0; wait "$p"'

export const LINUX_OPEN = [
  'set -f',
  'f=$1',
  'if command -v gio >/dev/null; then',
  '  if [ -f "$f" ] && command -v file >/dev/null && encoding=$(file -b --mime-encoding -- "$f") && [ -n "$encoding" ] && [ "$encoding" != binary ]; then',
  '    case $(gio info -a standard::content-type -- "$f" | sed -n \'s/.*standard::content-type: //p\') in',
  '      video/* | audio/*)',
  '        app=$(xdg-mime query default text/plain)',
  '        IFS=:',
  '        for dir in "${XDG_DATA_HOME:-$HOME/.local/share}" ${XDG_DATA_DIRS:-/usr/local/share:/usr/share}; do',
  '          [ -n "$app" ] && [ -f "$dir/applications/$app" ] && exec gio launch "$dir/applications/$app" "$f"',
  '        done',
  '        echo "No text/plain desktop application found for $f" >&2',
  '        exit 1',
  '        ;;',
  '    esac',
  '  fi',
  '  if (exec gio open "$f"); then exit 0; fi',
  'fi',
  'exec xdg-open "$f"',
].join('\n')

const WIN_OPEN = "$ErrorActionPreference = 'Stop'; [Diagnostics.Process]::Start([Diagnostics.ProcessStartInfo]@{ FileName = $env:PANE_OPEN_TARGET; UseShellExecute = $true }) | Out-Null"

export function openCommand(os: 'linux' | 'darwin' | 'win32', target: string) {
  const argv = os === 'linux'
    ? ['sh', '-c', LINUX_LAUNCH, 'sh', 'sh', '-c', LINUX_OPEN, 'sh', target]
    : os === 'darwin'
      ? ['open', '--', target]
      : ['powershell', '-NoProfile', '-NonInteractive', '-Command', WIN_OPEN]
  return {
    argv,
    init: {
      timeoutMs: 10_000,
      ...(os === 'win32' ? { env: { PANE_OPEN_TARGET: /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : target.replace(/\//g, '\\') } } : {}),
    },
  }
}

function words(command: string): string[] {
  const out: string[] = []
  let word: string | null = null
  let quote = ''
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = ''
      else word = (word ?? '') + ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      word ??= ''
    } else if (/\s/.test(ch)) {
      if (word !== null) out.push(word)
      word = null
    } else word = (word ?? '') + ch
  }
  if (word !== null) out.push(word)
  return out
}

export function openWithCommand(command: string, path: string, dir: string): string[] | null {
  const argv = words(command)
  if (!argv.length) return null
  const filled = argv.map(w => w.replace(/\{(path|dir)\}/g, (_, key) => (key === 'path' ? path : dir)))
  return argv.some(w => w.includes('{path}')) ? filled : [...filled, path]
}

// The setting always has a value: a blank one falls back to the default, preview.
export function openSetting(openWith: string): string {
  return openWith.trim() || 'preview'
}

/** How a file opens outside the pane: the argv to run and the tool named when it fails. */
export function openPlan(os: OS, setting: string, external: boolean, path: string): { argv: string[]; init: ReturnType<typeof openCommand>['init']; tool: string } {
  const native = (p: string) => (os === 'win32' ? p.replace(/\//g, '\\') : p)
  const custom = external || setting === 'app' ? null : openWithCommand(setting, native(path), native(dirname(path)))
  const { argv, init } = custom ? { argv: os === 'linux' ? ['sh', '-c', LINUX_LAUNCH, 'sh', ...custom] : custom, init: { timeoutMs: 10_000 } } : openCommand(os, path)
  return { argv, init, tool: custom?.[0] ?? argv[0] }
}

export function openFailed(path: string, tool: string, run?: { exitCode: number; stderr: string }): string {
  if (!run) return `could not open ${path} with ${tool}`
  return `could not open ${path} with ${tool}: ${run.stderr.trim().split('\n')[0] || `exit ${run.exitCode}`}`
}

export function togglePatch(t: FileTree, n: FileNode): Partial<FileTree> {
  const open = new Set(t.expanded)
  if (n.kind === 'dir') open.has(n.id) ? open.delete(n.id) : open.add(n.id)
  return { expanded: [...open], cursor: n.id, selected: n.kind === 'dir' ? t.selected : n.id }
}

/** A second press on the same row within DOUBLE_MS is a double press, and resets the pair. */
export function pressOf(last: { key: string; at: number }, id: string, now: number): { isDouble: boolean; last: { key: string; at: number } } {
  const isDouble = last.key === id && now - last.at < DOUBLE_MS
  return { isDouble, last: { key: isDouble ? '' : id, at: now } }
}

/** The path as copied: relative to the root unless asked for whole, or outside it. */
export function copyText(root: string, id: string, absolute: boolean): string {
  return !absolute && id !== root && inside(root, id) ? id.slice(root.endsWith('/') ? root.length : root.length + 1) : id
}
