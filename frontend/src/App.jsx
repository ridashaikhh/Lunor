import { useCallback, useRef, useState } from 'react'
import IdeaStep from './components/IdeaStep'
import PlanStep from './components/PlanStep'
import QuestionStep from './components/QuestionStep'
import Stepper from './components/Stepper'
import Workspace from './components/Workspace'
import Working from './components/Working'
import ActivityLog from './components/ActivityLog'
import exampleFlow from './fallback/exampleFlow.json'
import fallback from './fallback/expenseTracker.json'
import { api } from './lib/api'
import { callWithRetry, recommendedChoices, shorten } from './lib/flow'
import { runBuild } from './lib/pipeline'
import { verifyInHiddenIframe } from './lib/verify'

const DEFAULT_CHOICES = { navigation: 'single', layout: 'list' }

export default function App() {
  // ---- the guided flow ----
  const [view, setView] = useState('idea')   // idea | understanding | asking | planning | plan | workspace
  const [idea, setIdea] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [qIndex, setQIndex] = useState(0)
  const [plan, setPlan] = useState(null)
  const [choices, setChoices] = useState(DEFAULT_CHOICES)
  const [flowNotice, setFlowNotice] = useState(null)
  const [log, setLog] = useState([])
  // ---- build + explain ----
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [app, setApp] = useState(null)             // { html, key }: what the phone shows
  const [result, setResult] = useState(null)       // { source, explanations, notice }: set once explanations exist
  const [explainMode, setExplainMode] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [explored, setExplored] = useState(() => new Set())

  const keyRef = useRef(0)
  const runRef = useRef(0)                          // bumped on every new run / start over: stale async work is dropped
  const explanationsRef = useRef(null)
  explanationsRef.current = result?.explanations
  const addLog = useCallback((line) => setLog((l) => [...l, line]), [])

  const resetBuild = () => {
    setBusy(false); setStatus(''); setApp(null); setResult(null)
    setExplainMode(false); setSelectedId(null); setExplored(new Set())
  }

  function startOver() {
    runRef.current++
    resetBuild()
    setView('idea'); setIdea(''); setQuestions([]); setAnswers([]); setQIndex(0)
    setPlan(null); setChoices(DEFAULT_CHOICES); setFlowNotice(null); setLog([])
  }

  /** AI planning is unavailable: continue with a ready-made plan, and say so. */
  function useExamplePlan(reason) {
    const p = exampleFlow.plan
    addLog(`Using the ready-made example plan. Last problem: ${shorten(reason, 180)}`)
    setPlan(p)
    setChoices(recommendedChoices(p))
    setFlowNotice(`AI planning isn't available right now, so here is a ready-made plan for an example idea (${p.app_name}). Last problem: ${shorten(reason)}`)
    setView('plan')
  }

  // ---- Understand ----
  async function submitIdea(text) {
    const run = ++runRef.current
    setIdea(text); setLog([]); setFlowNotice(null); setView('understanding')
    const r = await callWithRetry(api.understand, { idea: text }, addLog, 'Understand')
    if (run !== runRef.current) return
    if (!r.ok) return useExamplePlan(r.reason)
    setQuestions(r.data.questions); setAnswers([]); setQIndex(0); setView('asking')
  }

  function answer(text) {
    const next = [...answers, { question: questions[qIndex].question, answer: text }]
    setAnswers(next)
    if (qIndex + 1 < questions.length) setQIndex(qIndex + 1)
    else planFrom(next)
  }

  // ---- Plan ----
  async function planFrom(finalAnswers) {
    const run = ++runRef.current
    setView('planning')
    const r = await callWithRetry(api.plan, { idea, answers: finalAnswers }, addLog, 'Plan')
    if (run !== runRef.current) return
    if (!r.ok) return useExamplePlan(r.reason)
    setPlan(r.data.plan)
    setChoices(recommendedChoices(r.data.plan))
    setView('plan')
  }

  // ---- Build + Explain ----
  async function build() {
    const run = ++runRef.current
    resetBuild()
    setView('workspace')
    setBusy(true)
    let out
    try {
      out = await runBuild(
        {
          idea: plan.idea, app_name: plan.app_name, summary: plan.summary, target_user: plan.target_user,
          decisions: choices, mvp_features: plan.mvp_features,
        },
        { api, verify: verifyInHiddenIframe, fallback },
        {
          onStatus: (s) => run === runRef.current && setStatus(s),
          onApp: ({ html }) => run === runRef.current && setApp({ html, key: ++keyRef.current }),   // usable before explanations
          onLog: (line) => run === runRef.current && addLog(line),
        },
      )
    } catch (err) {
      // Last line of defence: the demo must never get stuck or show a broken frame.
      out = {
        source: 'fallback', html: fallback.html, ids: fallback.ids, explanations: fallback.explanations,
        notice: `Something unexpected went wrong (${err.message}), so this is a pre-built example (${fallback.title}).`,
      }
    }
    if (run !== runRef.current) return
    if (out.source === 'fallback') setApp({ html: out.html, key: ++keyRef.current })
    setResult(out)
    setBusy(false)
  }

  /** No AI at all: straight to the ready-made app, with the full Explain experience. */
  function loadExampleApp() {
    runRef.current++
    resetBuild()
    setPlan(null); setFlowNotice(null)
    setApp({ html: fallback.html, key: ++keyRef.current })
    setResult({ source: 'example', explanations: fallback.explanations, notice: null })
    setView('workspace')
  }

  const select = useCallback((id) => {
    if (!explanationsRef.current?.some((e) => e.id === id)) return   // tagged but unexplained: ignore, never blank the panel
    setSelectedId(id)
    setExplored((prev) => new Set(prev).add(id))
  }, [])
  const pickFromPanel = useCallback((id) => { select(id); setExplainMode(true) }, [select])

  const stage =
    view === 'idea' || view === 'understanding' || view === 'asking' ? 0
    : view === 'planning' || view === 'plan' ? 1
    : !result ? 2
    : explored.size > 0 ? 4
    : 3

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Lunor</strong>
        <span className="muted">App Development · prototype</span>
        {view !== 'idea' && <button type="button" className="btn ghost small" onClick={startOver}>Start over</button>}
      </header>

      <Stepper current={stage} />

      {view === 'idea' && <IdeaStep onSubmit={submitIdea} onExample={loadExampleApp} />}
      {view === 'understanding' && <Working title="Reading your idea…" detail="Working out what to ask you." />}
      {view === 'asking' && (
        <QuestionStep key={qIndex} question={questions[qIndex]} index={qIndex} total={questions.length} onAnswer={answer} />
      )}
      {view === 'planning' && <Working title="Planning your app…" detail="Turning your answers into a small, buildable plan." />}
      {view === 'plan' && (
        <>
          {flowNotice && <p className="notice" role="status">{flowNotice}</p>}
          <PlanStep plan={plan} choices={choices} onChoose={(key, value) => setChoices((c) => ({ ...c, [key]: value }))} onBuild={build} />
        </>
      )}
      {view === 'workspace' && (
        <Workspace
          busy={busy} status={status} app={app} result={result} plan={plan} choices={choices} log={log}
          explainMode={explainMode} onToggleExplain={() => setExplainMode((on) => !on)}
          selectedId={selectedId} onSelect={select} onPick={pickFromPanel} explored={explored}
        />
      )}
      {view !== 'workspace' && <ActivityLog log={log} />}
    </div>
  )
}
