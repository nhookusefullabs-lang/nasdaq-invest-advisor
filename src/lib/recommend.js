// 2단계 추천 로직 (PRD §4.2, v7 §3 Must-7~8)
// 1단계: 매수 신호 판정 (모두 충족) → 2단계: 100점 만점 순위 스코어링
// RSI 하한/골든크로스 창/고득점 편입 임계는 프리셋(config)으로 주입한다(US-8) —
// 2단계 배점(이격도60/거래량30/섹터10)은 프리셋 대상이 아니므로 아래처럼 고정 상수로 둔다.

import { PRESETS, DEFAULT_PRESET_KEY } from './presets.js'

const SCORE_DISPARITY_MAX = 60
const SCORE_VOLUME_MAX = 30
const SCORE_SECTOR_BONUS = 10
const MIN_RESULTS = 5
const MAX_RESULTS = 10

// 프리셋의 goldenCrossWindow/goldenCrossRelaxedWindow(거래일 수) → deriveTickerData()가
// 미리 계산해 둔 indicators.goldenCross{N} 필드명 매핑.
const GOLDEN_CROSS_FIELDS = { 3: 'goldenCross3', 5: 'goldenCross5', 6: 'goldenCross6', 10: 'goldenCross10', 20: 'goldenCross20' }

function stage1Pass(td, level, config) {
  const rsiOk = td.indicators.rsi14 >= config.rsiMin
  const macdOk = td.indicators.macdLine > 0
  if (level === 'strict') return rsiOk && macdOk && td.indicators[GOLDEN_CROSS_FIELDS[config.goldenCrossWindow]]
  if (level === 'relaxed10d') return rsiOk && macdOk && td.indicators[GOLDEN_CROSS_FIELDS[config.goldenCrossRelaxedWindow]]
  if (level === 'rsiMacdOnly') return rsiOk && macdOk
  return false
}

function runStage1(eligible, config) {
  const levels = ['strict', 'relaxed10d', 'rsiMacdOnly']
  let level = levels[0]
  let passed = eligible.filter((t) => stage1Pass(t, level, config))

  for (let i = 1; i < levels.length && passed.length < MIN_RESULTS; i++) {
    level = levels[i]
    passed = eligible.filter((t) => stage1Pass(t, level, config))
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

function buildReasons(td, level, config) {
  const reasons = [`RSI ${Math.round(td.indicators.rsi14)}`]
  if (level === 'strict') reasons.push(`MACD 골든크로스 (${config.goldenCrossWindow}거래일 이내)`)
  else if (level === 'relaxed10d') reasons.push(`MACD 골든크로스 (${config.goldenCrossRelaxedWindow}거래일 이내, 완화 적용)`)
  else reasons.push('MACD 0선 위 (골든크로스 조건 완화 적용)')
  if (td.isLeadingSector) reasons.push('주도 섹터 소속')
  return reasons.join(', ')
}

function buildHighScoreReasons(td) {
  const reasons = [`RSI ${Math.round(td.indicators.rsi14)}`, '매수 신호 미충족 (고득점 특별 편입)']
  if (td.isLeadingSector) reasons.push('주도 섹터 소속')
  return reasons.join(', ')
}

/**
 * tickers: deriveTickerData() + applyLeadingSectorFlags() 를 거친 배열
 * config: 프리셋 설정 객체 (RSI 하한/골든크로스 창(기준·완화)/고득점 편입 임계) — 생략 시 기본형.
 *   기본형으로 호출하면 v5(리팩터링 전) recommend(tickers)와 완전히 동일한 결과를 낸다 (US-8 회귀 기준).
 * 반환: { list, relaxationApplied, insufficientSignal, level }
 */
export function recommend(tickers, config = PRESETS[DEFAULT_PRESET_KEY]) {
  const eligible = tickers.filter((t) => t.dataSufficient)
  const { passed, level, relaxationApplied } = runStage1(eligible, config)
  const passedTickerSet = new Set(passed.map((t) => t.ticker))

  const scoredPassed = passed.map((t) => ({
    ticker: t.ticker,
    name: t.name,
    sector: t.sector,
    score: scoreTicker(t),
    reasons: buildReasons(t, level, config),
    signalPassed: true,
    relaxationApplied,
  }))

  // 매수 신호는 놓쳤지만 2단계 점수가 높은 종목도 선택 가능하도록 별도로 편입한다
  const scoredHighScoreNoSignal = eligible
    .filter((t) => !passedTickerSet.has(t.ticker))
    .map((t) => ({ ticker: t, score: scoreTicker(t) }))
    .filter(({ score }) => score >= config.highScoreThreshold)
    .map(({ ticker: t, score }) => ({
      ticker: t.ticker,
      name: t.name,
      sector: t.sector,
      score,
      reasons: buildHighScoreReasons(t),
      signalPassed: false,
      relaxationApplied,
    }))

  const list = [...scoredPassed, ...scoredHighScoreNoSignal]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)

  return {
    list,
    relaxationApplied,
    insufficientSignal: scoredPassed.length < MIN_RESULTS,
    level,
  }
}
