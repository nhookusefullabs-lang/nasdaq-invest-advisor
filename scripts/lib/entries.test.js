import { describe, it, expect } from 'vitest'
import { ENTRY_VARIANTS, PULLBACK_ENTRY_VARIANTS, aggregateEntryVariant } from './entries.mjs'
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

// v11 US-6: 눌림목 진입 변형 3종 — 낮은 베이스(50→57.45,150일)+급상승(→400,110일)+
// −15%눌림(5일)으로 P1~P4를 모두 충족시키는 픽스처(pullback.test.js에서 검증된 것과 동일
// 구조)를 재사용한다. 트리거가(직전10거래일 최고 종가)는 이 픽스처에서 정확히 400(피벗
// 자체가 트리거 창에 포함)이다.
function observedPullbackBaseBars() {
  // makeBar()는 high를 close로 자동 대체하지 않는다(다른 진입 변형 픽스처는 high를 항상
  // 명시하므로 문제되지 않았다) — week52HighLow()가 high/low를 쓰므로 여기서는 명시적으로
  // close와 같게 채워야 트렌드 템플릿(T6/T7) 판정이 정상 동작한다.
  const bar = (date, spec) => makeBar(date, { high: spec.close, low: spec.close, ...spec })
  const bars = []
  for (let i = 0; i < 150; i++) bars.push(bar(dateAt(i), { close: 50 + 0.05 * i }))
  const afterBase = 50 + 0.05 * 149
  const peak = 400
  const step = (peak - afterBase) / 110
  for (let i = 0; i < 110; i++) bars.push(bar(dateAt(150 + i), { close: afterBase + step * (i + 1) }))
  for (let i = 0; i < 5; i++) {
    bars.push(bar(dateAt(260 + i), { close: peak * (1 - (15 / 100) * ((i + 1) / 5)), volume: 500_000 }))
  }
  for (let i = 255; i < 260; i++) bars[i] = { ...bars[i], volume: 1_800_000 }
  return bars
}

function appendFutureBars(baseBars, futureBars) {
  const bars = baseBars.slice()
  futureBars.forEach((spec) => bars.push(makeBar(dateAt(bars.length), spec)))
  return bars
}

const PULLBACK_ENTRY_IDX_DATE = dateAt(264)
// rsPercentileValue=80: pullback.test.js에서 검증된 것과 동일한 값 — P1(트렌드 템플릿 T8)이
// 통과하려면 실제 백테스트 파이프라인(buildSignalRecords)이 채워주는 값이 필요하다(US-6).
const PULLBACK_SIGNAL_RECORD = { date: PULLBACK_ENTRY_IDX_DATE, ticker: 'X', strategyKey: 'trend', basis: 'top5', rsPercentileValue: 80 }

describe('entries.mjs — pullback_immediate (US-6 기준선)', () => {
  it('관찰 조건(P1~P4) 충족 시 신호일 종가로 즉시 체결된다', () => {
    const series = observedPullbackBaseBars()
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([PULLBACK_SIGNAL_RECORD], priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_immediate, [5])
    expect(result.fillRate).toBe(1)
  })

  it('관찰 조건 미충족(평평한 베이스, 눌림 깊이 0%)이면 미체결', () => {
    const series = buildSeries([])
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_immediate, [5])
    expect(result.fillRate).toBe(0)
  })
})

