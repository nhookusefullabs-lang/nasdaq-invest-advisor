import { validateResearch } from './researchSchema.js'

/**
 * public/data/research.json을 fetch한다 (US-4). research.json은 존재하지 않을 수 있는
 * 선택적 스냅샷이므로, 404/네트워크 오류/파싱 실패/스키마 불일치는 모두 null 반환으로
 * 처리한다 (에러 UI 없음 — graceful degradation, PRD_Nasdaq6.md §4.3 안전장치).
 */
export async function loadResearch() {
  try {
    const url = `${import.meta.env.BASE_URL}data/research.json`
    const res = await fetch(url)
    if (!res.ok) return null

    const raw = await res.json()
    const { valid } = validateResearch(raw)
    if (!valid) return null

    return raw
  } catch {
    return null
  }
}

/**
 * research.json → 티커별 리서치 항목 맵. 유니버스에 없는 티커의 항목은 조용히 무시한다.
 * research가 null이거나(파일 없음/검증 실패) datasetGeneratedAt이 없으면 빈 맵을 반환한다.
 * datasetGeneratedAt과 research.basedOnDataOf가 다르면 각 항목에 stale:true를 표시한다.
 * v1 문서(riskFlags 필드 없음)는 riskFlags:[]로 정규화한다 (US-8, 하위 호환).
 */
export function buildResearchMap(research, datasetGeneratedAt, validTickerSet) {
  const map = new Map()
  if (!research) return map

  const stale = research.basedOnDataOf !== datasetGeneratedAt

  for (const item of research.items) {
    if (validTickerSet && !validTickerSet.has(item.ticker)) continue
    map.set(item.ticker, {
      ...item,
      riskFlags: item.riskFlags ?? [],
      stale,
      researchedAt: research.researchedAt,
    })
  }

  return map
}
