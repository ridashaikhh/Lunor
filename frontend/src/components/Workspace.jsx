import ActivityLog from './ActivityLog'
import ExplainPanel from './ExplainPanel'
import PhoneFrame from './PhoneFrame'

export default function Workspace({
  busy, status, app, result, plan, choices, log,
  explainMode, onToggleExplain, selectedId, onSelect, onPick, explored,
}) {
  const ready = Boolean(result)
  const placeholder = busy ? (
    <>
      <span className="spinner" aria-hidden="true" />
      <p role="status">{status || 'Working…'}</p>
      <p className="muted">This usually takes under a minute.</p>
    </>
  ) : undefined

  return (
    <>
      {result?.notice && <p className="notice" role="status">{result.notice}</p>}

      {plan && (
        <p className="recap muted">
          <strong>{plan.app_name}</strong> · {choices.navigation === 'tabs' ? 'Two tabs' : 'Single screen'} · {choices.layout === 'cards' ? 'Cards' : 'List'}
        </p>
      )}

      <main className="workspace">
        <section className="stage">
          <div className="stage-bar">
            <button
              type="button"
              role="switch"
              aria-checked={explainMode}
              className="toggle"
              disabled={!ready}
              onClick={onToggleExplain}
            >
              <span className="toggle-track"><span className="toggle-knob" /></span>
              Explain mode
            </button>
            <span className="muted">
              {!app ? '' : !ready ? 'Preparing explanations…' : explainMode ? 'Click a highlighted element' : 'Try the app first, then turn this on'}
            </span>
          </div>
          <PhoneFrame
            html={app?.html}
            appKey={app?.key}
            explainMode={explainMode}
            selectedId={selectedId}
            onSelect={onSelect}
            placeholder={placeholder}
          />
        </section>

        <ExplainPanel
          appVisible={Boolean(app)}
          explanations={result?.explanations}
          selectedId={selectedId}
          onPick={onPick}
          explored={explored}
          explainMode={explainMode}
        />
      </main>

      <ActivityLog log={log} />
    </>
  )
}
