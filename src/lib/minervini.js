// 미너비니 모드 — 1단계 트렌드 템플릿 (PRD_Nasdaq8 §4.2, US-4)
// 추세추종 모드(recommend.js)와 달리 원전 기준 고정 — 프리셋·고급 설정 대상이 아니다.

import { sma, week52HighLow, rsRawScore, rsPercentile, hasFullYearData } from './indicators.js'
import { TREND_TEMPLATE, TREND_TEMPLATE_RELAXED_MIN_CONDITIONS, TREND_TEMPLATE_MIN_RESULTS } from './constants/v8.js'

export const TREND_TEMPLATE_CONDITION_CODES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']

/**
 * 단일 종목의 트렌드 템플릿 8조건을 판정한다 (PRD §4.2 표 그대로).
 * series: 원본 바 배열. rsPercentileValue: 유니버스 단위로 미리 계산해 전달하는 이 종목의 RS 백분위.
 * 데이터가 52주(252거래일) 미만이면 판정하지 않고 insufficientData:true를 반환한다.
 */
export function evaluateTrendTemplate(series, rsPercentileValue) {
  if (!hasFullYearData(series)) {
    return { checks: null, passedCount: 0, allPassed: false, missingConditions: [], insufficientData: true }
  }

  const closes = series.map((b) => b.close)
  const n = closes.length
  const currentClose = closes[n - 1]

  const sma50 = sma(closes, 50)[n - 1]
  const sma150Arr = sma(closes, 150)
  const sma150 = sma150Arr[n - 1]
  const sma200Arr = sma(closes, 200)
  const sma200 = sma200Arr[n - 1]
  const sma200PriorIdx = n - 1 - TREND_TEMPLATE.SMA200_TREND_WINDOW
  const sma200Prior = sma200PriorIdx >= 0 ? sma200Arr[sma200PriorIdx] : null

  const week52 = week52HighLow(series)

  const checks = {
    T1: sma150 != null && sma200 != null && currentClose > sma150 && currentClose > sma200,
    T2: sma150 != null && sma200 != null && sma150 > sma200,
    T3: sma200 != null && sma200Prior != null && sma200 > sma200Prior,
    T4: sma50 != null && sma150 != null && sma200 != null && sma50 > sma150 && sma150 > sma200,
    T5: sma50 != null && currentClose > sma50,
    T6: week52 != null && currentClose >= week52.low * TREND_TEMPLATE.LOW_MULTIPLIER,
    T7: week52 != null && currentClose >= week52.high * TREND_TEMPLATE.HIGH_MULTIPLIER,
    T8: rsPercentileValue != null && rsPercentileValue >= TREND_TEMPLATE.RS_PERCENTILE_MIN,
  }

  const passedCount = TREND_TEMPLATE_CONDITION_CODES.filter((c) => checks[c]).length
  const missingConditions = TREND_TEMPLATE_CONDITION_CODES.filter((c) => !checks[c])

  return {
    checks,
    passedCount,
    allPassed: passedCount === TREND_TEMPLATE.CONDITION_COUNT,
    missingConditions,
    insufficientData: false,
  }
}

/**
 * tickers: [{ ticker, name, sector, series }] — deriveTickerData류 파생 데이터가 원본
 * series를 함께 보유한 배열이면 그대로 사용 가능하다 (화면 연동은 US-10에서 처리).
 * 반환: { passed, level, relaxationApplied, insufficientSignal, excludedForInsufficientData }
 */
export function runMinerviniStage1(tickers) {
  const eligible = tickers.filter((t) => hasFullYearData(t.series))
  const ineligible = tickers.filter((t) => !hasFullYearData(t.series))

  const rawScores = eligible.map((t) => rsRawScore(t.series))
  const percentiles = rsPercentile(rawScores)

  const evaluated = eligible.map((t, i) => ({
    ticker: t.ticker,
    name: t.name,
    sector: t.sector,
    rsPercentile: percentiles[i],
    ...evaluateTrendTemplate(t.series, percentiles[i]),
  }))

  let passed = evaluated.filter((e) => e.allPassed)
  let level = 'strict'
  let relaxationApplied = false

  if (passed.length < TREND_TEMPLATE_MIN_RESULTS) {
    passed = evaluated.filter((e) => e.passedCount >= TREND_TEMPLATE_RELAXED_MIN_CONDITIONS)
    level = 'relaxed7of8'
    relaxationApplied = true
  }

  return {
    passed,
    level,
    relaxationApplied,
    insufficientSignal: passed.length < TREND_TEMPLATE_MIN_RESULTS,
    excludedForInsufficientData: ineligible.map((t) => ({
      ticker: t.ticker,
      reason: '52주(252거래일) 미만 데이터',
    })),
  }
}
