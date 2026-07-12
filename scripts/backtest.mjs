#!/usr/bin/env node
// v9 백테스트 엔진 (PRD_Nasdaq9.md §4.1, US-1) — "같은 코드" 원칙: 앱의 src/lib/*를 그대로
// import해 실행한다. 지표·판정·스코어링의 백테스트 전용 재구현은 어떤 이유로도 금지.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'
import { buildConsensusRanking } from '../src/lib/consensus.js'
import { currentRegime } from '../src/lib/regime.js'
import { sliceUniverseAsOf, buildEvaluationDates, getCalendarDates } from './lib/asOf.mjs'
import { buildPriceIndex, aggregatePerformance } from './lib/performance.mjs'
import { buildFundamentalAxis } from './lib/fundamentalHistory.mjs'
import { VARIANTS, evaluateVariant } from './lib/variants.mjs'
import { EXIT_RULES, aggregateExitPerformance, EXIT_LIMITATION_NOTE, COMBOS, aggregateComboPerformance } from './lib/exits.mjs'
import { ENTRY_VARIANTS, aggregateEntryVariant } from './lib/entries.mjs'
import { goldenCrossFreshnessDays, pivotBreakoutFreshnessDays, freshnessCohort, aggregateFreshnessCohorts } from './lib/freshness.mjs'
import { atomicWriteBacktest } from './validate-backtest.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = path.resolve(__dirname, '../public/data/nasdaq100.json')
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../public/data/backtest.json')

/** raw nasdaq100.json({generatedAt, tickers}) 그대로 읽는다 (asOf 슬라이싱은 raw 형태에 대해 동작). */
export function loadRawUniverse(dataPath = DEFAULT_DATA_PATH) {
  return JSON.parse(readFileSync(dataPath, 'utf-8'))
}

/** raw nasdaq100.json({generatedAt, tickers}) 을 읽어 buildDataset()으로 파생한다. */
export function loadDataset(dataPath = DEFAULT_DATA_PATH) {
  return buildDataset(loadRawUniverse(dataPath))
}

/** dataset.tickers 중 dataSufficient한 것만, 미너비니 모드가 요구하는 형태({ticker,name,sector,series})로 추린다. */
export function toMinerviniInput(tickers) {
  return tickers.filter((t) => t.dataSufficient).map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, series: t.series }))
}

/**
 * 최신 시점(dataset 그 자체) 기준 두 모드 추천을 각 1회 실행한다 (스모크).
 * recommend()/runMinerviniRecommend() 호출 결과 그대로 반환 — 백테스트 전용 재구현 없음.
 */
export function runSmoke(dataset) {
  const trend = recommend(dataset.tickers)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers))
  return { trend, minervini }
}

function formatSummary(label, result) {
  return `${label}: ${result.list.length}개 (level=${result.level}, relaxationApplied=${result.relaxationApplied}, insufficientSignal=${result.insufficientSignal})`
}

// --- US-3: 신호 재현 루프 — 평가일마다 슬라이스 → 두 모드 → 컨센서스, 전부 기존 lib 호출 ---

/**
 * asOfDate까지로 절단한 시점에서 두 모드 + 컨센서스 + 시장 국면을 재현한다
 * (백테스트 판정의 단일 진입점). regime은 슬라이스된(미래 데이터 없는) dataset.tickers
 * 기준으로 regime.js가 그대로 계산한다(재구현 없음, 시점 정합성은 슬라이싱이 이미 보장).
 */
export function evaluateAsOf(rawUniverse, asOfDate) {
  const sliced = sliceUniverseAsOf(rawUniverse, asOfDate)
  const dataset = buildDataset(sliced)
  const trend = recommend(dataset.tickers)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers))
  const consensus = buildConsensusRanking(trend, minervini)
  const regime = currentRegime(dataset.tickers)
  return { dataset, trend, minervini, consensus, regime }
}

