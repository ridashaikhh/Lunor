import { describe, expect, it, vi } from 'vitest'
import { runBuild } from '../src/lib/pipeline'

const fallback = { title: 'Campus Cash', html: '<fallback/>', ids: ['a'], explanations: [{ id: 'a' }] }
const goodBuild = { ok: true, html: '<ai/>', ids: ['x', 'y'] }
const goodExplain = { ok: true, explanations: [{ id: 'x' }, { id: 'y' }] }
const input = { idea: 'habit tracker', decisions: { navigation: 'single', layout: 'list' } }

function deps(overrides = {}) {
  return {
    api: { build: vi.fn().mockResolvedValue(goodBuild), explain: vi.fn().mockResolvedValue(goodExplain) },
    verify: vi.fn().mockResolvedValue({ ok: true }),
    fallback,
    ...overrides,
  }
}

describe('runBuild', () => {
  it('happy path: one build, one explain, shows the app before explanations arrive', async () => {
    const d = deps()
    const onApp = vi.fn()
    const out = await runBuild(input, d, { onApp })
    expect(out.source).toBe('ai')
    expect(d.api.build).toHaveBeenCalledTimes(1)
    expect(onApp).toHaveBeenCalledWith({ html: '<ai/>', ids: ['x', 'y'] })
    expect(d.api.build.mock.calls[0][0].previous_error).toBeNull()
  })

  it('retries once when the server rejects the app, passing the reason back', async () => {
    const d = deps()
    d.api.build.mockResolvedValueOnce({ ok: false, errors: ['Missing </html>'], retryable: true, error_kind: 'validation' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('ai')
    expect(d.api.build).toHaveBeenCalledTimes(2)
    expect(d.api.build.mock.calls[1][0].previous_error).toContain('Missing </html>')
  })

  it('retries once when the runtime check fails, passing the browser error back', async () => {
    const d = deps()
    d.verify.mockResolvedValueOnce({ ok: false, reason: 'The page threw a script error on load: x is not defined' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('ai')
    expect(d.api.build.mock.calls[1][0].previous_error).toContain('x is not defined')
  })

  it('falls back after two failed builds (and never makes a third attempt)', async () => {
    const d = deps()
    d.api.build.mockResolvedValue({ ok: false, errors: ['bad'], retryable: true, error_kind: 'validation' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(out.html).toBe('<fallback/>')
    expect(out.notice).toMatch(/pre-built example/)
    expect(d.api.build).toHaveBeenCalledTimes(2)
  })

  it('falls back immediately for non-retryable problems such as a missing API key', async () => {
    const d = deps()
    d.api.build.mockResolvedValue({ ok: false, errors: ['GEMINI_API_KEY is not set on the server'], retryable: false, error_kind: 'config' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(d.api.build).toHaveBeenCalledTimes(1)
    expect(out.notice).toContain('GEMINI_API_KEY')
  })

  it('falls back when the backend is unreachable', async () => {
    const d = deps()
    d.api.build.mockRejectedValue(new TypeError('Failed to fetch'))
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(d.api.build).toHaveBeenCalledTimes(2)
  })

  it('falls back after two runtime-check failures', async () => {
    const d = deps()
    d.verify.mockResolvedValue({ ok: false, reason: 'blank page' })
    expect((await runBuild(input, d)).source).toBe('fallback')
  })

  it('retries only the explain call (not the build) when explanations fail once', async () => {
    const d = deps()
    d.api.explain.mockResolvedValueOnce({ ok: false, errors: ['No explanation returned for x.'], retryable: true })
    const out = await runBuild(input, d)
    expect(out.source).toBe('ai')
    expect(d.api.build).toHaveBeenCalledTimes(1)
    expect(d.api.explain).toHaveBeenCalledTimes(2)
  })

  it('falls back when explanations fail twice', async () => {
    const d = deps()
    d.api.explain.mockRejectedValue(new Error('timeout'))
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(out.notice).toMatch(/explanations/)
  })

  it('provider outage: the backend already retried, so go straight to the example (one request only)', async () => {
    const d = deps()
    d.api.build.mockResolvedValue({ ok: false, errors: ['Gemini failed: 503 UNAVAILABLE'], retryable: true, error_kind: 'provider' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(d.api.build).toHaveBeenCalledTimes(1)
    expect(out.notice).toContain('503')
  })

  it('never feeds non-rule problems (network, empty reply) to the model as if it had written bad code', async () => {
    const d = deps()
    d.api.build
      .mockResolvedValueOnce({ ok: false, errors: ['Gemini returned an empty response'], retryable: true, error_kind: 'model' })
      .mockResolvedValueOnce(goodBuild)
    await runBuild(input, d)
    expect(d.api.build.mock.calls[1][0].previous_error).toBeNull()

    const d2 = deps()
    d2.api.build.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(goodBuild)
    await runBuild(input, d2)
    expect(d2.api.build.mock.calls[1][0].previous_error).toBeNull()
  })

  it('explain: provider outage stops after one request', async () => {
    const d = deps()
    d.api.explain.mockResolvedValue({ ok: false, errors: ['503'], retryable: true, error_kind: 'provider' })
    const out = await runBuild(input, d)
    expect(out.source).toBe('fallback')
    expect(d.api.explain).toHaveBeenCalledTimes(1)
  })
})
