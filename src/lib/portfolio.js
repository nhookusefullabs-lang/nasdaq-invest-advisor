// 수동 비중 포트폴리오
// 종목 수 제한 없음. 사용자가 종목별로 입력한 상대 가중치(weights)를 합계 대비 비율로 정규화해
// 가중 평균 수익률·가중 평균 변동성(상관관계 미반영)을 계산한다.

export const DEFAULT_WEIGHT = 100

export function buildPortfolio(selectedTickers, weights = {}) {
  const n = selectedTickers.length
  if (n === 0) return null

  const rawWeights = selectedTickers.map((t) => Math.max(0, weights[t.ticker] ?? DEFAULT_WEIGHT))
  const totalWeight = rawWeights.reduce((s, w) => s + w, 0)
  if (totalWeight <= 0) return null

  const normalizedWeights = rawWeights.map((w) => w / totalWeight)

  const weightedReturnPct = selectedTickers.reduce(
    (s, t, i) => s + normalizedWeights[i] * t.simulation.returnPct,
    0
  )
  const weightedVolatility = selectedTickers.reduce(
    (s, t, i) => s + normalizedWeights[i] * t.indicators.volatility,
    0
  )

  return {
    tickers: selectedTickers.map((t) => t.ticker),
    weightsPct: Object.fromEntries(
      selectedTickers.map((t, i) => [t.ticker, normalizedWeights[i] * 100])
    ),
    weightedReturnPct,
    weightedVolatility,
  }
}
