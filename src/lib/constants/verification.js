// 청산 규칙 검증 상태 정적 매핑 (PRD_Nasdaq10 §4.4, US-6) — 규칙 코드 → {status, basis}.
// status는 "우위"/"열위"/"측정중" 3상태만 허용. 갱신은 백테스트 Out-of-Sample 결과 확인 후
// 운영자가 changelog를 남기고 수동으로만 반영한다(자동 채택 금지).
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq10 §4.4/US-6 원문 그대로
//   (고정 −8% 손절: v9.1 백테스트에서 단일 상승 국면 표본으로 열위 확인,
//    ATR 비례 손절: 아직 백테스트 변형 미실행, 60일 보유: v9.1 Out 실측 우위)

export const VERIFICATION_STATUS = {
  stopFixed8pct: { status: '열위', basis: '단일 상승 국면 Out 실측' },
  stopAtr: { status: '측정중', basis: '아직 백테스트 변형 미실행' },
  holding60d: { status: '우위', basis: 'v9.1 Out 실측' },
}
