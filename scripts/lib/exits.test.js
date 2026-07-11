import { describe, it, expect } from 'vitest'
import { walkExit, computeExitPerformance, aggregateExitPerformance, EXIT_RULES, EXIT_LIMITATION_NOTE } from './exits.mjs'
import { buildPriceIndex } from './performance.mjs'

function makeDates(n) {
  return Array.from({ length: n }, (_, i) => new Date((19723 + i) * 86400000).toISOString().slice(0, 10))
}

const DATES = makeDates(61) // entry(day0) ~ day60

// 손절 도달: day3에 91(entry 100 대비 -9%, -8% 문턱 92 이하) 도달 후 계속 하락하지 않음(참고용)
const STOP_CLOSES = [100, 98, 95, 91, 90, 89, 88, ...Array(53).fill(85)]
// 트레일링만 도달(진입 대비는 여전히 플러스): day1~10 130까지 상승(peak), day11~20은
// peak*0.85=110.5 위에서 완만히 하락하다 day21에 109.1(<=110.5) 도달. day22~60은 105
// 근처 유지(시간 청산 대비 — 손절선 92는 건드리지 않음)
const TRAIL_CLOSES = [
  100, 104, 108, 112, 116, 120, 123, 126, 128, 129, 130, // day0~10 (peak=130 at day10)
  128.1, 126.2, 124.3, 122.4, 120.5, 118.6, 116.7, 114.8, 112.9, 111, 109.1, // day11~21 (day20=111>110.5, day21=109.1<=110.5 → 트레일링 도달)
  ...Array(39).fill(105), // day22~60
]
// 만기 보유: 단조 완만 상승, 진입 대비도 최고가 대비도 손절선에 닿지 않음
const HOLD_CLOSES = Array.from({ length: 61 }, (_, i) => 100 + (10 * i) / 60)

function makeSeries(closes) {
  return DATES.map((date, i) => ({ date, close: closes[i], high: closes[i] + 0.5, low: closes[i] - 0.5, volume: 1000 }))
}

const tickers = [
  { ticker: 'STOPX', dataSufficient: true, series: makeSeries(STOP_CLOSES) },
  { ticker: 'TRAILX', dataSufficient: true, series: makeSeries(TRAIL_CLOSES) },
  { ticker: 'HOLDX', dataSufficient: true, series: makeSeries(HOLD_CLOSES) },
]
const priceIndex = buildPriceIndex(tickers)

describe('walkExit — 손계산 검증 (US-2 승인 기준 1, 6개 이상)', () => {
  it('손절 도달: exit_stop8_time60이 day3에 91로 청산된다', () => {
    const result = walkExit(tickers[0].series, 0, EXIT_RULES.exit_stop8_time60)
    expect(result.holdingDaysActual).toBe(3)
    expect(result.exitClose).toBe(91)
    expect(result.stopHit).toBe(true)
  })

  it('손절 도달: exit_stop8_trail15도 동일하게 day3에 91로 청산된다(−8% 조건이 OR로 포함됨)', () => {
    const result = walkExit(tickers[0].series, 0, EXIT_RULES.exit_stop8_trail15)
    expect(result.holdingDaysActual).toBe(3)
    expect(result.exitClose).toBe(91)
    expect(result.stopHit).toBe(true)
  })

  it('트레일링만 도달: exit_stop8_trail15가 day21에 109.1로 청산된다(진입 대비는 플러스)', () => {
    const result = walkExit(tickers[1].series, 0, EXIT_RULES.exit_stop8_trail15)
    expect(result.holdingDaysActual).toBe(21)
    expect(result.exitClose).toBe(109.1)
    expect(result.stopHit).toBe(true)
    expect(result.exitClose / 100 - 1).toBeGreaterThan(0) // 손절이 아니라 트레일링 익절
  })

  it('트레일링 미도달 규칙(exit_stop8_time60)은 같은 경로에서 day60 시간 청산된다', () => {
    const result = walkExit(tickers[1].series, 0, EXIT_RULES.exit_stop8_time60)
    expect(result.holdingDaysActual).toBe(60)
    expect(result.exitClose).toBe(105)
    expect(result.stopHit).toBe(false)
  })

  it('만기 보유: 두 규칙 모두 day60 종가로 청산되고 수익률은 +10%다', () => {
    const stop60 = walkExit(tickers[2].series, 0, EXIT_RULES.exit_stop8_time60)
    const trail60 = walkExit(tickers[2].series, 0, EXIT_RULES.exit_stop8_trail15)
    expect(stop60).toEqual({ exitIdx: 60, exitClose: 110, holdingDaysActual: 60, stopHit: false })
    expect(trail60).toEqual({ exitIdx: 60, exitClose: 110, holdingDaysActual: 60, stopHit: false })
  })

  it('computeExitPerformance의 returnPct가 청산가/진입가 비율과 정확히 일치한다(손절 케이스)', () => {
    const perf = computeExitPerformance({ date: DATES[0], ticker: 'STOPX', strategyKey: 'trend', basis: 'top5' }, priceIndex, EXIT_RULES.exit_stop8_time60)
    expect(perf.returnPct).toBeCloseTo(91 / 100 - 1, 10)
    expect(perf.holdingDaysActual).toBe(3)
  })
})

