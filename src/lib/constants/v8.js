// v8 이중 모드(추세추종 + 미너비니) 상수 모듈 (PRD_Nasdaq8, US-3)
// 이 파일에 정의된 값은 전부 **v9 백테스트로 실측 조정 예정인 설계값**이다 — 매직넘버를
// 코드 곳곳에 흩어두지 않고 여기 한 곳에서만 수정하면 되도록 모아둔다 (PRD_Nasdaq8 §9).

// --- 트렌드 템플릿 (§4.2, T1~T8) ---
export const TREND_TEMPLATE = {
  LOW_MULTIPLIER: 1.3, // T6: 현재가 ≥ 52주 최저가 × 1.30
  HIGH_MULTIPLIER: 0.75, // T7: 현재가 ≥ 52주 최고가 × 0.75
  RS_PERCENTILE_MIN: 70, // T8: RS 백분위 ≥ 70 (유니버스 상위 30%)
  SMA200_TREND_WINDOW: 22, // T3: SMA200(당일) > SMA200(22거래일 전)
  CONDITION_COUNT: 8, // 전체 조건 수
}

// 완화 폴백: 8/8 충족 종목이 5개 미만이면 7/8까지 허용 (기존 v7 MIN_RESULTS=5 폴백 패턴과 동형)
export const TREND_TEMPLATE_RELAXED_MIN_CONDITIONS = 7
export const TREND_TEMPLATE_MIN_RESULTS = 5

// --- VCP 근사 스코어링 (§4.2, 100점 만점) ---
export const VCP_SCORE = {
  RS_MAX: 40,
  RS_PERCENTILE_FLOOR: 70, // RS 백분위 70에서 0점
  RS_PERCENTILE_CEIL: 100, // RS 백분위 100에서 만점(40)

  CONTRACTION_MAX: 25,
  CONTRACTION_FULL_SCORE_RATIO: 0.5, // 수축비 0.5 이하 → 만점(25)
  CONTRACTION_ZERO_SCORE_RATIO: 1.0, // 수축비 1.0 이상 → 0점

  DRYUP_MAX: 15,
  DRYUP_CAP_PCT: 30, // |드라이업%| 30 이상 → 만점(15) 캡. 드라이업%가 양수(거래량 증가)면 0점

  PIVOT_MAX: 20,
  PIVOT_ZERO_PCT: 10, // 근접% 10 이상(고점 대비 −10% 이상 이격) → 0점. 근접% 0(고점 일치) → 만점(20)
}

// --- 펀더멘털 허들 (§4.4, F1/F3/F5 핵심 3종 임계값) ---
export const FUNDAMENTAL_THRESHOLDS = {
  F1_EPS_GROWTH_MIN_PCT: 20, // 분기 EPS 성장률(전년 동기 대비) ≥ +20%
  F3_REVENUE_GROWTH_MIN_PCT: 20, // 분기 매출 성장률(전년 동기 대비) ≥ +20%
  F5_ROE_MIN: 0.17, // ROE ≥ 17%
}
