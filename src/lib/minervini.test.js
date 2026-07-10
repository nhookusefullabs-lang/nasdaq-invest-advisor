import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluateTrendTemplate, runMinerviniStage1, TREND_TEMPLATE_CONDITION_CODES } from './minervini.js'

function makeBar(i, { close, high, low } = {}) {
  const c = close ?? 100
  return {
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    close: c,
    high: high ?? c + 1,
    low: low ?? c - 1,
    volume: 1_000_000,
  }
}

/** 252거래일 이상, 첫 바만 week52 고저를 넓게 벌려 두어(high=200,low=50) 마지막 바의
 * close/high/low가 window의 min/max를 흔들지 않게 만든 "제어된" 시리즈. */
function makeControlledSeries(n, lastBarOverrides = {}) {
  const bars = Array.from({ length: n }, (_, i) => makeBar(i, { close: 100 }))
  bars[0] = makeBar(0, { close: 100, high: 200, low: 50 })
  bars[n - 1] = makeBar(n - 1, { close: 100, ...lastBarOverrides })
  return bars
}

function makeMonotonicSeries(n, { start = 100, step = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => makeBar(i, { close: start + step * i }))
}

/** series 중 한 바의 high만 인위적으로 크게 올려 week52.high를 통제한다 — close 기반
 * SMA/RS 계산에는 영향이 없고(week52HighLow는 high/low만 씀), T7만 표적으로 실패시킬 수 있다. */
function withHighSpike(series, index, spikeHigh) {
  const copy = series.slice()
  copy[index] = { ...copy[index], high: spikeHigh }
  return copy
}

describe('evaluateTrendTemplate - insufficient data (US-4)', () => {
  it('returns insufficientData:true and no checks for fewer than 252 bars', () => {
    const series = Array.from({ length: 251 }, (_, i) => makeBar(i))
    const result = evaluateTrendTemplate(series, 80)
    expect(result.insufficientData).toBe(true)
    expect(result.checks).toBeNull()
    expect(result.allPassed).toBe(false)
  })
})

describe('evaluateTrendTemplate - T1/T2/T4/T5 (SMA ordering, US-4)', () => {
  it('T1/T2/T4/T5 are all true for a sustained uptrend (SMA50>SMA150>SMA200, close above all)', () => {
    const series = makeMonotonicSeries(260, { start: 100, step: 0.5 })
    const result = evaluateTrendTemplate(series, 80)
    expect(result.checks.T1).toBe(true)
    expect(result.checks.T2).toBe(true)
    expect(result.checks.T4).toBe(true)
    expect(result.checks.T5).toBe(true)
  })

  it('T1/T2/T4/T5 are all false for a sustained downtrend', () => {
    const series = makeMonotonicSeries(260, { start: 300, step: -0.5 })
    const result = evaluateTrendTemplate(series, 80)
    expect(result.checks.T1).toBe(false)
    expect(result.checks.T2).toBe(false)
    expect(result.checks.T4).toBe(false)
    expect(result.checks.T5).toBe(false)
  })
})

describe('evaluateTrendTemplate - T3 (22거래일 SMA200 비교, US-4)', () => {
  it('T3 is true when SMA200 has risen over the last 22 trading days (monotonic uptrend)', () => {
    const series = makeMonotonicSeries(260, { start: 100, step: 0.3 })
    expect(evaluateTrendTemplate(series, 80).checks.T3).toBe(true)
  })

  it('T3 is false when SMA200 has fallen over the last 22 trading days (monotonic downtrend)', () => {
    const series = makeMonotonicSeries(260, { start: 300, step: -0.3 })
    expect(evaluateTrendTemplate(series, 80).checks.T3).toBe(false)
  })
})

describe('evaluateTrendTemplate - T6/T7 exact boundaries (1.30 / 0.75, US-4)', () => {
  it('T6 passes at exactly 52주 최저가 × 1.30, fails just below it', () => {
    // week52.low = 50 (from the first controlled bar) -> boundary close = 65
    const passSeries = makeControlledSeries(252, { close: 65, high: 66, low: 64 })
    const failSeries = makeControlledSeries(252, { close: 64.99, high: 65.99, low: 63.99 })
    expect(evaluateTrendTemplate(passSeries, 80).checks.T6).toBe(true)
    expect(evaluateTrendTemplate(failSeries, 80).checks.T6).toBe(false)
  })

  it('T7 passes at exactly 52주 최고가 × 0.75, fails just below it', () => {
    // week52.high = 200 (from the first controlled bar) -> boundary close = 150
    const passSeries = makeControlledSeries(252, { close: 150, high: 151, low: 149 })
    const failSeries = makeControlledSeries(252, { close: 149.99, high: 150.99, low: 148.99 })
    expect(evaluateTrendTemplate(passSeries, 80).checks.T7).toBe(true)
    expect(evaluateTrendTemplate(failSeries, 80).checks.T7).toBe(false)
  })
})

