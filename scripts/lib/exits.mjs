// 변형 D — 경로 의존 청산 규칙 (prd-v9.1-diagnostics.md US-2, 가설 ②)
// 기존 고정 N거래일 청산(performance.mjs)은 변경하지 않고 그대로 공존시킨다. 이 파일은
// "진입은 동일, 청산만 상이"한 두 후보(손절만 / 손절+트레일링)를 추가로 측정한다.
// 벤치마크·MDD 계산은 performance.mjs의 기존 함수를 그대로 재사용(재구현 금지) — 실제
// 도달한 보유일수(holdingDaysActual)를 그 함수들의 holdingDays 인자로 넘길 뿐이다.
import { entryPoint, universeBenchmarkReturn, maxDrawdown, average, median, round4 } from './performance.mjs'
import { atr } from '../../src/lib/indicators.js'
import { ATR_STOP_MULT } from '../../src/lib/constants/entry.js'
import { evaluateExitSignals } from '../../src/lib/exitSignals.js'
import { ENTRY_VARIANTS } from './entries.mjs'

const MAX_HOLDING_DAYS = 60
const STOP_PCT = 0.08
const TRAIL_PCT = 0.15

export const EXIT_LIMITATION_NOTE = '종가 기준 판정 — 장중 이탈 미반영으로 실제 손절 체결가는 이보다 불리할 수 있음'

/** 신호(코드) 발생 여부를 exitSignals.js로 그대로 판정한다(재구현 금지) — idx일까지의 슬라이스만 본다. */
function hasExitSignalCode(series, idx, code) {
  const { signals } = evaluateExitSignals(series.slice(0, idx + 1))
  return signals.some((s) => s.code === code)
}

// checkStop({entryClose,peak,close,series,entryIdx,idx}) → 그날 청산해야 하면 true.
export const EXIT_RULES = {
  exit_stop8_time60: {
    name: 'exit_stop8_time60',
    description: '진입 종가 대비 종가 −8% 도달 시 당일 청산, 미도달 시 60거래일 시간 청산',
    checkStop: ({ entryClose, close }) => close <= entryClose * (1 - STOP_PCT),
  },
  exit_stop8_trail15: {
    name: 'exit_stop8_trail15',
    description: '손절(−8%) + 보유 중 최고 종가 대비 −15% 이탈 시 당일 청산, 미도달 시 60거래일 시간 청산',
    checkStop: ({ entryClose, peak, close }) => close <= entryClose * (1 - STOP_PCT) || close <= peak * (1 - TRAIL_PCT),
  },
  // --- v10 US-9 신규 3종 ---
  exit_stop_atr: {
    name: 'exit_stop_atr',
    description: '체결가 − 2.5×ATR14(체결일 기준 1회 산정) 손절, 미도달 시 60거래일 시간 청산',
    checkStop: ({ entryClose, close, series, entryIdx }) => {
      const atr14 = atr(series.slice(0, entryIdx + 1), 14)
      if (atr14 == null) return false
      return close <= entryClose - ATR_STOP_MULT * atr14
    },
  },
  exit_sma50_break: {
    name: 'exit_sma50_break',
    description: 'X1(50일선 이탈) 신호 발생 당일 청산, 미발생 시 60거래일 시간 청산',
    checkStop: ({ series, idx }) => hasExitSignalCode(series, idx, 'X1'),
  },
  exit_climax: {
    name: 'exit_climax',
    description: 'X4(클라이맥스 런) 신호 발생 당일 청산, 미발생 시 60거래일 시간 청산',
    checkStop: ({ series, idx }) => hasExitSignalCode(series, idx, 'X4'),
  },
}

