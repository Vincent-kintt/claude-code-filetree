import { RENDER_CHARS } from '../../core/constants'
import { inside, relative } from '../../tree'
import { shortPath } from '../../core/platform'

export const PREVIEW_CHARS = 90_000
export const PREVIEW_LINE = 2_000

export function fitSerialized(lines: string[], max: number): string[] {
  let size = 0
  for (let i = 0; i < lines.length; i++) {
    size += JSON.stringify(lines[i]).length
    if (size > max) return lines.slice(0, i)
  }
  return lines
}

/** A file's text as the preview keeps it: control characters gone, long lines and long files cut, with a note saying so. */
export function shapePreview(text: string, note: string): { text: string; note: string } {
  const total = text.length
  let lines = text.slice(0, PREVIEW_CHARS).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  if (total > PREVIEW_CHARS && lines.length > 1) lines.pop()
  lines = lines.map(l => (l.length > PREVIEW_LINE ? `${l.slice(0, PREVIEW_LINE)}…` : l))
  const fit = fitSerialized(lines, PREVIEW_CHARS)
  if (total > PREVIEW_CHARS || fit.length < lines.length) note = `first ${fit.length.toLocaleString('en')} lines of ${total.toLocaleString('en')} characters`
  return { text: fit.join('\n'), note }
}

/** The preview's top line after scrolling `by`, kept so the last line stays on screen. */
export function scrollTop(text: string | undefined, rows: number, top: number, by: number): number {
  const last = Math.max(0, (text?.split('\n').length ?? 1) - rows)
  return Math.max(0, Math.min(last, top + by))
}

export function previewLines(text: string, top: number, rows: number, markdown: boolean): { text: string; top: number } {
  const lines = text.split('\n')
  const from = Math.max(0, Math.min(top, lines.length - 1))
  let shown = lines.slice(from, from + rows)
  if (markdown) {
    // Reopen a code fence the window starts inside, so the rest is not read as prose.
    let fence = ''
    let opener = ''
    for (const line of lines.slice(0, from)) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (!m) continue
      const mark = m[1] ?? ''
      if (!fence) {
        fence = mark
        opener = line.trimStart()
      } else if (mark[0] === fence[0] && mark.length >= fence.length && !(m[2] ?? '').trim()) fence = ''
    }
    if (fence) shown = [opener, ...shown]
  }
  return { text: shown.join('\n'), top: from }
}

// The longest run of whole lines whose JSON form, with the rt.view's buttons, name, note and
// path around it, stays within RENDER_CHARS. loadPreview already cuts each line to 2,000
// characters, so the first line always fits.
export function cutLines(text: string, chrome: number): string {
  const room = RENDER_CHARS - chrome
  if (JSON.stringify(text).length <= room) return text
  let used = 2
  let end = 0
  for (const line of text.split('\n')) {
    const cost = JSON.stringify(line).length
    if (used + cost > room) break
    used += cost
    end += line.length + 1
  }
  return text.slice(0, end)
}

export type PreviewWindow = {
  name: string
  markdown: boolean
  // How many lines the terminal shows at once; every line on the desktop, which scrolls natively.
  rows: number
  win: { text: string; top: number }
}

/** The lines of a previewed file the pane shows, from its top line and the room it has. */
export function previewWindow(path: string, root: string, text: string, note: string, previewTop: number, bodyRows: number | undefined, nativeScroll: boolean): PreviewWindow {
  const markdown = /\.(md|markdown|mdx)$/i.test(path)
  const all = text.split('\n').length
  const rows = nativeScroll ? all : Math.max(4, (bodyRows ?? 40) - (note ? 2 : 1))
  const win = previewLines(text, nativeScroll ? 0 : Math.min(previewTop, Math.max(0, all - rows)), rows, markdown)
  const name = path !== root && inside(root, path) ? relative(root, path) : shortPath(path)
  return { name, markdown, rows, win }
}

/** The desktop preview's text, cut to what the page takes, and its note. */
export function desktopText(path: string, whole: string, note: string): { text: string; note: string } {
  const cut = cutLines(whole, 1_500 + 2 * JSON.stringify(path).length + JSON.stringify(note).length)
  const shownLines = cut.split('\n').length - (cut.endsWith('\n') ? 1 : 0)
  return { text: cut, note: [note, cut.length < whole.length ? `first ${shownLines.toLocaleString('en')} of ${whole.split('\n').length.toLocaleString('en')} lines; Open in app shows the rest` : ''].filter(Boolean).join(' · ') }
}
