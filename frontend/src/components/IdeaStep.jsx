import { useState } from 'react'

const EXAMPLES = ['An expense tracker for students', 'A habit tracker', 'A flashcard study app']

export default function IdeaStep({ onSubmit, onExample }) {
  const [idea, setIdea] = useState('')
  const valid = idea.trim().length >= 3

  function submit(e) {
    e.preventDefault()
    if (valid) onSubmit(idea.trim())
  }

  return (
    <section className="card step-card">
      <h1>What do you want to build?</h1>
      <p className="muted lead-sub">
        Describe your app idea in a sentence. I'll ask a few questions, plan it with you, build it, and show you how it works.
      </p>
      <form onSubmit={submit}>
        <textarea
          rows={3}
          maxLength={300}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. An expense tracker for students"
          aria-label="App idea"
        />
        <div className="chips tight" role="group" aria-label="Example ideas">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setIdea(ex)}>{ex}</button>
          ))}
        </div>
        <div className="actions">
          <button className="btn primary" disabled={!valid}>Continue</button>
          <button type="button" className="btn ghost" onClick={onExample}>Skip to a ready-made example</button>
        </div>
      </form>
    </section>
  )
}
