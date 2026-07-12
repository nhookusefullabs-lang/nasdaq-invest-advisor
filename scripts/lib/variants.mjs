// 후보 변형 비교 프레임 + 변형 A/B/C (PRD_Nasdaq9.md §4.3, US-7)
// 변형은 현행 로직을 감싸거나 대체하는 순수 함수로만 구성하며, 앱(src/) 코드는 수정하지
// 않는다(export 보강 예외 — recommend.js의 stage1Pass/scoreTicker/SCORE_*, consensus.js의
// percentileOf를 그대로 재사용해 "변경되지 않는 부분"의 재구현을 피한다). ADX처럼 앱에
// 없는 신규 지표는 scripts/lib/adx.mjs에 둔다(채택 전까지 앱 lib에 넣지 않음).
// 채택 결정·상수 변경·앱(src) 반영은 이 파일이 하지 않는다 — adopted는 항상 false.
import { buildDataset } from '../../src/lib/buildDataset.js'
import { recommend, stage1Pass, scoreTicker, SCORE_VOLUME_MAX, SCORE_SECTOR_BONUS } from '../../src/lib/recommend.js'
import { runMinerviniRecommend } from '../../src/lib/minervini.js'
import { percentileOf } from '../../src/lib/consensus.js'
import { PRESETS, DEFAULT_PRESET_KEY } from '../../src/lib/presets.js'
import { sliceUniverseAsOf } from './asOf.mjs'
import { aggregatePerformance } from './performance.mjs'
import { adx } from './adx.mjs'

const round4 = (x) => Math.round(x * 10000) / 10000

function toMinerviniInput(tickers) {
  return tickers.filter((t) => t.dataSufficient).map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, series: t.series }))
}

// --- 변형 A: 이격도 역U자 점수 (추세추종 2단계) ---
const SWEET_LOW = 3
const SWEET_HIGH = 8
const OVERHEAT_ZERO = 15
const SCORE_DISPARITY_MAX = 60 // recommend.js와 동일한 만점 배분 — 변경 대상은 "형태"뿐, 만점 자체는 유지

function disparityInvertedUScore(disparity) {
  if (disparity == null) return 0
  if (disparity < SWEET_LOW) return Math.max(0, disparity / SWEET_LOW) * SCORE_DISPARITY_MAX
  if (disparity <= SWEET_HIGH) return SCORE_DISPARITY_MAX
  return Math.max(0, (OVERHEAT_ZERO - disparity) / (OVERHEAT_ZERO - SWEET_HIGH)) * SCORE_DISPARITY_MAX
}

/**
 * trendResult(recommend()의 반환값)의 stage1 통과 종목만 재점수화한다. 거래량·섹터 가점은
 * recommend.js가 실제로 쓰는 것과 동일한 공식·상수(export된 SCORE_VOLUME_MAX/SCORE_SECTOR_BONUS)를
 * 그대로 재사용 — 변경 대상(이격도 성분)만 새 공식으로 교체한다.
 */
export function applyDisparityInvertedU(trendResult, dataset) {
  const byTicker = new Map(dataset.tickers.map((t) => [t.ticker, t]))
  const list = trendResult.list
    .filter((r) => r.signalPassed)
    .map((r) => {
      const td = byTicker.get(r.ticker)
      const dispScore = disparityInvertedUScore(td?.indicators?.disparity)
      const volScore = (Math.max(0, Math.min(td?.indicators?.volTrend ?? 0, 50)) / 50) * SCORE_VOLUME_MAX
      const sectorScore = td?.isLeadingSector ? SCORE_SECTOR_BONUS : 0
      return { ...r, score: Math.round((dispScore + volScore + sectorScore) * 10) / 10 }
    })
    .sort((a, b) => b.score - a.score)

  return { ...trendResult, list }
}

// --- 변형 B: ADX(14) ≥ 20 게이트 (추세추종 1단계 추가 게이트) ---
const ADX_MIN = 20

