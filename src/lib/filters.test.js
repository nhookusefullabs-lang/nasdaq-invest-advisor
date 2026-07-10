import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  DEFAULT_FILTER_STATE,
  passesBollinger,
  passesWeek52,
  countWeek52Excluded,
  passesStochastic,
  passesAtrPercentile,
  passesObv,
} from './filters.js'

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

// --- v7 신규 필터 판정 함수 (PRD_Nasdaq7 §3 Must 1~5, US-5) — 필터×옵션 10케이스 ---

describe('passesBollinger', () => {
  const bands = { middle: 100, upper: 110, lower: 90 }

  it('lowerProximity: passes when close is at or below lower band × 1.02, fails otherwise', () => {
    expect(passesBollinger(91, bands, 'lowerProximity')).toBe(true) // 91 <= 90*1.02=91.8
    expect(passesBollinger(95, bands, 'lowerProximity')).toBe(false)
  })

  it('upperBreakout: passes when close is at or above the upper band, fails otherwise', () => {
    expect(passesBollinger(110, bands, 'upperBreakout')).toBe(true)
    expect(passesBollinger(105, bands, 'upperBreakout')).toBe(false)
  })

  it('fails safely when bands is null (insufficient data)', () => {
    expect(passesBollinger(100, null, 'lowerProximity')).toBe(false)
  })
})

describe('passesWeek52', () => {
  const week52 = { high: 200, low: 100 }

  it('nearHigh: passes within 5% of the 52-week high, fails otherwise', () => {
    expect(passesWeek52(190, week52, 'nearHigh')).toBe(true) // 200*0.95=190
    expect(passesWeek52(150, week52, 'nearHigh')).toBe(false)
  })

  it('nearLow: passes within 5% of the 52-week low, fails otherwise', () => {
    expect(passesWeek52(105, week52, 'nearLow')).toBe(true) // 100*1.05=105
    expect(passesWeek52(150, week52, 'nearLow')).toBe(false)
  })

  it('fails safely when week52 is null (fewer than 252 trading days)', () => {
    expect(passesWeek52(150, null, 'nearHigh')).toBe(false)
  })
})

describe('countWeek52Excluded', () => {
  it('counts null entries (252일 미만 데이터로 계산 불가한 종목)', () => {
    expect(countWeek52Excluded([{ high: 1, low: 1 }, null, null, { high: 2, low: 2 }])).toBe(2)
  })

  it('returns 0 when no tickers are excluded', () => {
    expect(countWeek52Excluded([{ high: 1, low: 1 }])).toBe(0)
  })
})

describe('passesStochastic', () => {
  it('oversold: passes at or below %K=20, fails otherwise', () => {
    expect(passesStochastic({ slowK: 15, slowD: 15 }, 'oversold')).toBe(true)
    expect(passesStochastic({ slowK: 50, slowD: 50 }, 'oversold')).toBe(false)
  })

  it('overbought: passes at or above %K=80, fails otherwise', () => {
    expect(passesStochastic({ slowK: 85, slowD: 85 }, 'overbought')).toBe(true)
    expect(passesStochastic({ slowK: 50, slowD: 50 }, 'overbought')).toBe(false)
  })

  it('fails safely when slowK is null (denominator-zero day)', () => {
    expect(passesStochastic({ slowK: null, slowD: null }, 'oversold')).toBe(false)
  })
})

describe('passesAtrPercentile', () => {
  // population 1..10 -> percentileRank(3) = 30, percentileRank(7) = 70 (exact boundary)
  const population = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('low: passes exactly at the 30th percentile boundary, fails just above it', () => {
    expect(passesAtrPercentile(3, population, 'low')).toBe(true) // rank exactly 30
    expect(passesAtrPercentile(4, population, 'low')).toBe(false) // rank 40
  })

  it('high: passes exactly at the 70th percentile boundary, fails just below it', () => {
    expect(passesAtrPercentile(7, population, 'high')).toBe(true) // rank exactly 70
    expect(passesAtrPercentile(6, population, 'high')).toBe(false) // rank 60
  })

  it('fails safely when atrPercentValue is null or the universe population is empty', () => {
    expect(passesAtrPercentile(null, population, 'low')).toBe(false)
    expect(passesAtrPercentile(5, [], 'low')).toBe(false)
  })
})

describe('passesObv', () => {
  const risingObv = Array.from({ length: 19 }, () => 0).concat([1000]) // SMA20 pulled down by 19 zeros, last value spikes above it
  const fallingObv = Array.from({ length: 19 }, () => 0).concat([-1000])

  it('rising: passes when the latest OBV is above its SMA20, fails otherwise', () => {
    expect(passesObv(risingObv, 'rising')).toBe(true)
    expect(passesObv(fallingObv, 'rising')).toBe(false)
  })

  it('falling: passes when the latest OBV is below its SMA20, fails otherwise', () => {
    expect(passesObv(fallingObv, 'falling')).toBe(true)
    expect(passesObv(risingObv, 'falling')).toBe(false)
  })

  it('fails safely when there are fewer than 20 OBV points', () => {
    expect(passesObv([1, 2, 3], 'rising')).toBe(false)
  })
})
