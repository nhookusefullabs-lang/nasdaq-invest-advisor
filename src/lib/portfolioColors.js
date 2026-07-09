// 카테고리 8색 팔레트 (고정 순서, CVD 안전성 검증됨 — dataviz 스킬 palette.md 기준)
export const CATEGORICAL_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
]
export const OTHER_COLOR = '#9a988f' // 8개 초과 시 나머지를 묶는 중립 회색 ("기타")
export const MAX_COLORED_SLICES = CATEGORICAL_COLORS.length

/**
 * tickers: 선택 순서(추가된 순서) 문자열 배열.
 * 9번째 종목부터는 색상 정체성을 접어 "기타" 회색 하나로 묶는다 (8개 초과 카테고리 색상 금지 원칙).
 * 반환: Map<ticker, { color, isOther }>
 */
export function assignPortfolioColors(tickers) {
  const dedicatedSlots = tickers.length > MAX_COLORED_SLICES ? MAX_COLORED_SLICES - 1 : MAX_COLORED_SLICES
  const map = new Map()
  tickers.forEach((ticker, i) => {
    map.set(
      ticker,
      i < dedicatedSlots
        ? { color: CATEGORICAL_COLORS[i], isOther: false }
        : { color: OTHER_COLOR, isOther: true }
    )
  })
  return map
}
