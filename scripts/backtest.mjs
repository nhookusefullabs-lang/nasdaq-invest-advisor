#!/usr/bin/env node
// v9 백테스트 엔진 (PRD_Nasdaq9.md §4.1, US-1) — "같은 코드" 원칙: 앱의 src/lib/*를 그대로
// import해 실행한다. 지표·판정·스코어링의 백테스트 전용 재구현은 어떤 이유로도 금지.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'
import { buildConsensusRanking } from '../src/lib/consensus.js'
import { sliceUniverseAsOf, buildEvaluationDates } from './lib/asOf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = path.resolve(__dirname, '../public/data/nasdaq100.json')

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

function main() {
  const dataPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DATA_PATH
  const rawUniverse = loadRawUniverse(dataPath)
  const dataset = buildDataset(rawUniverse)
  const { trend, minervini } = runSmoke(dataset)

  console.log(`데이터 기준일: ${dataset.generatedAt} (${dataPath})`)
  console.log(formatSummary('추세추종', trend))
  console.log(formatSummary('미너비니', minervini))

  const evaluationDates = buildEvaluationDates(rawUniverse)
  const records = runSignalLoop(rawUniverse, evaluationDates)
  console.log(`평가일 ${evaluationDates.length}개, 신호 레코드 ${records.length}건`)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
