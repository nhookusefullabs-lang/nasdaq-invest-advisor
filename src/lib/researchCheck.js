// 리서치 점검 배지 판정 (PRD_Nasdaq8 §4.5, US-12)
// research: researchLoader.buildResearchMap()이 만든 티커별 항목(또는 undefined —
// research.json 부재/해당 티커 미리서치).

/**
 * 반환: { state: 'none'|'ok'|'flagged', flags: riskFlags[] }
 * PRD는 "리서치 점검 ✓"를 "플래그 0건 + sentiment≠negative"로만 명시하고, "플래그 0건인데
 * sentiment===negative"인 조합은 정의하지 않았다 — 이 조합을 그대로 ✓로 두면 부정적
 * 센티먼트 종목이 아무 경고 없이 통과하는 결함이 되므로, flagged(경고)로 안전하게
 * 처리한다(flags는 빈 배열로 유지 — 구조화된 리스크 플래그가 실제로 있는 것은 아님).
 */
export function computeResearchCheckState(research) {
  if (!research) return { state: 'none', flags: [] }

  const flags = research.riskFlags ?? []
  if (flags.length > 0) return { state: 'flagged', flags }
  if (research.sentiment === 'negative') return { state: 'flagged', flags: [] }

  return { state: 'ok', flags: [] }
}
