// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Recommend from './Recommend.jsx'

afterEach(() => cleanup())

function makeRecommendation() {
  return {
    list: [
      { ticker: 'AXON', name: 'Axon Enterprise, Inc.', score: 80.1, reasons: 'RSI 69', signalPassed: false },
      { ticker: 'AAPL', name: 'Apple Inc.', score: 34.0, reasons: 'RSI 62', signalPassed: true },
    ],
    relaxationApplied: false,
    insufficientSignal: false,
  }
}

const noop = () => {}

describe('Recommend - research integration (US-6)', () => {
  it('shows a research section on the matching card when researchMap has an entry', () => {
    const researchMap = new Map([
      ['AXON', { ticker: 'AXON', sentiment: 'positive', summary: '요약.', catalysts: [], risks: [], sources: [], origin: 'recommended', researchedAt: '2026-07-11' }],
    ])
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchMap={researchMap}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText('AI 리서치')).toBeInTheDocument()
  })

  it('renders identically to v5 (no research section anywhere) when researchMap is empty', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchMap={new Map()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByText('AI 리서치')).not.toBeInTheDocument()
    expect(screen.getByText('AXON')).toBeInTheDocument()
  })

  it('does not crash when researchMap is undefined (research.json never loaded)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByText('AI 리서치')).not.toBeInTheDocument()
  })
})

// --- v7 US-9: 프리셋 세그먼트 + 배너 연동 ---

describe('Recommend - preset segment (US-9)', () => {
  it('clicking a preset button calls onPresetChange with that preset key (re-render triggers recompute upstream)', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        preset="default"
        onPresetChange={(p) => {
          latest = p
        }}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: '보수형' }))
    expect(latest).toBe('conservative')
  })

  it('renders identically to v5 when preset is "default" (regression: same list, no research-pool notice)', () => {
    const researchMap = new Map([
      ['AXON', { ticker: 'AXON', sentiment: 'positive', summary: '요약.', catalysts: [], risks: [], sources: [], origin: 'recommended', researchedAt: '2026-07-11' }],
    ])
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchMap={researchMap}
        preset="default"
        onPresetChange={noop}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText('AXON')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.queryByText(/리서치 풀은 기본형 기준으로 선정되었습니다/)).not.toBeInTheDocument()
  })

  it('shows the research-pool notice on researched cards when a non-default preset is active', () => {
    const researchMap = new Map([
      ['AXON', { ticker: 'AXON', sentiment: 'positive', summary: '요약.', catalysts: [], risks: [], sources: [], origin: 'recommended', researchedAt: '2026-07-11' }],
    ])
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchMap={researchMap}
        preset="conservative"
        onPresetChange={noop}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/리서치 풀은 기본형 기준으로 선정되었습니다/)).toBeInTheDocument()
  })

  it('includes the active preset label in the relaxation-fallback and insufficient-signal banners', () => {
    const recommendation = { ...makeRecommendation(), relaxationApplied: true, insufficientSignal: true }
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={recommendation}
        preset="aggressive"
        onPresetChange={noop}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/공격형 기준 매수 신호 통과 종목이 부족해/)).toBeInTheDocument()
    expect(screen.getByText(/공격형 기준 매수 신호가 충분치 않습니다/)).toBeInTheDocument()
  })
})

describe('Recommend - research request toggle (US-11)', () => {
  it('renders a research-request toggle on every card and calls onToggleResearchRequest with the ticker', async () => {
    const user = userEvent.setup()
    let toggled = null
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchRequests={[]}
        onToggleResearchRequest={(t) => (toggled = t)}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getAllByText('리서치 요청').length).toBe(2) // one per card in makeRecommendation()
    const axonCard = screen.getByText('AXON').closest('.border')
    await user.click(within(axonCard).getByRole('button', { name: '리서치 요청' }))
    expect(toggled).toBe('AXON')
  })

  it('clicking the toggle does not also select the ticker checkbox (label click-bubbling regression)', async () => {
    const user = userEvent.setup()
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchRequests={[]}
        onToggleResearchRequest={noop}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    await user.click(screen.getAllByRole('button', { name: '리서치 요청' })[0])
    expect(screen.getAllByRole('checkbox').every((cb) => !cb.checked)).toBe(true)
  })

  it('does not render a toggle when onToggleResearchRequest is not passed (regression)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByText('리서치 요청')).not.toBeInTheDocument()
  })
})

// --- v8 US-10: 모드 세그먼트 + 통합/미너비니 뷰 ---

