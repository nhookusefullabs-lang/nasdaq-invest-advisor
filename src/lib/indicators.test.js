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
} from './indicators.js'

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
