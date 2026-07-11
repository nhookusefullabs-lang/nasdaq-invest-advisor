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
import { sliceUniverseAsOf, buildEvaluationDates, getCalendarDates } from './lib/asOf.mjs'
import { buildPriceIndex, aggregatePerformance } from './lib/performance.mjs'
import { buildFundamentalAxis } from './lib/fundamentalHistory.mjs'
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

/** asOfDate까지로 절단한 시점에서 두 모드 + 컨센서스를 재현한다 (백테스트 판정의 단일 진입점). */
export function evaluateAsOf(rawUniverse, asOfDate) {
  const sliced = sliceUniverseAsOf(rawUniverse, asOfDate)
  const dataset = buildDataset(sliced)
  const trend = recommend(dataset.tickers)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers))
  const consensus = buildConsensusRanking(trend, minervini)
  return { dataset, trend, minervini, consensus }
}

/** 컨센서스 항목 하나가 어느 모드 신호에서 왔는지로 relaxationApplied를 판단한다. */
function consensusRelaxationApplied(entry, trendResult, minerviniResult) {
  if (entry.trend) return trendResult.relaxationApplied
  if (entry.minervini) return minerviniResult.relaxationApplied
  return false
}

/**
 * 평가일 하나의 { trend, minervini, consensus } 결과를 평탄한 신호 레코드 배열로 변환한다.
 * basis: top5(상위 5) / allSignals(1단계 통과 전체, 추세추종·미너비니는 recommend()가 이미
 * 반환한 list 전체를, 컨센서스는 두 모드 통합 리스트 전체를 사용 — 별도 재구현 없음).
 */
export function buildSignalRecords(date, { trend, minervini, consensus }) {
  const records = []

  const addBasisPair = (items, mapFn) => {
    items.forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'allSignals' }))
    items.slice(0, 5).forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'top5' }))
  }

  const trendPassed = trend.list.filter((t) => t.signalPassed)
  addBasisPair(trendPassed, (t, i) => ({
    date,
    ticker: t.ticker,
    strategyKey: 'trend',
    rank: i + 1,
    score: t.score,
    grade: null,
    relaxationApplied: trend.relaxationApplied,
  }))

  addBasisPair(minervini.list, (m, i) => ({
    date,
    ticker: m.ticker,
    strategyKey: 'minervini',
    rank: i + 1,
    score: m.score,
    grade: null,
    relaxationApplied: minervini.relaxationApplied,
  }))

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

/** evaluationDates 전체를 순회하며 신호 레코드를 축적한다 (100종목×주단위×2모드 규모 — 수만 건 수준). */
export function runSignalLoop(rawUniverse, evaluationDates) {
  const records = []
  for (const date of evaluationDates) {
    const { trend, minervini, consensus } = evaluateAsOf(rawUniverse, date)
    records.push(...buildSignalRecords(date, { trend, minervini, consensus }))
  }
  return records
}

// --- US-5: In/Out 분할 + backtest.json 발행 ---

const round4 = (x) => Math.round(x * 10000) / 10000
const HOLDING_DAYS = [5, 20, 60]
const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const BASES = ['top5', 'allSignals']

function computeRelaxedShare(records) {
  if (!records.length) return null
  const count = records.filter((r) => r.relaxationApplied).length
  return round4(count / records.length)
}

/**
 * 전체 백테스트 실행: 평가일 나열 → 신호 재현 → 신호일 기준 In(전반 50%)/Out(후반 50%) 분할
 * → 성과 집계 → PRD_Nasdaq9.md §7 스키마 형태로 조립한다.
 * 경계 규칙: splitDate 당일 신호는 Out에 귀속된다(splitDate = Out 구간의 첫 평가일).
 * fundamentalAxis는 US-6에서, variants는 US-7에서 채운다 — 여기서는 각각 null/[].
 */
export function runBacktest(
  rawUniverse,
  { warmupDays = 252, holdingBufferDays = 60, stepDays = 5, holdingDays = HOLDING_DAYS, topN = 5, fundamentalsData = null } = {}
) {
  const evaluationDates = buildEvaluationDates(rawUniverse, { warmupDays, holdingBufferDays, stepDays })
  const records = runSignalLoop(rawUniverse, evaluationDates)

  const splitIndex = Math.floor(evaluationDates.length / 2)
  const splitDate = evaluationDates.length ? (evaluationDates[splitIndex] ?? null) : null
  const inRecords = splitDate ? records.filter((r) => r.date < splitDate) : records
  const outRecords = splitDate ? records.filter((r) => r.date >= splitDate) : []

  const dataset = buildDataset(rawUniverse)
  const priceIndex = buildPriceIndex(dataset.tickers)

  const inGroups = aggregatePerformance(inRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: BASES })
  const outGroups = aggregatePerformance(outRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: BASES })

  const strategies = []
  for (const key of STRATEGY_KEYS) {
    for (const basis of BASES) {
      for (const [sample, groups, sampleRecords] of [
        ['in', inGroups, inRecords],
        ['out', outGroups, outRecords],
      ]) {
        const byHolding = groups
          .filter((g) => g.strategyKey === key && g.basis === basis)
          .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
        const matchingRecords = sampleRecords.filter((r) => r.strategyKey === key && r.basis === basis)
        strategies.push({ key, sample, basis, byHolding, relaxedShare: computeRelaxedShare(matchingRecords) })
      }
    }
  }

  const calendarDates = getCalendarDates(rawUniverse)
  const fundamentalAxis = buildFundamentalAxis(fundamentalsData, records, priceIndex, holdingDays)

  return {
    schemaVersion: 1,
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
    },
    strategies,
    fundamentalAxis,
    variants: [],
  }
}

function formatInOutSummary(backtest) {
  const lines = []
  for (const s of backtest.strategies) {
    if (s.basis !== 'top5') continue
    const d20 = s.byHolding.find((h) => h.days === 20)
    if (!d20 || d20.signals === 0) continue
    lines.push(`  ${s.key} (${s.sample}): 20거래일 승률 ${(d20.winRate * 100).toFixed(1)}% · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p (표본 ${d20.signals})`)
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

function main() {
  const dataPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DATA_PATH
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH
  const rawUniverse = loadRawUniverse(dataPath)
  const dataset = buildDataset(rawUniverse)
  const { trend, minervini } = runSmoke(dataset)

  console.log(`데이터 기준일: ${dataset.generatedAt} (${dataPath})`)
  console.log(formatSummary('추세추종', trend))
  console.log(formatSummary('미너비니', minervini))

  const evaluationDates = buildEvaluationDates(rawUniverse)
  console.log(`평가일 ${evaluationDates.length}개`)

  const fundamentalsData = loadFundamentalsIfPresent(dataPath)
  const backtest = runBacktest(rawUniverse, { fundamentalsData })
  console.log(`In/Out 분할: splitDate=${backtest.config.splitDate}`)
  console.log(formatInOutSummary(backtest))
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
