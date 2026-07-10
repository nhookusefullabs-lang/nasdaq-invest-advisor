// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResearchSection from './ResearchSection.jsx'

afterEach(() => cleanup())

function makeResearch(overrides = {}) {
  return {
    ticker: 'AXON',
    sentiment: 'positive',
    summary: '최근 신규 계약 발표로 상승세를 보이고 있다. 밸류에이션 부담은 남아있다.',
    catalysts: ['신규 정부기관 계약 체결'],
    risks: ['밸류에이션 부담'],
    institutionalActivity: '1분기 13F 기준 일부 기관 신규 편입',
    analystView: null,
    sources: [{ title: 'Axon 뉴스', url: 'https://example.com/axon', date: '2026-07-09', operatorProvided: false }],
    origin: 'recommended',
    researchedAt: '2026-07-11',
    stale: false,
    ...overrides,
  }
}

describe('ResearchSection - no data', () => {
  it('renders nothing when research is null/undefined', () => {
    const { container } = render(<ResearchSection research={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ResearchSection - collapsed (default)', () => {
  it('shows the sentiment badge and only the first sentence of the summary', () => {
    render(<ResearchSection research={makeResearch()} />)
    expect(screen.getByText('긍정')).toBeInTheDocument()
    expect(screen.getByText('최근 신규 계약 발표로 상승세를 보이고 있다.')).toBeInTheDocument()
    expect(screen.queryByText(/밸류에이션 부담은 남아있다/)).not.toBeInTheDocument()
  })
})

describe('ResearchSection - expanded', () => {
  it('shows catalysts, risks, sources, and researchedAt after clicking to expand', async () => {
    const user = userEvent.setup()
    render(<ResearchSection research={makeResearch()} />)

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('신규 정부기관 계약 체결')).toBeInTheDocument()
    expect(screen.getByText('밸류에이션 부담')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Axon 뉴스' })).toHaveAttribute('href', 'https://example.com/axon')
    expect(screen.getByText(/리서치 기준일: 2026-07-11/)).toBeInTheDocument()
    expect(screen.getByText(/투자 판단의 근거가 아닙니다/)).toBeInTheDocument()
  })
})

describe('ResearchSection - origin badge', () => {
  it('shows the "관심 종목 리서치" badge for userRequested items', () => {
    render(<ResearchSection research={makeResearch({ origin: 'userRequested' })} />)
    expect(screen.getByText('관심 종목 리서치')).toBeInTheDocument()
  })

  it('does not show the badge for recommended items', () => {
    render(<ResearchSection research={makeResearch({ origin: 'recommended' })} />)
    expect(screen.queryByText('관심 종목 리서치')).not.toBeInTheDocument()
  })
})

describe('ResearchSection - stale warning', () => {
  it('shows a stale badge and warning text when stale is true', async () => {
    const user = userEvent.setup()
    render(<ResearchSection research={makeResearch({ stale: true })} />)

    expect(screen.getByText(/이전 데이터 기준/)).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByText('이 리서치는 이전 데이터 기준입니다.')).toBeInTheDocument()
  })

  it('shows no stale warning when stale is false', () => {
    render(<ResearchSection research={makeResearch({ stale: false })} />)
    expect(screen.queryByText(/이전 데이터 기준/)).not.toBeInTheDocument()
  })
})
