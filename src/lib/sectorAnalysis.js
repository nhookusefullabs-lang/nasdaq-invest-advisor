// 주도주 섹터 계산 (PRD §4.1, §8)
// 섹터 수익률 = 섹터 구성종목의 최근 3개월 수익률 균등평균, 구성 1종목 섹터는 대표성 부족으로 제외.
// 상위 3개 섹터에 "주도 섹터" 태그를 부여한다.

export function computeLeadingSectors(tickers) {
  const bySector = new Map()
  for (const t of tickers) {
    if (!t.dataSufficient) continue
    if (!bySector.has(t.sector)) bySector.set(t.sector, [])
    bySector.get(t.sector).push(t.simulation.returnPct)
  }

  const sectorReturns = [...bySector.entries()]
    .filter(([, returns]) => returns.length >= 2) // 1종목 섹터 제외
    .map(([sector, returns]) => ({
      sector,
      avgReturnPct: returns.reduce((s, v) => s + v, 0) / returns.length,
      constituentCount: returns.length,
    }))
    .sort((a, b) => b.avgReturnPct - a.avgReturnPct)

  const leadingSectors = new Set(sectorReturns.slice(0, 3).map((s) => s.sector))

  return { sectorReturns, leadingSectors }
}

/** tickers 배열에 isLeadingSector 플래그를 채워서 새 배열로 반환한다. */
export function applyLeadingSectorFlags(tickers, leadingSectors) {
  return tickers.map((t) =>
    t.dataSufficient ? { ...t, isLeadingSector: leadingSectors.has(t.sector) } : t
  )
}