/**
 * 기존 stage1Pass(레벨은 실제 trend 결과가 사용한 것과 동일하게 맞춤)를 그대로 통과하고,
 * 추가로 ADX(14) ≥ 20인 종목만 남긴다. 스코어링은 scoreTicker를 그대로 재사용(변경 없음).
 */
export function applyAdxGate(dataset, level, config = PRESETS[DEFAULT_PRESET_KEY]) {
  const eligible = dataset.tickers.filter((t) => t.dataSufficient)
  const passed = eligible.filter((t) => stage1Pass(t, level, config) && (adx(t.series, 14) ?? 0) >= ADX_MIN)
  const list = passed.map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, score: scoreTicker(t), signalPassed: true })).sort((a, b) => b.score - a.score)

  return { list, relaxationApplied: level !== 'strict', insufficientSignal: list.length < 5, level }
}

// --- 변형 C: 컨센서스 가중 평균 (3격자 중 대표값 60:40 — 나머지는 evaluateVariant의 note로 병기) ---
export const CONSENSUS_WEIGHTED_GRID = [
  { trend: 0.5, minervini: 0.5, label: '50:50(현행)' },
  { trend: 0.6, minervini: 0.4, label: '60:40(추세추종 가중)' },
  { trend: 0.4, minervini: 0.6, label: '40:60(미너비니 가중)' },
]

/** 기존 buildConsensusRanking과 달리 percentile 평균 대신 가중 평균을 쓴다(등급 우선순위는 동일). */
export function applyConsensusWeighted(trendResult, minerviniResult, weights) {
  const trendList = trendResult?.list ?? []
  const minerviniList = minerviniResult?.list ?? []
  const trendScores = trendList.map((r) => r.score)
  const minerviniScores = minerviniList.map((r) => r.score)

  const trendByTicker = new Map(trendList.map((r) => [r.ticker, { ...r, percentile: percentileOf(r.score, trendScores) }]))
  const minerviniByTicker = new Map(minerviniList.map((r) => [r.ticker, { ...r, percentile: percentileOf(r.score, minerviniScores) }]))
  const allTickers = new Set([...trendByTicker.keys(), ...minerviniByTicker.keys()])

  const list = [...allTickers]
    .map((ticker) => {
      const trend = trendByTicker.get(ticker) ?? null
      const minervini = minerviniByTicker.get(ticker) ?? null
      const grade = trend && minervini ? '★★' : '★'
      const consensusPercentile =
        trend && minervini ? trend.percentile * weights.trend + minervini.percentile * weights.minervini : (trend ?? minervini).percentile
      const base = trend ?? minervini
      return { ticker, name: base.name, sector: base.sector, grade, consensusPercentile }
    })
    .sort((a, b) => (a.grade !== b.grade ? (a.grade === '★★' ? -1 : 1) : b.consensusPercentile - a.consensusPercentile))

  return { list }
}

// --- 변형 등록 + 평가일별 재현 ---

export const VARIANTS = [
  {
    name: 'disparity_inverted_u',
    description: '추세추종 2단계 이격도 점수를 역U자(+3~+8% 만점, 과열 감점)로 변경',
    baselineStrategyKeys: ['trend'],
    apply: (ctx) => applyDisparityInvertedU(ctx.trend, ctx.dataset),
  },
  {
    name: 'adx_gate',
    description: 'ADX(14) ≥ 20을 추세추종 1단계 추가 게이트로 적용',
    baselineStrategyKeys: ['trend'],
    apply: (ctx) => applyAdxGate(ctx.dataset, ctx.trend.level),
  },
  {
    name: 'consensus_weighted',
    description: '컨센서스 백분위 가중 평균을 60:40(추세추종 우세)으로 변경 — 3격자(50:50/60:40/40:60) 중 대표값, 나머지는 note에 병기',
    baselineStrategyKeys: ['consensus_2star', 'consensus_1star'],
    apply: (ctx) => applyConsensusWeighted(ctx.trend, ctx.minervini, { trend: 0.6, minervini: 0.4 }),
  },
]

