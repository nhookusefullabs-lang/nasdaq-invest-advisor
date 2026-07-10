// 미너비니 모드 — 1단계 트렌드 템플릿 + 2단계 VCP 근사 스코어링 (PRD_Nasdaq8 §4.2, US-4/US-5)
// 추세추종 모드(recommend.js)와 달리 원전 기준 고정 — 프리셋·고급 설정 대상이 아니다.

import {
  sma,
  week52HighLow,
  rsRawScore,
  rsPercentile,
  hasFullYearData,
  volatilityContraction,
  volumeDryUp,
  pivotProximity,
} from './indicators.js'
import { TREND_TEMPLATE, TREND_TEMPLATE_RELAXED_MIN_CONDITIONS, TREND_TEMPLATE_MIN_RESULTS, VCP_SCORE } from './constants/v8.js'

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const round1 = (x) => Math.round(x * 10) / 10

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
    series: t.series,
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

/**
 * 2단계 VCP 근사 스코어링 (PRD §4.2 배점표, US-5) — RS 백분위 40 + 변동성 수축 25 +
 * 거래량 드라이업 15 + 피벗/신고가 근접 20, 전부 선형·클램프. 개별 요소가 계산 불가(null)면
 * 그 요소는 0점으로 처리한다(1단계를 통과한 종목은 hasFullYearData가 보장되므로 실제로는
 * 거의 발생하지 않지만, 방어적으로 처리).
 */
export function evaluateVcpScore(series, rsPercentileValue) {
  const rsScore =
    clamp01(((rsPercentileValue ?? 0) - VCP_SCORE.RS_PERCENTILE_FLOOR) / (VCP_SCORE.RS_PERCENTILE_CEIL - VCP_SCORE.RS_PERCENTILE_FLOOR)) *
    VCP_SCORE.RS_MAX

  const contractionRatio = volatilityContraction(series)
  const contractionDenom = VCP_SCORE.CONTRACTION_ZERO_SCORE_RATIO - VCP_SCORE.CONTRACTION_FULL_SCORE_RATIO
  const contractionScore =
    contractionRatio == null
      ? 0
      : clamp01((1 - Math.min(contractionRatio, VCP_SCORE.CONTRACTION_ZERO_SCORE_RATIO)) / contractionDenom) * VCP_SCORE.CONTRACTION_MAX

  const dryUpPct = volumeDryUp(series)
  const dryUpScore =
    dryUpPct == null || dryUpPct > 0
      ? 0
      : (Math.min(Math.abs(dryUpPct), VCP_SCORE.DRYUP_CAP_PCT) / VCP_SCORE.DRYUP_CAP_PCT) * VCP_SCORE.DRYUP_MAX

  const proximityPct = pivotProximity(series)
  const pivotScore =
    proximityPct == null
      ? 0
      : Math.max(0, (VCP_SCORE.PIVOT_ZERO_PCT - Math.min(proximityPct, VCP_SCORE.PIVOT_ZERO_PCT)) / VCP_SCORE.PIVOT_ZERO_PCT) * VCP_SCORE.PIVOT_MAX

  const score = round1(rsScore + contractionScore + dryUpScore + pivotScore)

  const reasonParts = ['Stage 2 추세']
  if (rsScore > 0 && rsPercentileValue != null) reasonParts.push(`RS 상위 ${Math.round(100 - rsPercentileValue)}%`)
  if (contractionScore > 0) reasonParts.push('변동성 수축 중')
  if (pivotScore > 0 && proximityPct != null) reasonParts.push(`피벗 −${proximityPct.toFixed(1)}%`)

  return {
    score,
    rsScore: round1(rsScore),
    contractionScore: round1(contractionScore),
    dryUpScore: round1(dryUpScore),
    pivotScore: round1(pivotScore),
    reasons: reasonParts.join(', '),
  }
}

/**
 * 미너비니 모드 전체 추천 파이프라인(1단계+2단계). 출력 필드를 추세추종 recommend()
 * 결과와 동형으로 맞춰(ticker,name,sector,score,reasons,signalPassed,relaxationApplied +
 * 신규 templateChecks[]) 이후 컨센서스 랭킹(US-6)이 두 모드를 동일하게 다룰 수 있게 한다.
 * 반환: { list, relaxationApplied, insufficientSignal, level, excludedForInsufficientData }
 */
export function runMinerviniRecommend(tickers) {
  const stage1 = runMinerviniStage1(tickers)

  const list = stage1.passed
    .map((p) => {
      const vcp = evaluateVcpScore(p.series, p.rsPercentile)
      return {
        ticker: p.ticker,
        name: p.name,
        sector: p.sector,
        score: vcp.score,
        reasons: vcp.reasons,
        signalPassed: true,
        relaxationApplied: stage1.relaxationApplied,
        templateChecks: TREND_TEMPLATE_CONDITION_CODES.map((code) => ({ code, passed: p.checks[code] })),
      }
    })
    .sort((a, b) => b.score - a.score)

  return {
    list,
    relaxationApplied: stage1.relaxationApplied,
    insufficientSignal: stage1.insufficientSignal,
    level: stage1.level,
    excludedForInsufficientData: stage1.excludedForInsufficientData,
  }
}
