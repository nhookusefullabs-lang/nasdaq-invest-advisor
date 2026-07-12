// 눌림목 판정(pullback.js) 상수 (PRD_Nasdaq11 §4.2, US-5) — 전부 "설계값 — 백테스트로
// 사후 검증" 대상. 값 변경은 changelog 기록 후 운영자 승인.
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq11 §4.2 표 그대로

/** P2 눌림 깊이 하한 — 피벗 대비 이 이상 하락해야 "눌림"으로 인정(%, 양수로 표기) */
export const PULLBACK_DEPTH_MIN_PCT = 10
/** P2 눌림 깊이 상한 — 피벗 대비 이 초과 하락하면 눌림이 아닌 붕괴로 간주(%, 양수로 표기).
 * 트렌드 템플릿 T7(52주 고점 대비 −25% 이내)이 사실상 같은 방향의 별도 차단선을 이미
 * 두므로(P1 충족 시 자동 적용), 이 상수는 피벗 기준의 더 정밀한 경계로 병행 적용한다. */
export const PULLBACK_DEPTH_MAX_PCT = 25
/** P3 기본형 — 현재가 > 이 이동평균. SMA50 엄격형은 미적용(예비 상수만 별도 보관). */
export const PULLBACK_P3_SMA_PERIOD = 200
/** P3 예비(미적용) — 더 엄격한 눌림 판정을 원할 때 SMA50으로 교체하는 실험용 상수. */
export const PULLBACK_P3_SMA_PERIOD_STRICT = 50
/** 재개 트리거가 산정 창(거래일) — 직전 N거래일 최고 종가 */
export const PULLBACK_TRIGGER_WINDOW_DAYS = 10
/** 관찰 유효 기간(거래일) — 이 기간 내 재개해야 pullback_resume* 진입이 유효(US-6에서 사용) */
export const PULLBACK_OBSERVATION_VALID_DAYS = 30
/** 구조 손절 참고가 계수 — 눌림 저점 × 이 값 */
export const PULLBACK_STOP_MULT = 0.98
/** 재개 확인 시 거래량 배수 — 50일 평균 거래량 대비 (pullback_resume_vol, 돌파 거래량 확인과 동일 관례) */
export const PULLBACK_RESUME_VOL_MULT = 1.5
