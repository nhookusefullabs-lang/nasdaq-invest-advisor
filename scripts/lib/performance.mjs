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

/**
 * 부분 청산 지원 포지션 성과 계산 (PRD_Nasdaq11 §4.3 청산 E/US-3) — 청산E(클라이맥스
 * 부분 청산) 등 "포지션의 일부만 특정 시점에 청산하고 나머지는 만기까지 보유"하는
 * 규칙의 정확한 가중 수익률/벤치마크/MDD를 계산한다. 기존 computeSignalPerformance()는
 * 전량 청산(단일 만기) 전용으로 그대로 두고(회귀 없음), 이 함수는 완전히 별개로 추가한다.
 *
 * exitEvents: [{date, ratio}] — date(그 시점 청산 비중 ratio, 0~1)의 배열. ratio 합이
 * 1 미만이면 잔여분(1−합)은 record.date로부터 finalHoldingDays 거래일 후에 청산한다.
 * ratio 합이 1을 초과하면(무효 입력) null. 각 청산분(레그)은 자신의 보유기간에 맞는
 * universeBenchmarkReturn()으로 개별 벤치마킹한 뒤 비중대로 가중합한다(레그마다 보유
 * 기간이 다르므로 전체를 하나의 벤치마크로 뭉뚱그리면 정합성이 깨진다).
 *
 * 반환: { ...record, returnPct, benchmarkReturn, excessReturn, mdd, legs } | null
 * (legs: [{date, weight, returnPct}] — 근거 확인용)
 */
export function computePartialPositionPerformance(record, priceIndex, exitEvents, finalHoldingDays) {
  const entry = priceIndex.get(record.ticker)
  if (!entry) return null
  const entryIdx = entry.dateIndex.get(record.date)
  if (entryIdx == null) return null
  const { series } = entry
  const entryClose = series[entryIdx].close

  const totalPartialRatio = exitEvents.reduce((s, e) => s + e.ratio, 0)
  if (totalPartialRatio < 0 || totalPartialRatio > 1 + 1e-9) return null

  const legs = []
  for (const event of exitEvents) {
    const exitIdx = entry.dateIndex.get(event.date)
    if (exitIdx == null || exitIdx <= entryIdx) return null
    legs.push({ exitIdx, weight: event.ratio })
  }

  const remainderWeight = Math.max(0, 1 - totalPartialRatio)
  if (remainderWeight > 1e-9) {
    const finalExitIdx = entryIdx + finalHoldingDays
    if (finalExitIdx >= series.length) return null
    legs.push({ exitIdx: finalExitIdx, weight: remainderWeight })
  }
  if (!legs.length) return null

  let weightedReturn = 0
  let weightedBenchmark = 0
  const legDetails = []
  for (const leg of legs) {
    const exitClose = series[leg.exitIdx].close
    const legReturn = exitClose / entryClose - 1
    const legHoldingDays = leg.exitIdx - entryIdx
    const legBenchmark = universeBenchmarkReturn(priceIndex, record.date, legHoldingDays)
    if (legBenchmark == null) return null
    weightedReturn += leg.weight * legReturn
    weightedBenchmark += leg.weight * legBenchmark
    legDetails.push({ date: series[leg.exitIdx].date, weight: leg.weight, returnPct: legReturn })
  }

  // MDD는 "잔여 포지션 가중 곡선" 기준 — 이미 청산된 레그는 그 시점 수익률로 고정(확정),
  // 아직 청산 안 된 비중만 그날그날의 종가로 계속 평가한다.
  const maxExitIdx = Math.max(...legs.map((l) => l.exitIdx))
  const curve = []
  for (let t = entryIdx; t <= maxExitIdx; t++) {
    let value = 0
    for (const leg of legs) {
      const priceRatio = t >= leg.exitIdx ? series[leg.exitIdx].close / entryClose : series[t].close / entryClose
      value += leg.weight * priceRatio
    }
    curve.push(value)
  }

  return {
    ...record,
    returnPct: weightedReturn,
    benchmarkReturn: weightedBenchmark,
    excessReturn: weightedReturn - weightedBenchmark,
    mdd: maxDrawdown(curve),
    legs: legDetails,
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
