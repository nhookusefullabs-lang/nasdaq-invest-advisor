import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  walkExit,
  computeExitPerformance,
  aggregateExitPerformance,
  EXIT_RULES,
  EXIT_LIMITATION_NOTE,
  COMBOS,
  computeComboPerformance,
  aggregateComboPerformance,
  computeClimaxPartialPerformance,
  aggregateClimaxPartialPerformance,
} from './exits.mjs'
import { buildPriceIndex } from './performance.mjs'
import { sliceUniverseAsOf } from './asOf.mjs'
import { evaluateExitSignals } from '../../src/lib/exitSignals.js'
import { ENTRY_VARIANTS, PULLBACK_ENTRY_VARIANTS } from './entries.mjs'
import { PIVOT_STRUCTURAL_STOP_MULT } from '../../src/lib/constants/entry.js'
import { PULLBACK_STOP_MULT } from '../../src/lib/constants/pullback.js'
import { regimeSeries, currentRegime } from '../../src/lib/regime.js'
import { buildDataset } from '../../src/lib/buildDataset.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

// --- v10 US-9: 신규 청산 3종 픽스처 (60일 평평 베이스 → entryIdx=59 → 이후 시나리오별 경로) ---
function makeExtendedSeries(afterEntryCloses, { baseHigh = 100.3, baseLow = 99.7 } = {}) {
  const bars = []
  for (let i = 0; i < 60; i++) {
    bars.push({ date: `pre-${i}`, close: 100, high: baseHigh, low: baseLow, volume: 1_000_000 })
  }
  afterEntryCloses.forEach((close, k) => {
    bars.push({ date: `post-${k}`, close, high: close, low: close, volume: 1_000_000 })
  })
  return bars
}
const ENTRY_IDX = 59 // 60일 베이스의 마지막 인덱스(entryClose=100)

describe('exits.mjs — exit_stop_atr (US-9 AC1)', () => {
  it('ATR 기반 손절선 이하로 하락하면 그날 청산된다', () => {
    const series = makeExtendedSeries([100, 97]) // day61(offset2)=97 — ATR14≈0.6 → stop≈98.5
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_stop_atr)
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
  })

  it('ATR 기반 손절선에 도달하지 않으면 60거래일 시간 청산된다', () => {
    const series = makeExtendedSeries(new Array(60).fill(100))
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_stop_atr)
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })
})

describe('exits.mjs — exit_sma50_break (X1, US-9 AC1/AC2)', () => {
  it('종가가 SMA50 아래로 이탈하면 그날 청산된다(X1)', () => {
    const series = makeExtendedSeries([95, 95]) // offset1(day60)=95 < SMA50(≈99.9)
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_sma50_break)
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(1)
  })

  it('SMA50 위를 유지하면 60거래일 시간 청산된다', () => {
    const series = makeExtendedSeries(new Array(60).fill(101))
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_sma50_break)
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })

  it('exitSignals.js 재사용 확인: walkExit의 트리거일이 evaluateExitSignals()가 직접 판정한 X1 트리거일과 정확히 같다', () => {
    const series = makeExtendedSeries([95, 95])
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_sma50_break)
    const direct = evaluateExitSignals(series.slice(0, ENTRY_IDX + 1 + 1)) // offset1 = ENTRY_IDX+1
    expect(direct.signals.some((s) => s.code === 'X1')).toBe(true)
    expect(result.holdingDaysActual).toBe(1)
  })
})

describe('exits.mjs — exit_climax (X4, US-9 AC1/AC2)', () => {
  it('10거래일 수익률·SMA50 이격이 +25% 이상이면 그날 청산된다(X4)', () => {
    const spike = Array.from({ length: 10 }, (_, k) => 100 + 3 * (k + 1)) // day60~69: 103..130
    const series = makeExtendedSeries([...spike, ...new Array(50).fill(130)])
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_climax)
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(10)
  })

  it('완만한 상승(클라이맥스 미달)이면 60거래일 시간 청산된다', () => {
    const gentle = Array.from({ length: 60 }, (_, k) => 100 + 0.1 * (k + 1))
    const series = makeExtendedSeries(gentle)
    const result = walkExit(series, ENTRY_IDX, EXIT_RULES.exit_climax)
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })
})

