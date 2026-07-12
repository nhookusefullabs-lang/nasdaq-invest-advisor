// 진입가 엔진 (design-entry-point-engine.md, PRD_Nasdaq10 §4.3, US-3/US-4) — 순수 함수.
// §2(피벗 산정)·§3(파생 가격) 그대로 구현한다.

import {
  PIVOT_LOOKBACK,
  BREAKOUT_RECENCY,
  BUFFER,
  CHASE_LIMIT,
  FAR_BAND,
  STOP_PCT,
  ATR_STOP_MULT,
} from './constants/entry.js'

/**
 * 선행 고점(PH) 시계열: PH[d] = max(close[d-PIVOT_LOOKBACK .. d-1]) (당일 제외, §2.1).
 * d < PIVOT_LOOKBACK인 구간(창을 채울 과거 데이터 부족)은 null.
 */
function precedingHighSeries(closes) {
  const n = closes.length
  const out = new Array(n).fill(null)
  for (let d = PIVOT_LOOKBACK; d < n; d++) {
    let max = -Infinity
    for (let k = d - PIVOT_LOOKBACK; k < d; k++) {
      if (closes[k] > max) max = closes[k]
    }
    out[d] = max
  }
  return out
}

/**
 * 돌파 이벤트 인덱스 목록(오름차순): close_d > PH_d 이고 close_{d-1} ≤ PH_{d-1}
 * (상향 교차일만 — 연속 상회는 제외, §2.1).
 */
function breakoutIndices(closes, phSeries) {
  const out = []
  for (let d = PIVOT_LOOKBACK + 1; d < closes.length; d++) {
    const phD = phSeries[d]
    const phPrev = phSeries[d - 1]
    if (phD == null || phPrev == null) continue
    if (closes[d] > phD && closes[d - 1] <= phPrev) out.push(d)
  }
  return out
}

/**
 * 피벗 산정 (design-entry-point-engine.md §2.1 3규칙 그대로).
 * 반환: { pivot, valid, reason, breakoutIndex, breakoutDate, precedingHigh }
 * - valid=false면 pivot은 null (피벗 산정 불가 또는 저항선 소멸 — 상태 3 강제 배정 사유는
 *   호출부(US-4 상태 판정)가 reason으로 구분한다)
 * - 21거래일 내 돌파 이벤트가 다수면 가장 최근 이벤트를 사용한다.
 */
export function computePivot(series) {
  const n = series.length
  if (n < PIVOT_LOOKBACK + 1) {
    return {
      pivot: null,
      valid: false,
      reason: '피벗 산정 불가 (데이터 부족)',
      breakoutIndex: null,
      breakoutDate: null,
      precedingHigh: null,
    }
  }

  const closes = series.map((b) => b.close)
  const phSeries = precedingHighSeries(closes)
  const t = n - 1
  const phT = phSeries[t]
  const closeT = closes[t]

  // 규칙 1: 현재가가 선행 고점 아래(또는 그 자체) → 머리 위 저항선
  if (closeT <= phT) {
    return {
      pivot: phT,
      valid: true,
      reason: '머리 위 저항선',
      breakoutIndex: null,
      breakoutDate: null,
      precedingHigh: phT,
    }
  }

  // 규칙 2/3: 현재가가 선행 고점 위 — 최근(BREAKOUT_RECENCY일 내) 돌파 이벤트 존재 여부로 분기
  const breakouts = breakoutIndices(closes, phSeries)
  const recentBreakouts = breakouts.filter((d) => t - d <= BREAKOUT_RECENCY)

  if (recentBreakouts.length > 0) {
    const b = recentBreakouts[recentBreakouts.length - 1] // 가장 최근 이벤트
    return {
      pivot: phSeries[b],
      valid: true,
      reason: '최근 돌파된 저항선',
      breakoutIndex: b,
      breakoutDate: series[b].date,
      precedingHigh: phT,
    }
  }

  // 규칙 3: 돌파 후 장기 상승 지속으로 교차 이벤트가 유효 기간 밖 → 피벗 무효, 저항선 소멸
  return {
    pivot: null,
    valid: false,
    reason: '저항선 소멸 — 다음 베이스 대기',
    breakoutIndex: null,
    breakoutDate: null,
    precedingHigh: phT,
  }
}

/**
 * 파생 가격 산출 (§3 표 그대로) — pivot이 null이면 산출 불가(null 반환).
 * 손절 참고 2종은 피벗이 아니라 "현재 종가"를 기준으로 한다(§4.3 v10 PRD 구현 지시 원문:
 * "고정 −8% ... ATR 비례 = close − 2.5×ATR14").
 */
export function derivedPrices({ pivot, currentClose, atr14 = null }) {
  if (pivot == null) return null
  return {
    trigger: pivot * (1 + BUFFER),
    upper: pivot * (1 + CHASE_LIMIT),
    farBand: pivot * (1 - FAR_BAND),
    stopFixed: currentClose * (1 - STOP_PCT),
    stopAtr: atr14 != null ? currentClose - ATR_STOP_MULT * atr14 : null,
  }
}
