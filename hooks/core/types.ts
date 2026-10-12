import type { BuiltinToolResults } from 'claude-code'
import type { GitAction } from '../features/git-jobs/commands'

export type OS = 'linux' | 'darwin' | 'win32'
export type Since = { ms: number; mark: string; os: OS }
export type Pending = { actions: GitAction[]; ids: number[]; command: string; head: string }
export type Job = { actions: GitAction[]; since: Since; initRepo: boolean; readOnly: boolean }
export type Background = { p: Pending | null; job: Job; reads: string[]; cwd: string }
export type GitOperation = NonNullable<BuiltinToolResults['Bash']['gitOperation']>
// 'unknown' is a command with no evidence of how it went: its chip is taken down.
export type Outcome = { state: 'done' | 'failed' | 'unknown'; label: string; detail: string }
