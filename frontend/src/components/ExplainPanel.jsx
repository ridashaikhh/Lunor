import CodeBlock from './CodeBlock'

/** `like this` in explanation text becomes inline code. */
function Inline({ text }) {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part,
  )
}

/** "What you learned": the concepts from the elements the learner has explored, plus their try-changing experiments. */
function LearnStrip({ items }) {
  if (items.length === 0) return null
  const concepts = []
  for (const e of items) if (!concepts.some((c) => c.concept === e.concept)) concepts.push(e)
  return (
    <section className="learned" aria-label="What you learned">
      <h3>What you learned</h3>
      <ul className="learned-concepts">
        {concepts.map((e) => (
          <li key={e.concept}><strong>{e.concept}.</strong> <Inline text={e.concept_note} /></li>
        ))}
      </ul>
      <h4>Try changing this</h4>
      <ul className="learned-try">
        {items.map((e) => (
          <li key={e.id}><span className="muted">{e.title}:</span> <Inline text={e.try_changing} /></li>
        ))}
      </ul>
    </section>
  )
}

export default function ExplainPanel({ appVisible, explanations, selectedId, onPick, explored, explainMode }) {
  if (!appVisible) {
    return (
      <aside className="panel panel-idle">
        <h2>Explain</h2>
        <p className="muted">Once your app is built, click anything in it to see the code that makes it work.</p>
      </aside>
    )
  }
  if (!explanations) {
    return (
      <aside className="panel panel-idle" aria-live="polite">
        <h2>Preparing explanations…</h2>
        <p className="muted">The app is ready to use. Explain mode unlocks in a moment.</p>
      </aside>
    )
  }

  const current = explanations.find((e) => e.id === selectedId)
  const learned = [...explored].map((id) => explanations.find((e) => e.id === id)).filter(Boolean)
  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <h2>{current ? current.title : 'Explore the app'}</h2>
        <span className="muted">{explored.size} of {explanations.length} explored</span>
      </div>

      {learned.length > 0 && (
        <p className="learned-pills">
          <span className="muted">Learned so far:</span>
          {[...new Set(learned.map((e) => e.concept))].map((name) => <span key={name} className="pill">{name}</span>)}
        </p>
      )}

      {!current && (
        <p className="hint">
          {explainMode
            ? 'Click any highlighted element in the phone.'
            : 'Turn on Explain mode, then click any highlighted element in the phone. Or pick one below.'}
        </p>
      )}

      {current && (
        <div className="detail">
          <section>
            <h3>What it does</h3>
            <p><Inline text={current.what_it_does} /></p>
          </section>
          <section>
            <h3>The code behind it</h3>
            {current.snippets.map((s, i) => <CodeBlock key={`${current.id}-${i}`} snippet={s} />)}
          </section>
          <section>
            <h3>How it works</h3>
            <p><Inline text={current.how_it_works} /></p>
          </section>
          <section>
            <h3>The concept: {current.concept}</h3>
            <p><Inline text={current.concept_note} /></p>
          </section>
          <section className="try">
            <h3>Try changing this</h3>
            <p><Inline text={current.try_changing} /></p>
          </section>
        </div>
      )}

      <div className="chips" role="group" aria-label="Elements you can explore">
        {explanations.map((e) => (
          <button
            key={e.id}
            type="button"
            className="chip"
            aria-pressed={e.id === selectedId}
            data-explored={explored.has(e.id)}
            onClick={() => onPick(e.id)}
          >
            {e.title}
          </button>
        ))}
      </div>

      <LearnStrip items={learned} />
    </aside>
  )
}
