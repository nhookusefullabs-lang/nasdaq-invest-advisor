// 변형 D — 경로 의존 청산 규칙 (prd-v9.1-diagnostics.md US-2, 가설 ②)
// 기존 고정 N거래일 청산(performance.mjs)은 변경하지 않고 그대로 공존시킨다. 이 파일은
// "진입은 동일, 청산만 상이"한 두 후보(손절만 / 손절+트레일링)를 추가로 측정한다.
// 벤치마크·MDD 계산은 performance.mjs의 기존 함수를 그대로 재사용(재구현 금지) — 실제
// 도달한 보유일수(holdingDaysActual)를 그 함수들의 holdingDays 인자로 넘길 뿐이다.
import { entryPoint, universeBenchmarkReturn, maxDrawdown, average, median, round4, computePartialPositionPerformance } from './performance.mjs'
import { atr } from '../../src/lib/indicators.js'
import { ATR_STOP_MULT, PIVOT_STRUCTURAL_STOP_MULT } from '../../src/lib/constants/entry.js'
import { evaluateExitSignals } from '../../src/lib/exitSignals.js'
import { computePivot } from '../../src/lib/entryPoint.js'
import { judgePullback } from '../../src/lib/pullback.js'
import { ENTRY_VARIANTS, PULLBACK_ENTRY_VARIANTS } from './entries.mjs'

const MAX_HOLDING_DAYS = 60
const STOP_PCT = 0.08
const TRAIL_PCT = 0.15

export const EXIT_LIMITATION_NOTE = '종가 기준 판정 — 장중 이탈 미반영으로 실제 손절 체결가는 이보다 불리할 수 있음'

/** 신호(코드) 발생 여부를 exitSignals.js로 그대로 판정한다(재구현 금지) — idx일까지의 슬라이스만 본다. */
function hasExitSignalCode(series, idx, code) {
  const { signals } = evaluateExitSignals(series.slice(0, idx + 1))
  return signals.some((s) => s.code === code)
}

/** exit_stop_atr과 exit_regime_conditional이 공유하는 ATR 손절 판정(재구현 없이 함수로 공유). */
function atrStopTriggered({ entryClose, close, series, entryIdx }) {
  const atr14 = atr(series.slice(0, entryIdx + 1), 14)
  if (atr14 == null) return false
  return close <= entryClose - ATR_STOP_MULT * atr14
}

/**
 * exit_structural(v11 US-8)의 손절선 — entryType으로 분기: 'breakout'은 피벗×
 * PIVOT_STRUCTURAL_STOP_MULT(entryPoint.js의 computePivot() 재사용), 'pullback'은 눌림
 * 저점×PULLBACK_STOP_MULT(pullback.js의 judgePullback().stopReference를 그대로 재사용 —
 * 재계산 없음). entryIdx까지의 asOfSeries만 사용해 진입 시점 구조로 고정한다(승인 기준 2:
 * 이후 데이터로 재계산되지 않음). entryType이 'breakout'/'pullback' 어느 쪽도 아니거나
 * (미지정) 산정 자체가 불가하면 null — 안전 기본값(승인 기준 1): 손절 미가동, 시간 청산만.
 */
function structuralStopPrice(series, entryIdx, entryType) {
  const asOfSeries = series.slice(0, entryIdx + 1)
  if (entryType === 'pullback') {
    const judgement = judgePullback(asOfSeries)
    return judgement.insufficientData ? null : judgement.stopReference
  }
  if (entryType === 'breakout') {
    const pivotResult = computePivot(asOfSeries)
    return pivotResult.valid ? pivotResult.pivot * PIVOT_STRUCTURAL_STOP_MULT : null
  }
  return null
}

