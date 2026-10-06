// Tiny syntax highlighter: just enough colour to make code readable. Output is plain data (no innerHTML).
// Every rule has the same 4 groups: comment, string, number, keyword.
const JS_KW = 'const|let|var|function|return|if|else|for|while|of|in|new|class|async|await|true|false|null|undefined|this|break|continue|switch|case|default|typeof|throw|try|catch'
const STR = String.raw`(\x60(?:\\[\s\S]|[^\x60\\])*\x60|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')`
const RULES = {
  js: String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|${STR}|(\b\d+(?:\.\d+)?\b)|(\b(?:${JS_KW})\b)`,
  css: String.raw`(\/\*[\s\S]*?\*\/)|${STR}|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b)|(\bvar\b)`,
  html: String.raw`(<!--[\s\S]*?-->)|("[^"\n]*"|'[^'\n]*')|((?!))|(<\/?[a-zA-Z][\w-]*|\/?>)`,
}
const CLASSES = ['tok-comment', 'tok-string', 'tok-number', 'tok-keyword']

export function tokenize(code, language) {
  const re = new RegExp(RULES[language] || RULES.js, 'g')
  const out = []
  let last = 0
  let m
  while ((m = re.exec(code))) {
    if (m[0].length === 0) { re.lastIndex++; continue }
    if (m.index > last) out.push({ text: code.slice(last, m.index), cls: '' })
    const group = [1, 2, 3, 4].find((g) => m[g] !== undefined)
    out.push({ text: m[0], cls: CLASSES[group - 1] })
    last = m.index + m[0].length
  }
  if (last < code.length) out.push({ text: code.slice(last), cls: '' })
  return out
}

/** Tokens grouped per line, so the code block can draw a line-number gutter. */
export function highlightLines(code, language) {
  const lines = [[]]
  for (const tok of tokenize(code, language)) {
    const parts = tok.text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, cls: tok.cls })
    })
  }
  return lines
}
