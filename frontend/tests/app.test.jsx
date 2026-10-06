// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fallback from '../src/fallback/expenseTracker.json'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

/** What the real iframe would do: post a message whose `source` is the iframe's own window. */
function fromIframe(data) {
  const frame = document.querySelector('iframe.device-frame')
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { channel: 'lunor', ...data }, source: frame.contentWindow }))
  })
}

async function freshApp({ verifyOk = true } = {}) {
  vi.resetModules()
  // The hidden-iframe runtime check needs a real browser; its logic is covered by bridge.test.js and pipeline.test.js.
  vi.doMock('../src/lib/verify', () => ({
    verifyInHiddenIframe: () => Promise.resolve(verifyOk ? { ok: true } : { ok: false, reason: 'blank page' }),
  }))
  const { default: App } = await import('../src/App.jsx')
  render(<App />)
}

const questions = {
  ok: true,
  questions: [
    { question: 'Who will use it?', options: ['Just me', 'My friends'] },
    { question: 'What is the main thing to track?', options: ['Streaks', 'Time spent', 'Mood'] },
    { question: 'What should the first version leave out?', options: ['Reminders', 'Charts'] },
  ],
}
const decision = (key, title, options, recommended) => ({ key, title, context: `Context for ${key}.`, recommended, options })
const aiPlan = {
  ok: true,
  plan: {
    idea: 'habit tracker', app_name: 'HabitFlow', understanding: 'You want to build habits. You need it to be quick.',
    summary: 'A tiny habit tracker.', target_user: 'Busy students',
    mvp_features: ['Add a habit', 'Mark it done today', 'See your streak'], later_features: ['Reminders', 'Charts'],
    decisions: [
      decision('navigation', 'How should people move around?', [
        { value: 'single', label: 'Single screen', benefit: 'Everything in sight.', cost: 'Gets crowded.' },
        { value: 'tabs', label: 'Two tabs', benefit: 'Tidy.', cost: 'Extra tap.' }], 'single'),
      decision('layout', 'How should items be shown?', [
        { value: 'list', label: 'List', benefit: 'Dense.', cost: 'Plain.' },
        { value: 'cards', label: 'Cards', benefit: 'Visual.', cost: 'Fewer fit.' }], 'cards'),
    ],
  },
}
const okBuild = { ok: true, html: fallback.html.replace('Campus Cash', 'HabitFlow'), ids: fallback.ids }
const okExplain = { ok: true, explanations: fallback.explanations }

function route(table) {
  return vi.fn((url, init) => (url in table ? table[url](init) : Promise.reject(new Error(`unexpected ${url}`))))
}
const bodyOf = (fetchMock, url) => JSON.parse(fetchMock.mock.calls.find((c) => c[0] === url)[1].body)

