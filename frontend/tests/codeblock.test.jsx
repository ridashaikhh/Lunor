// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import CodeBlock from '../src/components/CodeBlock.jsx'

afterEach(cleanup)
const snippet = (n) => ({
  language: 'js', start_line: 100, end_line: 100 + n - 1,
  code: Array.from({ length: n }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n'),
})
const rendered = () => document.querySelectorAll('.code-line').length

describe('CodeBlock', () => {
  it('short snippets are shown in full with no toggle', () => {
    render(<CodeBlock snippet={snippet(14)} />)
    expect(rendered()).toBe(14)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('long snippets start collapsed, keep true line numbers, and expand on demand', async () => {
    render(<CodeBlock snippet={snippet(33)} />)
    expect(rendered()).toBe(12)
    expect(document.querySelector('.code-ln').textContent).toBe('100')
    expect(screen.getByText(/lines 100–132 of the generated app/)).toBeInTheDocument()   // caption still tells the truth

    await userEvent.click(screen.getByRole('button', { name: 'Show all 33 lines' }))
    expect(rendered()).toBe(33)
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(rendered()).toBe(12)
  })
})
