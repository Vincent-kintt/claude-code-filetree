import { TONES } from '../git'

// The desktop page refuses a drawing past about 100,000 characters serialized, so the
// highlighted file stays well under it.
export const RENDER_CHARS = 60_000
export const TOUCH_KEEP = 40
export const TOUCH_SHOWN = 8
export const PANE = 'filetree'
export const MIN_COLUMNS = 110
// Below this many columns the date column is hidden, so the names get the room (TRE-08).
export const DATE_MIN_COLUMNS = 40
export const SHIMMER = Object.fromEntries(Object.entries(TONES).map(([k, v]) => [k, { bright: v.bright, dim: v.dim }]))
// The desktop app may be light or dark and says neither, so its shimmer peaks on a deep
// shade rather than the near-white the terminal's dark background takes.
export const DEEP: Record<string, string> = { orange: '#c2410c', green: '#15803d', teal: '#0f766e', blue: '#1d4ed8', purple: '#7e22ce', cyan: '#0e7490', red: '#b91c1c' }
export const SHIMMER_DESKTOP = Object.fromEntries(Object.entries(TONES).map(([k, v]) => [k, { bright: [v.bright[0] ?? v.solid, v.bright[1] ?? v.solid, v.bright[0] ?? v.solid, DEEP[k] ?? v.solid], dim: v.dim }]))
export const BRANCH_ROW = '#branch'
export const FLASH_MS = 2700
export const RUNNING_MAX_MS = 600_000
export const NO_REPO_DEPTH = 4
export const DOUBLE_MS = 450
export const FIND_LIMIT = 200
export const READ_REVEAL_LIMIT = 12
export const ACTIVITY_TTL_MS = 45_000
export const ADD_COLOR = '#98c379'
export const DEL_COLOR = '#e06c75'
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
export const PRUNE = ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']
export const HOME_PRUNE = ['Library', 'AppData', '.Trash']
export const SIZE_TIMEOUT_MS = 15_000
export const SIZE_JOBS = 2
export const SIZE_WALK_LIMIT = 50_000
