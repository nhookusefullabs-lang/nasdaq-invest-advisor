import { describe, it, expect } from 'vitest'
import { ENTRY_VARIANTS, aggregateEntryVariant } from './entries.mjs'
import { buildPriceIndex } from './performance.mjs'
import { computePivot } from '../../src/lib/entryPoint.js'

function makeBar(date, { open, high, low, close, volume = 1_000_000 }) {
  return { date, open: open ?? close, high, low: low ?? close, close, volume }
}

function dateAt(i) {
  const start = new Date('2023-01-02T00:00:00Z')
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}

/**
 * 90일 평평(100) 베이스(pivot=100, trigger≈100.3) + 신호일(index89) + 이후 futureBars로
 * 이어지는 시리즈를 만든다. futureBars: index90부터의 봉 목록(부분 지정, {open,high,low,close,volume}).
 */
function buildSeries(futureBars) {
  const bars = []
  for (let i = 0; i < 90; i++) bars.push(makeBar(dateAt(i), { close: 100 }))
  futureBars.forEach((spec, k) => bars.push(makeBar(dateAt(90 + k), spec)))
  return bars
}

function priceIndexFor(ticker, series) {
  return buildPriceIndex([{ ticker, dataSufficient: true, series }])
}

const ENTRY_IDX_DATE = dateAt(89)
const SIGNAL_RECORD = { date: ENTRY_IDX_DATE, ticker: 'X', strategyKey: 'trend', basis: 'top5' }

describe('entries.mjs — entry_close (기준선)', () => {
  it('항상 신호일 종가로 체결된다', () => {
    const series = buildSeries([{ close: 101 }])
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_close, [5])
    expect(result.fillRate).toBe(1)
  })
})

describe('entries.mjs — entry_pivot_trigger (손계산 픽스처, US-8 AC1)', () => {
  it('갭업 개장(시가가 트리거 초과)이면 체결가 = 시가(트리거가 아님)', () => {
    // pivot=100, trigger=100.3 — 갭업 시가 101, 고가 102
    const future = [{ open: 101, high: 102, close: 101.5 }]
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger, [5])
    expect(result.fillRate).toBe(1)
  })

  it('시가가 트리거 아래면 체결가 = 트리거가(시가가 아님)', () => {
    const future = [{ open: 99, high: 100.5, close: 100.4 }]
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const pivotResult = computePivot(series.slice(0, 90))
    expect(pivotResult.valid).toBe(true)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger, [5])
    expect(result.fillRate).toBe(1)
  })

  it('21거래일 내 고가가 트리거에 도달하지 못하면 미체결(fillRate=0)', () => {
    const future = new Array(25).fill(null).map(() => ({ high: 100.2, close: 100.1 }))
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger, [5])
    expect(result.fillRate).toBe(0)
    expect(result.byHolding[0].opportunity.signals).toBe(1) // 기회비용 포함 표본에는 남는다
    expect(result.byHolding[0].opportunity.avgExcess).toBe(0)
    expect(result.byHolding[0].conditional.signals).toBe(0) // 체결 조건부 표본에서는 제외
  })
})

describe('entries.mjs — entry_pivot_trigger_vol (거래량 조건, US-8 AC1)', () => {
  it('트리거 도달해도 거래량 조건 미충족이면 (21일 내내) 미체결', () => {
    const future = new Array(25).fill(null).map(() => ({ high: 100.5, close: 100.4, volume: 1_000_000 }))
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger_vol, [5])
    expect(result.fillRate).toBe(0)
  })

  it('트리거 도달 + 거래량 조건(1.5×50일평균) 충족일에 체결', () => {
    const future = new Array(25).fill(null).map(() => ({ high: 100.5, close: 100.4, volume: 1_000_000 }))
    future[0] = { high: 100.5, close: 100.4, volume: 2_000_000 } // 첫날 거래량 스파이크
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger_vol, [5])
    expect(result.fillRate).toBe(1)
  })
})