function makeMinerviniResult(overrides = {}) {
  return {
    list: [
      {
        ticker: 'FTNT',
        name: 'Fortinet, Inc.',
        sector: 'Technology',
        score: 78.1,
        reasons: 'Stage 2 추세, RS 상위 12%, 변동성 수축 중',
        signalPassed: true,
        relaxationApplied: false,
        templateChecks: [
          { code: 'T1', passed: true },
          { code: 'T2', passed: true },
          { code: 'T3', passed: true },
          { code: 'T4', passed: true },
          { code: 'T5', passed: true },
          { code: 'T6', passed: true },
          { code: 'T7', passed: false },
          { code: 'T8', passed: true },
        ],
      },
    ],
    relaxationApplied: false,
    insufficientSignal: false,
    level: 'strict',
    excludedForInsufficientData: [],
    ...overrides,
  }
}

function makeConsensusResult(overrides = {}) {
  return {
    list: [
      {
        ticker: 'FTNT',
        name: 'Fortinet, Inc.',
        sector: 'Technology',
        grade: '★★',
        singleModeLabel: null,
        consensusPercentile: 87,
        trend: { score: 43.5, percentile: 96, reasons: 'RSI 62', signalPassed: true },
        minervini: { score: 78.1, percentile: 78, reasons: 'Stage 2 추세', signalPassed: true },
      },
      {
        ticker: 'AAPL',
        name: 'Apple Inc.',
        sector: 'Technology',
        grade: '★',
        singleModeLabel: '추세추종',
        consensusPercentile: 34,
        trend: { score: 34.0, percentile: 34, reasons: 'RSI 62', signalPassed: true },
        minervini: null,
      },
    ],
    trendInsufficientSignal: false,
    minerviniInsufficientSignal: false,
    ...overrides,
  }
}

describe('Recommend - mode segment (US-10)', () => {
  it('defaults to trend mode when recommendMode is not passed (regression: v7 behavior unchanged)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByRole('button', { name: '추세추종' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: '추천 프리셋' })).toBeInTheDocument()
  })

  it('calls onModeChange with the clicked mode key', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="trend"
        onModeChange={(m) => (latest = m)}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: '미너비니' }))
    expect(latest).toBe('minervini')
  })

  it('renders the three mode buttons with the active one pressed', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="consensus"
        consensusResult={makeConsensusResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    const group = screen.getByRole('group', { name: '추천 모드' })
    expect(within(group).getByRole('button', { name: '통합' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: '추세추종' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: '미너비니' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides the preset segment and advanced settings entry point outside trend mode', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="minervini"
        minerviniResult={makeMinerviniResult()}
        customParams={{ rsiMin: 50, goldenCrossWindow: 5, highScoreThreshold: 70 }}
        onCustomParamChange={noop}
        onResetToDefault={noop}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByRole('group', { name: '추천 프리셋' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /고급 설정/ })).not.toBeInTheDocument()
  })
})

describe('Recommend - minervini mode (US-10)', () => {
  it('renders the trend template 8-checklist and the score for each card', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="minervini"
        minerviniResult={makeMinerviniResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    const checklist = screen.getByLabelText('트렌드 템플릿 체크리스트')
    expect(within(checklist).getByText('T1✓')).toBeInTheDocument()
    expect(within(checklist).getByText('T7✗')).toBeInTheDocument()
    expect(screen.getByText('78.1점')).toBeInTheDocument()
  })

  it('shows the relaxation-fallback banner with the 7/8 relaxed threshold', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="minervini"
        minerviniResult={makeMinerviniResult({ relaxationApplied: true })}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/조건 완화 적용됨\(7\/8\)/)).toBeInTheDocument()
  })

  it('shows the cash-is-the-default banner when insufficientSignal is true', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="minervini"
        minerviniResult={makeMinerviniResult({ list: [], insufficientSignal: true })}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/미너비니 방법론에서는 조건 미충족 시 현금 보유가 원칙입니다/)).toBeInTheDocument()
  })

  it('shows the v9-backtest design-value disclaimer', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="minervini"
        minerviniResult={makeMinerviniResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/배점·기준값은 v9 백테스트로 조정 예정인 설계값입니다/)).toBeInTheDocument()
  })
})

// --- v8 US-11: 펀더멘털 배지 + Fail 하단 섹션 ---

function makeFundamentalsMap() {
  return new Map([
    ['PASS_T', { ticker: 'PASS_T', epsGrowthQoQ_yoy: 31, epsAccelerating: true, revenueGrowthQoQ_yoy: 25, marginImproving: true, roe: 0.22, quarters: [], missing: [] }],
    ['PARTIAL_T', { ticker: 'PARTIAL_T', epsGrowthQoQ_yoy: 31, epsAccelerating: true, revenueGrowthQoQ_yoy: 12, marginImproving: false, roe: 0.05, quarters: [], missing: [] }],
    ['FAIL_T', { ticker: 'FAIL_T', epsGrowthQoQ_yoy: 5, epsAccelerating: false, revenueGrowthQoQ_yoy: 5, marginImproving: false, roe: 0.05, quarters: [], missing: [] }],
    ['INSUFF_T', { ticker: 'INSUFF_T', epsGrowthQoQ_yoy: null, epsAccelerating: null, revenueGrowthQoQ_yoy: null, marginImproving: null, roe: 0.22, quarters: [], missing: ['F1', 'F3'] }],
  ])
}

