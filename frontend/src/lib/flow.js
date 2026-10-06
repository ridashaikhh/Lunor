import { STOP_KINDS } from './pipeline'

/** One call with the same policy as the build: a rejected/bad reply gets one retry; outages and bad keys do not. */
export async function callWithRetry(fn, payload, onLog = () => {}, label = 'Step') {
  let reason = 'Unknown error'
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fn(payload)
      if (res.ok) return { ok: true, data: res }
      reason = (res.errors || []).join(' | ') || 'Unknown error'
      onLog(`${label} attempt ${attempt} rejected (${res.error_kind || 'unknown'}): ${reason}`)
      if (res.retryable === false || STOP_KINDS.has(res.error_kind)) break
    } catch (err) {
      reason = `Server unreachable or timed out (${err.message})`
      onLog(`${label} attempt ${attempt} failed: ${reason}`)
    }
  }
  return { ok: false, reason }
}

export function recommendedChoices(plan) {
  return Object.fromEntries(plan.decisions.map((d) => [d.key, d.recommended]))
}

export function shorten(text, max = 140) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
