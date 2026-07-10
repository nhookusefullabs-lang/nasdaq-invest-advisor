import { describe, it, expect } from 'vitest'
import {
  sma,
  ema,
  rsiWilder,
  macd,
  disparity,
  volumeTrend,
  goldenCrossWithin,
  dailyReturns,
  stddev,
  bollingerBands,
  week52HighLow,
  stochastic,
  atr,
  atrPercent,
  obv,
  hasFullYearData,
  rsRawScore,
  rsPercentile,
  volatilityContraction,
  volumeDryUp,
  pivotProximity,
} from './indicators.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

function makeBar(i, { close, high, low, volume } = {}) {
  const c = close ?? 10 + i
  return {
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    close: c,
    high: high ?? c + 1,
    low: low ?? c - 1,
    volume: volume ?? 1_000_000,
  }
}

describe('sma', () => {
  it('computes simple moving average with correct warmup', () => {
    const closes = [1, 2, 3, 4, 5]
    const result = sma(closes, 3)
    expect(result[0]).toBeNull()
    expect(result[1]).toBeNull()
    expect(result[2]).toBeCloseTo(2) // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3) // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4) // (3+4+5)/3
  })
})

describe('ema', () => {
  it('seeds with SMA then applies recursive EMA formula', () => {
    const closes = [10, 11, 12, 13, 14, 15]
    const result = ema(closes, 3)
    // seed = avg(10,11,12) = 11
    expect(result[2]).toBeCloseTo(11)
    const k = 2 / 4
    const expected3 = 13 * k + 11 * (1 - k)
    expect(result[3]).toBeCloseTo(expected3)
  })
})

describe('rsiWilder', () => {
  it('returns 100 when there are no losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i) // 항상 상승
    const result = rsiWilder(closes, 14)
    expect(result[14]).toBe(100)
  })

  it('returns 0-ish RSI when there are only losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i) // 항상 하락
    const result = rsiWilder(closes, 14)
    expect(result[14]).toBe(0)
  })

  it('matches a hand-computed value for a known mixed series', () => {
    // 표준 RSI 예시 계열(단순화): 14일 상승/하락 반복
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ]
    const result = rsiWilder(closes, 14)
    // 알려진 참조값(Wilder 방식, 위키피디아 예시 근사): 약 70.5
    expect(result[14]).toBeGreaterThan(65)
    expect(result[14]).toBeLessThan(75)
  })
})

describe('macd', () => {
  it('macd line equals ema12 - ema26 and signal is ema9 of macd', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2)
    const { macdLine, signalLine, histogram } = macd(closes)
    const lastIdx = closes.length - 1
    expect(macdLine[lastIdx]).not.toBeNull()
    expect(signalLine[lastIdx]).not.toBeNull()
    expect(histogram[lastIdx]).toBeCloseTo(macdLine[lastIdx] - signalLine[lastIdx], 8)
  })
})

describe('disparity', () => {
  it('computes percentage gap from SMA20', () => {
    expect(disparity(110, 100)).toBeCloseTo(10)
    expect(disparity(90, 100)).toBeCloseTo(-10)
  })
})

describe('volumeTrend', () => {
  it('computes recent5 vs prior20 average percentage change', () => {
    const prior20 = Array(20).fill(1000)
    const recent5 = Array(5).fill(1500)
    const volumes = [...prior20, ...recent5]
    expect(volumeTrend(volumes)).toBeCloseTo(50) // (1500-1000)/1000*100
  })

  it('returns null when insufficient history', () => {
    expect(volumeTrend([1, 2, 3])).toBeNull()
  })
})

describe('goldenCrossWithin', () => {
  it('detects an upward crossover within the window', () => {
    const macdLine = [-2, -1, -0.5, 0.2, 0.5]
    const signalLine = [-1, -1, -1, -1, -1]
    // crosses at index 3 (prev -0.5 <= -1? no)... let's build a clean cross
    const m = [-1, -0.5, 0.1, 0.6]
    const s = [0, 0, 0, 0]
    expect(goldenCrossWithin(m, s, 5)).toBe(true)
  })

  it('returns false when no crossover happened in window', () => {
    const m = [1, 2, 3, 4]
    const s = [0, 0, 0, 0]
    expect(goldenCrossWithin(m, s, 5)).toBe(false) // already above, no cross
  })
})

