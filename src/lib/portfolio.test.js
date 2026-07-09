import { describe, it, expect } from 'vitest'
import { buildPortfolio, DEFAULT_WEIGHT } from './portfolio.js'

function t(ticker, returnPct, volatility) {
  return { ticker, simulation: { returnPct }, indicators: { volatility } }
}

describe('buildPortfolio', () => {
  it('computes equal-weight average when weights are omitted (all default to DEFAULT_WEIGHT)', () => {
    const selected = [t('A', 10, 0.02), t('B', 20, 0.04), t('C', 30, 0.06)]
    const p = buildPortfolio(selected)
    expect(p.weightedReturnPct).toBeCloseTo(20)
    expect(p.weightedVolatility).toBeCloseTo(0.04)
    expect(p.tickers).toEqual(['A', 'B', 'C'])
    expect(p.weightsPct.A).toBeCloseTo(100 / 3)
  })

  it('normalizes arbitrary relative weights that do not sum to 100', () => {
    const selected = [t('A', 10, 0.02), t('B', 30, 0.06)]
    const p = buildPortfolio(selected, { A: 25, B: 75 })
    expect(p.weightsPct.A).toBeCloseTo(25)
    expect(p.weightsPct.B).toBeCloseTo(75)
    expect(p.weightedReturnPct).toBeCloseTo(0.25 * 10 + 0.75 * 30)
  })

  it('builds a portfolio of any size (no 3-5 restriction)', () => {
    expect(buildPortfolio([t('A', 1, 0.01), t('B', 2, 0.02)])).not.toBeNull()
    const six = Array.from({ length: 6 }, (_, i) => t(`T${i}`, 1, 0.01))
    expect(buildPortfolio(six)).not.toBeNull()
    const one = [t('A', 5, 0.01)]
    expect(buildPortfolio(one).weightedReturnPct).toBeCloseTo(5)
  })

  it('returns null for an empty selection or when all weights are zero', () => {
    expect(buildPortfolio([])).toBeNull()
    expect(buildPortfolio([t('A', 1, 0.01), t('B', 2, 0.02)], { A: 0, B: 0 })).toBeNull()
  })

  it('treats a missing weight entry as DEFAULT_WEIGHT', () => {
    const selected = [t('A', 10, 0.02), t('B', 20, 0.04)]
    const p = buildPortfolio(selected, { A: DEFAULT_WEIGHT })
    expect(p.weightsPct.A).toBeCloseTo(50)
    expect(p.weightsPct.B).toBeCloseTo(50)
  })
})
