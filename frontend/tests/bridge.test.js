import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import fallback from '../src/fallback/expenseTracker.json'
import { injectBridge } from '../src/lib/bridge'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Boots an HTML page in jsdom with the bridge injected. In a top-level jsdom window, window.parent === window,
 *  so the page's own message events double as the "parent" side in these tests. */
async function boot(html) {
  const dom = new JSDOM(injectBridge(html), { runScripts: 'dangerously', pretendToBeVisual: true })
  const { window } = dom
  const messages = []
  window.addEventListener('message', (e) => {
    if (e.data?.channel === 'lunor') messages.push(e.data)
  })
  await wait(700) // load + the bridge's 300ms settle delay
  const send = (data) => window.dispatchEvent(new window.MessageEvent('message', { data: { channel: 'lunor', ...data }, source: window }))
  return { window, doc: window.document, messages, send, close: () => window.close() }
}

describe('bridge + known-good app', () => {
  it('reports ready with every tagged element and no errors', async () => {
    const app = await boot(fallback.html)
    const ready = app.messages.find((m) => m.type === 'ready')
    expect(ready).toBeTruthy()
    expect(ready.errors).toEqual([])
    expect(ready.ids.sort()).toEqual([...fallback.ids].sort())
    app.close()
  })

  it('the app genuinely works with Explain mode off', async () => {
    const app = await boot(fallback.html)
    const { doc } = app
    const rows = () => doc.querySelectorAll('#list li').length
    expect(rows()).toBe(3)
    expect(doc.getElementById('total').textContent).toBe('$35.25')

    doc.getElementById('amount').value = '10'
    doc.getElementById('title').value = 'Coffee'
    doc.getElementById('add-btn').click()
    expect(rows()).toBe(4)
    expect(doc.getElementById('total').textContent).toBe('$45.25')

    doc.querySelector('[data-delete]').click()
    expect(rows()).toBe(3)

    doc.getElementById('amount').value = '-5'
    doc.getElementById('add-btn').click()
    expect(rows()).toBe(3)                                         // invalid amount rejected
    expect(doc.getElementById('amount').classList.contains('invalid')).toBe(true)

    doc.querySelector('[data-filter="Books"]').click()
    expect(rows()).toBe(1)
    app.close()
  })

  it('Explain mode intercepts clicks: reports the id and does NOT run the app action', async () => {
    const app = await boot(fallback.html)
    const { doc, messages, send } = app
    send({ type: 'set-mode', on: true })
    expect(doc.body.classList.contains('lx-explain')).toBe(true)

    const before = doc.querySelectorAll('#list li').length
    doc.querySelector('[data-delete]').click()                    // innermost tagged element is the delete button
    doc.getElementById('add-btn').click()
    await wait(20)

    expect(doc.querySelectorAll('#list li').length).toBe(before)  // nothing deleted or added
    const clicks = messages.filter((m) => m.type === 'explain-click').map((m) => m.id)
    expect(clicks).toEqual(['delete-button', 'add-button'])
    expect(doc.querySelector('[data-explain="add-button"]').classList.contains('lx-selected')).toBe(true)

    send({ type: 'set-mode', on: false })                         // back to normal: the app works again
    doc.querySelector('[data-delete]').click()
    expect(doc.querySelectorAll('#list li').length).toBe(before - 1)
    app.close()
  })

  it('clicking a list row (not the button) reports the list, and untagged areas report nothing', async () => {
    const app = await boot(fallback.html)
    app.send({ type: 'set-mode', on: true })
    app.doc.querySelector('#list li .name').click()
    app.doc.querySelector('h1').click()
    await wait(20)
    expect(app.messages.filter((m) => m.type === 'explain-click').map((m) => m.id)).toEqual(['expense-list'])
    app.close()
  })

  it('select message highlights every element sharing that id', async () => {
    const app = await boot(fallback.html)
    app.send({ type: 'set-mode', on: true })
    app.send({ type: 'select', id: 'delete-button' })
    expect(app.doc.querySelectorAll('.lx-selected').length).toBe(3)
    app.close()
  })
})

