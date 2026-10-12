import type { Elements, RenderChildren } from 'claude-code'

export type TerminalPreviewModel = { name: string; note: string; unicode: boolean; minHeight: number; bg: string }
export type TerminalPreviewActions = { back: () => void; external: () => void }

/** A file in the terminal pane: a back button, its name, a note, and the lines drawn by rows.tsx. */
export function terminalPreview(el: Elements['terminal'], m: TerminalPreviewModel, act: TerminalPreviewActions, rows: RenderChildren) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" minHeight={m.minHeight} backgroundColor={m.bg || undefined}>
      <Box flexDirection="row">
        <Button key="back" plain label={m.unicode ? '← files' : '\u{f004d} files'} onPress={act.back} />
        <Text> </Text>
        <Box flexShrink={1} flexGrow={1}>
          <Text bold wrap="truncate-start">{m.name}</Text>
        </Box>
        <Button key="external" plain dimColor label="Open in app ↗" onPress={act.external} />
      </Box>
      {m.note ? <Text dimColor>{m.note}</Text> : null}
      {rows}
    </Box>
  )
}