/** 평가일 하나에서 변형을 적용한다 — trend/minervini는 반드시 기존 lib 호출 결과, 변형만 대체. */
export function evaluateVariantAsOf(rawUniverse, asOfDate, variant) {
  const sliced = sliceUniverseAsOf(rawUniverse, asOfDate)
  const dataset = buildDataset(sliced)
  const trend = recommend(dataset.tickers)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers))
  const variantResult = variant.apply({ dataset, trend, minervini })
  return { dataset, trend, minervini, variantResult }
}

/** 변형 결과의 상위 5종목만 신호 레코드로 기록한다(비교 지표가 top5·20거래일 기준이므로). */
export function buildVariantSignalRecords(date, variant, variantResult) {
  return variantResult.list.slice(0, 5).map((item, i) => ({
    date,
    ticker: item.ticker,
    strategyKey: variant.name,
    rank: i + 1,
    score: item.score ?? item.consensusPercentile ?? null,
    grade: item.grade ?? null,
    relaxationApplied: variantResult.relaxationApplied ?? false,
    basis: 'top5',
  }))
}

export function runVariantSignalLoop(rawUniverse, evaluationDates, variant) {
  const records = []
  for (const date of evaluationDates) {
    const { variantResult } = evaluateVariantAsOf(rawUniverse, date, variant)
    records.push(...buildVariantSignalRecords(date, variant, variantResult))
  }
  return records
}

/** records(모두 basis='top5' 가정)를 단일 그룹으로 강제해 (signals,winRate,avgExcess,...)를 얻는다. */
function summarizeTop5(records, priceIndex, days) {
  const relabeled = records.map((r) => ({ ...r, strategyKey: '_summary', basis: 'top5' }))
  const [group] = aggregatePerformance(relabeled, priceIndex, [days], { strategyKeys: ['_summary'], bases: ['top5'] })
  return group
}

const MIN_OUT_SIGNALS = 100
const COMPARISON_HOLDING_DAYS = 20

/**
 * 변형 하나를 evaluationDates 전체에서 재현하고, Out-of-Sample(splitDate 이후) top5·20거래일
 * 기준으로 현행(baselineStrategyKeys) 대비 성과 델타를 계산한다. 채택 여부는 판단만 note에
 * 남기고 adopted는 항상 false(운영자 승인 전용, PRD §4.4).
 */
export function evaluateVariant(rawUniverse, variant, { evaluationDates, splitDate, mainRecords, priceIndex }) {
  const variantRecords = runVariantSignalLoop(rawUniverse, evaluationDates, variant)
  const variantOut = variantRecords.filter((r) => r.date >= splitDate)
  const variantPerf = summarizeTop5(variantOut, priceIndex, COMPARISON_HOLDING_DAYS)

  const baselineOutRaw = mainRecords.filter((r) => r.basis === 'top5' && r.date >= splitDate && variant.baselineStrategyKeys.includes(r.strategyKey))
  const baselinePerf = summarizeTop5(baselineOutRaw, priceIndex, COMPARISON_HOLDING_DAYS)

  const bothMeasurable = variantPerf.avgExcess != null && baselinePerf.avgExcess != null && variantPerf.winRate != null && baselinePerf.winRate != null
  const outVsBaseline = {
    avgExcessDelta: bothMeasurable ? round4(variantPerf.avgExcess - baselinePerf.avgExcess) : null,
    winRateDelta: bothMeasurable ? round4(variantPerf.winRate - baselinePerf.winRate) : null,
  }

  const sufficientSample = (variantPerf.signals ?? 0) >= MIN_OUT_SIGNALS && (baselinePerf.signals ?? 0) >= MIN_OUT_SIGNALS
  const meetsCriteria = sufficientSample && bothMeasurable && outVsBaseline.avgExcessDelta > 0 && outVsBaseline.winRateDelta > 0

  const noteParts = [
    `Out 표본: 변형 ${variantPerf.signals ?? 0}건 / 현행 ${baselinePerf.signals ?? 0}건 (top5·${COMPARISON_HOLDING_DAYS}거래일 기준)`,
    sufficientSample ? null : '표본 수 100 미만 — 판단 보류',
    meetsCriteria ? '채택 기준 충족(참고용 — 실제 채택·앱 반영은 운영자 승인 필요)' : '채택 기준 미충족',
  ]
  if (variant.name === 'consensus_weighted') {
    noteParts.push(`3격자: ${CONSENSUS_WEIGHTED_GRID.map((g) => g.label).join(', ')} 중 60:40을 대표값으로 채택 비교(나머지 격자는 별도 실행 필요)`)
  }

  return { name: variant.name, adopted: false, outVsBaseline, note: noteParts.filter(Boolean).join(' / ') }
}

