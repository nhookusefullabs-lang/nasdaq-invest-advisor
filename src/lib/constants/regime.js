// 시장 국면(breadth) 히스테리시스 임계값 (PRD_Nasdaq10 §4.2) — 설계값, 국면별 백테스트
// 분해(US-7)로 사후 검증 예정. 값 변경은 changelog 기록 후 운영자 승인.
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq10 §4.2 표 그대로

/** 중립 → 상승 전이 문턱 (breadth가 이 초과) */
export const REGIME_UP_ENTER = 0.65
/** 상승 → 중립 전이 문턱 (breadth가 이 미만) — 초기 상태 판정의 "상승" 경계이기도 함 */
export const REGIME_UP_EXIT = 0.55
/** 중립 → 하락 전이 문턱 (breadth가 이 미만) — 초기 상태 판정의 "하락" 경계이기도 함 */
export const REGIME_DOWN_ENTER = 0.40
/** 하락 → 중립 전이 문턱 (breadth가 이 초과) */
export const REGIME_DOWN_EXIT = 0.50
/** breadth 계산에 쓰는 이동평균 기간 */
export const REGIME_SMA_PERIOD = 200