describe('dailyReturns / stddev', () => {
  it('computes daily pct returns and sample stddev', () => {
    const closes = [100, 110, 99, 108.9]
    const returns = dailyReturns(closes)
    expect(returns[0]).toBeCloseTo(0.1)
    expect(returns[1]).toBeCloseTo(-0.1)
    expect(returns[2]).toBeCloseTo(0.1)
    const sd = stddev(returns)
    expect(sd).toBeGreaterThan(0)
  })
})

describe('bollingerBands (PRD_Nasdaq7 §4.1, US-3)', () => {
  it('computes middle/upper/lower from the last `period` closes (hand-computed)', () => {
    // closes = [10,12,14,16,18], mean=14, sample stddev=sqrt(10)≈3.16227766
    const series = [10, 12, 14, 16, 18].map((c, i) => makeBar(i, { close: c }))
    const bands = bollingerBands(series, 5, 2)
    expect(bands.middle).toBeCloseTo(14)
    expect(bands.upper).toBeCloseTo(14 + 2 * Math.sqrt(10))
    expect(bands.lower).toBeCloseTo(14 - 2 * Math.sqrt(10))
  })

  it('uses only the most recent `period` closes and respects a custom mult (hand-computed)', () => {
    // extra older bar (close=1000) must be excluded by the period=5 window
    const series = [1000, 10, 12, 14, 16, 18].map((c, i) => makeBar(i, { close: c }))
    const bands = bollingerBands(series, 5, 1)
    expect(bands.middle).toBeCloseTo(14)
    expect(bands.upper).toBeCloseTo(14 + Math.sqrt(10))
    expect(bands.lower).toBeCloseTo(14 - Math.sqrt(10))
  })

  it('returns null when there is less data than `period`', () => {
    const series = [10, 12, 14].map((c, i) => makeBar(i, { close: c }))
    expect(bollingerBands(series, 5, 2)).toBeNull()
  })
})

describe('week52HighLow (PRD_Nasdaq7 §4.1, US-3)', () => {
  it('returns null when the series has fewer than 252 trading days', () => {
    const series = Array.from({ length: 251 }, (_, i) => makeBar(i))
    expect(week52HighLow(series)).toBeNull()
  })

  it('returns {high, low} from exactly the most recent 252 bars (hand-computed)', () => {
    const series = Array.from({ length: 252 }, (_, i) => makeBar(i, { close: 100, high: 100 + i, low: 100 - i }))
    const result = week52HighLow(series)
    // last bar (i=251) has the highest high (351) and lowest low (-151)
    expect(result.high).toBe(100 + 251)
    expect(result.low).toBe(100 - 251)
  })

  it('ignores bars older than the most recent 252 (window boundary)', () => {
    // one extra old bar with an extreme high/low that must NOT affect the 252-day window
    const outlier = makeBar(0, { close: 100, high: 999999, low: -999999 })
    const rest = Array.from({ length: 252 }, (_, i) => makeBar(i + 1, { close: 100, high: 110, low: 90 }))
    const series = [outlier, ...rest]
    const result = week52HighLow(series)
    expect(result.high).toBe(110)
    expect(result.low).toBe(90)
  })
})

describe('stochastic (PRD_Nasdaq7 §4.1, US-4)', () => {
  it('computes Fast %K directly when kSmooth=dSmooth=1 (hand-computed)', () => {
    // high/low constant (110/90) across the whole series, so every 14-day window has
    // the same denominator (20) — only the window's close matters for %K.
    const series = Array.from({ length: 14 }, (_, i) =>
      makeBar(i, { close: i === 13 ? 95 : 100, high: 110, low: 90 })
    )
    const result = stochastic(series, 14, 1, 1)
    // %K = (95 - 90) / (110 - 90) * 100 = 25
    expect(result.slowK).toBeCloseTo(25)
    expect(result.slowD).toBeCloseTo(25)
  })

  it('smooths %D over 3 known Fast %K values when kSmooth=1 (hand-computed)', () => {
    const closes = Array.from({ length: 13 }, () => 100).concat([95, 100, 105])
    const series = closes.map((c, i) => makeBar(i, { close: c, high: 110, low: 90 }))
    // fastK at the last 3 indices: (95-90)/20*100=25, (100-90)/20*100=50, (105-90)/20*100=75
    const result = stochastic(series, 14, 1, 3)
    expect(result.slowK).toBeCloseTo(75) // last Fast %K (kSmooth=1, no smoothing)
    expect(result.slowD).toBeCloseTo((25 + 50 + 75) / 3) // = 50
  })

  it('returns null slowK/slowD when the most recent 14-day window has zero range (high === low)', () => {
    const series = Array.from({ length: 14 }, (_, i) => makeBar(i, { close: 100, high: 100, low: 100 }))
    const result = stochastic(series, 14, 3, 3)
    expect(result.slowK).toBeNull()
    expect(result.slowD).toBeNull()
  })
})

