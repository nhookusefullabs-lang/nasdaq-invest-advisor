// 균등 비중 포트폴리오 (PRD §4.4)
// 종합 수익률 = 개별 3개월 실현 수익률의 단순 평균
// 종합 위험 지표 = 개별 종목 변동성의 단순 평균 ("평균 개별 변동성(상관관계 미반영)")

export const MIN_PORTFOLIO_SIZE = 3
export const MAX_PORTFOLIO_SIZE = 5

export function buildPortfolio(selectedTickers) {
  const n = selectedTickers.length
  if (n < MIN_PORTFOLIO_SIZE || n > MAX_PORTFOLIO_SIZE) {
    return null
  }
  const equalWeightReturnPct =
    selectedTickers.reduce((s, t) => s + t.simulation.returnPct, 0) / n
  const avgIndividualVolatility =
    selectedTickers.reduce((s, t) => s + t.indicators.volatility, 0) / n

  return {
    tickers: selectedTickers.map((t) => t.ticker),
    equalWeightReturnPct,
    avgIndividualVolatility,
  }
}
