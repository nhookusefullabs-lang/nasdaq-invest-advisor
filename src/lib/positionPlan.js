// 포지션 계획 계층 2 — 체결가 기준 청산 계획 (PRD_Nasdaq10 §4.4, US-6) — 순수 함수.
// 진입가 엔진(entryPoint.js)과 상수(STOP_PCT/ATR_STOP_MULT)를 공유한다.

import { atr } from './indicators.js'
import { STOP_PCT, ATR_STOP_MULT } from './constants/entry.js'
import { VERIFICATION_STATUS } from './constants/verification.js'

/** R-배수 산정 기준 브레이크이븐 상향 알림 문턱 */
const BREAKEVEN_R_THRESHOLD = 2
/** 이익 보호 알림: 이 수익률(%) 이상 도달한 이력이 있어야 대상이 된다 */
const PROFIT_PROTECTION_PEAK_MIN_PCT = 20
/** 이익 보호 알림: 현재 수익이 최고 수익의 이 비율 이하로 반납되면 알림 */
const PROFIT_PROTECTION_GIVEBACK_RATIO = 0.5
/** 트레일링 참고가 = 보유 중 최고 종가 × 이 배수 */
const TRAILING_MULT = 0.85

/**
 * 체결가 기준 청산 계획 산출.
 * position: { ticker, entryPrice, entryDate? } — entryDate 없으면 트레일링·이익 보호는
 * "체결일 입력 시 제공" 상태로 반환한다(§4.4 layer2 명시).
 * series: 해당 티커의 원본 바 배열(오름차순).
 */
export function computePositionPlan({ ticker, entryPrice, entryDate = null }, series) {
  const closes = series.map((b) => b.close)
  const n = closes.length
  const currentClose = closes[n - 1]

  const currentReturnPct = ((currentClose - entryPrice) / entryPrice) * 100
  const initialRiskPct = STOP_PCT * 100
  const rMultiple = currentReturnPct / initialRiskPct

  const atr14 = atr(series, 14)
  const stopFixedPrice = entryPrice * (1 - STOP_PCT)
  const stopAtrPrice = atr14 != null ? entryPrice - ATR_STOP_MULT * atr14 : null

  const breakEvenAlert = rMultiple >= BREAKEVEN_R_THRESHOLD

  let trailing = { available: false, reason: '체결일 입력 시 제공' }
  let profitProtection = { available: false, reason: '체결일 입력 시 제공' }

  if (entryDate != null) {
    const startIdx = series.findIndex((b) => b.date >= entryDate)
    if (startIdx === -1) {
      trailing = { available: false, reason: '체결일 이후 데이터 없음' }
      profitProtection = { available: false, reason: '체결일 이후 데이터 없음' }
    } else {
      const held = series.slice(startIdx)
      const maxClose = Math.max(...held.map((b) => b.close))
      const trailingRefPrice = maxClose * TRAILING_MULT
      trailing = {
        available: true,
        maxClose,
        trailingRefPrice,
        // 손절선과 트레일링 중 더 높은 쪽을 강조(§4.4: "손절선과 트레일링 중 높은 쪽 강조")
        effectiveStopPrice: Math.max(stopFixedPrice, trailingRefPrice),
      }

      const heldReturnPcts = held.map((b) => ((b.close - entryPrice) / entryPrice) * 100)
      const peakReturnPct = Math.max(...heldReturnPcts)
      const alert =
        peakReturnPct >= PROFIT_PROTECTION_PEAK_MIN_PCT &&
        currentReturnPct <= peakReturnPct * PROFIT_PROTECTION_GIVEBACK_RATIO
      profitProtection = { available: true, peakReturnPct, alert }
    }
  }

  return {
    ticker,
    entryPrice,
    currentClose,
    currentReturnPct,
    rMultiple,
    breakEvenAlert,
    stopFixed: { price: stopFixedPrice, verification: VERIFICATION_STATUS.stopFixed8pct },
    stopAtr: stopAtrPrice != null ? { price: stopAtrPrice, verification: VERIFICATION_STATUS.stopAtr } : null,
    trailing,
    profitProtection,
  }
}