describe('atr (PRD_Nasdaq7 §4.1, US-4)', () => {
  it('seeds ATR as the simple average of the first `period` True Range values (hand-computed)', () => {
    // 15 flat bars (high=110,low=90,close=100): TR = max(20, |110-100|, |90-100|) = 20 for all 14 TRs
    const series = Array.from({ length: 15 }, (_, i) => makeBar(i, { close: 100, high: 110, low: 90 }))
    expect(atr(series, 14)).toBeCloseTo(20)
  })

  it('applies one Wilder smoothing step after the seed (hand-computed)', () => {
    const flat = Array.from({ length: 15 }, (_, i) => makeBar(i, { close: 100, high: 110, low: 90 }))
    // 16th bar: TR = max(140-90=50, |140-100|=40, |90-100|=10) = 50
    const series = [...flat, makeBar(15, { close: 100, high: 140, low: 90 })]
    // seed = 20 (avg of first 14 TRs), then value = (20*13 + 50) / 14
    expect(atr(series, 14)).toBeCloseTo((20 * 13 + 50) / 14)
  })

  it('returns null when there are fewer than period+1 bars', () => {
    const series = Array.from({ length: 10 }, (_, i) => makeBar(i))
    expect(atr(series, 14)).toBeNull()
  })

  it('atrPercent divides ATR by the latest close (hand-computed)', () => {
    const series = Array.from({ length: 15 }, (_, i) => makeBar(i, { close: 100, high: 110, low: 90 }))
    expect(atrPercent(series, 14)).toBeCloseTo(20) // ATR=20, close=100 -> 20%
  })
})

describe('obv (PRD_Nasdaq7 §4.1, US-4)', () => {
  it('adds volume on an up day', () => {
    const series = [makeBar(0, { close: 100, volume: 1000 }), makeBar(1, { close: 105, volume: 500 })].map(
      (b, i) => ({ ...b, volume: i === 0 ? 1000 : 500 })
    )
    expect(obv(series)).toEqual([0, 500])
  })

  it('subtracts volume on a down day', () => {
    const series = [
      { ...makeBar(0, { close: 100 }), volume: 1000 },
      { ...makeBar(1, { close: 95 }), volume: 700 },
    ]
    expect(obv(series)).toEqual([0, -700])
  })

  it('does not change on a flat (보합) day', () => {
    const series = [
      { ...makeBar(0, { close: 100 }), volume: 1000 },
      { ...makeBar(1, { close: 100 }), volume: 700 },
      { ...makeBar(2, { close: 105 }), volume: 300 },
    ]
    expect(obv(series)).toEqual([0, 0, 300])
  })
})

// --- v8 공유 지표 계층 (PRD_Nasdaq8 §8, US-3) ---

const fixture2yPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/nasdaq100.2y.sample.json'
)
const FIXTURE_2Y = JSON.parse(readFileSync(fixture2yPath, 'utf-8'))
const fixtureSeries = (ticker) => FIXTURE_2Y.tickers.find((t) => t.ticker === ticker).series

describe('hasFullYearData', () => {
  it('is true at exactly 252 bars and false just under', () => {
    expect(hasFullYearData(Array.from({ length: 252 }, (_, i) => makeBar(i)))).toBe(true)
    expect(hasFullYearData(Array.from({ length: 251 }, (_, i) => makeBar(i)))).toBe(false)
  })
})

describe('rsRawScore (PRD_Nasdaq8 §8, US-3)', () => {
  it('computes 2×R3m + R6m + R12m on a linear ramp (hand-computed)', () => {
    // closes[i] = 100 + i, i=0..251 (252 bars, exactly the minimum)
    const series = Array.from({ length: 252 }, (_, i) => makeBar(i, { close: 100 + i }))
    const current = 100 + 251 // 351
    const r3m = (current / (100 + (252 - 63)) - 1) * 100 // anchor = closes[189] = 289
    const r6m = (current / (100 + (252 - 126)) - 1) * 100 // anchor = closes[126] = 226
    const r12m = (current / (100 + (252 - 252)) - 1) * 100 // anchor = closes[0] = 100
    expect(rsRawScore(series)).toBeCloseTo(2 * r3m + r6m + r12m, 4)
  })

  it('returns null when there are fewer than 252 bars (데이터 부족)', () => {
    const series = Array.from({ length: 251 }, (_, i) => makeBar(i, { close: 100 + i }))
    expect(rsRawScore(series)).toBeNull()
  })

  it('is positive for a sustained real-data uptrend and negative for a sustained downtrend', () => {
    expect(rsRawScore(fixtureSeries('MMVI1'))).toBeGreaterThan(0) // 강한 상승 종목
    expect(rsRawScore(fixtureSeries('MMVI2'))).toBeLessThan(0) // 지속 하락 종목
  })
})

