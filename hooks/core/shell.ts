export function segments(command: string, seps: string[] = []): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let tok = ''
  let quote = ''
  let has = false
  const endTok = () => {
    if (has) cur.push(tok)
    tok = ''
    has = false
  }
  const endSeg = () => {
    endTok()
    if (cur.length) out.push(cur)
    cur = []
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? ''
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) tok += command[++i]
      else tok += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (ch === '\\' && i + 1 < command.length) {
      tok += command[++i]
      has = true
    } else if (ch === '#' && !has) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (ch === ' ' || ch === '\t') endTok()
    else if (ch === '\n' || ch === ';') {
      seps.push(';')
      endSeg()
    } else if (ch === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      tok += ch
      has = true
    } else if (ch === '&' || ch === '|') {
      const twice = command[i + 1] === ch
      if (twice) i++
      seps.push(twice ? ch + ch : ch)
      endSeg()
    } else {
      tok += ch
      has = true
    }
  }
  endSeg()
  if (!quote) return out
  seps.push(';')
  return command
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim().split(/\s+/).filter(Boolean))
    .filter(s => s.length > 0)
}

export function stripGlobals(tokens: string[]): string[] {
  const out = [...tokens]
  if (out[0] === 'env') out.shift()
  while (out.length && /^[A-Z_][A-Z0-9_]*=/.test(out[0] ?? '')) out.shift()
  return out
}