/**
 * entryIdx 다음 거래일부터 최대 MAX_HOLDING_DAYS까지 종가 경로를 순회하며 청산 시점을 찾는다.
 * entryIdx 이전 데이터는 전혀 참조하지 않는다(peak은 진입가부터 시작, 이후만 갱신).
 * entryPrice(선택, 기본=진입일 종가): 조합 실험(US-9 combos)에서는 진입 변형의 체결가가
 * entryIdx(신호일)의 종가와 다를 수 있어(피벗 트리거 등) 별도로 받는다.
 * 반환: { exitIdx, exitClose, holdingDaysActual, stopHit } | null(경로가 데이터 범위를 벗어남).
 */
export function walkExit(series, entryIdx, exitRule, entryPrice = series[entryIdx].close) {
  let peak = entryPrice

  for (let offset = 1; offset <= MAX_HOLDING_DAYS; offset++) {
    const idx = entryIdx + offset
    if (idx >= series.length) return null
    const close = series[idx].close
    if (close > peak) peak = close
    if (exitRule.checkStop({ entryClose: entryPrice, peak, close, series, entryIdx, idx })) {
      return { exitIdx: idx, exitClose: close, holdingDaysActual: offset, stopHit: true }
    }
  }

  const timeExitIdx = entryIdx + MAX_HOLDING_DAYS
  return { exitIdx: timeExitIdx, exitClose: series[timeExitIdx].close, holdingDaysActual: MAX_HOLDING_DAYS, stopHit: false }
}

/**
 * 신호 레코드 하나를 경로 의존 청산 규칙으로 확장한다. 벤치마크는 실제 도달한
 * holdingDaysActual 구간으로 계산(고정 60일이 아님 — "청산만 상이" 원칙).
 * 반환: { ...record, returnPct, benchmarkReturn, excessReturn, mdd, holdingDaysActual, stopHit } | null
 */
export function computeExitPerformance(record, priceIndex, exitRule) {
  const point = entryPoint(priceIndex, record.ticker, record.date)
  if (!point) return null

  const result = walkExit(point.series, point.idx, exitRule)
  if (!result) return null

  const entryClose = point.series[point.idx].close
  const returnPct = result.exitClose / entryClose - 1
  const benchmarkReturn = universeBenchmarkReturn(priceIndex, record.date, result.holdingDaysActual)
  if (benchmarkReturn == null) return null

  const closes = point.series.slice(point.idx, result.exitIdx + 1).map((b) => b.close)

  return {
    ...record,
    returnPct,
    benchmarkReturn,
    excessReturn: returnPct - benchmarkReturn,
    mdd: maxDrawdown(closes),
    holdingDaysActual: result.holdingDaysActual,
    stopHit: result.stopHit,
  }
}

/**
 * records(동일 신호 집합 — 보통 trend/top5) 전체를 하나의 exitRule로 집계한다.
 * 반환: { signals, winRate, avgExcess, medianExcess, avgReturn, mdd, avgHoldingDays, stopHitRate }
 * (표본 0이면 전부 null — NaN 금지).
 */
export function aggregateExitPerformance(records, priceIndex, exitRule) {
  const items = records.map((r) => computeExitPerformance(r, priceIndex, exitRule)).filter(Boolean)

  if (!items.length) {
    return { signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null, avgHoldingDays: null, stopHitRate: null }
  }

  const excess = items.map((i) => i.excessReturn)
  const rets = items.map((i) => i.returnPct)
  const mdds = items.map((i) => i.mdd)
  const holdingDays = items.map((i) => i.holdingDaysActual)
  const wins = excess.filter((e) => e > 0).length
  const stopHits = items.filter((i) => i.stopHit).length

  return {
    signals: items.length,
    winRate: round4(wins / items.length),
    avgExcess: round4(average(excess)),
    medianExcess: round4(median(excess)),
    avgReturn: round4(average(rets)),
    mdd: round4(average(mdds)),
    avgHoldingDays: round4(average(holdingDays)),
    stopHitRate: round4(stopHits / items.length),
  }
}