describe('ready-made example (no AI at all)', () => {
  it('skips straight to a sandboxed app, forms allowed, never same-origin', async () => {
    await freshApp()
    await userEvent.click(screen.getByRole('button', { name: /ready-made example/i }))
    const frame = document.querySelector('iframe.device-frame')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(frame.getAttribute('sandbox')).not.toContain('same-origin')
    expect(frame.getAttribute('srcdoc')).toContain("var CHANNEL = 'lunor'")
    expect(screen.getByRole('switch', { name: /explain mode/i })).toBeEnabled()
    expect(screen.getByText('0 of 7 explored')).toBeInTheDocument()
  })

  it('click in the phone -> real code, concept, try-changing, and the Learn strip appears', async () => {
    await freshApp()
    await userEvent.click(screen.getByRole('button', { name: /ready-made example/i }))
    await userEvent.click(screen.getByRole('switch', { name: /explain mode/i }))
    expect(screen.queryByLabelText('What you learned')).toBeNull()

    fromIframe({ type: 'explain-click', id: 'add-button' })

    expect(screen.getByRole('heading', { name: 'Add expense button' })).toBeInTheDocument()
    const code = document.querySelector('.code')
    expect(code.textContent).toContain('addBtn.addEventListener')
    expect(code.textContent).toMatch(/lines \d+–\d+ of the generated app/)
    const learned = screen.getByLabelText('What you learned')
    expect(learned).toHaveTextContent('Event handling and state updates')
    expect(learned).toHaveTextContent('Try changing this')

    expect(document.querySelector('.learned-pills')).toHaveTextContent('Event handling and state updates')   // visible at the top
    fromIframe({ type: 'explain-click', id: 'delete-button' })
    expect(screen.getByLabelText('What you learned')).toHaveTextContent('Event delegation')
    expect(document.querySelector('.learned-pills')).toHaveTextContent('Event delegation')
    expect(screen.getByText('2 of 7 explored')).toBeInTheDocument()
  })

  it('stepper moves Explain -> Learn, and an unexplained id never blanks the panel', async () => {
    await freshApp()
    await userEvent.click(screen.getByRole('button', { name: /ready-made example/i }))
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Explain')
    fromIframe({ type: 'explain-click', id: 'not-a-real-id' })
    expect(screen.getByRole('heading', { name: 'Explore the app' })).toBeInTheDocument()
    fromIframe({ type: 'explain-click', id: 'total-card' })
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Learn')
  })

  it('ignores messages that do not come from the preview iframe', async () => {
    await freshApp()
    await userEvent.click(screen.getByRole('button', { name: /ready-made example/i }))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { channel: 'lunor', type: 'explain-click', id: 'add-button' }, source: window }))
    })
    expect(screen.getByRole('heading', { name: 'Explore the app' })).toBeInTheDocument()
  })
})