describe('evaluateTrendTemplate - T8 RS 백분위 70 경계 (US-4)', () => {
  it('T8 passes at exactly percentile 70, fails just below it', () => {
    const series = makeMonotonicSeries(260, { start: 100, step: 0.5 })
    expect(evaluateTrendTemplate(series, 70).checks.T8).toBe(true)
    expect(evaluateTrendTemplate(series, 69.999).checks.T8).toBe(false)
  })
})

describe('evaluateTrendTemplate - missingConditions', () => {
  it('lists exactly the failed condition codes, empty when all pass', () => {
    const uptrend = makeMonotonicSeries(260, { start: 100, step: 0.5 })
    const downtrend = makeMonotonicSeries(260, { start: 300, step: -0.5 })
    const goodResult = evaluateTrendTemplate(uptrend, 90)
    const badResult = evaluateTrendTemplate(downtrend, 10)
    expect(goodResult.missingConditions).toEqual([])
    expect(badResult.missingConditions.length).toBeGreaterThan(0)
    badResult.missingConditions.forEach((code) => expect(TREND_TEMPLATE_CONDITION_CODES).toContain(code))
  })
})

describe('runMinerviniStage1 - relaxation fallback (US-4)', () => {
  function makeTicker(ticker, series) {
    return { ticker, name: ticker, sector: 'Technology', series }
  }

  it('does not relax when 8/8 already reaches MIN_RESULTS(5)', () => {
    const tickers = Array.from({ length: 5 }, (_, i) =>
      makeTicker(`T${i}`, makeMonotonicSeries(260, { start: 100, step: 0.6 }))
    )
    const result = runMinerviniStage1(tickers)
    expect(result.level).toBe('strict')
    expect(result.relaxationApplied).toBe(false)
    expect(result.passed.length).toBe(5)
    expect(result.insufficientSignal).toBe(false)
  })

  it('relaxes to 7/8 when 8/8 has fewer than 5 tickers but 7/8 reaches 5', () => {
    // 상승 추세는 유지하되 초반 한 바의 high만 인위적으로 크게 올려 52주 고점을 왜곡시켜
    // T7(현재가 ≥ 52주 최고가×0.75)만 표적으로 실패시킨다 — 나머지 7조건은 정상 통과.
    const tickers = Array.from({ length: 5 }, (_, i) => {
      const base = makeMonotonicSeries(260, { start: 100, step: 0.5 })
      // week52HighLow는 마지막 252거래일 창(index 8..259)만 본다 — 그 창 안의 인덱스를 찍어야 한다
      const series = withHighSpike(base, 20, 2000)
      return makeTicker(`T${i}`, series)
    })
    const result = runMinerviniStage1(tickers)
    expect(result.level).toBe('relaxed7of8')
    expect(result.relaxationApplied).toBe(true)
    expect(result.passed.length).toBe(5)
    expect(result.insufficientSignal).toBe(false)
    result.passed.forEach((p) => expect(p.missingConditions).toEqual(['T7']))
  })

  it('sets insufficientSignal when even 7/8 relaxation yields fewer than 5 tickers', () => {
    const tickers = [makeTicker('LONE', makeMonotonicSeries(260, { start: 100, step: 0.6 }))]
    const result = runMinerviniStage1(tickers)
    expect(result.insufficientSignal).toBe(true)
    expect(result.passed.length).toBe(1)
  })
})

describe('runMinerviniStage1 - insufficient-data exclusion (US-4)', () => {
  it('excludes tickers with fewer than 252 bars and reports a reason', () => {
    const short = { ticker: 'SHORT', name: 'Short', sector: 'Technology', series: Array.from({ length: 100 }, (_, i) => makeBar(i)) }
    const long = { ticker: 'LONG', name: 'Long', sector: 'Technology', series: makeMonotonicSeries(260, { start: 100, step: 0.5 }) }
    const result = runMinerviniStage1([short, long])
    expect(result.excludedForInsufficientData).toEqual([{ ticker: 'SHORT', reason: '52주(252거래일) 미만 데이터' }])
    expect(result.passed.some((p) => p.ticker === 'SHORT')).toBe(false)
  })
})

describe('runMinerviniStage1 - real 2y fixture sanity (US-4)', () => {
  it('MMVI1 (strong uptrend) qualifies while MMVI2 (downtrend) does not, on real fixture data', () => {
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '__fixtures__/nasdaq100.2y.sample.json'
    )
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    const tickers = raw.tickers.map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, series: t.series }))
    const result = runMinerviniStage1(tickers)
    const byTicker = Object.fromEntries(result.passed.map((p) => [p.ticker, p]))
    expect(byTicker.MMVI1).toBeDefined()
    expect(byTicker.MMVI2).toBeUndefined()
  })
})
