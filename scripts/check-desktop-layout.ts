// Renders the Desktop pane's scenes (scripts/layout-scenes.tsx) in headless Chrome at narrow widths
// and fails when anything spills out of its box. Screenshots land in --out (default: a temp folder).
// The HTML mirrors the Desktop app's flexbox layout as closely as we can tell; it is not the app's renderer.
// Run: node scripts/check-desktop-layout.ts [--out dir]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const WIDTHS = [280, 360, 480]
const repo = resolve(import.meta.dirname, '..')
const at = process.argv.indexOf('--out')
const out = at > 0 ? resolve(process.argv[at + 1]) : mkdtempSync(join(tmpdir(), 'filetree-layout-'))
mkdirSync(out, { recursive: true })
const claude = existsSync(join(homedir(), '.local/bin/claude')) ? join(homedir(), '.local/bin/claude') : 'claude'
const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
if (!chrome) throw new Error('No Chrome or Chromium found')

function scenes(): Record<string, unknown> {
  const mod = mkdtempSync(join(tmpdir(), 'filetree-scenes-'))
  try {
    for (const d of ['hooks', 'types', '.claude-plugin']) cpSync(join(repo, d), join(mod, d), { recursive: true })
    mkdirSync(join(mod, 'tests'))
    cpSync(join(repo, 'tests/harness.tsx'), join(mod, 'tests/harness.tsx'))
    cpSync(join(repo, 'scripts/layout-scenes.tsx'), join(mod, 'tests/scenes.test.tsx'))
    const run = spawnSync(claude, ['plugin', 'test', mod], { encoding: 'utf8', maxBuffer: 1 << 28 })
    const found: Record<string, unknown> = {}
    for (const m of `${run.stdout}\n${run.stderr}`.matchAll(/^SCENE:([\w-]+):(.*)$/gm)) found[m[1]] = JSON.parse(m[2])
    if (!Object.keys(found).length) throw new Error(`No scenes drawn:\n${run.stdout}${run.stderr}`)
    return found
  } finally {
    rmSync(mod, { recursive: true, force: true })
  }
}

