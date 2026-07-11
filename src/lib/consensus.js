// 컨센서스 랭킹 (PRD_Nasdaq8 §4.3, US-6)
// 추세추종(recommend.js, 수정 금지)과 미너비니(minervini.js) 두 모드의 결과를 합쳐
// **원점수 합산이 아닌** "각 모드 1단계 통과 집합 내 백분위 순위"의 단순 평균으로 정렬한다.
// 척도가 다른 두 점수를 그냥 더하면 "어디서도 1등이 아닌 종목"이 통합 1위가 되는
// 평균의 함정에 빠지므로, 등급(★★/★)을 백분위보다 우선하는 2단계 정렬을 쓴다.

// v9 US-7: 백테스트 후보 변형(scripts/lib/variants.mjs)이 percentileOf를 재구현 없이 그대로
// 재사용할 수 있도록 export만 보강한다 — 동작 불변.
/** population(같은 모드 결과 리스트의 score 배열) 내에서 value가 차지하는 백분위(0~100). */
export function percentileOf(value, population) {
  if (!population.length) return null
  const belowOrEqual = population.filter((v) => v <= value).length
  return (belowOrEqual / population.length) * 100
}

function indexByTickerWithPercentile(result) {
  const list = result?.list ?? []
  const scores = list.map((r) => r.score)
  return new Map(list.map((r) => [r.ticker, { ...r, percentile: percentileOf(r.score, scores) }]))
}

/**
 * trendResult: recommend(tickers, config)의 반환값 { list, insufficientSignal, ... }
 * minerviniResult: runMinerviniRecommend(tickers)의 반환값 { list, insufficientSignal, ... }
 * 둘 중 하나가 null/undefined이거나 list가 비어 있어도(해당 모드 insufficientSignal) 나머지
 * 한쪽만으로 정상 동작한다.
 * 반환: { list: [{ ticker, name, sector, grade, singleModeLabel, consensusPercentile,
 *                   trend, minervini }], trendInsufficientSignal, minerviniInsufficientSignal }
 *   grade: '★★'(양쪽 1단계 통과) | '★'(한쪽만 통과)
 *   trend/minervini: 통과했으면 { score, percentile, reasons, signalPassed }, 아니면 null
 */
export function buildConsensusRanking(trendResult, minerviniResult) {
  const trendByTicker = indexByTickerWithPercentile(trendResult)
  const minerviniByTicker = indexByTickerWithPercentile(minerviniResult)

  const allTickers = new Set([...trendByTicker.keys(), ...minerviniByTicker.keys()])

  const list = [...allTickers].map((ticker) => {
    const trend = trendByTicker.get(ticker) ?? null
    const minervini = minerviniByTicker.get(ticker) ?? null
    const percentiles = [trend?.percentile, minervini?.percentile].filter((p) => p != null)
    const consensusPercentile = percentiles.reduce((s, p) => s + p, 0) / percentiles.length
    const grade = trend && minervini ? '★★' : '★'
    const singleModeLabel = grade === '★' ? (trend ? '추세추종' : '미너비니') : null
    const base = trend ?? minervini

    return {
      ticker,
      name: base.name,
      sector: base.sector,
      grade,
      singleModeLabel,
      consensusPercentile,
      trend: trend ? { score: trend.score, percentile: trend.percentile, reasons: trend.reasons, signalPassed: trend.signalPassed } : null,
      minervini: minervini
        ? { score: minervini.score, percentile: minervini.percentile, reasons: minervini.reasons, signalPassed: minervini.signalPassed }
        : null,
    }
  })

  // ★★ 그룹이 항상 ★ 그룹 위 (백분위 평균과 무관) — 그룹 내부는 consensusPercentile 내림차순
  list.sort((a, b) => {
    if (a.grade !== b.grade) return a.grade === '★★' ? -1 : 1
    return b.consensusPercentile - a.consensusPercentile
  })

  return {
    list,
    trendInsufficientSignal: trendResult?.insufficientSignal ?? true,
    minerviniInsufficientSignal: minerviniResult?.insufficientSignal ?? true,
  }
}
