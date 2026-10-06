import { describe, expect, it } from 'vitest'
import { highlightLines, tokenize } from '../src/lib/highlight'

describe('highlight', () => {
  it('never loses or alters characters', () => {
    const code = 'const a = `x ${1}`;\n// note\nif (a === "s") { return 42; }'
    expect(tokenize(code, 'js').map((t) => t.text).join('')).toBe(code)
    expect(highlightLines(code, 'js').map((l) => l.map((t) => t.text).join('')).join('\n')).toBe(code)
  })
  it('classifies the basics', () => {
    const t = tokenize('const n = 5; // hi', 'js')
    expect(t.find((x) => x.text === 'const').cls).toBe('tok-keyword')
    expect(t.find((x) => x.text === '5').cls).toBe('tok-number')
    expect(t.find((x) => x.text === '// hi').cls).toBe('tok-comment')
  })
  it('keeps multi-line template strings together but splits them into lines', () => {
    const lines = highlightLines('x = `a\nb`;', 'js')
    expect(lines).toHaveLength(2)
  })
  it('handles html and css without throwing', () => {
    expect(tokenize('<button class="x">Hi</button>', 'html').some((t) => t.cls === 'tok-keyword')).toBe(true)
    expect(tokenize('a { color: #fff; margin: 4px }', 'css').some((t) => t.cls === 'tok-number')).toBe(true)
  })
})
