// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BacktestConfidence, { BACKTEST_DISCLAIMER } from './BacktestConfidence.jsx'

afterEach(() => cleanup())

function makeBacktest(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-10',
    config: { dataFrom: '2024-08-05', dataTo: '2026-07-09', stepDays: 5, holdingDays: [5, 20, 60], warmupDays: 252, splitDate: '2026-01-05', benchmark: 'universe_equal_weight', topN: 5 },
    strategies: [
      {
        key: 'trend',
        sample: 'out',
        basis: 'top5',
        byHolding: [
          { days: 5, signals: 40, winRate: 0.5, avgExcess: 0.01, medianExcess: 0.01, avgReturn: 0.02, mdd: 0.02 },
          { days: 20, signals: 38, winRate: 0.55, avgExcess: 0.021, medianExcess: 0.015, avgReturn: 0.05, mdd: 0.04 },
          { days: 60, signals: 30, winRate: 0.5, avgExcess: 0.018, medianExcess: 0.012, avgReturn: 0.08, mdd: 0.07 },
        ],
        relaxedShare: 0.3,
      },
    ],
    fundamentalAxis: null,
    variants: [],
    ...overrides,
  }
}

describe('BacktestConfidence — US-8', () => {
  it('backtest가 없으면(null) 아무것도 렌더링하지 않는다 (graceful degradation)', () => {
    const { container } = render(<BacktestConfidence backtest={null} modeKey="trend" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('해당 모드의 out/top5/20거래일 항목이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<BacktestConfidence backtest={makeBacktest()} modeKey="minervini" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sample:"in" 레코드만 있으면(out 없음) 아무것도 렌더링하지 않는다 (In-Sample 미표시 보증)', () => {
    const inOnly = makeBacktest({ strategies: [{ ...makeBacktest().strategies[0], sample: 'in' }] })
    const { container } = render(<BacktestConfidence backtest={inOnly} modeKey="trend" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('요약과 고정 고지 문구가 항상 함께 렌더링된다 (분리 렌더 불가)', () => {
    render(<BacktestConfidence backtest={makeBacktest()} modeKey="trend" />)
    expect(screen.getByText(/검증 구간\(Out-of-Sample\) 초과수익/)).toBeInTheDocument()
    expect(screen.getByText(BACKTEST_DISCLAIMER)).toBeInTheDocument()
  })

  it('20일·60일 초과수익이 한 줄에 병기된다 (v9.1 US-5 승인 기준 1)', () => {
    render(<BacktestConfidence backtest={makeBacktest()} modeKey="trend" />)
    const summary = screen.getByText(/검증 구간\(Out-of-Sample\) 초과수익/)
    expect(summary.textContent).toContain('20거래일 +2.1%p')
    expect(summary.textContent).toContain('60거래일 +1.8%p')
    expect(summary.textContent).toContain('추세추종')
  })

  it('config.overlapFactor가 없으면(v1 하위 호환) 유효 표본 주석을 생략한다 (US-5 승인 기준 2)', () => {
    const v1Backtest = makeBacktest({ config: { ...makeBacktest().config, overlapFactor: undefined } })
    render(<BacktestConfidence backtest={v1Backtest} modeKey="trend" />)
    const summary = screen.getByText(/검증 구간\(Out-of-Sample\) 초과수익/)
    expect(summary.textContent).toContain('60거래일 +1.8%p')
    expect(summary.textContent).not.toContain('겹침 보정')
  })

  it('config.overlapFactor가 있으면 60일 옆에 유효 표본 근사를 병기한다', () => {
    const withOverlap = makeBacktest({ config: { ...makeBacktest().config, overlapFactor: { 5: 1, 20: 4, 60: 12 } } })
    render(<BacktestConfidence backtest={withOverlap} modeKey="trend" />)
    const summary = screen.getByText(/검증 구간\(Out-of-Sample\) 초과수익/)
    expect(summary.textContent).toContain('겹침 보정 유효 표본 약 2.5건') // 30신호/overlapFactor 12
  })

  it('표본이 0이면 승률/초과수익 대신 "표본 부족"을 표시한다 (NaN 노출 금지)', () => {
    const zeroSample = makeBacktest({
      strategies: [
        {
          key: 'trend',
          sample: 'out',
          basis: 'top5',
          byHolding: [{ days: 20, signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null }],
          relaxedShare: null,
        },
      ],
    })
    render(<BacktestConfidence backtest={zeroSample} modeKey="trend" />)
    expect(screen.getByText(/표본 부족/)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    // 고지 문구는 표본 부족 상황에서도 여전히 함께 렌더링된다
    expect(screen.getByText(BACKTEST_DISCLAIMER)).toBeInTheDocument()
  })

  it('상세 보기를 펼치면 평가 기간·보유기간별 표가 나타난다', async () => {
    const user = userEvent.setup()
    render(<BacktestConfidence backtest={makeBacktest()} modeKey="trend" />)
    expect(screen.queryByText(/평가 기간/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '상세 보기' }))
    expect(screen.getByText(/평가 기간/)).toBeInTheDocument()
    expect(screen.getByText('60거래일')).toBeInTheDocument()
  })

  it('consensus 모드에서 펼치면 ★★ vs ★ 비교가 나타난다', async () => {
    const user = userEvent.setup()
    const backtest = makeBacktest({
      strategies: [
        {
          key: 'consensus_2star',
          sample: 'out',
          basis: 'top5',
          byHolding: [{ days: 20, signals: 50, winRate: 0.6, avgExcess: 0.03, medianExcess: 0.02, avgReturn: 0.05, mdd: 0.03 }],
          relaxedShare: 0,
        },
        {
          key: 'consensus_1star',
          sample: 'out',
          basis: 'top5',
          byHolding: [{ days: 20, signals: 20, winRate: 0.4, avgExcess: -0.01, medianExcess: -0.01, avgReturn: 0.01, mdd: 0.05 }],
          relaxedShare: 0,
        },
      ],
    })
    render(<BacktestConfidence backtest={backtest} modeKey="consensus" />)
    await user.click(screen.getByRole('button', { name: '상세 보기' }))
    expect(screen.getByText(/★★ vs ★ 비교/)).toBeInTheDocument()
  })

  it('fundamentalAxis가 있으면 펼침 상세에 참고치가 나타난다', async () => {
    const user = userEvent.setup()
    const backtest = makeBacktest({
      fundamentalAxis: {
        note: '근사 재구성 · 짧은 구간 참고치',
        coveredFrom: '2025-08-14',
        byVerdict: [{ verdict: 'pass', byHolding: [{ days: 20, signals: 7, winRate: 0.5, avgExcess: 0.02, medianExcess: 0.01, avgReturn: 0.03, mdd: 0.02 }] }],
      },
    })
    render(<BacktestConfidence backtest={backtest} modeKey="trend" />)
    await user.click(screen.getByRole('button', { name: '상세 보기' }))
    expect(screen.getByText(/펀더멘털 축/)).toBeInTheDocument()
  })
})