// Runs in the page: builds the DOM from the drawn tree, then measures it.
function page(tree: unknown, width: number): string {
  const render = String(function draw(tree: any, width: number) {
    const U = 8
    const px = (v: any) => (typeof v === 'string' ? v : `${v * U}px`)
    const border = (c: string) => (c === 'subtle' || !c ? '#d4d4d8' : c)
    function node(n: any, inText = false, inRow = false): Node {
      if (n === null || n === undefined || n === false) return document.createTextNode('')
      if (typeof n !== 'object') return document.createTextNode(String(n))
      const p = n.props ?? {}
      const kids = (n.children ?? []) as any[]
      let el: HTMLElement
      switch (n.type) {
        case 'Box': {
          el = document.createElement('div')
          const s = el.style
          s.display = 'flex'
          s.flexDirection = p.flexDirection ?? 'row'
          if (p.flexGrow !== undefined) s.flexGrow = String(p.flexGrow)
          if (p.flexShrink !== undefined) s.flexShrink = String(p.flexShrink)
          if (p.flexWrap) s.flexWrap = p.flexWrap
          if (p.alignItems) s.alignItems = p.alignItems === 'start' ? 'flex-start' : p.alignItems
          if (p.justifyContent) s.justifyContent = p.justifyContent
          if (p.gap !== undefined) s.gap = px(p.gap)
          if (p.columnGap !== undefined) s.columnGap = px(p.columnGap)
          if (p.rowGap !== undefined) s.rowGap = px(p.rowGap)
          for (const k of ['width', 'height', 'minWidth', 'minHeight'] as const) if (p[k] !== undefined && k !== 'minHeight') (s as any)[k] = px(p[k])
          if (p.overflow) s.overflow = p.overflow
          if (p.overflow === 'hidden') el.dataset.clip = '1'
          s.padding = `${px(p.paddingY ?? p.padding ?? 0)} ${px(p.paddingX ?? p.padding ?? 0)}`
          if (p.marginTop) s.marginTop = px(p.marginTop)
          if (p.marginBottom) s.marginBottom = px(p.marginBottom)
          if (p.borderStyle) {
            s.border = `1px solid ${border(p.borderColor)}`
            s.borderRadius = '12px'
          }
          break
        }
        case 'Text': {
          el = document.createElement('span')
          const s = el.style
          if (p.color) s.color = p.color
          if (p.backgroundColor) s.backgroundColor = p.backgroundColor
          if (p.bold) s.fontWeight = '600'
          if (p.dimColor) s.opacity = '0.6'
          if (!inText) {
            const w = p.wrap ?? 'wrap'
            // The app keeps a text in a row on one line; only a text on its own line wraps.
            s.whiteSpace = w === 'wrap' && !inRow ? 'pre-wrap' : 'pre'
            if (w.startsWith('truncate') || w === 'end' || w === 'middle') {
              s.overflow = 'hidden'
              s.textOverflow = 'ellipsis'
              s.minWidth = '0'
              if (w === 'truncate-start') {
                s.direction = 'rtl'
                s.textAlign = 'left'
              }
            }
            el.dataset.text = w
          }
          for (const c of kids) el.appendChild(node(c, true))
          if (p.wrap === 'truncate-start' && !inText) el.innerHTML = `<bdi>${el.innerHTML}</bdi>`
          return el
        }
        case 'Button':
          el = document.createElement('span')
          el.textContent = p.label ?? ''
          // The app cuts a button's label with "…" when it has no room (seen as "version…" in the touched list).
          el.style.cssText = 'white-space:pre;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:pointer'
          el.dataset.text = 'button'
          return el
        case 'Input': {
          const i = document.createElement('input')
          i.placeholder = p.placeholder ?? ''
          i.value = p.value ?? ''
          i.style.minWidth = '0'
          return i
        }
        case 'Select': {
          // The app draws a menu as a rounded button that shrinks and cuts its label with "…" (seen as "ALL F… ⌄").
          const sel = document.createElement('span')
          sel.style.cssText = 'display:flex;align-items:center;gap:4px;min-width:0;padding:2px 8px;border:1px solid #d4d4d8;border-radius:8px'
          const text = document.createElement('span')
          text.textContent = (p.options ?? []).find((o: any) => o.value === p.value)?.label ?? p.value
          text.style.cssText = 'white-space:pre;overflow:hidden;text-overflow:ellipsis;min-width:0'
          text.dataset.menu = '1'
          sel.append(text, Object.assign(document.createElement('span'), { textContent: '⌄' }))
          return sel
        }
        case 'Svg': {
          const img = document.createElement('img')
          img.src = `data:image/svg+xml,${encodeURIComponent(p.source ?? '')}`
          img.width = p.width
          img.height = p.height
          img.style.flexShrink = '0'
          return img
        }
        case 'Client': {
          el = document.createElement('div')
          el.style.display = 'flex'
          el.style.flexDirection = 'column'
          for (const r of p.props?.rows ?? []) {
            const row = document.createElement('div')
            row.style.cssText = 'display:flex;white-space:pre'
            const seg = (s: any) => Object.assign(document.createElement('span'), { textContent: s.t, style: `color:${s.c ?? 'inherit'}` })
            const left = document.createElement('span')
            left.style.cssText = 'overflow:hidden;text-overflow:ellipsis;min-width:0;flex-shrink:1'
            left.dataset.text = 'row'
            for (const s of r.left ?? []) left.appendChild(seg(s))
            const right = document.createElement('span')
            right.style.cssText = 'margin-left:auto;flex-shrink:0'
            for (const s of r.right ?? []) right.appendChild(seg(s))
            row.append(left, right)
            el.appendChild(row)
          }
          return el
        }
        case 'Code':
        case 'Markdown':
          el = document.createElement('pre')
          el.textContent = p.source ?? p.text ?? ''
          el.style.cssText = 'margin:0;overflow:auto;white-space:pre'
          return el
        default:
          el = document.createElement('div')
      }
      const row = n.type === 'Box' && (p.flexDirection ?? 'row') === 'row'
      for (const c of kids) el.appendChild(node(c, false, row))
      return el
    }
    const pane = document.getElementById('pane')!
    pane.style.width = `${width}px`
    pane.appendChild(node(tree))
    const problems: string[] = []
    const notes: string[] = []
    const label = (e: Element) => (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50) || e.tagName.toLowerCase()
    for (const e of Array.from(pane.querySelectorAll('*'))) {
      const parent = e.parentElement!
      if ((e as HTMLElement).closest('bdi') || e.tagName === 'BDI' || (parent as HTMLElement).dataset.text) continue
      const r = e.getBoundingClientRect()
      const q = parent.getBoundingClientRect()
      const spill = Math.round(r.right - q.right)
      // A Box the mod marked overflow="hidden" clips on purpose (a Button can't truncate): a note, not a failure.
      if (r.width && (r.right > q.right + 0.5 || r.left < q.left - 0.5)) (parent.dataset.clip ? notes : problems).push(`"${label(e)}" ${parent.dataset.clip ? 'clipped' : 'spills'} ${spill}px out of "${label(parent)}"`)
      if ((e as HTMLElement).dataset.menu && e.scrollWidth > e.clientWidth + 1) problems.push(`menu "${label(e)}" is cut to ${Math.round(e.clientWidth)}px of ${e.scrollWidth}px`)
      const t = (e as HTMLElement).dataset.text
    }
    document.getElementById('result')!.textContent = JSON.stringify({ problems, notes })
  })
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:14px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328}
#pane{overflow:hidden;box-sizing:border-box;padding-right:12px}
#pane *{box-sizing:border-box}
#result{display:none}
</style><div id="pane"></div><pre id="result"></pre>
<script>(${render})(${JSON.stringify(tree)}, ${width})</script>`
}

let failed = 0
for (const [name, tree] of Object.entries(scenes())) {
  for (const width of WIDTHS) {
    const html = join(out, `${name}-${width}.html`)
    writeFileSync(html, page(tree, width))
    const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=2000']
    const dom = spawnSync(chrome, [...args, '--dump-dom', `file://${html}`], { encoding: 'utf8' }).stdout
    spawnSync(chrome, [...args, `--window-size=${width},900`, `--screenshot=${join(out, `${name}-${width}.png`)}`, `file://${html}`], { encoding: 'utf8' })
    const raw = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const { problems, notes }: { problems: string[]; notes: string[] } = raw ? JSON.parse(raw) : { problems: ['no result: the page did not run'], notes: [] }
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name} @ ${width}px${problems.map(p => `\n     ${p}`).join('')}${notes.map(n => `\n     note: ${n}`).join('')}`)
  }
}
console.log(`\nScreenshots: ${out}`)
process.exit(failed ? 1 : 0)