// --- v10 US-10: 소프트 정책 변형 3종 (측정만, PRD §3 Should) ---
// 변형 A/B/C와 달리 스코어링을 바꾸지 않고 이미 계산된 top5/allSignals 신호 레코드의
// "구성 규칙"만 바꾼다 — 그래서 재시뮬레이션(runVariantSignalLoop)이 필요 없다.

/**
 * poolRecords(같은 (date,strategyKey) 후보군의 allSignals, rank 오름차순 정렬 대상)를
 * 날짜별로 묶어 predicate를 만족하는 항목만 남긴 뒤 순위 상위 5개로 재구성한다.
 * predicate가 항상 true인 날짜는 원래 top5(items.slice(0,5))와 정확히 같은 결과를 낸다
 * (국면 조건부 정책이 "다른 국면에서는 불변"임을 보장하는 성질 — US-10 AC3).
 */
export function rebuildTop5WithPolicy(poolRecords, predicate) {
  const byDate = new Map()
  for (const r of poolRecords) {
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date).push(r)
  }
  const out = []
  for (const dateRecords of byDate.values()) {
    const survivors = [...dateRecords]
      .sort((a, b) => a.rank - b.rank)
      .filter(predicate)
      .slice(0, 5)
    out.push(...survivors.map((r) => ({ ...r, basis: 'top5' })))
  }
  return out
}

/**
 * 정책 변형 하나를 이미 계산된 메인 신호 레코드에 적용해 현행 top5와 비교한다(§7 판정 기준
 * 재료). sampleThreshold는 정책마다 다르다(PRD §7: 국면 조건부 정책=50, 상태 필터=100).
 */
export function evaluatePolicyVariant(name, { poolRecords, baselineRecords, predicate, priceIndex, holdingDays = COMPARISON_HOLDING_DAYS, sampleThreshold = MIN_OUT_SIGNALS, extraNote = null }) {
  const variantTop5 = rebuildTop5WithPolicy(poolRecords, predicate)
  const variantPerf = summarizeTop5(variantTop5, priceIndex, holdingDays)
  const baselinePerf = summarizeTop5(baselineRecords, priceIndex, holdingDays)

  const bothMeasurable = variantPerf.avgExcess != null && baselinePerf.avgExcess != null && variantPerf.winRate != null && baselinePerf.winRate != null
  const outVsBaseline = {
    avgExcessDelta: bothMeasurable ? round4(variantPerf.avgExcess - baselinePerf.avgExcess) : null,
    winRateDelta: bothMeasurable ? round4(variantPerf.winRate - baselinePerf.winRate) : null,
  }

  const sufficientSample = (variantPerf.signals ?? 0) >= sampleThreshold
  const meetsCriteria = sufficientSample && bothMeasurable && outVsBaseline.avgExcessDelta >= 0 && outVsBaseline.winRateDelta >= 0

  const noteParts = [
    `Out 표본: 변형 ${variantPerf.signals ?? 0}건 / 현행 ${baselinePerf.signals ?? 0}건 (top5·${holdingDays}거래일 기준)`,
    sufficientSample ? null : `표본 수 ${sampleThreshold} 미만 — 판단 보류`,
    meetsCriteria ? '채택 기준 충족(참고용 — 실제 채택은 운영자 승인 필요)' : '채택 기준 미충족',
    extraNote,
  ]

  return { name, adopted: false, outVsBaseline, note: noteParts.filter(Boolean).join(' / ') }
}