/** 컨센서스 항목 하나가 어느 모드 신호에서 왔는지로 relaxationApplied를 판단한다. */
function consensusRelaxationApplied(entry, trendResult, minerviniResult) {
  if (entry.trend) return trendResult.relaxationApplied
  if (entry.minervini) return minerviniResult.relaxationApplied
  return false
}

/**
 * datasetTickers(dataset.tickers, deriveTickerData() 산출물 배열)에서 ticker 하나의 파생
 * 데이터를 찾는다 — 신선도 코호트(US-4) 계산에 필요한 macdLineSeries/signalLineSeries/series를
 * 얻기 위함. 못 찾으면(픽스처 테스트 등 datasetTickers 미전달) null.
 */
function findTickerData(datasetTickers, ticker) {
  return datasetTickers?.find((t) => t.ticker === ticker) ?? null
}

/**
 * 평가일 하나의 { trend, minervini, consensus } 결과를 평탄한 신호 레코드 배열로 변환한다.
 * basis: top5(상위 5) / allSignals(1단계 통과 전체, 추세추종·미너비니는 recommend()가 이미
 * 반환한 list 전체를, 컨센서스는 두 모드 통합 리스트 전체를 사용 — 별도 재구현 없음).
 * datasetTickers(선택)를 넘기면 trend/minervini 레코드에 freshnessCohort(US-4)가 추가된다 —
 * 이벤트 정의가 모드별로만 존재하므로(PRD) 컨센서스 레코드에는 붙이지 않는다.
 * regimeInfo(선택, v10 US-7 — regime.js의 currentRegime() 반환값)를 넘기면 모든 레코드에
 * 그 평가일의 국면 코드(regime: 'up'|'neutral'|'down'|null)가 함께 실린다.
 */
export function buildSignalRecords(date, { trend, minervini, consensus }, datasetTickers = null, regimeInfo = null) {
  const regime = regimeInfo?.regime ?? null
  const records = []

  const addBasisPair = (items, mapFn) => {
    items.forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'allSignals', regime }))
    items.slice(0, 5).forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'top5', regime }))
  }

  const trendPassed = trend.list.filter((t) => t.signalPassed)
  addBasisPair(trendPassed, (t, i) => {
    const td = findTickerData(datasetTickers, t.ticker)
    const daysAgo = td ? goldenCrossFreshnessDays(td.indicators.macdLineSeries, td.indicators.signalLineSeries) : null
    return {
      date,
      ticker: t.ticker,
      strategyKey: 'trend',
      rank: i + 1,
      score: t.score,
      grade: null,
      relaxationApplied: trend.relaxationApplied,
      ...(td ? { freshnessCohort: freshnessCohort(daysAgo) } : {}),
    }
  })

  addBasisPair(minervini.list, (m, i) => {
    const td = findTickerData(datasetTickers, m.ticker)
    const daysAgo = td ? pivotBreakoutFreshnessDays(td.series) : null
    return {
      date,
      ticker: m.ticker,
      strategyKey: 'minervini',
      rank: i + 1,
      score: m.score,
      grade: null,
      relaxationApplied: minervini.relaxationApplied,
      ...(td ? { freshnessCohort: freshnessCohort(daysAgo) } : {}),
    }
  })

  addBasisPair(consensus.list, (c, i) => ({
    date,
    ticker: c.ticker,
    strategyKey: c.grade === '★★' ? 'consensus_2star' : 'consensus_1star',
    rank: i + 1,
    score: c.consensusPercentile,
    grade: c.grade,
    relaxationApplied: consensusRelaxationApplied(c, trend, minervini),
  }))

  return records
}

/**
 * evaluationDates 전체를 순회하며 신호 레코드를 축적한다 (100종목×주단위×2모드 규모 — 수만 건 수준).
 * onProgress(완료 개수, 전체 개수)는 선택적 진행률 콜백 — step=1(연산량 5배, US-3) 실행 시
 * CLI가 평가일 단위로 진행 상황을 출력하는 데 쓴다. 기본은 no-op(테스트 출력을 오염시키지 않음).
 */