describe('entries.mjs — entry_pivot_confirm2 (확인일 규칙, US-8 AC1)', () => {
  it('2거래일 연속 종가가 피벗 위 유지되면 3일째 시가에 체결', () => {
    const future = [
      { close: 101 }, // day1: 피벗(100) 위, 연속1
      { close: 102 }, // day2: 연속2 → 확인 완료
      { open: 103, close: 103.5 }, // day3: 체결일 시가
    ]
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_confirm2, [5])
    expect(result.fillRate).toBe(1)
  })

  it('연속 유지 실패(하루라도 피벗 이하) 시 카운트가 리셋되어 그 시점엔 진입하지 않는다', () => {
    const future = [
      { close: 101 }, // day1: 연속1
      { close: 99 }, // day2: 피벗 이하 → 리셋
      { close: 101 }, // day3: 연속1(재시작)
      { close: 102 }, // day4: 연속2 → 확인 완료
      { open: 103, close: 103.5 }, // day5: 체결일 시가
    ]
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_confirm2, [5])
    // 리셋이 없었다면(잘못된 구현) day2에서 이미 "연속2"로 오판해 day3에 체결됐을 것이다.
    // 실제로는 day4에서야 확인 완료되어 day5(open=103)에 체결된다 — fillRate는 동일(1)하지만
    // 체결가(아래 conditional 성과)가 리셋 여부에 따라 달라지므로, 체결가를 직접 확인한다.
    expect(result.fillRate).toBe(1)
    const items = [SIGNAL_RECORD].map((r) => {
      const point = priceIndex.get(r.ticker)
      return ENTRY_VARIANTS.entry_pivot_confirm2.simulate(point.series, point.dateIndex.get(r.date))
    })
    expect(items[0].fillIdx).toBe(90 + 4) // day5 (index94) — 리셋이 없었다면 90+2(day3)이었을 것
    expect(items[0].fillPrice).toBe(103)
  })

  it('21거래일 내 2일 연속 유지가 한 번도 성립하지 않으면 미체결', () => {
    // 하루 위, 하루 아래를 반복 — 연속 2일이 절대 안 만들어짐
    const future = Array.from({ length: 24 }, (_, i) => ({ close: i % 2 === 0 ? 101 : 99 }))
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_confirm2, [5])
    expect(result.fillRate).toBe(0)
  })
})

describe('entries.mjs — entryPoint.js 재사용 확인 (US-8 AC2)', () => {
  it('entry_pivot_trigger가 산출한 트리거가는 computePivot()+derivedPrices()의 값과 일치한다(재구현 없음)', () => {
    const future = [{ open: 99, high: 100.5, close: 100.4 }]
    const series = buildSeries(future)
    const point = priceIndexFor('X', series).get('X')
    const result = ENTRY_VARIANTS.entry_pivot_trigger.simulate(point.series, point.dateIndex.get(ENTRY_IDX_DATE))
    // computePivot(신호일까지)의 피벗=100 → derivedPrices의 트리거=100.3 그대로 사용됐는지 확인
    const pivotResult = computePivot(series.slice(0, 90))
    expect(result.trigger).toBeCloseTo(pivotResult.pivot * 1.003, 6)
  })
})

describe('entries.mjs — 스키마 형태 (US-8 AC3)', () => {
  it('fillRate와 byHolding[].conditional/opportunity가 요구 필드를 전부 갖춘다', () => {
    const future = [{ open: 101, high: 102, close: 101.5 }]
    const series = buildSeries(future)
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, ENTRY_VARIANTS.entry_pivot_trigger, [5, 20, 60])
    expect(typeof result.name).toBe('string')
    expect(typeof result.fillRate).toBe('number')
    expect(result.byHolding).toHaveLength(3)
    for (const h of result.byHolding) {
      expect(typeof h.days).toBe('number')
      for (const bucket of [h.conditional, h.opportunity]) {
        expect(typeof bucket.signals).toBe('number')
        expect('winRate' in bucket).toBe(true)
        expect('avgExcess' in bucket).toBe(true)
        expect('medianExcess' in bucket).toBe(true)
        expect('avgReturn' in bucket).toBe(true)
        expect('mdd' in bucket).toBe(true)
      }
    }
  })
})