// checkStop({entryClose,peak,close,series,entryIdx,idx,regime,regimeByDate}) → 그날 청산해야 하면 true.
// regime(신호일 국면)·regimeByDate(날짜→국면 맵, US-7)는 computeExitPerformance가 호출부에서
// 채워 넘긴다 — 대부분의 규칙은 이 필드들을 쓰지 않는다.
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
    checkStop: (ctx) => atrStopTriggered(ctx),
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
  // --- v11 US-7: 청산 변형 A(국면 조건부) + regime-flip ---
  exit_regime_conditional: {
    name: 'exit_regime_conditional',
    description: '신호일 국면 상승 → 손절 없이 60거래일 보유 / 신호일 국면 중립·하락 → ATR손절(2.5×ATR14) 가동, 미도달 시 60거래일 시간 청산',
    // regime은 신호(진입) 시점의 국면으로 고정 — 보유 중 국면이 바뀌어도 이 규칙 자체는
    // 재판정하지 않는다(그 재판정은 별도 규칙 exit_regime_flip이 담당).
    checkStop: (ctx) => ctx.regime !== 'up' && atrStopTriggered(ctx),
  },
  // (Should) regime-flip: 보유 중 국면이 하락으로 "전환"되는 날 당일 청산. regimeByDate는
  // regime.js의 regimeSeries()를 유니버스 전체(미절단)에 한 번만 호출해 만든 날짜→국면 맵
  // (backtest.mjs의 buildRegimeDateMap) — 국면 판정 자체가 breadth(당일 이하 SMA200 비교
  // 창)와 히스테리시스 상태기계(과거 상태를 그대로 이어받아 전진 계산, 미래 값 참조 없음)로만
  // 이뤄지므로, 미리 전체를 한 번 계산해도 "그 날짜까지의 슬라이스"로 계산한 것과 결과가
  // 동일하다(exits.test.js AC2가 이를 직접 검증). idx일의 regimeByDate 조회값이 그 날짜
  // 자체를 전환일(transitionDate)로 갖는 'down' 상태일 때만 청산한다(전환 첫날만 — 이미
  // 하락 국면이 지속 중인 날은 재트리거하지 않음, 진입 자체가 하락장 한복판이었을 수 있으므로).
  exit_regime_flip: {
    name: 'exit_regime_flip',
    description: '보유 중 국면이 하락으로 전환되는 날 당일 청산 (국면 판정은 그 날짜까지의 데이터만 반영 — 미래 참조 없음), 미발생 시 60거래일 시간 청산',
    checkStop: ({ series, idx, regimeByDate }) => {
      if (!regimeByDate) return false
      const date = series[idx].date
      const info = regimeByDate.get(date)
      return info?.regime === 'down' && info?.transitionDate === date
    },
  },
  // --- v11 US-8: 청산 변형 C(구조 기반 손절) ---
  // entryType(context, 조합 실험 전용 — computeComboPerformance가 entryVariant.type을 그대로
  // 넘긴다)이 없는 일반 사용(evaluateExitVariants가 원 신호일 종가 체결로 단독 적용하는 경우)은
  // 안전 기본값으로 손절이 걸리지 않고 60거래일 시간 청산만 적용된다(승인 기준 1).
  exit_structural: {
    name: 'exit_structural',
    description: '진입 유형별 구조 기반 손절 — 돌파형: 피벗×0.97 / 눌림목형: 눌림 저점×0.98, 이탈 시 당일 청산, 미이탈 시 60거래일 시간 청산 (유형 불명 시 안전 기본값: 손절 미가동)',
    checkStop: ({ series, entryIdx, close, entryType }) => {
      const stopPrice = structuralStopPrice(series, entryIdx, entryType)
      return stopPrice != null && close <= stopPrice
    },
  },
}

/**
 * entryIdx 다음 거래일부터 최대 MAX_HOLDING_DAYS까지 종가 경로를 순회하며 청산 시점을 찾는다.
 * entryIdx 이전 데이터는 전혀 참조하지 않는다(peak은 진입가부터 시작, 이후만 갱신).
 * entryPrice(선택, 기본=진입일 종가): 조합 실험(US-9 combos)에서는 진입 변형의 체결가가
 * entryIdx(신호일)의 종가와 다를 수 있어(피벗 트리거 등) 별도로 받는다.
 * context(선택, US-7): checkStop에 그대로 병합되는 추가 필드 — regime(신호일 국면)·
 * regimeByDate(날짜→국면 맵) 등, exit_regime_conditional/exit_regime_flip 전용.
 * 반환: { exitIdx, exitClose, holdingDaysActual, stopHit } | null(경로가 데이터 범위를 벗어남).
 */
