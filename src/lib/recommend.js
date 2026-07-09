// 2단계 추천 로직 (PRD §4.2)
// 1단계: 매수 신호 판정 (모두 충족) → 2단계: 100점 만점 순위 스코어링

const SCORE_DISPARITY_MAX = 60
const SCORE_VOLUME_MAX = 30
const SCORE_SECTOR_BONUS = 10
const MIN_RESULTS = 5
const MAX_RESULTS = 10

function stage1Pass(td, level) {
  const rsiOk = td.indicators.rsi14 >= 50
  const macdOk = td.indicators.macdLine > 0
  if (level === 'strict') return rsiOk && macdOk && td.indicators.goldenCross5
  if (level === 'relaxed10d') return rsiOk && macdOk && td.indicators.goldenCross10
  if (level === 'rsiMacdOnly') return rsiOk && macdOk
  return false
}

function runStage1(eligible) {
  const levels = ['strict', 'relaxed10d', 'rsiMacdOnly']
  let level = levels[0]
  let passed = eligible.filter((t) => stage1Pass(t, level))

  for (let i = 1; i < levels.length && passed.length < MIN_RESULTS; i++) {
    level = levels[i]
    passed = eligible.filter((t) => stage1Pass(t, level))
  }

  return { passed, level, relaxationApplied: level !== 'strict' }
}

function scoreTicker(td) {
  const disp = td.indicators.disparity ?? 0
  const vol = td.indicators.volTrend ?? 0
  const dispScore = (Math.max(0, Math.min(disp, 15)) / 15) * SCORE_DISPARITY_MAX
  const volScore = (Math.max(0, Math.min(vol, 50)) / 50) * SCORE_VOLUME_MAX
  const sectorScore = td.isLeadingSector ? SCORE_SECTOR_BONUS : 0
  return Math.round((dispScore + volScore + sectorScore) * 10) / 10
}

function buildReasons(td, level) {
  const reasons = [`RSI ${Math.round(td.indicators.rsi14)}`]
  if (level === 'strict') reasons.push('MACD 골든크로스 (5거래일 이내)')
  else if (level === 'relaxed10d') reasons.push('MACD 골든크로스 (10거래일 이내, 완화 적용)')
  else reasons.push('MACD 0선 위 (골든크로스 조건 완화 적용)')
  if (td.isLeadingSector) reasons.push('주도 섹터 소속')
  return reasons.join(', ')
}

/**
 * tickers: deriveTickerData() + applyLeadingSectorFlags() 를 거친 배열
 * 반환: { list, relaxationApplied, insufficientSignal, level }
 */
export function recommend(tickers) {
  const eligible = tickers.filter((t) => t.dataSufficient)
  const { passed, level, relaxationApplied } = runStage1(eligible)

  const scored = passed
    .map((t) => ({
      ticker: t.ticker,
      name: t.name,
      sector: t.sector,
      score: scoreTicker(t),
      reasons: buildReasons(t, level),
      signalPassed: true,
      relaxationApplied,
    }))
    .sort((a, b) => b.score - a.score)

  const list = scored.slice(0, MAX_RESULTS)

  return {
    list,
    relaxationApplied,
    insufficientSignal: list.length < MIN_RESULTS,
    level,
  }
}
