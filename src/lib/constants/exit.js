// 청산 신호 계층 1(종목 수준 추세 건강) 상수 (PRD_Nasdaq10 §4.4, US-5) — 설계값,
// 백테스트로 사후 검증. 값 변경은 changelog 기록 후 운영자 승인.
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq10 §4.4 표 그대로 (X5 거래량 배수는 진입가 엔진의
//   VOL_MULT와 동일 관례를 적용 — 별도 상수를 만들지 않고 constants/entry.js에서 공유)

/** X1(50일선 이탈) "강" 판정 거래량 배수 */
export const X1_STRONG_VOLUME_MULT = 1.5
/** X2(데드크로스) 최근 판정 기간(거래일) */
export const X2_RECENCY_DAYS = 5
/** X3(템플릿 붕괴) 최소 미충족 조건 수 */
export const X3_BREAKDOWN_MIN_MISSING = 3
/** X4(클라이맥스 런) 10일 수익률 문턱(%) */
export const X4_RETURN_10D_MIN_PCT = 25
/** X4(클라이맥스 런) SMA50 이격 문턱(%) */
export const X4_SMA50_DISPARITY_MIN_PCT = 25
/** X5(돌파 후 최대 낙폭일) 최근 판정 기간(거래일) */
export const X5_RECENCY_DAYS = 5
