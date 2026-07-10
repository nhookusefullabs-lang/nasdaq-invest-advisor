// 펀더멘털 허들 판정 (PRD_Nasdaq8 §4.4, US-7)
// 핵심 3종(F1 EPS 성장률·F3 매출 성장률·F5 ROE)만으로 Pass/Partial/Fail을 가른다.
// F2(EPS 가속)·F4(마진 개선)는 참고 배지 값만 전달하고 판정에는 반영하지 않는다.
// missing[]에 있는 기준, 또는 값 자체가 null이면 "판정불가"로 취급해 분모에서 제외하고,
// 핵심 3종 중 2개 이상이 판정불가면 Fail이 아니라 insufficientFundamentals로 구분한다.

import { FUNDAMENTAL_THRESHOLDS } from './constants/v8.js'

function formatSignedPct(v) {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(0)}%`
}

function buildReasons(item, coreResults) {
  const reasons = []

  if (coreResults.F1 === null) {
    reasons.push('EPS 성장률 판정불가')
  } else {
    reasons.push(`EPS ${formatSignedPct(item.epsGrowthQoQ_yoy)} ${coreResults.F1 ? '✓' : '✗'}`)
  }

  if (coreResults.F3 === null) {
    reasons.push('매출 성장률 판정불가')
  } else {
    reasons.push(`매출 ${formatSignedPct(item.revenueGrowthQoQ_yoy)} ${coreResults.F3 ? '✓' : '✗'}`)
  }

  if (coreResults.F5 === null) {
    reasons.push('ROE 판정불가')
  } else {
    reasons.push(`ROE ${Math.round(item.roe * 100)}% ${coreResults.F5 ? '✓' : '✗'}`)
  }

  return reasons
}

/**
 * item: fundamentals.json의 tickers[] 원소 하나. fundamentals.json 자체가 없거나
 * (로더가 null 반환) 해당 티커 항목이 없으면 이 함수를 호출하지 말고 상위에서
 * 허들 단계 전체를 생략한다(반환값 null과는 다른 케이스).
 * 반환: { verdict: 'pass'|'partial'|'fail'|'insufficientFundamentals',
 *         coreResults: { F1, F3, F5 } (true|false|null),
 *         epsAccelerating, marginImproving (참고 배지, true|false|null),
 *         reasons: string[] }
 */
export function evaluateFundamentalHurdle(item) {
  if (!item) return null

  const missing = new Set(item.missing ?? [])

  const f1Determinate = !missing.has('F1') && item.epsGrowthQoQ_yoy != null
  const f1Pass = f1Determinate ? item.epsGrowthQoQ_yoy >= FUNDAMENTAL_THRESHOLDS.F1_EPS_GROWTH_MIN_PCT : null

  const f3Determinate = !missing.has('F3') && item.revenueGrowthQoQ_yoy != null
  const f3Pass = f3Determinate ? item.revenueGrowthQoQ_yoy >= FUNDAMENTAL_THRESHOLDS.F3_REVENUE_GROWTH_MIN_PCT : null

  const f5Determinate = !missing.has('F5') && item.roe != null
  const f5Pass = f5Determinate ? item.roe >= FUNDAMENTAL_THRESHOLDS.F5_ROE_MIN : null

  const coreResults = { F1: f1Pass, F3: f3Pass, F5: f5Pass }
  const coreValues = [f1Pass, f3Pass, f5Pass]
  const indeterminateCount = coreValues.filter((v) => v === null).length
  const passCount = coreValues.filter((v) => v === true).length

  let verdict
  if (indeterminateCount >= 2) {
    verdict = 'insufficientFundamentals'
  } else if (passCount === 3) {
    verdict = 'pass'
  } else if (passCount === 0) {
    verdict = 'fail'
  } else {
    verdict = 'partial'
  }

  return {
    verdict,
    coreResults,
    epsAccelerating: missing.has('F2') ? null : (item.epsAccelerating ?? null),
    marginImproving: missing.has('F4') ? null : (item.marginImproving ?? null),
    reasons: buildReasons(item, coreResults),
  }
}
