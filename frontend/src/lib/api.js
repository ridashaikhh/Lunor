async function post(path, body, timeoutMs) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`)
  return res.json()
}

export const api = {
  understand: (body) => post('/api/understand', body, 50_000),
  plan: (body) => post('/api/plan', body, 50_000),
  build: (body) => post('/api/build', body, 100_000),
  explain: (body) => post('/api/explain', body, 70_000),
}
