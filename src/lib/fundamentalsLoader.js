import { validateFundamentals } from './fundamentalsSchema.js'

/**
 * public/data/fundamentals.json을 fetch한다 (US-2/US-7). research.json과 동일하게
 * 선택적 스냅샷이므로 404/네트워크 오류/파싱 실패/스키마 불일치는 모두 null 반환으로
 * 처리한다 (에러 UI 없음 — graceful degradation). null이면 상위에서 펀더멘털 허들
 * 단계 전체를 생략해야 한다.
 */
export async function loadFundamentals() {
  try {
    const url = `${import.meta.env.BASE_URL}data/fundamentals.json`
    const res = await fetch(url)
    if (!res.ok) return null

    const raw = await res.json()
    const { valid } = validateFundamentals(raw)
    if (!valid) return null

    return raw
  } catch {
    return null
  }
}

/**
 * fundamentals.json → 티커별 펀더멘털 항목 맵. 유니버스에 없는 티커의 항목은 조용히 무시한다.
 * fundamentals가 null이면(파일 없음/검증 실패) 빈 맵을 반환한다.
 */
export function buildFundamentalsMap(fundamentals, validTickerSet) {
  const map = new Map()
  if (!fundamentals) return map

  for (const item of fundamentals.tickers) {
    if (validTickerSet && !validTickerSet.has(item.ticker)) continue
    map.set(item.ticker, item)
  }

  return map
}
