import BRIDGE_SOURCE from './bridge.iife.js?raw'

export { BRIDGE_SOURCE }

/** Put the bridge at the very start of <head> so its error listener is registered before the app's own script runs. */
export function injectBridge(html) {
  const tag = `<script>${BRIDGE_SOURCE}</script>`
  const head = html.match(/<head[^>]*>/i)
  if (head) return html.replace(head[0], () => head[0] + tag)
  const root = html.match(/<html[^>]*>/i)
  if (root) return html.replace(root[0], () => root[0] + tag)
  return tag + html
}
