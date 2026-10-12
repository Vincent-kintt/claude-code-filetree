import type { Theme } from '../../../types'

export const DEFAULT_THEME: Theme = {
  fg: '',
  accent: '#5b9bd5',
  muted: '#808a96',
  urgent: '#d0605e',
  selection: '#6b7280',
  bg: '',
}

export function parseTheme(toml: string): Theme {
  const get = (k: string) => toml.match(new RegExp(`^${k}\\s*=\\s*"(#[0-9a-fA-F]{6})"`, 'm'))?.[1]
  return {
    fg: get('foreground') ?? get('color7') ?? DEFAULT_THEME.fg,
    accent: get('accent') ?? get('color4') ?? DEFAULT_THEME.accent,
    muted: get('muted') ?? get('color8') ?? DEFAULT_THEME.muted,
    urgent: get('red') ?? get('color1') ?? DEFAULT_THEME.urgent,
    selection: get('selection') ?? DEFAULT_THEME.selection,
    bg: get('dark_background') ?? get('background') ?? DEFAULT_THEME.bg,
  }
}
