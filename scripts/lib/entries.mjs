// 백테스트 — 진입 변형 4종 (PRD_Nasdaq10 §4.5/§7, design-entry-point-engine.md §7, US-8)
// entryPoint.js(computePivot/derivedPrices)를 그대로 재사용한다 — 피벗/트리거 재구현 금지.
// "미래 참조 금지" 원칙은 신호(추천) 판정에만 적용된다 — 체결 시점 탐색은 신호일 이후의
// 실제 가격 경로를 보는 진입 시뮬레이션이므로 정상이다(exits.mjs의 청산 시뮬레이션과 동일 원칙).
import { entryPoint as priceEntryPoint, universeBenchmarkReturn, maxDrawdown, average, median, round4 } from './performance.mjs'
import { computePivot, derivedPrices } from '../../src/lib/entryPoint.js'
import { sma } from '../../src/lib/indicators.js'
import { VOL_MULT } from '../../src/lib/constants/entry.js'

const TRIGGER_WINDOW_DAYS = 21

/** 체결가 = max(트리거가, 당일 시가). open 필드가 없는 구버전 픽스처는 종가로 근사(하위 호환). */
function fillPriceForBar(bar, trigger) {
  const openPrice = bar.open ?? bar.close
  return Math.max(trigger, openPrice)
}

/** entry_close: 기준선 — 신호일 종가 그대로 체결(항상 체결). */
function simulateEntryClose(series, entryIdx) {
  return { filled: true, fillIdx: entryIdx, fillPrice: series[entryIdx].close }
}

/**
 * entry_pivot_trigger[_vol]: 신호일까지의 데이터로 피벗/트리거를 계산(미래 참조 없음)한 뒤,
 * 신호일 다음날부터 TRIGGER_WINDOW_DAYS(21)거래일 내 고가≥트리거인 첫날에 체결한다
 * (체결가=max(트리거가,당일 시가) — 갭업 개장 반영). requireVolume=true면 그날 거래량이
 * VOL_MULT×50일평균거래량 이상인 조건도 함께 만족해야 한다.
 */
function simulateTriggerEntry(series, entryIdx, { requireVolume }) {
  const asOfSeries = series.slice(0, entryIdx + 1)
  const pivotResult = computePivot(asOfSeries)
  if (!pivotResult.valid) return { filled: false, reason: '피벗 산정 불가' }

  const currentClose = asOfSeries[asOfSeries.length - 1].close
  const derived = derivedPrices({ pivot: pivotResult.pivot, currentClose })
  const trigger = derived.trigger
  const volSma50 = requireVolume ? sma(series.map((b) => b.volume), 50) : null

  for (let offset = 1; offset <= TRIGGER_WINDOW_DAYS; offset++) {
    const idx = entryIdx + offset
    if (idx >= series.length) break
    const bar = series[idx]
    if (bar.high < trigger) continue
    if (requireVolume) {
      const volOK = volSma50[idx] != null && bar.volume >= VOL_MULT * volSma50[idx]
      if (!volOK) continue
    }
    return { filled: true, fillIdx: idx, fillPrice: fillPriceForBar(bar, trigger), trigger }
  }
  return { filled: false, reason: '유효기간(21거래일) 내 미체결', trigger }
}

/**
 * entry_pivot_confirm2: 신호일까지 데이터로 피벗을 계산한 뒤, 신호일 다음날부터 종가가
 * 피벗 위로 "2거래일 연속" 유지되면 확인 완료 다음날(3일째) 시가에 체결한다. 확인 도중
 * 하루라도 종가가 피벗 이하로 내려오면 연속 카운트가 리셋된다. 21거래일 내 확인 실패 시 미체결.
 */
function simulateConfirm2Entry(series, entryIdx) {
  const asOfSeries = series.slice(0, entryIdx + 1)
  const pivotResult = computePivot(asOfSeries)
  if (!pivotResult.valid) return { filled: false, reason: '피벗 산정 불가' }

  const pivot = pivotResult.pivot
  let consecutive = 0

  for (let offset = 1; offset <= TRIGGER_WINDOW_DAYS; offset++) {
    const idx = entryIdx + offset
    if (idx >= series.length) break
    const bar = series[idx]
    if (bar.close > pivot) {
      consecutive++
      if (consecutive >= 2) {
        const fillIdx = idx + 1
        if (fillIdx >= series.length) return { filled: false, reason: '확인 완료 직후 데이터 부족', pivot }
        const fillBar = series[fillIdx]
        return { filled: true, fillIdx, fillPrice: fillBar.open ?? fillBar.close, pivot }
      }
    } else {
      consecutive = 0
    }
  }
  return { filled: false, reason: '유효기간(21거래일) 내 확인 실패', pivot }
}