export function runSignalLoop(rawUniverse, evaluationDates, onProgress = () => {}) {
  const records = []
  evaluationDates.forEach((date, i) => {
    const { dataset, trend, minervini, consensus, regime } = evaluateAsOf(rawUniverse, date)
    records.push(...buildSignalRecords(date, { trend, minervini, consensus }, dataset.tickers, regime))
    onProgress(i + 1, evaluationDates.length)
  })
  return records
}

// --- US-5: In/Out 분할 + backtest.json 발행 ---

const round4 = (x) => Math.round(x * 10000) / 10000
const HOLDING_DAYS = [5, 20, 60]
const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const BASES = ['top5', 'allSignals']
// v10 US-7: 국면 3상태 — regime.js의 히스테리시스 코드와 동일.
const REGIME_VALUES = ['up', 'neutral', 'down']

function computeRelaxedShare(records) {
  if (!records.length) return null
  const count = records.filter((r) => r.relaxationApplied).length
  return round4(count / records.length)
}

// v9.1 US-3: stepDays를 1로 낮추면(매일 평가) 인접 평가일의 보유 구간이 크게 겹쳐
// "명목 표본 수"가 부풀려진다 — 보유기간별 overlapFactor(= holdingDays/stepDays)를
// config에 명시해, 화면·리포트가 "유효 독립 표본 근사 = 명목 표본 ÷ overlapFactor"를
// 함께 읽을 수 있게 한다(표본 착시 방지, 값 자체를 자동 보정하지는 않음).
function computeOverlapFactor(holdingDays, stepDays) {
  return Object.fromEntries(holdingDays.map((days) => [days, round4(days / stepDays)]))
}

// v9.1 US-1: 완화 폴백 신호(relaxationApplied:true)와 정상 신호를 분리 집계하는 차원.
// "all"은 기존 v1과 동일한 전체 집계(화면2가 계속 이것만 사용), normal/relaxed는 운영자
// 분석용으로 추가 발행한다(가설 ① — In 구간 추세추종 붕괴가 완화 신호 탓인지 판정 재료).
const SIGNAL_QUALITIES = ['all', 'normal', 'relaxed']

function filterByQuality(records, quality) {
  if (quality === 'all') return records
  if (quality === 'normal') return records.filter((r) => !r.relaxationApplied)
  return records.filter((r) => r.relaxationApplied)
}

/**
 * 전체 백테스트 실행: 평가일 나열 → 신호 재현 → 신호일 기준 In(전반 50%)/Out(후반 50%) 분할
 * → 성과 집계(전체·정상·완화 3중 집계) → backtest.json v2 스키마 형태로 조립한다.
 * 경계 규칙: splitDate 당일 신호는 Out에 귀속된다(splitDate = Out 구간의 첫 평가일).
 * fundamentalAxis는 US-6, variants는 US-7, signalQuality 분리는 v9.1 US-1이 채운다.
 */
