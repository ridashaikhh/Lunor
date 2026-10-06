const STEPS = ['Understand', 'Plan', 'Build', 'Explain', 'Learn']

export default function Stepper({ current }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className="step"
          data-state={i < current ? 'done' : i === current ? 'current' : 'todo'}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="step-dot" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}
