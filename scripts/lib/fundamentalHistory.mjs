// 펀더멘털 축 근사 재구성 (PRD_Nasdaq9.md §4.2 제약, §4.4 펀더멘털 축 참조, US-6)
// fundamentals.json은 현재 시점 스냅샷이므로 과거 판정에 그대로 쓰면 미래 정보를 참조하는
// 선견 편향이 생긴다. quarters[](보통 4~5분기)만으로는 진짜 전년동기(YoY) 비교를 여러 시점에서
// 반복할 수 없으므로(같은 분기 1년 전 데이터가 부족), 분기 i와 그 직전 분기(i+1, 배열은
// 최신이 index 0인 내림차순)의 QoQ 근사로 F1(EPS)·F3(매출)·F4(마진)를 재구성한다.
// F5(ROE)는 분기 이력이 없어 재구성 불가 — 현재 스냅샷을 그대로 쓰며, 이는 선견 편향 항목임을
// note로 명시한다. 판정 자체는 반드시 기존 src/lib/fundamentals.js의 evaluateFundamentalHurdle을
// 그대로 호출한다(임계값 재구현 금지) — 입력만 재구성된 시점값으로 바꾼다.
import { evaluateFundamentalHurdle } from '../../src/lib/fundamentals.js'
import { aggregatePerformance } from './performance.mjs'

export const FUNDAMENTAL_AXIS_NOTE = '근사 재구성 · 짧은 구간 참고치'

const QUARTER_END_MONTH_DAY = { 1: [3, 31], 2: [6, 30], 3: [9, 30], 4: [12, 31] }
const REPORT_LAG_DAYS = 45 // 분기 종료 후 실적 발표까지의 전형적 지연(근사)

function parsePeriod(period) {
  const m = /^(\d{4})-Q([1-4])$/.exec(period ?? '')
  if (!m) return null
  return { year: Number(m[1]), quarter: Number(m[2]) }
}

/** 분기 라벨("YYYY-QN")을 근사 발표일(YYYY-MM-DD)로 변환한다 — 분기 종료일 + 45일. */
export function quarterToApproxReportDate(period) {
  const parsed = parsePeriod(period)
  if (!parsed) return null
  const [month, day] = QUARTER_END_MONTH_DAY[parsed.quarter]
  const quarterEnd = new Date(Date.UTC(parsed.year, month - 1, day))
  return new Date(quarterEnd.getTime() + REPORT_LAG_DAYS * 86400000).toISOString().slice(0, 10)
}

function pctChange(current, prior) {
  if (current == null || prior == null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

/**
 * fundamentals.json의 ticker 항목 하나 → 분기별 근사 재구성 판정 이력(오래된 → 최신 정렬).
 * quarters.length < 2면 QoQ 비교 자체가 불가능하므로 빈 배열을 반환한다.
 * 반환: [{ asOfDate, quarter, verdict: evaluateFundamentalHurdle()의 반환값 }]
 */
export function reconstructFundamentalHistory(item) {
  if (!item || !Array.isArray(item.quarters) || item.quarters.length < 2) return []

  const points = []
  for (let i = 0; i < item.quarters.length - 1; i++) {
    const cur = item.quarters[i]
    const prior = item.quarters[i + 1]
    const asOfDate = quarterToApproxReportDate(cur.period)
    if (!asOfDate) continue

    const reconstructedItem = {
      ticker: item.ticker,
      epsGrowthQoQ_yoy: pctChange(cur.eps, prior.eps),
      epsAccelerating: null, // F2는 참고 배지 전용 — 근사 재구성 대상 아님(판정에 영향 없음)
      revenueGrowthQoQ_yoy: pctChange(cur.revenue, prior.revenue),
      marginImproving: cur.operatingMargin != null && prior.operatingMargin != null ? cur.operatingMargin > prior.operatingMargin : null,
      roe: item.roe, // F5: 분기 이력 없음 — 현재 스냅샷 그대로(선견 편향 항목, note로 고지)
      missing: item.missing ?? [],
    }

    points.push({ asOfDate, quarter: cur.period, verdict: evaluateFundamentalHurdle(reconstructedItem) })
  }

  return points.sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : a.asOfDate > b.asOfDate ? 1 : 0))
}

/** history(오래된→최신 정렬)에서 evaluationDate 시점에 유효한(그 날짜 이전 가장 최근) 판정을 찾는다. */
export function fundamentalVerdictAsOf(history, evaluationDate) {
  let result = null
  for (const point of history) {
    if (point.asOfDate <= evaluationDate) result = point
    else break
  }
  return result
}

const AXIS_VERDICTS = ['pass', 'partial', 'fail']

/**
 * 신호 레코드(US-3) + fundamentals.json 데이터 → backtest.json fundamentalAxis (PRD §7).
 * fundamentalsData가 없으면(null) 엔진은 정상 완주하되 fundamentalAxis는 null.
 * 대상 신호는 trend 모드의 allSignals(1단계 통과 전체) — 펀더멘털 축은 특정 전략에 종속되지
 * 않는 단일 교차표(PRD §7 스키마에 strategyKey 구분 없음)이므로 모드 중립적인 기준 집합
 * 하나를 고정해야 하며, 가장 넓은 표본(추세추종 전체 신호)을 택했다.
 * insufficientFundamentals 판정 신호는 이 3분류 교차표에서 제외한다(Pass/Partial/Fail만).
 */
export function buildFundamentalAxis(fundamentalsData, records, priceIndex, holdingDays) {
  if (!fundamentalsData) return null

  const historyByTicker = new Map(fundamentalsData.tickers.map((item) => [item.ticker, reconstructFundamentalHistory(item)]))

  const coveredFromCandidates = [...historyByTicker.values()].map((h) => h[0]?.asOfDate).filter(Boolean).sort()
  const coveredFrom = coveredFromCandidates[0] ?? null
  if (!coveredFrom) return { note: FUNDAMENTAL_AXIS_NOTE, coveredFrom: null, byVerdict: [] }

  const eligibleSignals = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'allSignals' && r.date >= coveredFrom)

  const byVerdictRecords = { pass: [], partial: [], fail: [] }
  for (const record of eligibleSignals) {
    const history = historyByTicker.get(record.ticker)
    if (!history) continue
    const point = fundamentalVerdictAsOf(history, record.date)
    const verdict = point?.verdict?.verdict
    if (!AXIS_VERDICTS.includes(verdict)) continue
    byVerdictRecords[verdict].push(record)
  }

  const byVerdict = AXIS_VERDICTS.map((verdict) => ({
    verdict,
    byHolding: aggregatePerformance(byVerdictRecords[verdict], priceIndex, holdingDays, { strategyKeys: ['trend'], bases: ['allSignals'] }).map((g) => ({
      days: g.days,
      signals: g.signals,
      winRate: g.winRate,
      avgExcess: g.avgExcess,
      medianExcess: g.medianExcess,
      avgReturn: g.avgReturn,
      mdd: g.mdd,
    })),
  }))

  return { note: FUNDAMENTAL_AXIS_NOTE, coveredFrom, byVerdict }
}
