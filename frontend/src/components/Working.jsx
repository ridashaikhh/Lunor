export default function Working({ title, detail }) {
  return (
    <section className="card step-card working" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <h1>{title}</h1>
      {detail && <p className="muted">{detail}</p>}
    </section>
  )
}
