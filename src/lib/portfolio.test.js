import { describe, it, expect } from 'vitest'
import { buildPortfolio } from './portfolio.js'

function t(ticker, returnPct, volatility) {
  return { ticker, simulation: { returnPct }, indicators: { volatility } }
}

describe('buildPortfolio', () => {
  it('computes equal-weight simple average return and average volatility', () => {
    const selected = [t('A', 10, 0.02), t('B', 20, 0.04), t('C', 30, 0.06)]
    const p = buildPortfolio(selected)
    expect(p.equalWeightReturnPct).toBeCloseTo(20)
    expect(p.avgIndividualVolatility).toBeCloseTo(0.04)
    expect(p.tickers).toEqual(['A', 'B', 'C'])
  })

  it('returns null when selection is outside 3-5 range', () => {
    expect(buildPortfolio([t('A', 1, 0.01), t('B', 2, 0.02)])).toBeNull() // 2개
    const six = Array.from({ length: 6 }, (_, i) => t(`T${i}`, 1, 0.01))
    expect(buildPortfolio(six)).toBeNull() // 6개
  })
})
