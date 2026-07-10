// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResearchRequestToggle from './ResearchRequestToggle.jsx'

afterEach(() => cleanup())

describe('ResearchRequestToggle (US-11)', () => {
  it('shows the "요청됨" state and label when requested=true', () => {
    render(<ResearchRequestToggle ticker="AAPL" requested={true} onToggle={() => {}} />)
    const btn = screen.getByRole('button', { name: /리서치 요청됨/ })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the default label and state when requested=false', () => {
    render(<ResearchRequestToggle ticker="AAPL" requested={false} onToggle={() => {}} />)
    const btn = screen.getByRole('button', { name: '리서치 요청' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onToggle with the ticker on click', async () => {
    const user = userEvent.setup()
    let called = null
    render(<ResearchRequestToggle ticker="MSFT" requested={false} onToggle={(t) => (called = t)} />)
    await user.click(screen.getByRole('button'))
    expect(called).toBe('MSFT')
  })

  it('stops click propagation (so a wrapping label/checkbox is not also toggled)', async () => {
    const user = userEvent.setup()
    let labelClicked = false
    render(
      <label onClick={() => (labelClicked = true)}>
        <ResearchRequestToggle ticker="MSFT" requested={false} onToggle={() => {}} />
      </label>
    )
    await user.click(screen.getByRole('button'))
    expect(labelClicked).toBe(false)
  })
})
