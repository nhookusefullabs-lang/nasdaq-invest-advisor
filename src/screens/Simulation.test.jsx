// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Simulation from './Simulation.jsx'

afterEach(() => cleanup())

const chartPoint = (date, close) => ({ date, close })

function makeTickerData(overrides = {}) {
  return {
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    dataSufficient: true,
    simulation: {
      anchorDate: '2026-04-01',
      anchorClose: 100,
      currentDate: '2026-07-08',
      currentClose: 110,
      returnPct: 10,
      periodHigh: 120,
      periodLow: 95,
    },
    chart: {
      oneMonth: [chartPoint('2026-06-08', 105), chartPoint('2026-07-08', 110)],
      threeMonth: [chartPoint('2026-04-01', 100), chartPoint('2026-07-08', 110)],
      sixMonth: [chartPoint('2026-01-08', 90), chartPoint('2026-07-08', 110)],
    },
    ...overrides,
  }
}

const noop = () => {}

describe('Simulation - research integration (US-7)', () => {
  it('shows the "관심 종목 리서치" badge for a userRequested research item', () => {
    const researchMap = new Map([
      [
        'NVDA',
        {
          ticker: 'NVDA',
          sentiment: 'neutral',
          summary: '관심 종목으로 직접 추가되어 리서치되었다.',
          catalysts: [],
          risks: [],
          sources: [],
          origin: 'userRequested',
          researchedAt: '2026-07-11',
        },
      ],
    ])
    render(
      <Simulation
        generatedAt="2026-07-08"
        allTickerData={[makeTickerData()]}
        researchMap={researchMap}
        selectedTickers={['NVDA']}
        selectedTickerData={[makeTickerData()]}
        onToggleTicker={noop}
        onGoToPortfolio={noop}
      />
    )
    expect(screen.getByText('AI 리서치')).toBeInTheDocument()
    expect(screen.getByText('관심 종목 리서치')).toBeInTheDocument()
  })

  it('renders identically to v5 (no research section) when the ticker has no research entry', () => {
    render(
      <Simulation
        generatedAt="2026-07-08"
        allTickerData={[makeTickerData()]}
        researchMap={new Map()}
        selectedTickers={['NVDA']}
        selectedTickerData={[makeTickerData()]}
        onToggleTicker={noop}
        onGoToPortfolio={noop}
      />
    )
    expect(screen.queryByText('AI 리서치')).not.toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()
  })

  it('does not crash when researchMap is undefined', () => {
    render(
      <Simulation
        generatedAt="2026-07-08"
        allTickerData={[makeTickerData()]}
        selectedTickers={['NVDA']}
        selectedTickerData={[makeTickerData()]}
        onToggleTicker={noop}
        onGoToPortfolio={noop}
      />
    )
    expect(screen.queryByText('AI 리서치')).not.toBeInTheDocument()
  })
})