describe('bridge catches broken generated apps', () => {
  it('reports a runtime error thrown during startup', async () => {
    const html = fallback.html.replace('render();\n</script>', 'nothingDefinedHere.boom();\n</script>')
    const app = await boot(html)
    const ready = app.messages.find((m) => m.type === 'ready')
    expect(ready.errors.length).toBeGreaterThan(0)
    expect(ready.errors[0]).toMatch(/nothingDefinedHere/)
    app.close()
  })

  it('reports tagged elements that are missing on first load', async () => {
    // an app that starts with an empty list never renders its delete buttons
    const html = fallback.html.replace(/expenses: \[[\s\S]*?\n    \],/, 'expenses: [],')
    const app = await boot(html)
    const ready = app.messages.find((m) => m.type === 'ready')
    expect(ready.ids).not.toContain('delete-button')
    app.close()
  })
})


describe('forms inside the preview', () => {
  const formApp = `<!DOCTYPE html><html><head></head><body>
    <form id="f"><input id="name" value="sleep"><button id="go">Add</button></form>
    <ul id="out"></ul>
    <script>
      // Deliberately forgets event.preventDefault(), like many generated apps do.
      document.getElementById('f').addEventListener('submit', function () {
        var li = document.createElement('li'); li.textContent = document.getElementById('name').value;
        document.getElementById('out').appendChild(li);
      });
      window.__prevented = null;
      document.addEventListener('submit', function (e) { window.__prevented = e.defaultPrevented; });
    </script></body></html>`

  it('the app handler still runs, and the bridge cancels navigation', async () => {
    const app = await boot(formApp)
    app.doc.getElementById('go').click()
    expect(app.doc.querySelectorAll('#out li').length).toBe(1)        // the app's own handler ran
    expect(app.window.__prevented).toBe(true)                          // ...and the form could not navigate
    app.close()
  })

  it('in Explain mode a click on the submit button is explained, not submitted', async () => {
    const html = formApp.replace('<button id="go">', '<button id="go" data-explain="add-habit">')
    const app = await boot(html)
    app.send({ type: 'set-mode', on: true })
    app.doc.getElementById('go').click()
    await wait(20)
    expect(app.doc.querySelectorAll('#out li').length).toBe(0)
    expect(app.messages.filter((m) => m.type === 'explain-click').map((m) => m.id)).toEqual(['add-habit'])
    app.close()
  })
})


describe('navigation controls in Explain mode', () => {
  const tabsApp = `<!DOCTYPE html><html><head></head><body>
    <div id="bar" data-explain="navigation-tab-bar"><button id="t2">Stats</button></div>
    <button id="del" data-explain="delete-button">x</button>
    <p id="view">habits</p>
    <script>
      document.getElementById('t2').addEventListener('click', function () { document.getElementById('view').textContent = 'stats'; });
      document.getElementById('del').addEventListener('click', function () { document.getElementById('view').textContent = 'deleted'; });
    </script></body></html>`

  it('a click on the tab bar explains it AND switches the tab', async () => {
    const app = await boot(tabsApp)
    app.send({ type: 'set-mode', on: true })
    app.doc.getElementById('t2').click()
    await wait(20)
    expect(app.doc.getElementById('view').textContent).toBe('stats')                       // the app reacted
    expect(app.messages.filter((m) => m.type === 'explain-click').map((m) => m.id)).toEqual(['navigation-tab-bar'])
    app.close()
  })

  it('other tagged controls are still only explained, never operated', async () => {
    const app = await boot(tabsApp)
    app.send({ type: 'set-mode', on: true })
    app.doc.getElementById('del').click()
    await wait(20)
    expect(app.doc.getElementById('view').textContent).toBe('habits')
    app.close()
  })
})