describe('exits.mjs — combos (US-9 AC3: 진입·청산 양쪽 파라미터 명시 — adopted=false는 backtest.mjs 통합 레벨에서 부여)', () => {
  it('COMBOS가 정확히 5개(v11 US-8의 2종 포함) 등록되어 있고 각각 entryVariant/exitRule을 명시한다', () => {
    expect(COMBOS).toHaveLength(5)
    const allEntryVariants = [...Object.values(ENTRY_VARIANTS), ...Object.values(PULLBACK_ENTRY_VARIANTS)]
    for (const combo of COMBOS) {
      expect(typeof combo.name).toBe('string')
      expect(combo.entryVariant).toBeDefined()
      expect(combo.exitRule).toBeDefined()
      expect(allEntryVariants).toContain(combo.entryVariant)
      expect(Object.values(EXIT_RULES)).toContain(combo.exitRule)
    }
  })

  it('조합 성과 집계는 체결률·성과·MDD·평균 보유일을 포함한다', () => {
    const tickers2 = [{ ticker: 'COMBOX', dataSufficient: true, series: makeExtendedSeries([101, 130, 130]) }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const record = { date: tickers2[0].series[ENTRY_IDX].date, ticker: 'COMBOX', strategyKey: 'trend', basis: 'top5' }
    const agg = aggregateComboPerformance([record], priceIndex2, ENTRY_VARIANTS.entry_pivot_confirm2, EXIT_RULES.exit_stop_atr)
    expect(typeof agg.signals).toBe('number')
    expect('fillRate' in agg).toBe(true)
    expect('avgExcess' in agg).toBe(true)
    expect('mdd' in agg).toBe(true)
    expect('avgHoldingDays' in agg).toBe(true)
  })

  it('computeComboPerformance는 미체결 신호를 filled:false로 남긴다(fillRate 집계용)', () => {
    // 60일 평평 베이스는 rule1 피벗(P=100)이라 confirm2가 확인할 "피벗 위 유지"가 전혀 없다
    const tickers2 = [{ ticker: 'NOFILLX', dataSufficient: true, series: makeExtendedSeries(new Array(25).fill(99)) }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const record = { date: tickers2[0].series[ENTRY_IDX].date, ticker: 'NOFILLX', strategyKey: 'trend', basis: 'top5' }
    const perf = computeComboPerformance(record, priceIndex2, ENTRY_VARIANTS.entry_pivot_confirm2, EXIT_RULES.exit_stop_atr)
    expect(perf.filled).toBe(false)
  })
})

describe('exits.mjs — exit_regime_conditional (US-7 AC1: 신호일 국면별 규칙 분기)', () => {
  // exit_stop_atr과 동일한 ATR 손절 픽스처(day61(offset2)=97 — ATR14≈0.6 → stop≈98.5)를
  // day2 이후 60일치까지 연장 — 'up' 시나리오가 손절 없이 day60 시간 청산까지 도달하려면
  // walkExit이 entryIdx+60까지의 데이터를 요구하기 때문(60일 미만이면 null 반환).
  const stopSeries = makeExtendedSeries([100, 97, ...Array(58).fill(97)])

  it('신호일 국면이 상승이면 ATR 이탈에도 손절이 걸리지 않고 60거래일 보유된다', () => {
    const result = walkExit(stopSeries, ENTRY_IDX, EXIT_RULES.exit_regime_conditional, undefined, { regime: 'up' })
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })

  it('신호일 국면이 하락이면 exit_stop_atr과 동일하게 day2에 손절된다', () => {
    const result = walkExit(stopSeries, ENTRY_IDX, EXIT_RULES.exit_regime_conditional, undefined, { regime: 'down' })
    const baseline = walkExit(stopSeries, ENTRY_IDX, EXIT_RULES.exit_stop_atr)
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
    expect(result).toEqual(baseline)
  })

  it('신호일 국면이 중립이어도 ATR 손절이 가동된다(상승만 예외)', () => {
    const result = walkExit(stopSeries, ENTRY_IDX, EXIT_RULES.exit_regime_conditional, undefined, { regime: 'neutral' })
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
  })

  it('computeExitPerformance는 record.regime을 자동으로 컨텍스트에 병합한다(별도 배선 불필요)', () => {
    const tickers2 = [{ ticker: 'REGIMEX', dataSufficient: true, series: stopSeries }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const upRecord = { date: stopSeries[ENTRY_IDX].date, ticker: 'REGIMEX', strategyKey: 'trend', basis: 'top5', regime: 'up' }
    const downRecord = { ...upRecord, regime: 'down' }
    expect(computeExitPerformance(upRecord, priceIndex2, EXIT_RULES.exit_regime_conditional).holdingDaysActual).toBe(60)
    expect(computeExitPerformance(downRecord, priceIndex2, EXIT_RULES.exit_regime_conditional).holdingDaysActual).toBe(2)
  })
})

describe('exits.mjs — exit_regime_flip (US-7 AC2: 전환일 판정의 슬라이스 기준 시점 정합성)', () => {
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/lib/__fixtures__/nasdaq100.5y.sample.json'), 'utf-8'))
  const dataset = buildDataset(raw)
  const fullSeries = regimeSeries(dataset.tickers)
  const regimeByDate = new Map(fullSeries.map((s) => [s.date, { regime: s.regime, transitionDate: s.transitionDate }]))
  const flipDay = fullSeries.find((s) => s.regime === 'down' && s.transitionDate === s.date)

  it('5.5년 픽스처에 하락 전환일이 최소 1개 존재한다(픽스처 전제 확인)', () => {
    expect(flipDay).toBeDefined()
  })

  it('AC2 시점 정합성: 전환일까지만 슬라이스한 유니버스로 직접 계산한 국면이 전체 계산(regimeByDate) 결과와 정확히 같다', () => {
    const sliced = sliceUniverseAsOf(raw, flipDay.date)
    const direct = currentRegime(buildDataset(sliced).tickers)
    expect(direct.regime).toBe('down')
    expect(direct.transitionDate).toBe(flipDay.date)
    expect(regimeByDate.get(flipDay.date)).toEqual({ regime: direct.regime, transitionDate: direct.transitionDate })
  })

  it('exit_regime_flip.checkStop은 전환일 당일에만 true, 그 전날에는 false다', () => {
    const dayBefore = fullSeries[fullSeries.findIndex((s) => s.date === flipDay.date) - 1]
    const seriesStub = (date) => [{ date }]
    expect(
      EXIT_RULES.exit_regime_flip.checkStop({ series: seriesStub(flipDay.date), idx: 0, regimeByDate })
    ).toBe(true)
    expect(
      EXIT_RULES.exit_regime_flip.checkStop({ series: seriesStub(dayBefore.date), idx: 0, regimeByDate })
    ).toBe(false)
  })

  it('regimeByDate가 없으면(구버전 호출부) 안전하게 미체결(false)로 처리한다', () => {
    expect(EXIT_RULES.exit_regime_flip.checkStop({ series: [{ date: flipDay.date }], idx: 0 })).toBe(false)
  })
})

describe('exits.mjs — v11 US-7 AC3: 5.5년 약세장 구간에서 exit_regime_conditional 방어 청산 실발동', () => {
  it('하락 국면 신호 표본에서 ATR 손절이 실제로 다수 발동한다(stopHitRate > 0)', () => {
    const raw = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/lib/__fixtures__/nasdaq100.5y.sample.json'), 'utf-8'))
    const dataset = buildDataset(raw)
    const fullSeries = regimeSeries(dataset.tickers)
    const regimeByDate = new Map(fullSeries.map((s) => [s.date, { regime: s.regime, transitionDate: s.transitionDate }]))
    const downDates = fullSeries.filter((s) => s.regime === 'down').map((s) => s.date)
    const sampleDates = downDates.filter((_, i) => i % 15 === 0)

    const priceIndex = buildPriceIndex(dataset.tickers)
    const records = []
    for (const date of sampleDates) {
      for (const t of dataset.tickers) {
        if (!t.dataSufficient) continue
        records.push({ date, ticker: t.ticker, strategyKey: 'trend', basis: 'top5', regime: 'down' })
      }
    }

    const agg = aggregateExitPerformance(records, priceIndex, EXIT_RULES.exit_regime_conditional, { regimeByDate })
    expect(agg.signals).toBeGreaterThan(0)
    expect(agg.stopHitRate).toBeGreaterThan(0)
  })
})

// --- v11 US-8: 청산 변형 C(구조 기반 손절) 픽스처 ---
// 돌파형: 90일 평평(100) 베이스 → entryIdx=89(피벗=100, 손절선=100×0.97=97).
function makeBreakoutStructuralSeries(afterEntryCloses) {
  const bars = []
  for (let i = 0; i < 90; i++) bars.push({ date: `bo-${i}`, close: 100, high: 100.2, low: 99.8, volume: 1_000_000 })
  afterEntryCloses.forEach((close, k) => bars.push({ date: `bo-post-${k}`, close, high: close, low: close, volume: 1_000_000 }))
  return bars
}
const BO_ENTRY_IDX = 89

// 눌림목형: 68일 평평(100) + 피벗일(index68, 200) + 눌림일(index69, entryIdx) — pullback.test.js의
// singleDayPullback과 동일한 형태(peakIndex=68 단일 최고점 → 눌림 저점=눌림일 자신의 종가).
function makePullbackStructuralSeries(depthPct, afterEntryCloses) {
  const bars = []
  for (let i = 0; i < 68; i++) bars.push({ date: `pb-${i}`, close: 100, high: 100.2, low: 99.8, volume: 1_000_000 })
  bars.push({ date: 'pb-peak', close: 200, high: 200.2, low: 199.8, volume: 1_000_000 })
  bars.push({ date: 'pb-entry', close: 200 * (1 - depthPct / 100), high: 200, low: 100, volume: 1_000_000 })
  afterEntryCloses.forEach((close, k) => bars.push({ date: `pb-post-${k}`, close, high: close, low: close, volume: 1_000_000 }))
  return bars
}
const PB_ENTRY_IDX = 69 // 눌림 저점(pullbackLow) = 200×(1−depthPct/100), 손절선 = pullbackLow×0.98

describe('exits.mjs — exit_structural (v11 US-8 AC1: 진입 유형→손절선 매핑 + 유형 불명 시 안전 기본값)', () => {
  it('돌파형(entryType=breakout): 피벗×0.97(=97) 이하로 하락하면 그날 청산된다', () => {
    const series = makeBreakoutStructuralSeries([100, 96, ...Array(58).fill(96)])
    const result = walkExit(series, BO_ENTRY_IDX, EXIT_RULES.exit_structural, undefined, { entryType: 'breakout' })
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
  })

  it('돌파형: 손절선(97)에 도달하지 않으면 60거래일 시간 청산된다', () => {
    const series = makeBreakoutStructuralSeries(new Array(60).fill(98))
    const result = walkExit(series, BO_ENTRY_IDX, EXIT_RULES.exit_structural, undefined, { entryType: 'breakout' })
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })

  it(`눌림목형(entryType=pullback): 눌림 저점×${PULLBACK_STOP_MULT}(=166.6) 이하로 하락하면 그날 청산된다`, () => {
    const series = makePullbackStructuralSeries(15, [175, 165, ...Array(58).fill(165)])
    const result = walkExit(series, PB_ENTRY_IDX, EXIT_RULES.exit_structural, undefined, { entryType: 'pullback' })
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
  })

  it('눌림목형: 손절선(166.6)에 도달하지 않으면 60거래일 시간 청산된다', () => {
    const series = makePullbackStructuralSeries(15, new Array(60).fill(200))
    const result = walkExit(series, PB_ENTRY_IDX, EXIT_RULES.exit_structural, undefined, { entryType: 'pullback' })
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })

  it('유형 불명(entryType 미지정 — context 없이 호출): 큰 하락에도 손절이 걸리지 않고 60거래일 시간 청산만 적용된다(승인 기준 1의 안전 기본값)', () => {
    const series = makeBreakoutStructuralSeries(new Array(60).fill(50)) // 피벗(100) 대비 -50%
    const result = walkExit(series, BO_ENTRY_IDX, EXIT_RULES.exit_structural) // context 생략
    expect(result.stopHit).toBe(false)
    expect(result.holdingDaysActual).toBe(60)
  })
})

describe('exits.mjs — exit_structural (v11 US-8 AC2: 손절선이 진입 시점 구조로 고정, 이후 데이터로 재계산되지 않음)', () => {
  it('진입일 이후 극단적인 스파이크가 끼어들어도 손절선(피벗×0.97=97)은 변하지 않는다', () => {
    // day+1에 500으로 스파이크한 뒤 day+2에 90으로 급락 — 손절선이 진입 시점(day89)까지의
    // 데이터로 고정되지 않고 매 스텝 전체 시리즈로 재계산됐다면 스파이크가 피벗을 끌어올려
    // day+2의 90이 손절선에 걸리지 않을 수도 있다. 실제로는 97 그대로 유지되어 정확히 걸린다.
    const series = makeBreakoutStructuralSeries([500, 90, ...Array(58).fill(90)])
    const result = walkExit(series, BO_ENTRY_IDX, EXIT_RULES.exit_structural, undefined, { entryType: 'breakout' })
    expect(result.stopHit).toBe(true)
    expect(result.holdingDaysActual).toBe(2)
  })
})

describe('exits.mjs — v11 US-8 AC3: 조합 레코드에 entryType/regime 컨텍스트가 배선된다 (대표 조합 2종)', () => {
  it('entry_close × exit_regime_conditional: record.regime이 조합 경로에서도 그대로 적용된다', () => {
    const stopSeries = makeExtendedSeries([100, 97, ...Array(58).fill(97)])
    const tickers2 = [{ ticker: 'COMBOREGIMEX', dataSufficient: true, series: stopSeries }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const upRecord = { date: stopSeries[ENTRY_IDX].date, ticker: 'COMBOREGIMEX', strategyKey: 'trend', basis: 'top5', regime: 'up' }
    const downRecord = { ...upRecord, regime: 'down' }
    expect(computeComboPerformance(upRecord, priceIndex2, ENTRY_VARIANTS.entry_close, EXIT_RULES.exit_regime_conditional).holdingDaysActual).toBe(60)
    expect(computeComboPerformance(downRecord, priceIndex2, ENTRY_VARIANTS.entry_close, EXIT_RULES.exit_regime_conditional).holdingDaysActual).toBe(2)
  })

  it('COMBOS에 등록된 실제 조합 정의(entry_close_x_exit_regime_conditional)로도 동일하게 동작한다', () => {
    const combo = COMBOS.find((c) => c.name === 'entry_close_x_exit_regime_conditional')
    expect(combo).toBeDefined()
    const stopSeries = makeExtendedSeries([100, 97, ...Array(58).fill(97)])
    const tickers2 = [{ ticker: 'COMBOREGIMEY', dataSufficient: true, series: stopSeries }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const downRecord = { date: stopSeries[ENTRY_IDX].date, ticker: 'COMBOREGIMEY', strategyKey: 'trend', basis: 'top5', regime: 'down' }
    expect(computeComboPerformance(downRecord, priceIndex2, combo.entryVariant, combo.exitRule).holdingDaysActual).toBe(2)
  })

  it('pullback_resume_vol_x_exit_structural: 등록된 조합의 entryVariant는 PULLBACK_ENTRY_VARIANTS 소속이며 type="pullback"이다', () => {
    const combo = COMBOS.find((c) => c.name === 'pullback_resume_vol_x_exit_structural')
    expect(combo).toBeDefined()
    expect(combo.entryVariant).toBe(PULLBACK_ENTRY_VARIANTS.pullback_resume_vol)
    expect(combo.entryVariant.type).toBe('pullback')
  })

  it('entryVariant.type="pullback" 배선 검증: computeComboPerformance가 entryType을 눌림목형으로 넘겨 exit_structural이 눌림 저점 기준 손절을 적용한다 (체결 자체는 항상 신호일에 이뤄지는 최소 가짜 진입 변형으로 격리 — pullback_resume_vol 자체의 체결 로직은 entries.test.js에서 이미 검증됨)', () => {
    const series = makePullbackStructuralSeries(15, [175, 165, ...Array(58).fill(165)])
    const tickers2 = [{ ticker: 'COMBOPULLBACKX', dataSufficient: true, series }]
    const priceIndex2 = buildPriceIndex(tickers2)
    const record = { date: series[PB_ENTRY_IDX].date, ticker: 'COMBOPULLBACKX', strategyKey: 'trend', basis: 'top5' }
    const fakePullbackVariant = { name: 'fake_pullback_entry', type: 'pullback', simulate: (s, entryIdx) => ({ filled: true, fillIdx: entryIdx, fillPrice: s[entryIdx].close }) }
    const perf = computeComboPerformance(record, priceIndex2, fakePullbackVariant, EXIT_RULES.exit_structural)
    expect(perf.filled).toBe(true)
    expect(perf.stopHit).toBe(true)
    expect(perf.holdingDaysActual).toBe(2)
  })
})

// --- v11 US-9: 청산 변형 E(클라이맥스 부분 청산) 픽스처 ---
// 60일 평평(100) 베이스 → entryIdx=59 → day60~69(offset1~10) 클라이맥스 스파이크(103..130,
// day69=X4 발생일) → day70~119(offset11~60)는 130에서 160까지 추가 상승(day119=160). 이렇게
// 하면 세 시나리오가 뚜렷이 갈린다: 무청산(day119=160, +60%) vs 전량 클라이맥스 청산
// (day69=130, +30%) vs 부분 청산(50%×30% + 50%×60% = +45%, 정확히 그 사이).
const CLIMAX_SPIKE = Array.from({ length: 10 }, (_, k) => 100 + 3 * (k + 1)) // day60~69: 103..130
const CLIMAX_FURTHER_RISE = Array.from({ length: 50 }, (_, k) => 130 + 0.6 * (k + 1)) // day70~119: 130.6..160
const climaxSeries = makeExtendedSeries([...CLIMAX_SPIKE, ...CLIMAX_FURTHER_RISE])
const climaxTickers = [{ ticker: 'CLIMAXX', dataSufficient: true, series: climaxSeries }]
const climaxPriceIndex = buildPriceIndex(climaxTickers)
const climaxRecord = { date: climaxSeries[ENTRY_IDX].date, ticker: 'CLIMAXX', strategyKey: 'trend', basis: 'top5' }

const gentleSeries = makeExtendedSeries(Array.from({ length: 60 }, (_, k) => 100 + 0.1 * (k + 1))) // 클라이맥스 미달, day119=106
const gentleTickers = [{ ticker: 'GENTLEX', dataSufficient: true, series: gentleSeries }]
const gentlePriceIndex = buildPriceIndex(gentleTickers)
const gentleRecord = { date: gentleSeries[ENTRY_IDX].date, ticker: 'GENTLEX', strategyKey: 'trend', basis: 'top5' }

describe('exits.mjs — computeClimaxPartialPerformance (v11 US-9 AC1: 손계산 픽스처, X4 발생/미발생)', () => {
  it('X4 발생 시 50%는 발생일(day69) 종가로, 잔여 50%는 60일 만기(day119) 종가로 청산되어 가중 평균 수익률(+45%)이 된다', () => {
    const perf = computeClimaxPartialPerformance(climaxRecord, climaxPriceIndex)
    expect(perf.climaxTriggered).toBe(true)
    expect(perf.legs).toHaveLength(2)
    expect(perf.legs[0].date).toBe(climaxSeries[69].date)
    expect(perf.legs[0].weight).toBe(0.5)
    expect(perf.legs[0].returnPct).toBeCloseTo(0.3, 10)
    expect(perf.legs[1].weight).toBe(0.5)
    expect(perf.legs[1].returnPct).toBeCloseTo(0.6, 10)
    expect(perf.returnPct).toBeCloseTo(0.5 * 0.3 + 0.5 * 0.6, 10)
  })

  it('X4 미발생 시 전액(100%)이 60일 만기로 청산되어 고정 60일 보유와 정확히 같은 결과가 된다', () => {
    const perf = computeClimaxPartialPerformance(gentleRecord, gentlePriceIndex)
    expect(perf.climaxTriggered).toBe(false)
    expect(perf.legs).toHaveLength(1)
    expect(perf.legs[0].weight).toBe(1)
    expect(perf.returnPct).toBeCloseTo(gentleSeries[119].close / 100 - 1, 10)
  })
})

describe('exits.mjs — computeClimaxPartialPerformance (v11 US-9 AC2: exitSignals.js 재사용 확인)', () => {
  it('부분 청산의 첫 레그 날짜가 evaluateExitSignals()가 직접 판정한 첫 X4 발생일(day69)과 정확히 같다', () => {
    const perf = computeClimaxPartialPerformance(climaxRecord, climaxPriceIndex)
    // day68(offset9)까지는 아직 X4가 아니고, day69(offset10)에 처음 X4가 뜬다는 것을 직접 확인.
    const beforeDirect = evaluateExitSignals(climaxSeries.slice(0, ENTRY_IDX + 1 + 9))
    const atDirect = evaluateExitSignals(climaxSeries.slice(0, ENTRY_IDX + 1 + 10))
    expect(beforeDirect.signals.some((s) => s.code === 'X4')).toBe(false)
    expect(atDirect.signals.some((s) => s.code === 'X4')).toBe(true)
    expect(perf.legs[0].date).toBe(climaxSeries[69].date)
  })
})

describe('exits.mjs — aggregateClimaxPartialPerformance / climaxTriggerRate (v11 US-9)', () => {
  it('climaxTriggerRate가 발동 비율을 정확히 집계한다(1건 발동 + 1건 미발동 = 50%)', () => {
    const combinedTickers = [
      { ticker: 'CLIMAXX', dataSufficient: true, series: climaxSeries },
      { ticker: 'GENTLEX', dataSufficient: true, series: gentleSeries },
    ]
    const combinedPriceIndex = buildPriceIndex(combinedTickers)
    const agg = aggregateClimaxPartialPerformance([climaxRecord, gentleRecord], combinedPriceIndex)
    expect(agg.signals).toBe(2)
    expect(agg.climaxTriggerRate).toBeCloseTo(0.5, 10)
  })

  it('표본이 0이면 NaN 없이 전부 null이다(climaxTriggerRate 포함)', () => {
    const agg = aggregateClimaxPartialPerformance([], climaxPriceIndex)
    expect(agg.signals).toBe(0)
    expect(agg.avgExcess).toBeNull()
    expect(agg.climaxTriggerRate).toBeNull()
  })
})

describe('exits.mjs — v11 US-9 AC3: 부분 청산 성과가 무청산과 전량 클라이맥스 청산 사이에 위치(가중 평균 보증)', () => {
  it('전량 클라이맥스 청산(+30%) < 부분 청산(+45%) < 무청산(+60%)', () => {
    const noExit = walkExit(climaxSeries, ENTRY_IDX, EXIT_RULES.exit_stop8_time60) // -8% 손절선은 절대 닿지 않아 사실상 60일 만기 고정 보유와 동일
    const fullClimaxExit = walkExit(climaxSeries, ENTRY_IDX, EXIT_RULES.exit_climax)
    const partial = computeClimaxPartialPerformance(climaxRecord, climaxPriceIndex)

    const noExitReturn = noExit.exitClose / 100 - 1
    const fullClimaxReturn = fullClimaxExit.exitClose / 100 - 1

    expect(noExit.holdingDaysActual).toBe(60) // 시간 청산 확인(손절 미도달)
    expect(fullClimaxExit.stopHit).toBe(true) // X4로 전량 조기 청산 확인
    expect(fullClimaxReturn).toBeLessThan(partial.returnPct)
    expect(partial.returnPct).toBeLessThan(noExitReturn)
  })
})
