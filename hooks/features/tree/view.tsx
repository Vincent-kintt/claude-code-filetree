import type { Elements, RenderChildren } from 'claude-code'

import type { Activity } from '../../../types'
import { ADD_COLOR, DEL_COLOR } from '../../core/constants'
import { BRANCH_ICON, TONES } from '../../ui/tones'
import type { TreeModel } from './model'

export type TreeActions = {
  search: (v: string) => void
  jump: (v: string) => void
  clear: () => void
}

/** The terminal pane: header, branch, search, the rows and a footer with the selection and activity. */
export function terminalPane(el: Elements['terminal'], m: TreeModel, act: TreeActions, tree: RenderChildren) {
  const { Box, Text, Button, Input } = el
  const { theme, unicode, totals, rootCounts } = m

  const branchRow = () => {
    if (!m.branch) return null
    const b = m.branch
    const isFlash = b.flash
    const tone = b.tone
    const label = b.head
    return (
      <Box flexDirection="row" height={1} overflow="hidden">
        <Box flexDirection="row" flexShrink={0}>
          <Text color={isFlash ? (TONES[tone]?.solid ?? theme.accent) : theme.accent}>{(unicode ? BRANCH_ICON.plain : BRANCH_ICON.nerd) + ' '}</Text>
          <Text bold color={isFlash ? (TONES[tone]?.solid ?? (theme.fg || undefined)) : theme.fg || undefined}>
            {label}
          </Text>
          {b.ahead > 0 && <Text color={TONES.teal?.solid}>{` ↑${b.ahead}`}</Text>}
          {b.behind > 0 && <Text color={TONES.blue?.solid}>{` ↓${b.behind}`}</Text>}
        </Box>
        {b.upstream && (
          <Box flexShrink={1} overflow="hidden">
            <Text color={theme.muted} wrap="truncate-end">
              {` ${b.upstream}`}
            </Text>
          </Box>
        )}
        <Box flexGrow={1} />
        <Box flexDirection="row" flexShrink={0}>
          {totals[0] > 0 && <Text color={ADD_COLOR}>{` +${totals[0]}`}</Text>}
          {totals[1] > 0 && <Text color={DEL_COLOR}>{` -${totals[1]}`}</Text>}
          {rootCounts.map(c => (
            <Text color={c.c}>{c.t}</Text>
          ))}
          {rootCounts.length === 0 && totals[0] === 0 && totals[1] === 0 && <Text color={theme.muted}> clean</Text>}
        </Box>
      </Box>
    )
  }

  const chip = (a: Activity) => {
    const tone = a.state === 'failed' ? 'red' : a.tone
    const color = TONES[tone]?.solid ?? theme.accent
    const icon = unicode ? a.plain : a.nerd
    const hash = a.state === 'done' && a.kind === 'git commit' ? a.detail.split(' ')[0] ?? '' : ''
    return (
      <Box flexDirection="row" marginLeft={2}>
        <Text color={color}>{icon + ' '}</Text>
        <Text bold={a.state === 'running'} color={color}>
          {a.state === 'running' ? `${a.label}…` : a.label}
        </Text>
        {hash && <Text color={theme.muted}>{` ${hash}`}</Text>}
      </Box>
    )
  }

  const latest = m.latest
  return (
    <Box flexDirection="column" minHeight={m.minHeight} backgroundColor={theme.bg || undefined}>
      <Box flexDirection="row">
        <Text bold color={theme.accent} wrap="truncate-start">
          {m.header}
        </Text>
      </Box>
      {branchRow()}
      {m.noRepo && <Text color={theme.muted}>{unicode ? '± ' : '\u{e702} '}no git repo · git status starts after git init</Text>}
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Input key="q" label="/ " placeholder="search" submitLabel="jump" autoFocus value={m.query} onInput={(v: string) => act.search(v)} onSubmit={(v: string) => act.jump(v)} />
        </Box>
        {m.query ? <Button key="clear" plain dimColor label={unicode ? '×' : '\u{f0156}'} onPress={act.clear} /> : null}
      </Box>
      {tree}
      <Box flexGrow={1} />
      {(m.selected || latest) && (
        <Box flexDirection="row">
          {m.selected ? (
            <Box flexShrink={1}>
              <Text dimColor wrap="truncate-start">
                selected: {m.selectedText}
              </Text>
            </Box>
          ) : null}
          <Box flexGrow={1} />
          {latest && chip(latest)}
        </Box>
      )}
    </Box>
  )
}