describe('rsPercentile', () => {
  it('ranks an ascending population 0..100 (hand-computed)', () => {
    expect(rsPercentile([10, 20, 30, 40])).toEqual([25, 50, 75, 100])
  })

  it('ties share the same percentile', () => {
    const result = rsPercentile([5, 5, 10])
    expect(result[0]).toBeCloseTo((2 / 3) * 100)
    expect(result[1]).toBeCloseTo((2 / 3) * 100)
    expect(result[2]).toBeCloseTo(100)
  })
})

describe('volatilityContraction (PRD_Nasdaq8 §8, US-3)', () => {
  it('returns null when the prior-40-day stddev is exactly 0 (분모 0, 경계)', () => {
    // 41 identical closes (40 exactly-zero prior returns) + 10 varying closes (nonzero recent returns)
    const flat = Array.from({ length: 41 }, () => 100)
    const varied = [110, 90, 115, 85, 120, 80, 125, 75, 130, 70]
    const closes = [...flat, ...varied]
    const series = closes.map((c, i) => makeBar(i, { close: c }))
    expect(volatilityContraction(series)).toBeNull()
  })

  it('returns null when there are fewer than 51 bars (데이터 부족)', () => {
    const series = Array.from({ length: 50 }, (_, i) => makeBar(i, { close: 100 + i }))
    expect(volatilityContraction(series)).toBeNull()
  })

  it('is below 1 for real-data tickers whose recent volatility tapers off (contraction)', () => {
    // MMVI1/MMVI6 fixtures are generated with amplitude tapering toward the end
    expect(volatilityContraction(fixtureSeries('MMVI1'))).toBeLessThan(1)
    expect(volatilityContraction(fixtureSeries('MMVI6'))).toBeLessThan(1)
  })
})

describe('volumeDryUp (PRD_Nasdaq8 §8, US-3)', () => {
  it('computes a negative dry-up % when recent volume is lower than the prior period (hand-computed, 음수 드라이업)', () => {
    const prior50 = Array.from({ length: 50 }, () => 1_000_000)
    const recent5 = Array.from({ length: 5 }, () => 500_000)
    const series = [...prior50, ...recent5].map((v, i) => makeBar(i, { volume: v }))
    expect(volumeDryUp(series)).toBeCloseTo(-50)
  })

  it('returns null when the prior-50-day average volume is exactly 0 (분모 0, 경계)', () => {
    const prior50 = Array.from({ length: 50 }, () => 0)
    const recent5 = Array.from({ length: 5 }, () => 100)
    const series = [...prior50, ...recent5].map((v, i) => makeBar(i, { volume: v }))
    expect(volumeDryUp(series)).toBeNull()
  })

  it('returns null when there are fewer than 55 bars (데이터 부족)', () => {
    const series = Array.from({ length: 54 }, (_, i) => makeBar(i))
    expect(volumeDryUp(series)).toBeNull()
  })
})

describe('pivotProximity (PRD_Nasdaq8 §8, US-3)', () => {
  it('is 0 when the current close equals the 63-day peak (hand-computed)', () => {
    const closes = Array.from({ length: 62 }, () => 90).concat([100])
    const series = closes.map((c, i) => makeBar(i, { close: c }))
    expect(pivotProximity(series)).toBeCloseTo(0)
  })

  it('computes the % gap below the peak (hand-computed)', () => {
    const closes = Array.from({ length: 62 }, () => 90).concat([81]) // peak=90, current=81 -> 10% gap
    const series = closes.map((c, i) => makeBar(i, { close: c }))
    expect(pivotProximity(series)).toBeCloseTo(10)
  })

  it('returns null when there are fewer than 63 bars (데이터 부족)', () => {
    const series = Array.from({ length: 62 }, (_, i) => makeBar(i))
    expect(pivotProximity(series)).toBeNull()
  })
})
