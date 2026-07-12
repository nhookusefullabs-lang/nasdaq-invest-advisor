// 진입가 엔진 상수 (PRD_Nasdaq10 §4.3, design-entry-point-engine.md §9) — 전부
// "설계값 — 백테스트로 사후 검증" 대상. 값 변경은 changelog 기록 후 운영자 승인.
//
// changelog:
//   2026-07-12 최초 도입 — design-entry-point-engine.md §9 표 그대로

/** 선행 고점(PH) 산정 창 (거래일) — 기존 pivotProximity와 동일한 약 3개월 베이스 */
export const PIVOT_LOOKBACK = 63
/** 돌파 이벤트 유효 기간(거래일) — 이 기간 내 돌파만 "최근 돌파된 저항선"으로 인정 */
export const BREAKOUT_RECENCY = 21
/** 트리거가 버퍼 — 피벗 정확히 그 가격에서의 잦은 되돌림(위스커) 회피 */
export const BUFFER = 0.003
/** 유효 상단(추격 금지 경계) — 미너비니 buyable range 관례 */
export const CHASE_LIMIT = 0.05
/** 원거리/대기 경계 — 피벗 대비 이 이상 하회하면 "원거리" 취급 */
export const FAR_BAND = 0.10
/** 고정 손절 비율 — 변형 D(exit_stop8_*)와 동일 상수 공유 */
export const STOP_PCT = 0.08
/** ATR 비례 손절의 배수 */
export const ATR_STOP_MULT = 2.5
/** 돌파 거래량 확인 배수 — 50일 평균 거래량 대비 */
export const VOL_MULT = 1.5
/** 구조 기반 손절(청산 변형 C, PRD_Nasdaq11 US-8) — 돌파형 진입의 손절선 계수: 피벗 × 이 값 */
export const PIVOT_STRUCTURAL_STOP_MULT = 0.97
