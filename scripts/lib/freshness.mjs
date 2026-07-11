// v9.1 US-4 — 신호 신선도 코호트 (prd-v9.1-diagnostics.md, 가설 ③)
// "신선도" = 신호일(asOf) − 트리거 이벤트 발생일(거래일 기준). 이벤트 판정은 기존
// src/lib/indicators.js의 골든크로스·피벗 근접 함수를 그대로 재호출해 재사용한다
// (재구현 금지) — 이 파일은 "그 함수가 참인 가장 짧은 창(window)"을 찾아 daysAgo로
// 환산할 뿐, 크로스오버/피벗 판정 조건 자체는 한 줄도 새로 작성하지 않는다.
import { goldenCrossWithin, pivotProximity } from '../../src/lib/indicators.js'
import { computeSignalPerformance, average, median, round4 } from './performance.mjs'

// 미너비니 피벗 돌파의 "최근 10거래일" 상한(PRD 명시)을 추세추종 골든크로스에도 동일 적용한다
// (두 이벤트가 같은 코호트 축을 공유하므로 대칭 유지 — 10거래일 밖은 no_recent_breakout).
export const MAX_LOOKBACK_DAYS = 10
export const FRESHNESS_COHORTS = ['0d', '1-2d', '3-4d', '5d+', 'no_recent_breakout']

/** daysAgo(신호일 기준 이벤트 발생 며칠 전, null=미검출) → 코호트 문자열. 전 신호가 정확히 하나에 귀속된다. */
export function freshnessCohort(daysAgo) {
  if (daysAgo == null) return 'no_recent_breakout'
  if (daysAgo === 0) return '0d'
  if (daysAgo <= 2) return '1-2d'
  if (daysAgo <= 4) return '3-4d'
  return '5d+'
}

/**
 * 추세추종: MACD 골든크로스가 정확히 daysAgo 거래일 전 발생했는지를, goldenCrossWithin(N)의
 * 창을 하나씩 늘려가며(N=daysAgo+1이 처음 true가 되는 지점) 찾는다 — 그 함수의 크로스오버
 * 조건은 그대로 두고 호출 파라미터만 바꾼다. maxLookback 안에서 못 찾으면 null.
 */
export function goldenCrossFreshnessDays(macdLine, signalLine, maxLookback = MAX_LOOKBACK_DAYS) {
  for (let daysAgo = 0; daysAgo < maxLookback; daysAgo++) {
    const withinN = goldenCrossWithin(macdLine, signalLine, daysAgo + 1)
    const withinShorter = goldenCrossWithin(macdLine, signalLine, daysAgo)
    if (withinN && !withinShorter) return daysAgo
  }
  return null
}

/**
 * 미너비니: 종가가 직전 63거래일 최고 종가를 상향 돌파한(피벗 돌파 근사) 가장 최근일을 찾는다.
 * pivotProximity(series)===0은 "그 배열의 마지막 날 종가가 직전 63거래일 중 최고치"라는 뜻이므로,
 * series를 끝에서부터 하루씩 잘라 그대로 재호출하면 daysAgo 며칠 전의 돌파 여부를 판정할 수 있다
 * (돌파 조건 자체는 pivotProximity 안에만 존재 — 재구현 없음).
 */
export function pivotBreakoutFreshnessDays(series, maxLookback = MAX_LOOKBACK_DAYS) {
  const n = series.length
  for (let daysAgo = 0; daysAgo < maxLookback; daysAgo++) {
    const endIndex = n - daysAgo
    if (endIndex < 63) break
    if (pivotProximity(series.slice(0, endIndex)) === 0) return daysAgo
  }
  return null
}

const DEFAULT_STRATEGY_KEYS = ['trend', 'minervini']

/**
 * records(US-3 buildSignalRecords 산출물, freshnessCohort 필드 포함) × holdingDaysList를
 * (strategyKey, cohort) 그룹별로 집계한다. basis는 allSignals만 사용(top5는 코호트별 표본이
 * 너무 작아짐 — PRD 명시), 컨센서스는 이벤트가 정의되지 않으므로 대상에서 제외한다.
 * 반환: [{ key, cohort, byHolding: [{days, signals, winRate, avgExcess, medianExcess, avgReturn, mdd}] }]
 * (전 key×cohort×days 조합이 표본 유무와 무관하게 나타남 — performance.mjs의 aggregatePerformance와 동일 원칙).
 */
export function aggregateFreshnessCohorts(records, priceIndex, holdingDaysList, { strategyKeys = DEFAULT_STRATEGY_KEYS } = {}) {
  const eligible = records.filter((r) => r.basis === 'allSignals' && strategyKeys.includes(r.strategyKey) && r.freshnessCohort)

  return strategyKeys.flatMap((key) =>
    FRESHNESS_COHORTS.map((cohort) => {
      const matching = eligible.filter((r) => r.strategyKey === key && r.freshnessCohort === cohort)
      return {
        key,
        cohort,
        byHolding: holdingDaysList.map((days) => summarizeFreshnessGroup(days, matching, priceIndex)),
      }
    })
  )
}

function summarizeFreshnessGroup(days, records, priceIndex) {
  const items = records.map((r) => computeSignalPerformance(r, priceIndex, days)).filter(Boolean)
  if (!items.length) {
    return { days, signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null }
  }
  const excess = items.map((i) => i.excessReturn)
  const rets = items.map((i) => i.returnPct)
  const mdds = items.map((i) => i.mdd)
  const wins = excess.filter((e) => e > 0).length
  return {
    days,
    signals: items.length,
    winRate: round4(wins / items.length),
    avgExcess: round4(average(excess)),
    medianExcess: round4(median(excess)),
    avgReturn: round4(average(rets)),
    mdd: round4(average(mdds)),
  }
}
