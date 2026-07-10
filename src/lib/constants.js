// v7 신규 필터 5종 임계 상수 (PRD_Nasdaq7 §7-4) — 필터 판정 로직(filters.js)에서 사용

export const WEEK52_PROXIMITY_PCT = 5 // 52주 신고가/신저가 근접 판정 기준 (±5%)
export const BOLLINGER_LOWER_PROXIMITY_MULT = 1.02 // 볼린저 하단 근접 판정 배수 (종가 ≤ 하단밴드 × 1.02)
export const STOCHASTIC_OVERSOLD = 20 // 스토캐스틱 과매도 (%K ≤ 20)
export const STOCHASTIC_OVERBOUGHT = 80 // 스토캐스틱 과매수 (%K ≥ 80)
export const ATR_PERCENTILE_LOW = 30 // ATR% 저변동성 (백분위 하위 30%)
export const ATR_PERCENTILE_HIGH = 70 // ATR% 고변동성 (백분위 상위 30%, 즉 70 이상)
export const OBV_SMA_WINDOW = 20 // OBV 추세 판정용 SMA 창

// 추천 프리셋 고급 설정(customParams) 허용 범위 (PRD_Nasdaq7 §3 Must-9, US-6/US-10)
export const CUSTOM_PARAM_RANGES = {
  rsiMin: { min: 30, max: 70 },
  goldenCrossWindow: { min: 1, max: 20 },
  highScoreThreshold: { min: 50, max: 95 },
}