export const ENTRY_VARIANTS = {
  entry_close: {
    name: 'entry_close',
    description: '신호일 종가 그대로 체결 (기준선)',
    simulate: (series, entryIdx) => simulateEntryClose(series, entryIdx),
  },
  entry_pivot_trigger: {
    name: 'entry_pivot_trigger',
    description: '트리거가 도달 첫날 체결 (체결가=max(T,시가))',
    simulate: (series, entryIdx) => simulateTriggerEntry(series, entryIdx, { requireVolume: false }),
  },
  entry_pivot_trigger_vol: {
    name: 'entry_pivot_trigger_vol',
    description: '트리거 도달 + 거래량 조건(1.5×50일평균) 동시 충족 첫날 체결',
    simulate: (series, entryIdx) => simulateTriggerEntry(series, entryIdx, { requireVolume: true }),
  },
  entry_pivot_confirm2: {
    name: 'entry_pivot_confirm2',
    description: '돌파 후 2거래일 종가가 피벗 위 유지 확인 시 3일째 시가 체결',
    simulate: (series, entryIdx) => simulateConfirm2Entry(series, entryIdx),
  },
}

function summarize(items) {
  if (!items.length) {
    return { signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null }
  }
  const excess = items.map((i) => i.excessReturn)
  const rets = items.map((i) => i.returnPct)
  const mdds = items.map((i) => i.mdd)
  const wins = excess.filter((e) => e > 0).length
  return {
    signals: items.length,
    winRate: round4(wins / items.length),
    avgExcess: round4(average(excess)),
    medianExcess: round4(median(excess)),
    avgReturn: round4(average(rets)),
    mdd: round4(average(mdds)),
  }
}

/** 체결된 신호 하나를 holdingDays 보유 성과로 확장한다. 청산일 범위 초과/벤치마크 불가 시 exitOutOfRange:true. */
function computeEntryPerformanceForHolding(fillInfo, priceIndex, holdingDays) {
  const { record, point, result } = fillInfo
  if (!result.filled) return { ...record, filled: false }

  const exitIdx = result.fillIdx + holdingDays
  if (exitIdx >= point.series.length) return { ...record, filled: true, exitOutOfRange: true }

  const fillPrice = result.fillPrice
  const exitClose = point.series[exitIdx].close
  const returnPct = exitClose / fillPrice - 1
  const fillDate = point.series[result.fillIdx].date
  const benchmarkReturn = universeBenchmarkReturn(priceIndex, fillDate, holdingDays)
  if (benchmarkReturn == null) return { ...record, filled: true, exitOutOfRange: true }

  const closes = point.series.slice(result.fillIdx, exitIdx + 1).map((b) => b.close)

  return {
    ...record,
    filled: true,
    fillPrice,
    returnPct,
    benchmarkReturn,
    excessReturn: returnPct - benchmarkReturn,
    mdd: maxDrawdown(closes),
  }
}

/**
 * records(보통 trend·top5·Out) 전체를 진입 변형 하나로 집계한다. 체결 판정(체결률)은
 * holdingDays와 무관하게 한 번만 계산하고, 보유기간별로 두 벌 성과를 산출한다:
 * conditional(체결 조건부 — 미체결/범위초과 제외), opportunity(기회비용 포함 — 미체결은
 * 초과수익 0으로 반영). 반환: { name, signals, fillRate, byHolding:[{days,conditional,opportunity}] }
 */
export function aggregateEntryVariant(records, priceIndex, variant, holdingDaysList) {
  const fillResults = records
    .map((r) => {
      const point = priceEntryPoint(priceIndex, r.ticker, r.date)
      if (!point) return null
      return { record: r, point, result: variant.simulate(point.series, point.idx) }
    })
    .filter(Boolean)

  const fillRate = fillResults.length ? round4(fillResults.filter((f) => f.result.filled).length / fillResults.length) : null

  const byHolding = holdingDaysList.map((days) => {
    const items = fillResults.map((f) => computeEntryPerformanceForHolding(f, priceIndex, days))
    const measurable = items.filter((i) => i.filled && !i.exitOutOfRange && i.excessReturn != null)
    const conditional = summarize(measurable)
    const opportunityItems = items.map((i) => (i.filled && !i.exitOutOfRange && i.excessReturn != null ? i : { ...i, excessReturn: 0, returnPct: 0, mdd: 0 }))
    const opportunity = summarize(opportunityItems)
    return { days, conditional, opportunity }
  })

  return { name: variant.name, signals: fillResults.length, fillRate, byHolding }
}