export function walkExit(series, entryIdx, exitRule, entryPrice = series[entryIdx].close, context = {}) {
  let peak = entryPrice

  for (let offset = 1; offset <= MAX_HOLDING_DAYS; offset++) {
    const idx = entryIdx + offset
    if (idx >= series.length) return null
    const close = series[idx].close
    if (close > peak) peak = close
    if (exitRule.checkStop({ entryClose: entryPrice, peak, close, series, entryIdx, idx, ...context })) {
      return { exitIdx: idx, exitClose: close, holdingDaysActual: offset, stopHit: true }
    }
  }

  const timeExitIdx = entryIdx + MAX_HOLDING_DAYS
  return { exitIdx: timeExitIdx, exitClose: series[timeExitIdx].close, holdingDaysActual: MAX_HOLDING_DAYS, stopHit: false }
}

/**
 * 신호 레코드 하나를 경로 의존 청산 규칙으로 확장한다. 벤치마크는 실제 도달한
 * holdingDaysActual 구간으로 계산(고정 60일이 아님 — "청산만 상이" 원칙).
 * context(선택, US-7): walkExit에 그대로 전달 — record.regime(신호일 국면)이 항상
 * 자동으로 병합되어 exit_regime_conditional이 별도 배선 없이 바로 쓸 수 있다.
 * 반환: { ...record, returnPct, benchmarkReturn, excessReturn, mdd, holdingDaysActual, stopHit } | null
 */
