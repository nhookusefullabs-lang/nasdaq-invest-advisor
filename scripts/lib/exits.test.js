import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { walkExit, computeExitPerformance, aggregateExitPerformance, EXIT_RULES, EXIT_LIMITATION_NOTE, COMBOS, computeComboPerformance, aggregateComboPerformance } from './exits.mjs'
import { buildPriceIndex } from './performance.mjs'
import { sliceUniverseAsOf } from './asOf.mjs'
import { evaluateExitSignals } from '../../src/lib/exitSignals.js'
import { ENTRY_VARIANTS } from './entries.mjs'
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
  it('COMBOS가 정확히 3개 등록되어 있고 각각 entryVariant/exitRule을 명시한다', () => {
    expect(COMBOS).toHaveLength(3)
    for (const combo of COMBOS) {
      expect(typeof combo.name).toBe('string')
      expect(combo.entryVariant).toBeDefined()
      expect(combo.exitRule).toBeDefined()
      expect(Object.values(ENTRY_VARIANTS)).toContain(combo.entryVariant)
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
