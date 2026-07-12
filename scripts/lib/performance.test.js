import { describe, it, expect } from 'vitest'
import { buildPriceIndex, universeBenchmarkReturn, computeSignalPerformance, aggregatePerformance, computePartialPositionPerformance } from './performance.mjs'

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

// --- v11 US-3: 부분 포지션 인프라 (PRD_Nasdaq11 §4.3 청산E 전제) ---
describe('computePartialPositionPerformance — 손계산 검증 (US-3 승인 기준 1, 6개 이상)', () => {
  const recordA = { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }

  // day20(entry+10) 기준 손계산 기대값 — 잔여 50%의 만기 청산 레그용
  const rA20 = closeFns.A(20) / closeFns.A(10) - 1
  const rB20 = closeFns.B(20) / closeFns.B(10) - 1
  const rC20 = closeFns.C(20) / closeFns.C(10) - 1
  const benchmarkD10H10 = (rA20 + rB20 + rC20) / 3

  it('50% 중도청산(day15) + 50% 만기청산(day20)의 가중 수익률·벤치마크가 손계산과 일치한다', () => {
    const perf = computePartialPositionPerformance(recordA, priceIndex, [{ date: DATES[15], ratio: 0.5 }], 10)
    const expectedReturn = 0.5 * rA + 0.5 * rA20
    const expectedBenchmark = 0.5 * benchmarkD10H5 + 0.5 * benchmarkD10H10
    expect(perf.returnPct).toBeCloseTo(expectedReturn, 10)
    expect(perf.benchmarkReturn).toBeCloseTo(expectedBenchmark, 10)
    expect(perf.excessReturn).toBeCloseTo(expectedReturn - expectedBenchmark, 10)
  })

  it('100% 중도청산(day15, ratio=1)은 잔여분 없이 그 레그 하나로만 계산되고 5일 보유 전량청산과 동일하다', () => {
    const perf = computePartialPositionPerformance(recordA, priceIndex, [{ date: DATES[15], ratio: 1 }], 10)
    const full = computeSignalPerformance(recordA, priceIndex, 5) // entry=10 → exit=15, 5거래일
    expect(perf.returnPct).toBeCloseTo(full.returnPct, 10)
    expect(perf.benchmarkReturn).toBeCloseTo(full.benchmarkReturn, 10)
    expect(perf.legs).toHaveLength(1)
  })

  it('0% 중도청산(이벤트 없음)은 기존 전량 청산 경로(computeSignalPerformance)와 완전히 동일하다 (AC3 회귀 없음)', () => {
    const perf = computePartialPositionPerformance(recordA, priceIndex, [], 5)
    const full = computeSignalPerformance(recordA, priceIndex, 5)
    expect(perf.returnPct).toBeCloseTo(full.returnPct, 10)
    expect(perf.benchmarkReturn).toBeCloseTo(full.benchmarkReturn, 10)
    expect(perf.excessReturn).toBeCloseTo(full.excessReturn, 10)
    expect(perf.mdd).toBeCloseTo(full.mdd, 10)
  })

  it('레그가 정확히 하나(remainder 없음)일 때 legs 배열에 날짜·비중·수익률이 정확히 기록된다', () => {
    const perf = computePartialPositionPerformance(recordA, priceIndex, [{ date: DATES[15], ratio: 1 }], 10)
    expect(perf.legs[0]).toEqual({ date: DATES[15], weight: 1, returnPct: rA })
  })

  it('비율 합이 정확히 1(오차 허용)인 두 이벤트는 잔여 레그 없이 딱 2개 레그로 계산된다', () => {
    const perf = computePartialPositionPerformance(
      recordA,
      priceIndex,
      [
        { date: DATES[13], ratio: 0.5 },
        { date: DATES[15], ratio: 0.5 },
      ],
      10
    )
    expect(perf.legs).toHaveLength(2)
  })

  it('비율 합이 1을 초과하면 무효 입력으로 null을 반환한다', () => {
    const perf = computePartialPositionPerformance(
      recordA,
      priceIndex,
      [
        { date: DATES[13], ratio: 0.7 },
        { date: DATES[15], ratio: 0.6 },
      ],
      10
    )
    expect(perf).toBeNull()
  })
})

describe('computePartialPositionPerformance — 벤치마크·MDD 정합성 (US-3 승인 기준 2)', () => {
  const recordA = { date: DATES[10], ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }

  it('레그별 비중 합이 1임을 전제로 가중 벤치마크가 각 레그의 보유기간별 벤치마크를 정확히 가중합한다', () => {
    // A(day10→day15, 5일 보유)와 A(day10→day20, 10일 보유)는 보유기간이 다르므로
    // 벤치마크도 서로 달라야 한다(뭉뚱그리면 안 됨) — 실제로 다름을 먼저 확인.
    const bench5 = universeBenchmarkReturn(priceIndex, DATES[10], 5)
    const bench10 = universeBenchmarkReturn(priceIndex, DATES[10], 10)
    expect(bench5).not.toBeCloseTo(bench10, 6)

    const perf = computePartialPositionPerformance(recordA, priceIndex, [{ date: DATES[15], ratio: 0.5 }], 10)
    expect(perf.benchmarkReturn).toBeCloseTo(0.5 * bench5 + 0.5 * bench10, 10)
  })

  it('일찍 절반을 청산하면(변동성 축소) 전량 만기 보유보다 MDD가 작거나 같다', () => {
    // V자 하락(day10~15 급락 후 day15~20 회복)이 있는 티커를 새로 만들어, 조기 절반 청산이
    // 후반 하락 노출을 줄여 MDD를 낮추는지 확인한다.
    const dip = [100, 95, 88, 80, 88, 95, 100, 108, 115, 120, 125] // day10=100 ... day20=125 (11포인트)
    const tickerV = {
      ticker: 'V',
      dataSufficient: true,
      series: DATES.map((date, i) => {
        const offset = i - 10
        const close = offset >= 0 && offset < dip.length ? dip[offset] : 100 + i
        return { date, close, high: close + 1, low: close - 1, volume: 1000 }
      }),
    }
    const priceIndexV = buildPriceIndex([tickerV, ...makeTickers()])
    const recordV = { date: DATES[10], ticker: 'V', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }

    const fullHold = computePartialPositionPerformance(recordV, priceIndexV, [], 10) // 전량 10일 보유(급락 그대로 노출)
    const halfEarlyExit = computePartialPositionPerformance(recordV, priceIndexV, [{ date: DATES[13], ratio: 0.5 }], 10) // 급락 직전(day13=80 도달 전) 절반 청산

    expect(halfEarlyExit.mdd).toBeLessThanOrEqual(fullHold.mdd)
  })

  it('청산일이 유니버스 캘린더에 없으면 null을 반환한다', () => {
    const perf = computePartialPositionPerformance(recordA, priceIndex, [{ date: '1999-01-01', ratio: 0.5 }], 10)
    expect(perf).toBeNull()
  })

  it('잔여분 만기 청산일이 데이터 범위를 벗어나면 null을 반환한다', () => {
    const lastIdx = DATES.length - 1
    const nearEndDate = DATES[lastIdx - 3]
    const recordNearEnd = { date: nearEndDate, ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false }
    const perf = computePartialPositionPerformance(recordNearEnd, priceIndex, [], 10) // 잔여 100%가 10일 후 청산해야 하는데 데이터가 3일치뿐
    expect(perf).toBeNull()
  })
})
