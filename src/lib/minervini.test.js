import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { evaluateTrendTemplate, runMinerviniStage1, evaluateVcpScore, runMinerviniRecommend, TREND_TEMPLATE_CONDITION_CODES } from './minervini.js'
import { VCP_SCORE } from './constants/v8.js'

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

// --- v8 US-5: 미너비니 2단계 VCP 근사 스코어링 ---

/** flat 150일 바탕(close=100,volume=1,000,000) 위에 특정 구간만 덮어써서 지표 하나만 표적화한다. */
function makeFlatSeries(n = 150) {
  return Array.from({ length: n }, (_, i) => makeBar(i, { close: 100 }))
}

function overlayCloses(series, fromEnd, closes) {
  const copy = series.map((b) => ({ ...b }))
  const start = copy.length - fromEnd
  closes.forEach((c, i) => {
    copy[start + i] = { ...copy[start + i], close: c, high: c + 1, low: c - 1 }
  })
  return copy
}

function overlayVolumes(series, fromEnd, volumes) {
  const copy = series.map((b) => ({ ...b }))
  const start = copy.length - fromEnd
  volumes.forEach((v, i) => {
    copy[start + i] = { ...copy[start + i], volume: v }
  })
  return copy
}

describe('evaluateVcpScore - RS 백분위 배점 (0/40, 경계 70/100)', () => {
  it('scores 0 at exactly percentile 70, 40 (max) at percentile 100', () => {
    const series = makeFlatSeries()
    expect(evaluateVcpScore(series, 70).rsScore).toBeCloseTo(0)
    expect(evaluateVcpScore(series, 100).rsScore).toBeCloseTo(VCP_SCORE.RS_MAX)
  })

  it('clamps to 0 below the floor (does not go negative)', () => {
    const series = makeFlatSeries()
    expect(evaluateVcpScore(series, 40).rsScore).toBe(0)
  })
})

describe('evaluateVcpScore - 변동성 수축 배점 (0/25, 경계 0.5/1.0)', () => {
  it('caps at max score(25) when the recent window is far quieter than the prior window (ratio well below 0.5)', () => {
    // prior40: 강한 스윙(±5%), recent10: 매우 잔잔함(±0.1%) -> 수축비 << 0.5
    const prior40 = []
    let p = 100
    for (let i = 0; i < 40; i++) {
      p *= i % 2 === 0 ? 1.05 : 1 / 1.05
      prior40.push(p)
    }
    const recent10 = []
    let r = p
    for (let i = 0; i < 10; i++) {
      r *= i % 2 === 0 ? 1.001 : 1 / 1.001
      recent10.push(r)
    }
    const series = overlayCloses(makeFlatSeries(), 50, [...prior40, ...recent10])
    expect(evaluateVcpScore(series, 80).contractionScore).toBeCloseTo(VCP_SCORE.CONTRACTION_MAX)
  })

  it('scores 0 when the recent window is at least as volatile as the prior window (ratio >= 1.0)', () => {
    const prior40 = []
    let p = 100
    for (let i = 0; i < 40; i++) {
      p *= i % 2 === 0 ? 1.02 : 1 / 1.02
      prior40.push(p)
    }
    const recent10 = []
    let r = p
    for (let i = 0; i < 10; i++) {
      r *= i % 2 === 0 ? 1.05 : 1 / 1.05 // 더 크게 흔들림 -> 수축비 >= 1
      recent10.push(r)
    }
    const series = overlayCloses(makeFlatSeries(), 50, [...prior40, ...recent10])
    expect(evaluateVcpScore(series, 80).contractionScore).toBe(0)
  })
})

describe('evaluateVcpScore - 거래량 드라이업 배점 (0/15, 경계 0%/−30%)', () => {
  it('scores 0 at exactly 0% dry-up (recent avg == prior avg, hand-computed)', () => {
    const series = overlayVolumes(makeFlatSeries(), 55, [
      ...Array(50).fill(1_000_000),
      ...Array(5).fill(1_000_000),
    ])
    expect(evaluateVcpScore(series, 80).dryUpScore).toBe(0)
  })

  it('scores max(15) at exactly -30% dry-up (hand-computed)', () => {
    const series = overlayVolumes(makeFlatSeries(), 55, [
      ...Array(50).fill(1_000_000),
      ...Array(5).fill(700_000), // (700000-1000000)/1000000*100 = -30
    ])
    expect(evaluateVcpScore(series, 80).dryUpScore).toBeCloseTo(VCP_SCORE.DRYUP_MAX)
  })

  it('scores 0 when volume increases (positive dry-up %)', () => {
    const series = overlayVolumes(makeFlatSeries(), 55, [
      ...Array(50).fill(1_000_000),
      ...Array(5).fill(1_300_000),
    ])
    expect(evaluateVcpScore(series, 80).dryUpScore).toBe(0)
  })
})

