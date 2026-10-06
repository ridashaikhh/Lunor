import { useEffect, useMemo, useRef } from 'react'
import { injectBridge } from '../lib/bridge'

function send(frame, msg) {
  // The iframe is sandboxed (opaque origin), so targetOrigin has to be '*'. Messages carry no secrets.
  frame?.contentWindow?.postMessage({ channel: 'lunor', ...msg }, '*')
}

export default function PhoneFrame({ html, appKey, explainMode, selectedId, onSelect, placeholder }) {
  const frameRef = useRef(null)
  const latest = useRef({})
  latest.current = { explainMode, selectedId, onSelect }
  const srcDoc = useMemo(() => (html ? injectBridge(html) : ''), [html])

  // Messages coming OUT of the app. We only trust the one iframe we created.
  useEffect(() => {
    function onMessage(e) {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow || e.data?.channel !== 'lunor') return
      if (e.data.type === 'ready') {
        // The app just (re)loaded: bring it up to date with the current mode and selection.
        send(frameRef.current, { type: 'set-mode', on: latest.current.explainMode })
        if (latest.current.selectedId) send(frameRef.current, { type: 'select', id: latest.current.selectedId })
      } else if (e.data.type === 'explain-click') {
        latest.current.onSelect(e.data.id)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Messages going IN to the app.
  useEffect(() => send(frameRef.current, { type: 'set-mode', on: explainMode }), [explainMode])
  useEffect(() => send(frameRef.current, { type: 'select', id: selectedId }), [selectedId])

  return (
    <div className="device" data-explaining={explainMode}>
      <div className="device-screen">
        {html ? (
          <iframe
            key={appKey}
            ref={frameRef}
            className="device-frame"
            title="Generated app preview"
            sandbox="allow-scripts allow-forms"
            srcDoc={srcDoc}
          />
        ) : (
          <div className="device-empty">{placeholder ?? <p className="muted">Your app appears here.</p>}</div>
        )}
      </div>
    </div>
  )
}
