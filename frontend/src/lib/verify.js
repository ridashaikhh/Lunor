import { injectBridge } from './bridge'

/**
 * Runtime check, done in a hidden sandboxed iframe BEFORE the user sees the app:
 * the page must load, throw no script errors, and contain every element the server found tagged with data-explain.
 * Resolves { ok: true } or { ok: false, reason } - the reason is fed back to the model on the retry.
 */
export function verifyInHiddenIframe(html, expectedIds, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts allow-forms')
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:375px;height:700px;border:0;visibility:hidden'
    let timer
    const finish = (result) => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      resolve(result)
    }
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.data?.channel !== 'lunor' || e.data.type !== 'ready') return
      const { errors = [], ids = [] } = e.data
      if (errors.length) return finish({ ok: false, reason: `The page threw a script error on load: ${errors[0]}` })
      const missing = expectedIds.filter((id) => !ids.includes(id))
      if (missing.length) {
        return finish({
          ok: false,
          reason: `These data-explain elements were not in the page on first load: ${missing.join(', ')}. Start with sample data so every tagged element exists immediately.`,
        })
      }
      finish({ ok: true })
    }
    window.addEventListener('message', onMessage)
    timer = setTimeout(
      () => finish({ ok: false, reason: 'The page did not finish loading (syntax error or infinite loop?).' }),
      timeoutMs,
    )
    frame.srcdoc = injectBridge(html)
    document.body.appendChild(frame)
  })
}
