import { useState } from 'react'

/** Render with key={index} so each question starts with fresh state. */
export default function QuestionStep({ question, index, total, onAnswer }) {
  const [other, setOther] = useState(false)
  const [text, setText] = useState('')

  function submitOther(e) {
    e.preventDefault()
    if (text.trim()) onAnswer(text.trim())
  }

  return (
    <section className="card step-card">
      <p className="muted">Question {index + 1} of {total}</p>
      <h1>{question.question}</h1>
      <div className="option-grid">
        {question.options.map((o) => (
          <button key={o} type="button" className="option" onClick={() => onAnswer(o)}>{o}</button>
        ))}
        {!other && <button type="button" className="option subtle" onClick={() => setOther(true)}>Something else…</button>}
      </div>
      {other && (
        <form className="other" onSubmit={submitOther}>
          <input
            autoFocus
            maxLength={120}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer"
            aria-label="Your answer"
          />
          <button className="btn primary" disabled={!text.trim()}>Use this answer</button>
        </form>
      )}
    </section>
  )
}
