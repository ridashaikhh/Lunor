function DecisionCard({ decision, value, onChoose }) {
  return (
    <div className="decision card">
      <h3>{decision.title}</h3>
      <p className="muted">{decision.context}</p>
      <div className="decision-options" role="radiogroup" aria-label={decision.title}>
        {decision.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className="decision-option"
            onClick={() => onChoose(decision.key, o.value)}
          >
            <span className="decision-label">
              {o.label}
              {o.value === decision.recommended && <span className="tag">Suggested</span>}
            </span>
            <span className="pro"><b aria-hidden="true">+</b> {o.benefit}</span>
            <span className="con"><b aria-hidden="true">−</b> {o.cost}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function PlanStep({ plan, choices, onChoose, onBuild }) {
  return (
    <section className="plan">
      <div className="card understood">
        <h3>What I understood</h3>
        <p className="lead">{plan.understanding}</p>
      </div>

      <div className="plan-grid">
        <div className="card">
          <h3>{plan.app_name}</h3>
          <p>{plan.summary}</p>
          <h4>Who it's for</h4>
          <p>{plan.target_user}</p>
        </div>
        <div className="card">
          <h3>Building now</h3>
          <ul className="checklist">
            {plan.mvp_features.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
        <div className="card">
          <h3>Later</h3>
          <ul className="later">
            {plan.later_features.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </div>

      <h2 className="section-title">Two decisions that shape the app</h2>
      <div className="decisions">
        {plan.decisions.map((d) => (
          <DecisionCard key={d.key} decision={d} value={choices[d.key]} onChoose={onChoose} />
        ))}
      </div>

      <div className="actions">
        <button className="btn primary big" onClick={onBuild}>Build {plan.app_name}</button>
      </div>
    </section>
  )
}