describe('full guided flow with AI (fetch mocked)', () => {
  it('idea -> 3 questions -> plan -> decisions -> build -> explain', async () => {
    const fetchMock = route({
      '/api/understand': () => json(questions),
      '/api/plan': () => json(aiPlan),
      '/api/build': () => json(okBuild),
      '/api/explain': () => json(okExplain),
    })
    vi.stubGlobal('fetch', fetchMock)
    await freshApp()
    const user = userEvent.setup()

    // Understand
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'A habit tracker' }))        // example chip fills the box
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Who will use it?')).toBeInTheDocument()
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/api/understand')).toEqual({ idea: 'A habit tracker' })

    await user.click(screen.getByRole('button', { name: 'Just me' }))
    expect(await screen.findByText('What is the main thing to track?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Something else…' }))        // free-text answer
    await user.type(screen.getByLabelText('Your answer'), 'Sleep quality')
    await user.click(screen.getByRole('button', { name: 'Use this answer' }))
    await user.click(await screen.findByRole('button', { name: 'Charts' }))

    // Plan: answers were sent, the plan is shown, recommended options are pre-selected
    expect(await screen.findByText('You want to build habits. You need it to be quick.')).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/api/plan').answers).toEqual([
      { question: 'Who will use it?', answer: 'Just me' },
      { question: 'What is the main thing to track?', answer: 'Sleep quality' },
      { question: 'What should the first version leave out?', answer: 'Charts' },
    ])
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Plan')
    expect(screen.getByRole('radio', { name: /Single screen/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Cards/ })).toHaveAttribute('aria-checked', 'true')

    // The user changes a decision: it must reach the build request, together with the plan
    await user.click(screen.getByRole('radio', { name: /Two tabs/ }))
    await user.click(screen.getByRole('button', { name: 'Build HabitFlow' }))

    await waitFor(() => expect(document.querySelector('iframe.device-frame')).toBeTruthy())
    const build = bodyOf(fetchMock, '/api/build')
    expect(build.decisions).toEqual({ navigation: 'tabs', layout: 'cards' })
    expect(build).toMatchObject({
      idea: 'habit tracker', app_name: 'HabitFlow', summary: 'A tiny habit tracker.', target_user: 'Busy students',
      mvp_features: ['Add a habit', 'Mark it done today', 'See your streak'], previous_error: null,
    })
    await waitFor(() => expect(screen.getByRole('switch', { name: /explain mode/i })).toBeEnabled())
    expect(screen.queryByText(/pre-built example/)).toBeNull()                         // a genuine AI result
    expect(screen.getByText(/Two tabs · Cards/)).toBeInTheDocument()                    // recap of the choices
  })

  it('shows the app first and unlocks Explain only when explanations arrive', async () => {
    let releaseExplain
    vi.stubGlobal('fetch', route({
      '/api/understand': () => json(questions),
      '/api/plan': () => json(aiPlan),
      '/api/build': () => json(okBuild),
      '/api/explain': () => new Promise((r) => { releaseExplain = () => r({ ok: true, json: () => Promise.resolve(okExplain) }) }),
    }))
    await freshApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('App idea'), 'habit tracker')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    for (const name of ['Just me', 'Streaks', 'Charts']) await user.click(await screen.findByRole('button', { name }))
    await user.click(await screen.findByRole('button', { name: 'Build HabitFlow' }))

    await waitFor(() => expect(document.querySelector('iframe.device-frame')).toBeTruthy())
    expect(screen.getByRole('switch', { name: /explain mode/i })).toBeDisabled()
    expect(screen.getByRole('heading', { name: /Preparing explanations/ })).toBeInTheDocument()
    await act(async () => releaseExplain())
    await waitFor(() => expect(screen.getByRole('switch', { name: /explain mode/i })).toBeEnabled())
  })

  it('Start over returns to the first screen and drops a build that is still running', async () => {
    let releaseBuild
    vi.stubGlobal('fetch', route({
      '/api/understand': () => json(questions),
      '/api/plan': () => json(aiPlan),
      '/api/build': () => new Promise((r) => { releaseBuild = () => r({ ok: true, json: () => Promise.resolve(okBuild) }) }),
      '/api/explain': () => json(okExplain),
    }))
    await freshApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('App idea'), 'habit tracker')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    for (const name of ['Just me', 'Streaks', 'Charts']) await user.click(await screen.findByRole('button', { name }))
    await user.click(await screen.findByRole('button', { name: 'Build HabitFlow' }))
    expect(await screen.findByText('Generating your app…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('heading', { name: 'What do you want to build?' })).toBeInTheDocument()
    await act(async () => releaseBuild())                                                // the stale build finishes later...
    expect(screen.getByRole('heading', { name: 'What do you want to build?' })).toBeInTheDocument()   // ...and changes nothing
    expect(document.querySelector('iframe.device-frame')).toBeNull()
  })
})

describe('failure paths never strand the user', () => {
  it('Understand fails (backend down): retries once, then continues with the ready-made plan and says so', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    await freshApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('App idea'), 'habit tracker')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('button', { name: 'Build Campus Cash' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/ready-made plan/)
    expect(fetchMock).toHaveBeenCalledTimes(2)                                           // one try + exactly one retry
  })

  it('Plan fails after the questions: same safe landing', async () => {
    vi.stubGlobal('fetch', route({
      '/api/understand': () => json(questions),
      '/api/plan': () => json({ ok: false, errors: ['Gemini failed: 503 UNAVAILABLE'], retryable: true, error_kind: 'provider' }),
    }))
    await freshApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('App idea'), 'habit tracker')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    for (const name of ['Just me', 'Streaks', 'Charts']) await user.click(await screen.findByRole('button', { name }))
    expect(await screen.findByRole('button', { name: 'Build Campus Cash' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/503/)                          // the notice says why
  })

  it('example plan -> build works, and a build that fails twice ends on the pre-built app with a notice', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    await freshApp()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('App idea'), 'habit tracker')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Build Campus Cash' }))

    await waitFor(() => expect(screen.getAllByRole('status').some((n) => /pre-built example/.test(n.textContent))).toBe(true))
    expect(document.querySelector('iframe.device-frame').getAttribute('srcdoc')).toContain('Campus Cash')
    expect(screen.getByRole('switch', { name: /explain mode/i })).toBeEnabled()          // fallback is fully explainable
  })
})