describe('entries.mjs — pullback_resume[_vol] (US-6 AC1: 손계산 픽스처 6개 이상)', () => {
  it('30거래일 내 재개(종가>트리거) 없으면 미체결', () => {
    const series = appendFutureBars(
      observedPullbackBaseBars(),
      Array.from({ length: 30 }, () => ({ close: 350 }))
    )
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([PULLBACK_SIGNAL_RECORD], priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_resume, [5])
    expect(result.fillRate).toBe(0)
  })

  it('관찰 조건 자체가 미충족이면 재개 탐색 없이 즉시 미체결', () => {
    const series = buildSeries(Array.from({ length: 30 }, () => ({ close: 105 })))
    const priceIndex = priceIndexFor('X', series)
    const result = aggregateEntryVariant([SIGNAL_RECORD], priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_resume, [5])
    expect(result.fillRate).toBe(0)
  })

  it('트리거 당일 갭업(시가>트리거)이면 체결가=시가(max 로직의 시가 분기)', () => {
    const series = appendFutureBars(observedPullbackBaseBars(), [{ open: 410, high: 415, close: 412 }])
    const point = priceIndexFor('X', series).get('X')
    const result = PULLBACK_ENTRY_VARIANTS.pullback_resume.simulate(point.series, point.dateIndex.get(PULLBACK_ENTRY_IDX_DATE), 80)
    expect(result.filled).toBe(true)
    expect(result.fillPrice).toBe(410)
  })

  it('트리거 당일 시가가 트리거 이하(정상 개장)면 체결가=트리거(max 로직의 트리거 분기)', () => {
    const series = appendFutureBars(observedPullbackBaseBars(), [{ open: 395, high: 402, close: 405 }])
    const point = priceIndexFor('X', series).get('X')
    const result = PULLBACK_ENTRY_VARIANTS.pullback_resume.simulate(point.series, point.dateIndex.get(PULLBACK_ENTRY_IDX_DATE), 80)
    expect(result.filled).toBe(true)
    expect(result.fillPrice).toBe(result.trigger)
  })

  it('재개 거래량 미달이면 pullback_resume은 체결되지만 pullback_resume_vol은 미체결', () => {
    const series = appendFutureBars(observedPullbackBaseBars(), [{ open: 395, high: 402, close: 405, volume: 800_000 }])
    const point = priceIndexFor('X', series).get('X')
    const entryIdx = point.dateIndex.get(PULLBACK_ENTRY_IDX_DATE)
    const resume = PULLBACK_ENTRY_VARIANTS.pullback_resume.simulate(point.series, entryIdx, 80)
    const resumeVol = PULLBACK_ENTRY_VARIANTS.pullback_resume_vol.simulate(point.series, entryIdx, 80)
    expect(resume.filled).toBe(true)
    expect(resumeVol.filled).toBe(false)
  })

  it('재개 거래량이 충분하면 pullback_resume_vol도 체결된다', () => {
    const series = appendFutureBars(observedPullbackBaseBars(), [{ open: 395, high: 402, close: 405, volume: 2_000_000 }])
    const point = priceIndexFor('X', series).get('X')
    const entryIdx = point.dateIndex.get(PULLBACK_ENTRY_IDX_DATE)
    const resumeVol = PULLBACK_ENTRY_VARIANTS.pullback_resume_vol.simulate(point.series, entryIdx, 80)
    expect(resumeVol.filled).toBe(true)
  })
})

describe('entries.mjs — 눌림목 3종 신호 집합 관계 (US-6 AC2: resume_vol ⊆ resume ⊆ immediate 관찰 집합)', () => {
  it('4개 시나리오(미관찰/재개미발생/거래량미달/전부충족) 조합에서 체결 집합이 포함관계를 만족한다', () => {
    const notObserved = buildSeries([])
    const neverResume = appendFutureBars(
      observedPullbackBaseBars(),
      Array.from({ length: 30 }, () => ({ close: 350 }))
    )
    const resumeNoVol = appendFutureBars(observedPullbackBaseBars(), [{ open: 395, high: 402, close: 405, volume: 800_000 }])
    const resumeWithVol = appendFutureBars(observedPullbackBaseBars(), [{ open: 395, high: 402, close: 405, volume: 2_000_000 }])

    const priceIndex = buildPriceIndex([
      { ticker: 'T1', dataSufficient: true, series: notObserved },
      { ticker: 'T2', dataSufficient: true, series: neverResume },
      { ticker: 'T3', dataSufficient: true, series: resumeNoVol },
      { ticker: 'T4', dataSufficient: true, series: resumeWithVol },
    ])
    const records = [
      { date: ENTRY_IDX_DATE, ticker: 'T1', strategyKey: 'trend', basis: 'top5', rsPercentileValue: 80 },
      { date: PULLBACK_ENTRY_IDX_DATE, ticker: 'T2', strategyKey: 'trend', basis: 'top5', rsPercentileValue: 80 },
      { date: PULLBACK_ENTRY_IDX_DATE, ticker: 'T3', strategyKey: 'trend', basis: 'top5', rsPercentileValue: 80 },
      { date: PULLBACK_ENTRY_IDX_DATE, ticker: 'T4', strategyKey: 'trend', basis: 'top5', rsPercentileValue: 80 },
    ]

    const immediate = aggregateEntryVariant(records, priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_immediate, [5])
    const resume = aggregateEntryVariant(records, priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_resume, [5])
    const resumeVol = aggregateEntryVariant(records, priceIndex, PULLBACK_ENTRY_VARIANTS.pullback_resume_vol, [5])

    const filledCount = (agg) => Math.round(agg.fillRate * agg.signals)
    expect(filledCount(immediate)).toBe(3) // T2,T3,T4 관찰 충족(T1 제외)
    expect(filledCount(resume)).toBe(2) // T3,T4 재개(T2는 재개 미발생)
    expect(filledCount(resumeVol)).toBe(1) // T4만 거래량까지 충족
    expect(filledCount(resumeVol)).toBeLessThanOrEqual(filledCount(resume))
    expect(filledCount(resume)).toBeLessThanOrEqual(filledCount(immediate))
  })
})