// --- v10 US-9: 진입×청산 조합 실험 (§7 "미너비니 완전체 근사 vs 현행" 최종 대결) ---
// 격자 탐색을 피하고 대표 조합 3개만 등록한다(PRD 명시: "격자 자제").
export const COMBOS = [
  { name: 'entry_pivot_confirm2_x_exit_stop_atr', entryVariant: ENTRY_VARIANTS.entry_pivot_confirm2, exitRule: EXIT_RULES.exit_stop_atr },
  { name: 'entry_pivot_trigger_vol_x_exit_sma50_break', entryVariant: ENTRY_VARIANTS.entry_pivot_trigger_vol, exitRule: EXIT_RULES.exit_sma50_break },
  { name: 'entry_pivot_confirm2_x_exit_sma50_break', entryVariant: ENTRY_VARIANTS.entry_pivot_confirm2, exitRule: EXIT_RULES.exit_sma50_break },
]

/**
 * 신호 레코드 하나를 진입 변형(entries.mjs)으로 체결한 뒤, 그 체결가/체결일부터 청산 규칙으로
 * 보유·청산을 시뮬레이션한다. 미체결 신호는 { filled:false }로 남긴다(체결률 집계용).
 */
export function computeComboPerformance(record, priceIndex, entryVariant, exitRule) {
  const point = entryPoint(priceIndex, record.ticker, record.date)
  if (!point) return null

  const fillResult = entryVariant.simulate(point.series, point.idx)
  if (!fillResult.filled) return { ...record, filled: false }

  const walkResult = walkExit(point.series, fillResult.fillIdx, exitRule, fillResult.fillPrice)
  if (!walkResult) return { ...record, filled: true, exitOutOfRange: true }

  const returnPct = walkResult.exitClose / fillResult.fillPrice - 1
  const fillDate = point.series[fillResult.fillIdx].date
  const benchmarkReturn = universeBenchmarkReturn(priceIndex, fillDate, walkResult.holdingDaysActual)
  if (benchmarkReturn == null) return { ...record, filled: true, exitOutOfRange: true }

  const closes = point.series.slice(fillResult.fillIdx, walkResult.exitIdx + 1).map((b) => b.close)

  return {
    ...record,
    filled: true,
    returnPct,
    benchmarkReturn,
    excessReturn: returnPct - benchmarkReturn,
    mdd: maxDrawdown(closes),
    holdingDaysActual: walkResult.holdingDaysActual,
    stopHit: walkResult.stopHit,
  }
}

/**
 * records 전체를 진입×청산 조합 하나로 집계한다.
 * 반환: { signals, fillRate, winRate, avgExcess, medianExcess, avgReturn, mdd, avgHoldingDays }
 * (체결/청산 시뮬레이션이 불가한 표본은 fillRate·평균 계산에서만 제외 — signals는 원 신호수)
 */
export function aggregateComboPerformance(records, priceIndex, entryVariant, exitRule) {
  const items = records.map((r) => computeComboPerformance(r, priceIndex, entryVariant, exitRule)).filter(Boolean)
  const filledItems = items.filter((i) => i.filled)
  const fillRate = items.length ? round4(filledItems.length / items.length) : null
  const measurable = filledItems.filter((i) => !i.exitOutOfRange && i.excessReturn != null)

  if (!measurable.length) {
    return { signals: items.length, fillRate, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null, avgHoldingDays: null }
  }

  const excess = measurable.map((i) => i.excessReturn)
  const rets = measurable.map((i) => i.returnPct)
  const mdds = measurable.map((i) => i.mdd)
  const holdingDays = measurable.map((i) => i.holdingDaysActual)
  const wins = excess.filter((e) => e > 0).length

  return {
    signals: items.length,
    fillRate,
    winRate: round4(wins / measurable.length),
    avgExcess: round4(average(excess)),
    medianExcess: round4(median(excess)),
    avgReturn: round4(average(rets)),
    mdd: round4(average(mdds)),
    avgHoldingDays: round4(average(holdingDays)),
  }
}
