/**
 * Build -> verify -> explain, with the reliability policy in ONE place:
 *   - The backend already absorbs temporary Gemini trouble (retries with backoff, then a backup model).
 *   - Here, a stage whose OUTPUT was bad (rule violation, script error, missing explanations) gets one retry,
 *     and the retry tells the model exactly what was wrong.
 *   - If Gemini is unavailable or the key is bad, asking again can't help: go straight to the example.
 *   - If a stage still fails, we show the known-good example so the demo never ends in a broken iframe.
 * All side effects come in through `deps`, which keeps this testable without a browser.
 */
const MAX_ATTEMPTS = 2
export const STOP_KINDS = new Set(['config', 'provider'])

function asReason(errors) {
  return (errors || []).join(' | ') || 'Unknown error'
}

function useFallback(fallback, reason, log) {
  const short = reason.length > 180 ? reason.slice(0, 177) + '…' : reason
  log(`Falling back to the pre-built example. Last problem: ${short}`)
  return {
    source: 'fallback',
    html: fallback.html,
    ids: fallback.ids,
    explanations: fallback.explanations,
    notice: `AI generation did not produce a working app, so this is a pre-built example (${fallback.title}). Last problem: ${short}`,
  }
}

export async function runBuild(input, deps, hooks = {}) {
  const { api, verify, fallback } = deps
  const { onStatus = () => {}, onApp = () => {}, onLog = () => {} } = hooks

  // ---- Stage 1: generate + runtime-check the app (max 2 attempts) ----
  let built = null
  let feedback = null   // what we tell the model on the retry; only set when it is something the model can act on
  let lastReason = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !built; attempt++) {
    onStatus(attempt === 1 ? 'Generating your app…' : 'That attempt had a problem. Retrying once…')
    let res
    try {
      res = await api.build({ ...input, previous_error: feedback })
    } catch (err) {
      lastReason = `Server unreachable or timed out (${err.message})`
      feedback = null
      onLog(`Build attempt ${attempt} failed: ${lastReason}`)
      continue
    }
    if (!res.ok) {
      lastReason = asReason(res.errors)
      onLog(`Build attempt ${attempt} rejected (${res.error_kind || 'unknown'}): ${lastReason}`)
      if (res.retryable === false || STOP_KINDS.has(res.error_kind)) return useFallback(fallback, lastReason, onLog)
      feedback = res.error_kind === 'validation' ? lastReason : null
      continue
    }
    onStatus('Checking that it runs…')
    const check = await verify(res.html, res.ids)
    if (!check.ok) {
      lastReason = check.reason
      feedback = check.reason
      onLog(`Build attempt ${attempt} failed the runtime check: ${lastReason}`)
      continue
    }
    built = res
    onLog(`Build attempt ${attempt} passed (${res.ids.length} explainable elements).`)
  }
  if (!built) return useFallback(fallback, lastReason || 'Build failed', onLog)

  onApp({ html: built.html, ids: built.ids }) // the app is usable now; explanations load in the background

  // ---- Stage 2: explanations (max 2 attempts) ----
  let lastExplainError = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onStatus(attempt === 1 ? 'Writing explanations…' : 'Explanations had a problem. Retrying once…')
    try {
      const ex = await api.explain({ html: built.html })
      if (ex.ok) {
        onLog(`Explanations ready (${ex.explanations.length}).`)
        return { source: 'ai', html: built.html, ids: built.ids, explanations: ex.explanations, notice: null }
      }
      lastExplainError = asReason(ex.errors)
      onLog(`Explain attempt ${attempt} rejected (${ex.error_kind || 'unknown'}): ${lastExplainError}`)
      if (ex.retryable === false || STOP_KINDS.has(ex.error_kind)) break
    } catch (err) {
      lastExplainError = `Server unreachable or timed out (${err.message})`
      onLog(`Explain attempt ${attempt} failed: ${lastExplainError}`)
    }
  }
  return useFallback(fallback, `Could not write explanations: ${lastExplainError}`, onLog)
}
