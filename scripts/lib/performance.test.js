import { describe, it, expect } from 'vitest'
import { buildPriceIndex, universeBenchmarkReturn, computeSignalPerformance, aggregatePerformance } from './performance.mjs'

// 3종목 × 70거래일 소형 픽스처 — 종가가 결정적 선형식이라 손계산이 가능하다.
// A: 100+i (완만한 상승), B: 200-i (하락), C: 100+2i (급상승)
function makeDates(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date((19723 + i) * 86400000)
    return d.toISOString().slice(0, 10)
  })
}

const DATES = makeDates(70)
const closeFns = { A: (i) => 100 + i, B: (i) => 200 - i, C: (i) => 100 + 2 * i }

function makeTickers() {
  return Object.entries(closeFns).map(([ticker, fn]) => ({
    ticker,
    dataSufficient: true,
    series: DATES.map((date, i) => ({ date, close: fn(i), high: fn(i) + 1, low: fn(i) - 1, volume: 1000 })),
  }))
}

const priceIndex = buildPriceIndex(makeTickers())

// 손계산 기대값 (entry=일10, holdingDays=5 → exit=일15)
const rA = closeFns.A(15) / closeFns.A(10) - 1 // 0.045454545454545414
const rB = closeFns.B(15) / closeFns.B(10) - 1 // -0.02631578947368418
const rC = closeFns.C(15) / closeFns.C(10) - 1 // 0.08333333333333326
const benchmarkD10H5 = (rA + rB + rC) / 3 // 0.0341573631047315

describe('performance.mjs — 손계산 검증 (US-4 승인 기준 1)', () => {
  it('진입~청산 수익률이 종가 비율과 정확히 일치한다 (종목 A)', () => {
    const perf = computeSignalPerformance(
      { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
      priceIndex,
      5
    )
    expect(perf.returnPct).toBeCloseTo(rA, 10)
  })

  it('유니버스 등가중 평균이 3종목 수익률의 산술평균과 일치한다', () => {
    const bench = universeBenchmarkReturn(priceIndex, DATES[10], 5)
    expect(bench).toBeCloseTo(benchmarkD10H5, 10)
  })

  it('초과수익 = 종목 수익률 − 벤치마크 (종목 A, B 둘 다)', () => {
    const perfA = computeSignalPerformance({ date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }, priceIndex, 5)
    const perfB = computeSignalPerformance({ date: DATES[10], ticker: 'B', strategyKey: 'trend', basis: 'top5', relaxationApplied: true }, priceIndex, 5)
    expect(perfA.excessReturn).toBeCloseTo(rA - benchmarkD10H5, 10)
    expect(perfB.excessReturn).toBeCloseTo(rB - benchmarkD10H5, 10)
  })

  it('승률 = 초과수익>0인 신호 비율 (A 승, B 패 → 2건 중 1승 = 0.5)', () => {
    const records = [
      { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
      { date: DATES[10], ticker: 'B', strategyKey: 'trend', basis: 'top5', relaxationApplied: true },
    ]
    const [group] = aggregatePerformance(records, priceIndex, [5], { strategyKeys: ['trend'], bases: ['top5'] })
    expect(group.winRate).toBe(0.5)
    expect(group.signals).toBe(2)
  })

  it('평균 초과수익이 두 신호의 산술평균과 일치한다', () => {
    const records = [
      { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
      { date: DATES[10], ticker: 'B', strategyKey: 'trend', basis: 'top5', relaxationApplied: true },
    ]
    const [group] = aggregatePerformance(records, priceIndex, [5], { strategyKeys: ['trend'], bases: ['top5'] })
    const expectedAvg = ((rA - benchmarkD10H5) + (rB - benchmarkD10H5)) / 2
    expect(group.avgExcess).toBeCloseTo(expectedAvg, 4)
  })

  it('중앙값 초과수익 — 3신호(A/B/C)에서 중앙값이 평균과 다르게 정확히 계산된다', () => {
    const records = [
      { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'allSignals', relaxationApplied: false },
      { date: DATES[10], ticker: 'B', strategyKey: 'trend', basis: 'allSignals', relaxationApplied: false },
      { date: DATES[10], ticker: 'C', strategyKey: 'trend', basis: 'allSignals', relaxationApplied: false },
    ]
    const [group] = aggregatePerformance(records, priceIndex, [5], { strategyKeys: ['trend'], bases: ['allSignals'] })
    const excesses = [rA - benchmarkD10H5, rB - benchmarkD10H5, rC - benchmarkD10H5].sort((a, b) => a - b)
    expect(group.medianExcess).toBeCloseTo(excesses[1], 4)
  })

  it('relaxedShare = relaxationApplied:true 비율 (A=false, B=true → 0.5)', () => {
    const records = [
      { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
      { date: DATES[10], ticker: 'B', strategyKey: 'trend', basis: 'top5', relaxationApplied: true },
    ]
    const [group] = aggregatePerformance(records, priceIndex, [5], { strategyKeys: ['trend'], bases: ['top5'] })
    expect(group.relaxedShare).toBe(0.5)
  })
})

describe('performance.mjs — 경계 테스트 (US-4 승인 기준 2)', () => {
  it('청산일이 데이터 범위를 벗어나는 신호는 null로 제외된다', () => {
    const lastDate = DATES[DATES.length - 1]
    const perf = computeSignalPerformance({ date: lastDate, ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }, priceIndex, 5)
    expect(perf).toBeNull()
  })

  it('표본이 0인 축은 NaN이 아니라 null로 안전하게 표기된다', () => {
    const [group] = aggregatePerformance([], priceIndex, [20], { strategyKeys: ['minervini'], bases: ['top5'] })
    expect(group.signals).toBe(0)
    expect(group.winRate).toBeNull()
    expect(group.avgExcess).toBeNull()
    expect(Number.isNaN(group.winRate)).toBe(false)
  })

  it('요청한 전략키×basis×보유기간의 전체 조합이 신호 유무와 무관하게 모두 나타난다', () => {
    const groups = aggregatePerformance([], priceIndex, [5, 20], { strategyKeys: ['trend', 'minervini'], bases: ['top5', 'allSignals'] })
    expect(groups.length).toBe(2 * 2 * 2)
  })
})

describe('performance.mjs — 컨센서스 ★★/★ 분리 집계 (US-4 승인 기준 3)', () => {
  it('consensus_2star와 consensus_1star가 별도 그룹으로 집계된다', () => {
    const records = [
      { date: DATES[10], ticker: 'A', strategyKey: 'consensus_2star', basis: 'top5', relaxationApplied: false },
      { date: DATES[10], ticker: 'B', strategyKey: 'consensus_1star', basis: 'top5', relaxationApplied: false },
    ]
    const groups = aggregatePerformance(records, priceIndex, [5], { strategyKeys: ['consensus_2star', 'consensus_1star'], bases: ['top5'] })
    const twoStar = groups.find((g) => g.strategyKey === 'consensus_2star')
    const oneStar = groups.find((g) => g.strategyKey === 'consensus_1star')
    expect(twoStar.signals).toBe(1)
    expect(oneStar.signals).toBe(1)
    expect(twoStar.avgExcess).not.toBe(oneStar.avgExcess)
  })
})