function makeFourTickerRecommendation() {
  return {
    list: [
      { ticker: 'PASS_T', name: 'Pass Co', score: 80.0, reasons: 'RSI 65', signalPassed: true },
      { ticker: 'PARTIAL_T', name: 'Partial Co', score: 70.0, reasons: 'RSI 60', signalPassed: true },
      { ticker: 'FAIL_T', name: 'Fail Co', score: 60.0, reasons: 'RSI 55', signalPassed: true },
      { ticker: 'INSUFF_T', name: 'Insuff Co', score: 50.0, reasons: 'RSI 50', signalPassed: true },
    ],
    relaxationApplied: false,
    insufficientSignal: false,
  }
}

describe('Recommend - fundamental hurdle badges (US-11)', () => {
  it('shows the Pass/Partial/insufficientFundamentals badges inline for their respective tickers', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeFourTickerRecommendation()}
        fundamentalsMap={makeFundamentalsMap()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(within(screen.getByText('PASS_T').closest('.border')).getByText(/펀더멘털 Pass/)).toBeInTheDocument()
    expect(within(screen.getByText('PARTIAL_T').closest('.border')).getByText(/펀더멘털 Partial/)).toBeInTheDocument()
    expect(within(screen.getByText('INSUFF_T').closest('.border')).getByText(/펀더멘털 판정불가/)).toBeInTheDocument()
  })

  it('separates the Fail ticker out of the main list into the "펀더멘털 미달" section (not hidden, shown with cause)', async () => {
    const user = userEvent.setup()
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeFourTickerRecommendation()}
        fundamentalsMap={makeFundamentalsMap()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    // FAIL_T is not rendered as a normal card
    expect(screen.queryByText('FAIL_T')).not.toBeInTheDocument()

    // it appears, with its cause, inside the collapsed-by-default fail section once expanded
    const failSection = screen.getByRole('button', { name: /펀더멘털 미달/ })
    expect(failSection).toHaveAttribute('aria-expanded', 'false')
    await user.click(failSection)
    expect(screen.getByText('FAIL_T')).toBeInTheDocument()
    expect(screen.getByText(/EPS \+5% ✗/)).toBeInTheDocument()
  })

  it('renders no badges and no fail section when fundamentalsMap is not passed (graceful degradation, US-10 parity)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeFourTickerRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByText(/펀더멘털/)).not.toBeInTheDocument()
    // all four tickers render normally, including the one that would otherwise Fail
    expect(screen.getByText('PASS_T')).toBeInTheDocument()
    expect(screen.getByText('FAIL_T')).toBeInTheDocument()
    expect(screen.getByText('INSUFF_T')).toBeInTheDocument()
  })
})

// --- v8 US-12: 리서치 점검 배지 + 숨기기 토글 ---

function makeTwoTickerRecommendation() {
  return {
    list: [
      { ticker: 'OK_T', name: 'OK Co', score: 80.0, reasons: 'RSI 65', signalPassed: true },
      { ticker: 'FLAG_T', name: 'Flag Co', score: 70.0, reasons: 'RSI 60', signalPassed: true },
    ],
    relaxationApplied: false,
    insufficientSignal: false,
  }
}

function makeResearchMapWithFlags() {
  return new Map([
    ['OK_T', { ticker: 'OK_T', sentiment: 'positive', summary: '요약.', catalysts: [], risks: [], sources: [], origin: 'recommended', riskFlags: [], stale: false }],
    [
      'FLAG_T',
      {
        ticker: 'FLAG_T',
        sentiment: 'neutral',
        summary: '요약.',
        catalysts: [],
        risks: [],
        sources: [],
        origin: 'recommended',
        riskFlags: [{ type: 'litigation', description: '소송 진행 중' }],
        stale: false,
      },
    ],
  ])
}

