import { useMemo, useState } from 'react'
import { highlightLines } from '../lib/highlight'

const LABEL = { html: 'HTML', css: 'CSS', js: 'JavaScript' }
const COLLAPSE_OVER = 16   // snippets longer than this start collapsed...
const COLLAPSED_LINES = 12 // ...showing just this many lines

export default function CodeBlock({ snippet }) {
  const lines = useMemo(() => highlightLines(snippet.code, snippet.language), [snippet])
  const [expanded, setExpanded] = useState(false)
  const collapsible = lines.length > COLLAPSE_OVER
  const shown = collapsible && !expanded ? lines.slice(0, COLLAPSED_LINES) : lines
  const range = snippet.start_line === snippet.end_line ? `line ${snippet.start_line}` : `lines ${snippet.start_line}–${snippet.end_line}`
  return (
    <figure className="code">
      <figcaption>
        <span>{LABEL[snippet.language] ?? snippet.language}</span>
        <span className="code-range">{range} of the generated app</span>
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {shown.map((tokens, i) => (
            <span className="code-line" key={i}>
              <span className="code-ln" aria-hidden="true">{snippet.start_line + i}</span>
              <span className="code-src">
                {tokens.map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : t.text))}
              </span>
            </span>
          ))}
        </code>
      </pre>
      {collapsible && (
        <button type="button" className="code-toggle" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </figure>
  )
}
