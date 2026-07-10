// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FundamentalBadge from './FundamentalBadge.jsx'

afterEach(() => cleanup())

function makeEvaluation(overrides = {}) {
  return {
    verdict: 'pass',
    coreResults: { F1: true, F3: true, F5: true },
    epsAccelerating: true,
    marginImproving: true,
    reasons: ['EPS +31% ✓', '매출 +25% ✓', 'ROE 22% ✓'],
    ...overrides,
  }
}

describe('FundamentalBadge - renders nothing without data', () => {
  it('renders nothing when evaluation is null (fundamentals.json 부재/해당 티커 없음)', () => {
    const { container } = render(<FundamentalBadge evaluation={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FundamentalBadge - verdict badges (US-11)', () => {
  it('shows a Pass badge', () => {
    render(<FundamentalBadge evaluation={makeEvaluation({ verdict: 'pass' })} />)
    expect(screen.getByText(/펀더멘털 Pass/)).toBeInTheDocument()
  })

  it('shows a Partial badge', () => {
    render(<FundamentalBadge evaluation={makeEvaluation({ verdict: 'partial' })} />)
    expect(screen.getByText(/펀더멘털 Partial/)).toBeInTheDocument()
  })

  it('shows an insufficientFundamentals badge', () => {
    render(<FundamentalBadge evaluation={makeEvaluation({ verdict: 'insufficientFundamentals' })} />)
    expect(screen.getByText(/펀더멘털 판정불가/)).toBeInTheDocument()
  })

  it('starts collapsed, hiding the evidence reasons until expanded', () => {
    render(<FundamentalBadge evaluation={makeEvaluation()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('EPS +31% ✓')).not.toBeInTheDocument()
  })

  it('shows evidence reasons and F2/F4 reference badges when expanded', async () => {
    const user = userEvent.setup()
    render(<FundamentalBadge evaluation={makeEvaluation()} />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('EPS +31% ✓')).toBeInTheDocument()
    expect(screen.getByText('매출 +25% ✓')).toBeInTheDocument()
    expect(screen.getByText('ROE 22% ✓')).toBeInTheDocument()
    expect(screen.getByText(/EPS 성장 가속 여부: 예/)).toBeInTheDocument()
    expect(screen.getByText(/영업이익률 개선 여부: 예/)).toBeInTheDocument()
  })

  it('omits the F2/F4 reference lines when they are null (missing[] included F2/F4)', async () => {
    const user = userEvent.setup()
    render(<FundamentalBadge evaluation={makeEvaluation({ epsAccelerating: null, marginImproving: null })} />)
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText(/EPS 성장 가속 여부/)).not.toBeInTheDocument()
    expect(screen.queryByText(/영업이익률 개선 여부/)).not.toBeInTheDocument()
  })
})