describe('Recommend - research check badges (US-12)', () => {
  it('shows the 3 badge states: ✓ for a clean ticker, ⚠ for a flagged ticker, and "미실시" for an unresearched one', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeTwoTickerRecommendation()}
        researchMap={makeResearchMapWithFlags()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(within(screen.getByText('OK_T').closest('.border')).getByText('리서치 점검 ✓')).toBeInTheDocument()
    expect(within(screen.getByText('FLAG_T').closest('.border')).getByText('⚠ 리스크 플래그 1건')).toBeInTheDocument()
  })

  it('shows "리서치 점검 ✓" for a v1-style research entry normalized to riskFlags:[] (researchLoader 하위 호환)', () => {
    const researchMap = new Map([['OK_T', { ticker: 'OK_T', sentiment: 'positive', riskFlags: [], stale: false }]])
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        researchMap={researchMap}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(within(screen.getByText('AXON').closest('.border')).getByText('리서치 미실시')).toBeInTheDocument()
  })

  it('shows no badges when researchMap is not passed (research.json 부재, graceful degradation)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeTwoTickerRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getAllByText('리서치 미실시').length).toBe(2)
    expect(screen.queryByText('리서치 점검 ✓')).not.toBeInTheDocument()
    expect(screen.queryByText(/⚠ 리스크 플래그/)).not.toBeInTheDocument()
  })
})

describe('Recommend - hide risk-flagged toggle (US-12)', () => {
  it('defaults to unchecked (숨기기 기본 꺼짐) and shows every ticker, including flagged ones', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeTwoTickerRecommendation()}
        researchMap={makeResearchMapWithFlags()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByRole('checkbox', { name: '리스크 플래그 종목 숨기기' })).not.toBeChecked()
    expect(screen.getByText('OK_T')).toBeInTheDocument()
    expect(screen.getByText('FLAG_T')).toBeInTheDocument()
  })

  it('calls onToggleHideRiskFlagged when the toggle is clicked', async () => {
    const user = userEvent.setup()
    let calls = 0
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeTwoTickerRecommendation()}
        researchMap={makeResearchMapWithFlags()}
        onToggleHideRiskFlagged={() => (calls += 1)}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    await user.click(screen.getByRole('checkbox', { name: '리스크 플래그 종목 숨기기' }))
    expect(calls).toBe(1)
  })

  it('hides only the flagged ticker (not an auto-disqualification, no separate section) when hideRiskFlagged is true', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeTwoTickerRecommendation()}
        researchMap={makeResearchMapWithFlags()}
        hideRiskFlagged={true}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByRole('checkbox', { name: '리스크 플래그 종목 숨기기' })).toBeChecked()
    expect(screen.getByText('OK_T')).toBeInTheDocument()
    expect(screen.queryByText('FLAG_T')).not.toBeInTheDocument()
    // hidden, not relocated — no "펀더멘털 미달"-style bottom section exists for this
    expect(screen.queryByText(/리스크 플래그 종목 목록/)).not.toBeInTheDocument()
  })
})

describe('Recommend - consensus mode (US-10)', () => {
  it('shows the ★★ grade with both mode scores for a dual-pass ticker', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="consensus"
        consensusResult={makeConsensusResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    const ftntCard = screen.getByText('FTNT').closest('.border')
    expect(within(ftntCard).getByText('★★')).toBeInTheDocument()
    expect(within(ftntCard).getByText(/추세추종 43\.5점/)).toBeInTheDocument()
    expect(within(ftntCard).getByText(/미너비니 78\.1점/)).toBeInTheDocument()
  })

  it('shows the ★ grade with a single mode label for a single-pass ticker', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="consensus"
        consensusResult={makeConsensusResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    const aaplCard = screen.getByText('AAPL').closest('.border')
    expect(within(aaplCard).getByText('★')).toBeInTheDocument()
    expect(within(aaplCard).getByText(/추세추종 34\.0점/)).toBeInTheDocument()
  })

  it('shows the v9-backtest design-value disclaimer', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        recommendMode="consensus"
        consensusResult={makeConsensusResult()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(/배점·기준값은 v9 백테스트로 조정 예정인 설계값입니다/)).toBeInTheDocument()
  })
})

describe('Recommend - regime gate banner (v11 US-11 승인 기준 3: 안내 1줄은 하락 국면에서만 노출)', () => {
  const BANNER_TEXT = '하락 국면에서는 완화 신호가 제외됩니다 (v11 · 백테스트 근거)'

  it('recommendation.regimeGated가 true면 배너가 렌더링된다', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={{ ...makeRecommendation(), regimeGated: true }}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()
  })

  it('regimeGated가 false/미지정이면 배너가 렌더링되지 않는다', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
  })

  it('minerviniResult.regimeGated만 true여도 배너가 렌더링된다(추세추종·미너비니 공통 적용)', () => {
    render(
      <Recommend
        generatedAt="2026-07-08"
        recommendation={makeRecommendation()}
        minerviniResult={{ list: [], relaxationApplied: true, insufficientSignal: false, regimeGated: true }}
        selectedTickers={[]}
        onToggleSelect={noop}
        onGoToSimulation={noop}
      />
    )
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()
  })
})
