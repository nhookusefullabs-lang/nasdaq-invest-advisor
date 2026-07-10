// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FundamentalFailSection from './FundamentalFailSection.jsx'

afterEach(() => cleanup())

const FAILED = [
  { ticker: 'ZZZZ', name: 'Zzzz Corp', reasons: ['EPS -5% ✗', '매출 +2% ✗', 'ROE 8% ✗'] },
]

describe('FundamentalFailSection - empty state', () => {
  it('renders nothing when failed is empty', () => {
    const { container } = render(<FundamentalFailSection failed={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when failed is undefined', () => {
    const { container } = render(<FundamentalFailSection />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FundamentalFailSection - default collapsed + Fail 분리 배치 (US-11)', () => {
  it('starts collapsed', () => {
    render(<FundamentalFailSection failed={FAILED} />)
    expect(screen.getByRole('button', { name: /펀더멘털 미달/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('ZZZZ')).not.toBeInTheDocument()
  })

  it('shows the failed count badge', () => {
    render(<FundamentalFailSection failed={FAILED} />)
    expect(screen.getByText('1개')).toBeInTheDocument()
  })

  it('shows each failed ticker with its reasons when expanded — not hidden, shown with cause', async () => {
    const user = userEvent.setup()
    render(<FundamentalFailSection failed={FAILED} />)
    await user.click(screen.getByRole('button', { name: /펀더멘털 미달/ }))
    expect(screen.getByText('ZZZZ')).toBeInTheDocument()
    expect(screen.getByText('Zzzz Corp')).toBeInTheDocument()
    expect(screen.getByText(/EPS -5% ✗/)).toBeInTheDocument()
  })
})