export function runBacktest(
  rawUniverse,
  {
    warmupDays = 252,
    holdingBufferDays = 60,
    stepDays = 5,
    holdingDays = HOLDING_DAYS,
    topN = 5,
    fundamentalsData = null,
    onProgress = () => {},
  } = {}
) {
  const evaluationDates = buildEvaluationDates(rawUniverse, { warmupDays, holdingBufferDays, stepDays })
  const records = runSignalLoop(rawUniverse, evaluationDates, onProgress)

  const splitIndex = Math.floor(evaluationDates.length / 2)
  const splitDate = evaluationDates.length ? (evaluationDates[splitIndex] ?? null) : null
  const inRecords = splitDate ? records.filter((r) => r.date < splitDate) : records
  const outRecords = splitDate ? records.filter((r) => r.date >= splitDate) : []

  const dataset = buildDataset(rawUniverse)
  const priceIndex = buildPriceIndex(dataset.tickers)

  const aggregateAllQualities = (sampleRecords) =>
    Object.fromEntries(
      SIGNAL_QUALITIES.map((quality) => [
        quality,
        aggregatePerformance(filterByQuality(sampleRecords, quality), priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: BASES }),
      ])
    )

  const inGroupsByQuality = aggregateAllQualities(inRecords)
  const outGroupsByQuality = aggregateAllQualities(outRecords)

  const strategies = []
  for (const key of STRATEGY_KEYS) {
    for (const basis of BASES) {
      for (const [sample, groupsByQuality, sampleRecords] of [
        ['in', inGroupsByQuality, inRecords],
        ['out', outGroupsByQuality, outRecords],
      ]) {
        for (const signalQuality of SIGNAL_QUALITIES) {
          const groups = groupsByQuality[signalQuality]
          const byHolding = groups
            .filter((g) => g.strategyKey === key && g.basis === basis)
            .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
          const matchingRecords = filterByQuality(
            sampleRecords.filter((r) => r.strategyKey === key && r.basis === basis),
            signalQuality
          )
          strategies.push({ key, sample, basis, signalQuality, byHolding, relaxedShare: computeRelaxedShare(matchingRecords) })
        }
      }
    }
  }

  const calendarDates = getCalendarDates(rawUniverse)
  const fundamentalAxis = buildFundamentalAxis(fundamentalsData, records, priceIndex, holdingDays)
  const variants = VARIANTS.map((v) => evaluateVariant(rawUniverse, v, { evaluationDates, splitDate, mainRecords: records, priceIndex }))
  const exitVariants = evaluateExitVariants(outRecords, strategies, priceIndex)

  // v9.1 US-4 가설 ③: 신선 신호(0~2d)와 지연 신호(3d+/no_recent_breakout)의 성과 차이를
  // In/Out 양쪽에서 측정한다(basis는 allSignals만 — top5는 코호트별 표본이 너무 작아짐).
  const freshnessCohorts = [
    ...aggregateFreshnessCohorts(inRecords, priceIndex, holdingDays).map((f) => ({ ...f, sample: 'in' })),
    ...aggregateFreshnessCohorts(outRecords, priceIndex, holdingDays).map((f) => ({ ...f, sample: 'out' })),
  ]

  const regimeAxis = buildRegimeAxis(inRecords, outRecords, priceIndex, holdingDays)

  // v10 US-8: 진입 변형 4종 — 기존 변형 D(exitVariants)와 동일 스코프(trend·top5·Out)에서
  // 비교해야 §7의 최종 조합 실험(진입×청산)이 같은 기준선을 공유한다.
  const outTrendTop5 = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
  const entryVariants = Object.values(ENTRY_VARIANTS).map((variant) => aggregateEntryVariant(outTrendTop5, priceIndex, variant, holdingDays))

  // v10 US-9: 진입×청산 조합 3종(§7 최종 대결 재료) — 채택 결정은 하지 않는다(adopted 항상 false).
  const combos = COMBOS.map((combo) => ({
    name: combo.name,
    adopted: false,
    ...aggregateComboPerformance(outTrendTop5, priceIndex, combo.entryVariant, combo.exitRule),
  }))

  return {
    schemaVersion: 3,
    generatedAt: rawUniverse.generatedAt,
    config: {
      dataFrom: calendarDates[0] ?? null,
      dataTo: calendarDates[calendarDates.length - 1] ?? null,
      stepDays,
      holdingDays,
      warmupDays,
      splitDate,
      benchmark: 'universe_equal_weight',
      topN,
      overlapFactor: computeOverlapFactor(holdingDays, stepDays),
    },
    strategies,
    fundamentalAxis,
    variants: [...variants, ...exitVariants],
    freshnessCohorts,
    regimeAxis,
    entryVariants,
    combos,
  }
}

/**
 * 전략×sample×국면×보유기간 성과표 (v10 US-7, PRD §4.2 1단). allSignals 기준만 사용한다
 * (top5를 국면별로 다시 쪼개면 표본이 급격히 작아짐 — freshnessCohorts와 동일 원칙).
 * aggregatePerformance()를 그대로 재사용(재구현 없음).
 */
