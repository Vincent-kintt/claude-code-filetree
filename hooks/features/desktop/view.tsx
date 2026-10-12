import type { Elements, RenderChildren } from 'claude-code'

import type { Touch } from '../../../types'
import { TONES } from '../../ui/tones'
import { GIT_COLOR } from '../../ui/icons'
import { VERSION } from '../../version'

export type Icon = 'eye' | 'pencil' | 'check' | 'git' | 'x' | 'idle'
export type Card = { tone: string; phase: string; title: string; sub: string; icon: Icon; live: boolean }
export type TouchRow = { path: string; name: string; dir: string; state: Touch['state']; folder: boolean }
export type DesktopModel = {
  card: Card
  branch: { head: string; upstream: string; ahead: number; behind: number } | null
  summary: { text: string; add: number; del: number }
  noRepo: boolean
  query: string
  view: 'all' | 'edited'
  edited: number
  selected: string
  touched: TouchRow[]
  more: number
  project: string
  muted: string
}
export type DesktopActions = {
  search: (v: string) => void
  jump: (v: string) => void
  setView: (v: 'all' | 'edited') => void
  openTouch: (path: string) => void
}

const IDLE = '#808a96'
const ADD = '#98c379'
const DEL = '#e06c75'

const GLYPH: Record<Icon, string> = {
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  git: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9M18 9.5c0 5-7 4-11.5 7.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  idle: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}

const PILL: Record<Touch['state'], { label: string; tone: string }> = {
  reading: { label: 'Reading', tone: 'purple' },
  read: { label: 'Read', tone: 'purple' },
  editing: { label: 'Editing', tone: 'orange' },
  edited: { label: 'Edited', tone: 'orange' },
  committed: { label: 'Committed', tone: 'green' },
}

const BADGE: [RegExp, string][] = [
  [/^(js|jsx|mjs|cjs)$/, '#e5c07b'],
  [/^(ts|tsx|mts|cts)$/, '#61afef'],
  [/^(md|mdx|txt|rst)$/, '#98c379'],
  [/^(json|yml|yaml|toml|ini)$/, '#d19a66'],
  [/^(py|rb|go|rs|java|kt|swift|c|h|cpp|cs)$/, '#c678dd'],
  [/^(css|scss|html|svg|vue)$/, '#56b6c2'],
]

export function toneColor(tone: string): string {
  return TONES[tone]?.solid ?? IDLE
}

/** The file's type in at most four letters, as the touched list badges it. A folder is DIR, a file with no extension FILE. */
export function badgeOf(name: string, folder = false): { text: string; color: string } {
  if (folder) return { text: 'DIR', color: IDLE }
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  const text = ext ? ext.slice(0, 4).toUpperCase() : 'FILE'
  return { text, color: BADGE.find(([re]) => re.test(ext))?.[1] ?? IDLE }
}

function iconSvg(icon: Icon, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">` +
    `<circle cx="24" cy="24" r="24" fill="${color}" fill-opacity="0.16"/>` +
    `<g transform="translate(12 12)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[icon]}</g></svg>`
  )
}

