import { resolve } from '../../git'
import { inside } from '../../tree'

/** The context line that tells Claude which file the user has selected in the tree. */
export function selectedContext(path: string): string {
  return `The user has this file selected in the file tree; "this" or "it" in the prompt likely refers to it: ${path}`
}

/** The @mentions in a prompt, resolved against `root` and kept only when inside it. */
export function mentionsIn(text: string, root: string, home: string): string[] {
  return [...text.matchAll(/@([^\s"'`]+)/g)]
    .map(m => (m[1] ?? '').replace(/[.,;:!?)]+$/, ''))
    .filter(Boolean)
    .map(p => resolve(root, p, home))
    .filter(p => inside(root, p))
}
