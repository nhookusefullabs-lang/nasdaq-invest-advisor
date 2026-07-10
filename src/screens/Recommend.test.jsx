// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