export function desktopPane(el: Elements['desktop'], m: DesktopModel, act: DesktopActions, tree: RenderChildren) {
  const { Box, Text, Button, Input, Select, Svg } = el
  const c = m.card
  const color = c.icon === 'idle' ? IDLE : toneColor(c.tone)
  const legend: [string, string][] = [
    [toneColor('purple'), 'Claude read'],
    [toneColor('orange'), 'Claude edited'],
    [GIT_COLOR.M ?? '#e5c07b', 'Not committed'],
  ]
  return (
    <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <Box key="card" flexDirection="column" borderStyle="round" borderColor={c.live ? color : 'subtle'} paddingX={2} paddingY={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          <Svg source={iconSvg(c.icon, color)} alt={c.title} width={48} height={48} />
          <Box flexDirection="column" flexShrink={1} minWidth={0}>
            <Text bold color={color}>
              {c.phase}
            </Text>
            <Text bold wrap="truncate-end">
              {c.title}
            </Text>
            {c.sub ? (
              <Text color={m.muted} wrap="truncate-start">
                {c.sub}
              </Text>
            ) : null}
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          {m.branch ? (
            // A long branch shrinks: the upstream gives way first, then the branch name ends in an ellipsis.
            <Box flexDirection="row" flexShrink={1} minWidth={0}>
              <Text color={toneColor('blue')}>⑂ </Text>
              <Text bold wrap="truncate-end">
                {m.branch.head}
              </Text>
              {m.branch.ahead > 0 && <Text color={toneColor('teal')}>{` ↑${m.branch.ahead}`}</Text>}
              {m.branch.behind > 0 && <Text color={toneColor('blue')}>{` ↓${m.branch.behind}`}</Text>}
              {m.branch.upstream ? (
                <Box flexShrink={100} minWidth={0}>
                  <Text color={m.muted} wrap="truncate-end">{` ${m.branch.upstream}`}</Text>
                </Box>
              ) : null}
            </Box>
          ) : (
            <Text color={m.muted}>{m.noRepo ? 'no git repo' : ''}</Text>
          )}
          <Box flexGrow={1} />
          {/* Never shrinks: when the branch line has no room, the summary wraps whole onto the next line. */}
          <Box flexDirection="row" flexShrink={0}>
            <Text color={m.muted}>{m.summary.text}</Text>
            {m.summary.add > 0 && <Text color={ADD}>{` +${m.summary.add}`}</Text>}
            {m.summary.del > 0 && <Text color={DEL}>{` -${m.summary.del}`}</Text>}
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {legend.map(([dot, label]) => (
            <Box flexDirection="row">
              <Text color={dot}>● </Text>
              <Text color={m.muted}>{label}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Input key="q" placeholder="Find a file" autoFocus value={m.query} onInput={(v: string) => act.search(v)} onSubmit={(v: string) => act.jump(v)} />

      <Box key="touched" flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={2} paddingY={1}>
        <Box flexDirection="row" columnGap={1}>
          <Text bold color={m.muted}>
            CLAUDE TOUCHED
          </Text>
          <Box flexGrow={1} />
          <Text bold color={m.muted}>
            {(() => {
              const n = m.touched.length + m.more
              return `${n} ${n === 1 ? 'FILE' : 'FILES'}`
            })()}
          </Text>
        </Box>
        {m.touched.length === 0 ? (
          <Text color={m.muted}>Files Claude reads, edits or commits this session show here</Text>
        ) : (
          m.touched.map(r => {
            const badge = badgeOf(r.name, r.folder)
            const pill = PILL[r.state]
            const pc = toneColor(pill.tone)
            return (
              <Box flexDirection="row" columnGap={1} marginTop={1}>
                <Box flexDirection="row" flexShrink={1} minWidth={0} gap={1} alignItems="center">
                  <Text bold color={badge.color} backgroundColor={`${badge.color}26`}>{` ${badge.text} `}</Text>
                  {/* Lets the name shrink, so the app cuts it with an ellipsis instead of pushing the pill out. */}
                  <Box flexShrink={1} minWidth={0} overflow="hidden">
                    <Button key={`touch:${r.path}`} label={r.name} plain onPress={() => act.openTouch(r.path)} />
                  </Box>
                  {r.dir ? (
                    <Box flexShrink={100} minWidth={0}>
                      <Text color={m.muted} wrap="truncate-start">
                        {r.dir}
                      </Text>
                    </Box>
                  ) : null}
                </Box>
                <Box flexGrow={1} />
                <Text bold color={pc} backgroundColor={`${pc}26`}>{` ${pill.label} `}</Text>
              </Box>
            )
          })
        )}
        {m.more > 0 ? <Text color={m.muted}>{`+${m.more} more`}</Text> : null}
      </Box>

      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} marginBottom={1} alignItems="center">
          {/* Never shrinks: a narrow pane cuts the project name instead of the menu's label. */}
          <Box flexShrink={0}>
            <Select
              key="view"
              value={m.view}
              options={[
                { value: 'all', label: 'ALL FILES' },
                { value: 'edited', label: `EDITED FILES (${m.edited})` },
              ]}
              onSelect={(v: string) => act.setView(v === 'edited' ? 'edited' : 'all')}
            />
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
            <Text bold color={m.muted} wrap="truncate-start">
              {m.project.toUpperCase()}
            </Text>
          </Box>
        </Box>
        {m.noRepo ? <Text color={m.muted}>git status starts after git init</Text> : null}
        {m.view === 'edited' && m.edited === 0 ? <Text color={m.muted}>{m.noRepo ? 'Edited files need a git repo' : 'Nothing edited, added or removed since the last commit'}</Text> : null}
        {tree}
        {m.selected ? (
          <Text dimColor wrap="truncate-start">
            selected: {m.selected}
          </Text>
        ) : null}
      </Box>
      <Text dimColor>{`filetree ${VERSION}`}</Text>
    </Box>
  )
}

export type PreviewModel = {
  name: string
  note: string
  markdown: boolean
  text: string
  path: string
}
export type PreviewActions = {
  back: () => void
  external: () => void
}

/** A file in the pane: Markdown rendered, anything else highlighted. */
export function desktopPreview(el: Elements['desktop'], m: PreviewModel, act: PreviewActions, muted: string) {
  const { Box, Text, Button, Code, Markdown } = el
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="back" plain label="← Back to files" onPress={act.back} />
        <Box flexShrink={1} flexGrow={1} minWidth={0}>
          <Text bold wrap="truncate-start">
            {m.name}
          </Text>
        </Box>
        <Button key="external" plain dimColor label="Open in app ↗" onPress={act.external} />
      </Box>
      {m.note ? <Text color={muted}>{m.note}</Text> : null}
      {m.markdown ? <Markdown key="preview" text={m.text} /> : <Code source={m.text} path={m.path} startLine={1} wrap="truncate-end" />}
    </Box>
  )
}