export function computeExitPerformance(record, priceIndex, exitRule, context = {}) {
  const point = entryPoint(priceIndex, record.ticker, record.date)
  if (!point) return null

  const result = walkExit(point.series, point.idx, exitRule, undefined, { ...context, regime: record.regime })
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
export function aggregateExitPerformance(records, priceIndex, exitRule, context = {}) {
  const items = records.map((r) => computeExitPerformance(r, priceIndex, exitRule, context)).filter(Boolean)

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
// 격자 탐색을 피하고 대표 조합만 등록한다(PRD 명시: "격자 자제").
export const COMBOS = [
  { name: 'entry_pivot_confirm2_x_exit_stop_atr', entryVariant: ENTRY_VARIANTS.entry_pivot_confirm2, exitRule: EXIT_RULES.exit_stop_atr },
  { name: 'entry_pivot_trigger_vol_x_exit_sma50_break', entryVariant: ENTRY_VARIANTS.entry_pivot_trigger_vol, exitRule: EXIT_RULES.exit_sma50_break },
  { name: 'entry_pivot_confirm2_x_exit_sma50_break', entryVariant: ENTRY_VARIANTS.entry_pivot_confirm2, exitRule: EXIT_RULES.exit_sma50_break },
  // --- v11 US-8: 대표 조합 2종 ---
  { name: 'pullback_resume_vol_x_exit_structural', entryVariant: PULLBACK_ENTRY_VARIANTS.pullback_resume_vol, exitRule: EXIT_RULES.exit_structural },
  { name: 'entry_close_x_exit_regime_conditional', entryVariant: ENTRY_VARIANTS.entry_close, exitRule: EXIT_RULES.exit_regime_conditional },
]

/**
 * 신호 레코드 하나를 진입 변형(entries.mjs)으로 체결한 뒤, 그 체결가/체결일부터 청산 규칙으로
 * 보유·청산을 시뮬레이션한다. 미체결 신호는 { filled:false }로 남긴다(체결률 집계용).
 * rsPercentileValue(v11 US-8)는 눌림목 진입 변형(pullback_*)의 P1 판정에 필요 — record에
 * 이미 실려 있으면(US-6/backtest.mjs) 그대로 전달, 돌파형 진입은 이 인자를 쓰지 않는다.
 * context(v11 US-8)는 exitRule.checkStop에 그대로 병합된다 — entryType(entryVariant.type,
 * exit_structural 전용)과 regime(record.regime, exit_regime_conditional 조합 전용)을
 * 조합 실험에서도 그대로 사용할 수 있도록 항상 채워 넘긴다(대부분의 exitRule은 무시).
 */
export function computeComboPerformance(record, priceIndex, entryVariant, exitRule) {
  const point = entryPoint(priceIndex, record.ticker, record.date)
  if (!point) return null

  const fillResult = entryVariant.simulate(point.series, point.idx, record.rsPercentileValue)
  if (!fillResult.filled) return { ...record, filled: false }

  const context = { entryType: entryVariant.type, regime: record.regime }
  const walkResult = walkExit(point.series, fillResult.fillIdx, exitRule, fillResult.fillPrice, context)
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

// --- v11 US-9: 청산 변형 E(클라이맥스 부분 청산) ---
// EXIT_RULES/walkExit 체계는 "그날 전량 청산 여부"만 표현할 수 있어(checkStop이 boolean) 50%
// 부분 청산은 이 체계에 넣을 수 없다 — COMBOS와 마찬가지로 별도 경로로 둔다. performance.mjs의
// computePartialPositionPerformance()(US-3 인프라)를 그대로 재사용(재구현 금지) — 이 파일이
// 새로 담당하는 것은 X4(클라이맥스 런) 첫 발생일 탐색과 exitEvents 구성뿐이다.

/** entryIdx 다음 거래일부터 MAX_HOLDING_DAYS까지 X4(exitSignals.js, 재구현 금지) 첫 발생일의 인덱스. 없으면 null. */
function findFirstClimaxIdx(series, entryIdx) {
  for (let offset = 1; offset <= MAX_HOLDING_DAYS; offset++) {
    const idx = entryIdx + offset
    if (idx >= series.length) return null
    if (hasExitSignalCode(series, idx, 'X4')) return idx
  }
  return null
}

/**
 * 신호 레코드 하나를 클라이맥스 부분 청산으로 확장한다: X4 첫 발생일에 50% 청산, 잔여 50%는
 * MAX_HOLDING_DAYS(60거래일) 만기 청산. X4가 전혀 발생하지 않으면 exitEvents가 빈 배열이 되어
 * computePartialPositionPerformance()가 잔여분(100%) 전체를 60일 만기로 처리한다 — 이 경우
 * 결과가 "무청산"(고정 60일 보유) 경로와 정확히 같아진다(별도 분기 불필요).
 * 반환: { ...record, returnPct, benchmarkReturn, excessReturn, mdd, legs, climaxTriggered } | null
 */
export function computeClimaxPartialPerformance(record, priceIndex) {
  const point = entryPoint(priceIndex, record.ticker, record.date)
  if (!point) return null

  const climaxIdx = findFirstClimaxIdx(point.series, point.idx)
  const exitEvents = climaxIdx != null ? [{ date: point.series[climaxIdx].date, ratio: 0.5 }] : []
  const perf = computePartialPositionPerformance(record, priceIndex, exitEvents, MAX_HOLDING_DAYS)
  if (!perf) return null

  return { ...perf, climaxTriggered: climaxIdx != null }
}

/**
 * records 전체를 클라이맥스 부분 청산으로 집계한다. climaxTriggerRate(발동률)를 1급 재료로
 * 포함한다(v10 "83.7% 교훈" — 판정 이전에 항상 실측할 것).
 * 반환: { signals, winRate, avgExcess, medianExcess, avgReturn, mdd, climaxTriggerRate }
 * (표본 0이면 전부 null — NaN 금지).
 */
export function aggregateClimaxPartialPerformance(records, priceIndex) {
  const items = records.map((r) => computeClimaxPartialPerformance(r, priceIndex)).filter(Boolean)

  if (!items.length) {
    return { signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null, climaxTriggerRate: null }
  }

  const excess = items.map((i) => i.excessReturn)
  const rets = items.map((i) => i.returnPct)
  const mdds = items.map((i) => i.mdd)
  const wins = excess.filter((e) => e > 0).length
  const triggered = items.filter((i) => i.climaxTriggered).length

  return {
    signals: items.length,
    winRate: round4(wins / items.length),
    avgExcess: round4(average(excess)),
    medianExcess: round4(median(excess)),
    avgReturn: round4(average(rets)),
    mdd: round4(average(mdds)),
    climaxTriggerRate: round4(triggered / items.length),
  }
}
