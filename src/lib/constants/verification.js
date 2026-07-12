// 청산 규칙 검증 상태 정적 매핑 (PRD_Nasdaq10 §4.4, US-6) — 규칙 코드 → {status, basis}.
// status는 "우위"/"열위"/"측정중" 3상태만 허용. 갱신은 백테스트 Out-of-Sample 결과 확인 후
// 운영자가 changelog를 남기고 수동으로만 반영한다(자동 채택 금지).
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq10 §4.4/US-6 원문 그대로
//   (고정 −8% 손절: v9.1 백테스트에서 단일 상승 국면 표본으로 열위 확인,
//    ATR 비례 손절: 아직 백테스트 변형 미실행, 60일 보유: v9.1 Out 실측 우위)
//   2026-07-13 relaxOffInDownturn 추가 — v11 US-11(승인된 채택 1). 근거: v10 backtest의
//    relax_off_in_downturn 변형 Out 실측(하락 국면에서 완화 폴백 신호 제외 시 +14.7%p).
//    조건 문구(PRD_Nasdaq11 원문 그대로): "하락 국면 Out 표본 박약 — 분기 재검증 시 재확인"
//    — 표본이 아직 작아 분기 재검증 때마다 재확인이 필요한 잠정 채택임을 명시.
//   2026-07-13 volumeConfirmedBreakout 승격 — v11 US-12(승인된 채택 2). "우위" 단일
//    라벨에서 양면 라벨로 갱신(PRD_Nasdaq11 원문 그대로): "조건부 품질 우위 — 체결 거래
//    승률 +11.6pt 실측(NDX Out) · 전량 자동 적용 시 기회비용 존재" — 우위 근거와 기회비용
//    경고를 분리해 렌더링하면 어느 한쪽만 보여 오도 소지가 있어(v10 "83.7%" 교훈과 동일
//    패턴), status/basis 두 필드에 나눠 담되 VerificationTag가 항상 함께 렌더링한다.
//    pullbackCandidate 추가 — 상태0 눌림목 후보 안내(측정 중, 아직 채택 판단 없음).

export const VERIFICATION_STATUS = {
  stopFixed8pct: { status: '열위', basis: '단일 상승 국면 Out 실측' },
  stopAtr: { status: '측정중', basis: '아직 백테스트 변형 미실행' },
  holding60d: { status: '우위', basis: 'v9.1 Out 실측' },
  relaxOffInDownturn: {
    status: '채택',
    basis: 'v10 backtest relax_off_in_downturn 변형 Out 실측(+14.7%p)',
    condition: '하락 국면 Out 표본 박약 — 분기 재검증 시 재확인',
  },
  volumeConfirmedBreakout: {
    status: '조건부 품질 우위',
    basis: '체결 거래 승률 +11.6pt 실측(NDX Out) · 전량 자동 적용 시 기회비용 존재',
  },
  pullbackCandidate: { status: '측정중', basis: '눌림목 관찰 조건(P1~P4) 실측 진행 중' },
}
