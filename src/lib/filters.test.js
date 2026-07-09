import { describe, it, expect } from 'vitest'
import { applyFilters, DEFAULT_FILTER_STATE } from './filters.js'

function t(ticker, name, overrides = {}) {
  return {
    ticker,
    name,
    dataSufficient: true,
    isLeadingSector: false,
    indicators: { disparity: 0, volTrend: 0, rsi14: 50 },
    ...overrides,
  }
}

describe('applyFilters', () => {
  it('default state (all off) shows every data-sufficient ticker', () => {
    const tickers = [t('AAPL', 'Apple'), t('MSFT', 'Microsoft')]
    expect(applyFilters(tickers, DEFAULT_FILTER_STATE)).toHaveLength(2)
  })

  it('excludes data-insufficient tickers regardless of filters', () => {
    const tickers = [t('AAPL', 'Apple', { dataSufficient: false })]
    expect(applyFilters(tickers, DEFAULT_FILTER_STATE)).toHaveLength(0)
  })

  it('filters by ticker/name search query', () => {
    const tickers = [t('AAPL', 'Apple Inc.'), t('MSFT', 'Microsoft Corp')]
    expect(applyFilters(tickers, DEFAULT_FILTER_STATE, 'msft')).toHaveLength(1)
    expect(applyFilters(tickers, DEFAULT_FILTER_STATE, 'apple')).toHaveLength(1)
  })

  it('filters by disparity threshold', () => {
    const tickers = [
      t('A', 'A', { indicators: { disparity: 10, volTrend: 0, rsi14: 50 } }),
      t('B', 'B', { indicators: { disparity: -5, volTrend: 0, rsi14: 50 } }),
    ]
    const result = applyFilters(tickers, { ...DEFAULT_FILTER_STATE, disparityMin: 5 })
    expect(result.map((r) => r.ticker)).toEqual(['A'])
  })

  it('filters leading sector only', () => {
    const tickers = [
      t('A', 'A', { isLeadingSector: true }),
      t('B', 'B', { isLeadingSector: false }),
    ]
    const result = applyFilters(tickers, { ...DEFAULT_FILTER_STATE, leadingSectorOnly: true })
    expect(result.map((r) => r.ticker)).toEqual(['A'])
  })

  it('filters overheated/oversold RSI states', () => {
    const tickers = [
      t('OVER', 'Over', { indicators: { disparity: 0, volTrend: 0, rsi14: 75 } }),
      t('OVERSOLD', 'Oversold', { indicators: { disparity: 0, volTrend: 0, rsi14: 25 } }),
      t('MID', 'Mid', { indicators: { disparity: 0, volTrend: 0, rsi14: 50 } }),
    ]
    expect(
      applyFilters(tickers, { ...DEFAULT_FILTER_STATE, rsiState: 'overheated' }).map((r) => r.ticker)
    ).toEqual(['OVER'])
    expect(
      applyFilters(tickers, { ...DEFAULT_FILTER_STATE, rsiState: 'oversold' }).map((r) => r.ticker)
    ).toEqual(['OVERSOLD'])
  })
})
