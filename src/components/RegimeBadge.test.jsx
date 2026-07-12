// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RegimeBadge from './RegimeBadge.jsx'

afterEach(() => cleanup())

function makeBacktest(regimeAxisEntries = []) {
  return { regimeAxis: regimeAxisEntries }
}

function entryFor(regime, { signals = 60, avgExcess = 0.021 } = {}) {
  return {
    strategyKey: 'consensus_2star',
    sample: 'out',
    regime,
    byHolding: [{ days: 20, signals, winRate: 0.6, avgExcess, medianExcess: avgExcess, avgReturn: 0.05, mdd: 0.02 }],
  }
}

describe('RegimeBadge — graceful degradation (US-13 AC4)', () => {
  it('renders nothing when backtest is null (backtest.json 부재)', () => {
    const { container } = render(<RegimeBadge regimeInfo={{ regime: 'up', breadth: 0.7 }} backtest={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when backtest.regimeAxis is undefined (v1/v2 산출물, regimeAxis 없음)', () => {
    const { container } = render(<RegimeBadge regimeInfo={{ regime: 'up', breadth: 0.7 }} backtest={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when regimeInfo.regime is null (국면 계산 불가)', () => {
    const { container } = render(<RegimeBadge regimeInfo={{ regime: null, breadth: null }} backtest={makeBacktest([entryFor('up')])} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RegimeBadge — 국면 3상태 렌더링 (US-13 AC1)', () => {
  it('상승 국면 + breadth%를 표시한다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'up', breadth: 0.72 }} backtest={makeBacktest([entryFor('up')])} />)
    expect(screen.getByText(/현재 시장 폭 72% — 상승 국면/)).toBeInTheDocument()
  })

  it('중립 국면을 표시한다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'neutral', breadth: 0.5 }} backtest={makeBacktest([entryFor('neutral')])} />)
    expect(screen.getByText(/중립 국면/)).toBeInTheDocument()
  })

  it('하락 국면을 표시한다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'down', breadth: 0.3 }} backtest={makeBacktest([entryFor('down')])} />)
    expect(screen.getByText(/하락 국면/)).toBeInTheDocument()
  })

  it('표본이 50 이상이면 ★★ 컨센서스의 검증 초과수익 문구를 보여준다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'up', breadth: 0.7 }} backtest={makeBacktest([entryFor('up', { signals: 60, avgExcess: 0.021 })])} />)
    expect(screen.getByText(/★★ 컨센서스의 검증 초과수익: 2\.1%p · 표본 60건/)).toBeInTheDocument()
  })

  it('표본이 50 미만이면 "표본 부족 — 참고 불가"를 보여준다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'down', breadth: 0.3 }} backtest={makeBacktest([entryFor('down', { signals: 10 })])} />)
    expect(screen.getByText('표본 부족 — 참고 불가')).toBeInTheDocument()
  })

  it('해당 국면의 regimeAxis 항목 자체가 없어도 "표본 부족"으로 안전 처리한다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'down', breadth: 0.3 }} backtest={makeBacktest([entryFor('up')])} />)
    expect(screen.getByText('표본 부족 — 참고 불가')).toBeInTheDocument()
  })

  it('고정 고지 문구("국면 분류는 기계적 지표이며 시장 예측이 아닙니다")가 항상 함께 표시된다', () => {
    render(<RegimeBadge regimeInfo={{ regime: 'up', breadth: 0.7 }} backtest={makeBacktest([entryFor('up')])} />)
    expect(screen.getByText('국면 분류는 기계적 지표이며 시장 예측이 아닙니다')).toBeInTheDocument()
  })
})
