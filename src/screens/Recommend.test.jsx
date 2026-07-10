// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
