export type FileNode = {
  id: string
  parent: string
  name: string
  kind: 'dir' | 'file' | 'link'
  hidden: boolean
  mtime: number
  size: number
  loaded: boolean
}

export type Branch = {
  head: string
  upstream: string
  ahead: number
  behind: number
}

export type Activity = {
  id: number
  kind: string
  label: string
  state: 'running' | 'done' | 'failed'
  detail: string
  at: number
  tone: string
  nerd: string
  plain: string
}

export type FileTree = {
  root: string
  nodes: FileNode[]
  expanded: string[]
  cursor: string
  selected: string
  query: string
  showSize: boolean
  dirSizes: Record<string, number>
  git: Record<string, string>
  diff: Record<string, [number, number]>
  ignored: string[]
  untrackedDirs: string[]
  top: string
  prefix: string
  branch: Branch | null
  counts: Record<string, [number, number, number]>
  flash: string[]
  flashDim: string[]
  flashOn: boolean
  flashTones: Record<string, string>
  scroll: number | null
  preview: string
  previewTop: number
  view: 'all' | 'edited'
  changes: Record<string, 'new' | 'mod' | 'del'>
}

export type Touch = {
  path: string
  state: 'reading' | 'read' | 'editing' | 'edited' | 'committed'
  at: number
}

export type Now = {
  verb: 'read' | 'edit' | 'commit'
  state: 'running' | 'done' | 'failed'
  path: string
  count: number
  detail: string
  at: number
}

export type ClaudeLog = {
  now: Now | null
  touched: Touch[]
}

export type Theme = {
  fg: string
  accent: string
  muted: string
  urgent: string
  selection: string
  bg: string
}

declare module 'claude-code' {
  interface PluginState {
    filetree: {
      tree: FileTree
      theme: Theme
      activity: Activity[]
      claude: ClaudeLog
    }
  }
}
