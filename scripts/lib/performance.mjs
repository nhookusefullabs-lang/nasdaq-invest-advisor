// 성과 계산 (PRD_Nasdaq9.md §4.2, US-4) — 신호별 초과수익·승률·표본을 집계한다.
// 진입 = 신호일 종가, 청산 = N거래일 후 종가. 벤치마크 = 같은 진입~청산 구간의 유니버스
// (dataSufficient 전체) 등가중 평균 수익률. 청산일이 데이터 범위를 벗어나는 신호는 그
// 보유기간 집계에서만 제외한다(표본 수에 반영, 다른 보유기간은 영향 없음).

// v9.1 US-2: scripts/lib/exits.mjs(경로 의존 청산 변형)가 아래 소함수들을 재구현 없이
// 그대로 재사용할 수 있도록 export만 보강한다 — 동작 불변.
export const round4 = (x) => Math.round(x * 10000) / 10000

export function average(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

export function median(arr) {
  if (!arr.length) return null
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** dataset.tickers(dataSufficient만 대상) → ticker별 { series, dateIndex } 조회 구조. */
export function buildPriceIndex(tickers) {
  const map = new Map()
  for (const t of tickers) {
    if (!t.dataSufficient) continue
    const dateIndex = new Map(t.series.map((bar, i) => [bar.date, i]))
    map.set(t.ticker, { series: t.series, dateIndex })
  }
  return map
}

export function entryPoint(priceIndex, ticker, date) {
  const entry = priceIndex.get(ticker)
  if (!entry) return null
  const idx = entry.dateIndex.get(date)
  if (idx == null) return null
  return { idx, series: entry.series }
}

/** entryDate 종가 → entryDate+holdingDays 거래일 후 종가까지의 수익률. 범위 초과 시 null. */
function forwardReturn(priceIndex, ticker, entryDate, holdingDays) {
  const point = entryPoint(priceIndex, ticker, entryDate)
  if (!point) return null
  const exitIdx = point.idx + holdingDays
  if (exitIdx >= point.series.length) return null
  const entryClose = point.series[point.idx].close
  const exitClose = point.series[exitIdx].close
  return { entryIdx: point.idx, exitIdx, series: point.series, returnPct: exitClose / entryClose - 1 }
}

/** entryDate 기준 holdingDays 보유 시 유니버스(dataSufficient 전체) 등가중 평균 수익률. 유효 표본 없으면 null. */
export function universeBenchmarkReturn(priceIndex, entryDate, holdingDays) {
  const returns = []
  for (const ticker of priceIndex.keys()) {
    const fwd = forwardReturn(priceIndex, ticker, entryDate, holdingDays)
    if (fwd) returns.push(fwd.returnPct)
  }
  return returns.length ? average(returns) : null
}

export function maxDrawdown(closes) {
  let peak = closes[0]
  let mdd = 0
  for (const c of closes) {
    if (c > peak) peak = c
    mdd = Math.max(mdd, (peak - c) / peak)
  }
  return mdd
}

/**
 * 신호 레코드 하나(US-3 buildSignalRecords 산출물) + 보유기간 하나를 성과 레코드로 확장한다.
 * 반환: { ...record, holdingDays, returnPct, benchmarkReturn, excessReturn, mdd } | null
 * (청산일 범위 초과 또는 벤치마크 계산 불가 시 null — 표본에서 제외).
 */
export function computeSignalPerformance(record, priceIndex, holdingDays) {
  const fwd = forwardReturn(priceIndex, record.ticker, record.date, holdingDays)
  if (!fwd) return null
  const benchmarkReturn = universeBenchmarkReturn(priceIndex, record.date, holdingDays)
  if (benchmarkReturn == null) return null

  const closes = fwd.series.slice(fwd.entryIdx, fwd.exitIdx + 1).map((b) => b.close)

  return {
    ...record,
    holdingDays,
    returnPct: fwd.returnPct,
    benchmarkReturn,
    excessReturn: fwd.returnPct - benchmarkReturn,
    mdd: maxDrawdown(closes),
  }
}

const DEFAULT_STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const DEFAULT_BASES = ['top5', 'allSignals']

/**
 * records × holdingDaysList 조합을 계산해 (strategyKey, basis, days) 그룹별 집계표를 만든다.
 * strategyKeys/bases의 전체 조합을 미리 만들어두므로, 신호가 하나도 없는 축도 표본 0으로
 * 안전하게(NaN 없이 null) 나타난다.
 * 반환: [{ strategyKey, basis, days, signals, winRate, avgExcess, medianExcess, avgReturn, mdd, relaxedShare }]
 */
export function aggregatePerformance(
  records,
  priceIndex,
  holdingDaysList,
  { strategyKeys = DEFAULT_STRATEGY_KEYS, bases = DEFAULT_BASES } = {}
) {
  const groups = new Map()
  const groupKey = (strategyKey, basis, days) => `${strategyKey}|${basis}|${days}`

  for (const strategyKey of strategyKeys) {
    for (const basis of bases) {
      for (const days of holdingDaysList) {
        groups.set(groupKey(strategyKey, basis, days), { strategyKey, basis, days, items: [] })
      }
    }
  }

  for (const record of records) {
    for (const days of holdingDaysList) {
      const perf = computeSignalPerformance(record, priceIndex, days)
      if (!perf) continue
      const key = groupKey(record.strategyKey, record.basis, days)
      if (!groups.has(key)) groups.set(key, { strategyKey: record.strategyKey, basis: record.basis, days, items: [] })
      groups.get(key).items.push(perf)
    }
  }

  return [...groups.values()].map(({ strategyKey, basis, days, items }) => {
    if (!items.length) {
      return { strategyKey, basis, days, signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null, relaxedShare: null }
    }

    const excess = items.map((i) => i.excessReturn)
    const rets = items.map((i) => i.returnPct)
    const mdds = items.map((i) => i.mdd)
    const wins = excess.filter((e) => e > 0).length
    const relaxedCount = items.filter((i) => i.relaxationApplied).length

    return {
      strategyKey,
      basis,
      days,
      signals: items.length,
      winRate: round4(wins / items.length),
      avgExcess: round4(average(excess)),
      medianExcess: round4(median(excess)),
      avgReturn: round4(average(rets)),
      mdd: round4(average(mdds)),
      relaxedShare: round4(relaxedCount / items.length),
    }
  })
}
