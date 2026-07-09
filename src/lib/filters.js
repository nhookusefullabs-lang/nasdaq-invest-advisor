// 홈/검색 화면 상세 필터 4종 (PRD §4.1) — 초기 상태는 모두 꺼짐(= 전체 표시)

export const DEFAULT_FILTER_STATE = {
  disparityMin: null, // 이격도 하한(%), null = 미적용
  volumeTrendMin: null, // 거래량 추세 하한(%), null = 미적용
  leadingSectorOnly: false, // 주도 섹터만
  rsiState: 'off', // 'off' | 'overheated' | 'oversold'
}

export function applyFilters(tickers, filters, query = '') {
  const q = query.trim().toLowerCase()
  return tickers
    .filter((t) => t.dataSufficient)
    .filter((t) => !q || t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .filter((t) => filters.disparityMin == null || t.indicators.disparity >= filters.disparityMin)
    .filter((t) => filters.volumeTrendMin == null || t.indicators.volTrend >= filters.volumeTrendMin)
    .filter((t) => !filters.leadingSectorOnly || t.isLeadingSector)
    .filter((t) => {
      if (filters.rsiState === 'overheated') return t.indicators.rsi14 >= 70
      if (filters.rsiState === 'oversold') return t.indicators.rsi14 <= 30
      return true
    })
}
