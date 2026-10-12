export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

let drives = false

export function dirname(path: string): string {
  if (drives && /^[A-Za-z]:\/[^/]*$/.test(path)) return path.slice(0, 3)
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function useDrives(on: boolean): void {
  drives = on
}

export function drivesOn(): boolean {
  return drives
}

export function posix(path: string): string {
  if (!drives) return path
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z])(\/|$)/, (_, d: string) => `${d.toUpperCase()}:/`)
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || (drives && /^[A-Za-z]:\//.test(path))
}

export function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

export function mapper(root: string, prefix: string): (rel: string) => string | null {
  return rel => (rel.startsWith(prefix) ? join(root, rel.slice(prefix.length).replace(/\/$/, '')).replace(/\/$/, '') : null)
}

export function underAny(id: string, set: Set<string>, root: string): boolean {
  if (set.size === 0) return false
  let cur = id
  while (cur.length >= root.length) {
    if (set.has(cur)) return true
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return false
}

export function ancestorsOf(id: string, root: string): string[] {
  const out: string[] = []
  if (!root) return out
  for (let dir = dirname(id), prev = id; dir !== prev && dir !== root && inside(root, dir); prev = dir, dir = dirname(dir)) out.push(dir)
  return out
}

export function relative(root: string, path: string): string {
  return path === root ? '' : path.slice(root.endsWith('/') ? root.length : root.length + 1)
}

function tidy(path: string): string {
  const s = path.replace(/\/+$/, '')
  return s === '' ? '/' : /^[A-Za-z]:$/.test(s) && isAbsolute(`${s}/`) ? `${s}/` : s
}

export function resolve(cwd: string, p: string, home = ''): string {
  let path = posix(p)
  if (home && (path === '~' || path.startsWith('~/'))) path = home + path.slice(1)
  const drive = isAbsolute(path) && !path.startsWith('/') ? path.slice(0, 2) : ''
  const parts = isAbsolute(path) ? [drive] : posix(cwd).replace(/\/+$/, '').split('/')
  for (const seg of path.slice(drive.length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(seg)
  }
  return tidy(parts.join('/'))
}