function buildRegimeAxis(inRecords, outRecords, priceIndex, holdingDays) {
  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const allSignalsRecords = records.filter((r) => r.basis === 'allSignals')
    for (const regime of REGIME_VALUES) {
      const regimeRecords = allSignalsRecords.filter((r) => r.regime === regime)
      const groups = aggregatePerformance(regimeRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: ['allSignals'] })
      for (const key of STRATEGY_KEYS) {
        const byHolding = groups
          .filter((g) => g.strategyKey === key)
          .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
        axis.push({ strategyKey: key, sample, regime, byHolding })
      }
    }
  }
  return axis
}

// v9.1 US-2 가설 ②: trend/top5 Out 신호에 경로 의존 청산(변형 D) 2종을 적용해, 현행
// 60거래일 고정 보유(all·signalQuality) 대비 성과 델타를 계산한다. 채택 결정은 하지 않는다
// (adopted 항상 false — 손절·트레일링 채택은 운영자 몫).
function evaluateExitVariants(outRecords, strategies, priceIndex) {
  const outTrendTop5 = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
  const baseline = strategies.find((s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out' && s.signalQuality === 'all')
  const baseline60 = baseline?.byHolding?.find((h) => h.days === 60) ?? null

  return Object.values(EXIT_RULES).map((rule) => {
    const outDetail = aggregateExitPerformance(outTrendTop5, priceIndex, rule)
    const bothMeasurable = outDetail.avgExcess != null && outDetail.winRate != null && baseline60?.avgExcess != null && baseline60?.winRate != null
    const outVsBaseline = {
      avgExcessDelta: bothMeasurable ? round4(outDetail.avgExcess - baseline60.avgExcess) : null,
      winRateDelta: bothMeasurable ? round4(outDetail.winRate - baseline60.winRate) : null,
    }
    const note = [
      `Out 표본 ${outDetail.signals}건 (trend·top5 기준) vs 현행 60거래일 고정 보유(표본 ${baseline60?.signals ?? 0}건)`,
      EXIT_LIMITATION_NOTE,
    ].join(' / ')
    return { name: rule.name, adopted: false, outVsBaseline, outDetail, note }
  })
}

function formatInOutSummary(backtest) {
  const lines = []
  for (const s of backtest.strategies) {
    if (s.basis !== 'top5' || s.signalQuality !== 'all') continue
    const d20 = s.byHolding.find((h) => h.days === 20)
    if (!d20 || d20.signals === 0) continue
    lines.push(`  ${s.key} (${s.sample}): 20거래일 승률 ${(d20.winRate * 100).toFixed(1)}% · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p (표본 ${d20.signals})`)
  }
  return lines.join('\n')
}

// v9.1 US-1 가설 ①: In 구간 추세추종 붕괴가 완화 폴백 신호 탓인지 판정하기 위한
// In/Out × normal/relaxed 비교표 (allSignals 기준 — top5는 완화 신호가 거의 없어 표본이 너무 작음).
function formatSignalQualityComparison(backtest) {
  const lines = []
  for (const sample of ['in', 'out']) {
    for (const quality of ['normal', 'relaxed']) {
      const s = backtest.strategies.find((x) => x.key === 'trend' && x.basis === 'allSignals' && x.sample === sample && x.signalQuality === quality)
      const d20 = s?.byHolding?.find((h) => h.days === 20)
      const label = `${sample}/${quality}`
      if (!d20 || d20.signals === 0) {
        lines.push(`  ${label}: 표본 부족`)
        continue
      }
      lines.push(`  ${label}: 승률 ${(d20.winRate * 100).toFixed(1)}% · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p (표본 ${d20.signals})`)
    }
  }
  return lines.join('\n')
}

// v9.1 US-3: 명목 표본(신호 수)과 겹침 보정을 반영한 유효 독립 표본 근사를 병기한다
// (stepDays가 holdingDays보다 작으면 인접 평가일의 보유 구간이 겹쳐 표본이 과대해 보인다).
export function formatOverlapFactorNote(backtest) {
  const trendOut20 = backtest.strategies.find(
    (s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out' && s.signalQuality === 'all'
  )?.byHolding?.find((h) => h.days === 20)
  const factor = backtest.config.overlapFactor?.[20]
  if (!trendOut20 || !factor) return '겹침 보정: 계산 불가'
  const effective = round4(trendOut20.signals / factor)
  return `겹침 보정(20거래일 기준): 명목 표본 ${trendOut20.signals} / 유효 독립 표본 근사 ${effective} (overlapFactor=${factor})`
}

// v9.1 US-4 가설 ③: Out 구간 코호트별 20일·60일 초과수익 표 — 신선 신호(0d/1-2d)와
// 지연 신호(3d+/5d+/no_recent_breakout)의 성과 차이가 왕복 거래비용 가정을 넘는지 판정 재료.
export function formatFreshnessCohortSummary(backtest) {
  const lines = []
  for (const key of ['trend', 'minervini']) {
    for (const cohort of ['0d', '1-2d', '3-4d', '5d+', 'no_recent_breakout']) {
      const entry = backtest.freshnessCohorts?.find((f) => f.key === key && f.sample === 'out' && f.cohort === cohort)
      const parts = [20, 60].map((days) => {
        const h = entry?.byHolding?.find((b) => b.days === days)
        if (!h || h.signals === 0) return `${days}일 표본 부족`
        return `${days}일 초과수익 ${(h.avgExcess * 100).toFixed(2)}%p (표본 ${h.signals})`
      })
      lines.push(`  ${key}/${cohort}: ${parts.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

// v10 US-7: In/Out 각각의 국면 구성비 + 국면별 성과 — In/Out 역전을 "기간"이 아니라
// "국면"의 지식으로 재해석하기 위한 표(PRD §4.2 1단 목표). trend/allSignals/20거래일 기준.
export function formatRegimeReinterpretation(backtest) {
  const findEntry = (sample, regime) => backtest.regimeAxis?.find((r) => r.strategyKey === 'trend' && r.sample === sample && r.regime === regime)

  const lines = []
  for (const sample of ['in', 'out']) {
    const totalSignals = REGIME_VALUES.reduce((sum, regime) => sum + (findEntry(sample, regime)?.byHolding?.find((h) => h.days === 20)?.signals ?? 0), 0)
    lines.push(`  [${sample}] 국면 구성 (trend·allSignals·20거래일 신호 수 기준, 총 ${totalSignals}건)`)
    for (const regime of REGIME_VALUES) {
      const d20 = findEntry(sample, regime)?.byHolding?.find((h) => h.days === 20)
      if (!d20 || d20.signals === 0) {
        lines.push(`    ${regime}: 표본 부족`)
        continue
      }
      const share = totalSignals ? ((d20.signals / totalSignals) * 100).toFixed(1) : '0.0'
      lines.push(`    ${regime}: 구성비 ${share}% (표본 ${d20.signals}) · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p`)
    }
  }
  return lines.join('\n')
}

function loadFundamentalsIfPresent(dataPath) {
  // nasdaq100.json과 같은 디렉터리의 fundamentals.json을 선택적으로 사용한다(US-6) —
  // 없으면 조용히 null(엔진은 fundamentalAxis:null로 정상 완주, graceful degradation).
  const candidate = path.join(path.dirname(dataPath), 'fundamentals.json')
  if (!existsSync(candidate)) return null
  try {
    return JSON.parse(readFileSync(candidate, 'utf-8'))
  } catch {
    return null
  }
}

// v9.1 US-3: --step=N(기본 5, 허용 1~10) / --out=경로 형태의 named 플래그를 파싱한다.
// 첫 번째 non-flag 인자는 여전히 dataPath(위치 인자, 하위 호환)로 취급한다.
export function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) flags[m[1]] = m[2]
    else positional.push(arg)
  }
  return { flags, positional }
}

/**
 * 파싱된 flags를 검증하고 stepDays를 확정한다 (main()과 테스트가 공유하는 순수 함수).
 * 반환: { ok: true, stepDays } | { ok: false, error }
 */
export function validateCliArgs(flags) {
  const stepDays = flags.step !== undefined ? Number(flags.step) : 5
  if (!Number.isInteger(stepDays) || stepDays < 1 || stepDays > 10) {
    return { ok: false, error: `--step은 1~10 사이 정수여야 합니다 (받은 값: ${flags.step})` }
  }
  // 화면 표시용 공식 backtest.json은 항상 step=5 산출물이라는 운영 규칙(README 참고) —
  // step≠5 실험 실행이 실수로 공식 파일을 덮어쓰지 않도록 --out을 강제한다.
  if (stepDays !== 5 && !flags.out) {
    return { ok: false, error: '--step이 5가 아니면 --out=경로를 반드시 지정해야 합니다 (공식 backtest.json 보호)' }
  }
  return { ok: true, stepDays }
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))

  const validated = validateCliArgs(flags)
  if (!validated.ok) {
    console.error(`✗ ${validated.error}`)
    process.exitCode = 1
    return
  }
  const { stepDays } = validated

  const dataPath = positional[0] ? path.resolve(positional[0]) : DEFAULT_DATA_PATH
  const outputPath = flags.out ? path.resolve(flags.out) : DEFAULT_OUTPUT_PATH

  const rawUniverse = loadRawUniverse(dataPath)
  const dataset = buildDataset(rawUniverse)
  const { trend, minervini } = runSmoke(dataset)

  console.log(`데이터 기준일: ${dataset.generatedAt} (${dataPath})`)
  console.log(formatSummary('추세추종', trend))
  console.log(formatSummary('미너비니', minervini))

  const evaluationDates = buildEvaluationDates(rawUniverse, { stepDays })
  console.log(`평가일 ${evaluationDates.length}개 (stepDays=${stepDays})`)

  // step=1은 evaluationDates가 약 5배로 늘어 연산량도 비례 증가한다 — 평가일 단위 진행률 로그.
  const logEvery = Math.max(1, Math.floor(evaluationDates.length / 10))
  const onProgress = (done, total) => {
    if (done % logEvery === 0 || done === total) console.log(`  진행률: ${done}/${total} 평가일`)
  }

  const fundamentalsData = loadFundamentalsIfPresent(dataPath)
  const backtest = runBacktest(rawUniverse, { fundamentalsData, stepDays, onProgress })
  console.log(`In/Out 분할: splitDate=${backtest.config.splitDate}`)
  console.log(formatInOutSummary(backtest))
  console.log('추세추종 신호 품질 비교 (가설 ① 판정 재료, allSignals·20거래일):')
  console.log(formatSignalQualityComparison(backtest))
  console.log(formatOverlapFactorNote(backtest))
  console.log('신호 신선도 코호트 (가설 ③ 판정 재료, Out·allSignals·20/60거래일):')
  console.log(formatFreshnessCohortSummary(backtest))
  console.log('국면별 재해석 (In/Out 역전을 국면 지식으로 재해석, v10 US-7):')
  console.log(formatRegimeReinterpretation(backtest))
  console.log(backtest.fundamentalAxis ? `펀더멘털 축: coveredFrom=${backtest.fundamentalAxis.coveredFrom}` : '펀더멘털 축: fundamentals.json 없음(생략)')

  const result = atomicWriteBacktest(outputPath, backtest)
  if (!result.ok) {
    console.error(`✗ ${outputPath}: 스키마 검증 실패`)
    result.errors.forEach((e) => console.error(`  - ${e}`))
    process.exitCode = 1
    return
  }
  console.log(`✓ ${outputPath} 작성 완료`)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
