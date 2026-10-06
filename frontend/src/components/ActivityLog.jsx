export default function ActivityLog({ log }) {
  if (log.length === 0) return null
  return (
    <details className="log">
      <summary>Activity log</summary>
      <ul>{log.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </details>
  )
}
