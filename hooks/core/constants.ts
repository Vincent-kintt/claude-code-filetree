// The desktop page refuses a drawing past about 100,000 characters serialized, so the
// highlighted file stays well under it.
export const RENDER_CHARS = 60_000
export const PANE = 'filetree'
export const MIN_COLUMNS = 110
export const BRANCH_ROW = '#branch'
export const FLASH_MS = 2700
export const NO_REPO_DEPTH = 4
export const READ_REVEAL_LIMIT = 12
export const ACTIVITY_TTL_MS = 45_000
export const PRUNE = ['.git', 'node_modules', 'target', '.venv', '__pycache__', 'dist', '.next']
export const HOME_PRUNE = ['Library', 'AppData', '.Trash']