describe('walkExit — 미래 참조 불가 (US-2 승인 기준 2)', () => {
  it('entryIdx 이전 봉은 peak·청산 판정에 전혀 개입하지 않는다', () => {
    // entryIdx 이전에 극단적으로 높은/낮은 값을 넣어도(peak 시드는 entryClose여야 함) 결과가 달라지지 않는다
    const seriesWithNoise = [
      { date: '2000-01-01', close: 99999, high: 99999, low: 1, volume: 1 }, // entryIdx 이전 — 참조되면 안 됨
      ...makeSeries(STOP_CLOSES),
    ]
    const entryIdx = 1 // makeSeries(STOP_CLOSES)[0]에 해당
    const result = walkExit(seriesWithNoise, entryIdx, EXIT_RULES.exit_stop8_trail15)
    expect(result.holdingDaysActual).toBe(3)
    expect(result.exitClose).toBe(91)
  })

  it('MAX_HOLDING_DAYS(60) 이내에 데이터가 끝나면 null을 반환한다(경로 밖 데이터 요구 없이 안전 처리)', () => {
    const shortSeries = makeSeries(HOLD_CLOSES).slice(0, 30) // day0~29만 존재
    expect(walkExit(shortSeries, 0, EXIT_RULES.exit_stop8_time60)).toBeNull()
  })
})

describe('aggregateExitPerformance — US-2 승인 기준 3', () => {
  const records = [
    { date: DATES[0], ticker: 'STOPX', strategyKey: 'trend', basis: 'top5' },
    { date: DATES[0], ticker: 'TRAILX', strategyKey: 'trend', basis: 'top5' },
    { date: DATES[0], ticker: 'HOLDX', strategyKey: 'trend', basis: 'top5' },
  ]

  it('avgHoldingDays·stopHitRate가 집계된다', () => {
    const agg = aggregateExitPerformance(records, priceIndex, EXIT_RULES.exit_stop8_trail15)
    expect(agg.signals).toBe(3)
    expect(agg.avgHoldingDays).toBeCloseTo((3 + 21 + 60) / 3, 4)
    expect(agg.stopHitRate).toBeCloseTo(2 / 3, 4) // STOPX·TRAILX는 stopHit, HOLDX는 시간 청산 (holdingDaysActual 3/21/60)
  })

  it('표본이 0이면 NaN 없이 전부 null이다', () => {
    const agg = aggregateExitPerformance([], priceIndex, EXIT_RULES.exit_stop8_time60)
    expect(agg.signals).toBe(0)
    expect(agg.avgHoldingDays).toBeNull()
    expect(agg.stopHitRate).toBeNull()
  })

  it('한계 고지 고정 문구가 export되어 있다', () => {
    expect(EXIT_LIMITATION_NOTE).toBe('종가 기준 판정 — 장중 이탈 미반영으로 실제 손절 체결가는 이보다 불리할 수 있음')
  })
})