describe('evaluateVcpScore - 피벗/신고가 근접 배점 (0/20, 경계 0%/10%)', () => {
  it('scores max(20) when the current close equals the 63-day peak (hand-computed, proximity 0%)', () => {
    const closes = Array.from({ length: 62 }, () => 90).concat([100]) // peak=current=100
    const series = overlayCloses(makeFlatSeries(), 63, closes)
    expect(evaluateVcpScore(series, 80).pivotScore).toBeCloseTo(VCP_SCORE.PIVOT_MAX)
  })

  it('scores 0 at exactly 10% below the peak (hand-computed)', () => {
    const closes = Array.from({ length: 62 }, () => 90).concat([81]) // peak=90, gap=9/90*100=10%
    const series = overlayCloses(makeFlatSeries(), 63, closes)
    expect(evaluateVcpScore(series, 80).pivotScore).toBeCloseTo(0)
  })
})

describe('evaluateVcpScore - 이유 문자열 생성 (US-5)', () => {
  it('always includes the Stage 2 baseline phrase', () => {
    const series = makeFlatSeries()
    expect(evaluateVcpScore(series, 40).reasons).toMatch(/^Stage 2 추세/)
  })

  it('includes "RS 상위 n%" only when the RS component scores above 0', () => {
    const series = makeFlatSeries()
    expect(evaluateVcpScore(series, 90).reasons).toMatch(/RS 상위 10%/)
    expect(evaluateVcpScore(series, 40).reasons).not.toMatch(/RS 상위/)
  })

  it('includes "피벗 −n%" only when the pivot component scores above 0', () => {
    const atPeak = overlayCloses(makeFlatSeries(), 63, Array.from({ length: 62 }, () => 90).concat([100]))
    const farBelow = overlayCloses(makeFlatSeries(), 63, Array.from({ length: 62 }, () => 90).concat([81]))
    expect(evaluateVcpScore(atPeak, 40).reasons).toMatch(/피벗 −0\.0%/)
    expect(evaluateVcpScore(farBelow, 40).reasons).not.toMatch(/피벗/)
  })
})

describe('runMinerviniRecommend - 출력 형태가 recommend.js와 동형 (US-5)', () => {
  it('each list entry has the same core fields as a recommend.js result, plus templateChecks[]', () => {
    const tickers = Array.from({ length: 5 }, (_, i) => ({
      ticker: `T${i}`,
      name: `Ticker ${i}`,
      sector: 'Technology',
      series: makeMonotonicSeries(260, { start: 100, step: 0.5 }),
    }))
    const result = runMinerviniRecommend(tickers)
    expect(result).toHaveProperty('list')
    expect(result).toHaveProperty('relaxationApplied')
    expect(result).toHaveProperty('insufficientSignal')
    expect(result).toHaveProperty('level')

    const entry = result.list[0]
    expect(entry).toMatchObject({
      ticker: expect.any(String),
      name: expect.any(String),
      sector: expect.any(String),
      score: expect.any(Number),
      reasons: expect.any(String),
      signalPassed: true,
      relaxationApplied: expect.any(Boolean),
    })
    expect(Array.isArray(entry.templateChecks)).toBe(true)
    expect(entry.templateChecks).toHaveLength(8)
    entry.templateChecks.forEach((c) => {
      expect(c).toMatchObject({ code: expect.any(String), passed: expect.any(Boolean) })
    })
  })

  it('sorts the list by score descending', () => {
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '__fixtures__/nasdaq100.2y.sample.json'
    )
    const raw = JSON.parse(readFileSync(fixturePath, 'utf-8'))
    const tickers = raw.tickers.map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, series: t.series }))
    const result = runMinerviniRecommend(tickers)
    for (let i = 1; i < result.list.length; i++) {
      expect(result.list[i - 1].score).toBeGreaterThanOrEqual(result.list[i].score)
    }
  })
})

// v11 US-11: 승인된 채택 1 — recommend.js와 동일한 regime 게이트를 공유한다(regime.js 재사용).
describe('runMinerviniRecommend - regime gate (v11 US-11 승인 기준 1: 승인된 채택 1)', () => {
  const relaxedTickers = Array.from({ length: 5 }, (_, i) => {
    const base = makeMonotonicSeries(260, { start: 100, step: 0.5 })
    const series = withHighSpike(base, 20, 2000) // T7만 실패 → 7/8 완화로 통과
    return { ticker: `T${i}`, name: `Ticker ${i}`, sector: 'Technology', series }
  })

  it('하락 국면(regime="down")에서는 완화(relaxed7of8) 신호가 결과에서 완전히 빠진다', () => {
    const result = runMinerviniRecommend(relaxedTickers, 'down')
    expect(result.relaxationApplied).toBe(true)
    expect(result.regimeGated).toBe(true)
    expect(result.list).toEqual([])
  })

  it('상승/중립/국면 미지정에서는 완화 신호가 그대로 유지된다(v10과 완전 동일 — 승인 기준 1)', () => {
    for (const regime of ['up', 'neutral', null, undefined]) {
      const result = regime === undefined ? runMinerviniRecommend(relaxedTickers) : runMinerviniRecommend(relaxedTickers, regime)
      expect(result.list.length).toBe(5)
      expect(result.regimeGated).toBe(false)
    }
  })
})
