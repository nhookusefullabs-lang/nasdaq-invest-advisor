#!/usr/bin/env node
// v9 백테스트 엔진 (PRD_Nasdaq9.md §4.1, US-1) — "같은 코드" 원칙: 앱의 src/lib/*를 그대로
// import해 실행한다. 지표·판정·스코어링의 백테스트 전용 재구현은 어떤 이유로도 금지.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = path.resolve(__dirname, '../public/data/nasdaq100.json')

/** raw nasdaq100.json({generatedAt, tickers}) 을 읽어 buildDataset()으로 파생한다. */
export function loadDataset(dataPath = DEFAULT_DATA_PATH) {
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'))
  return buildDataset(raw)
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

function main() {
  const dataPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DATA_PATH
  const dataset = loadDataset(dataPath)
  const { trend, minervini } = runSmoke(dataset)

  console.log(`데이터 기준일: ${dataset.generatedAt} (${dataPath})`)
  console.log(formatSummary('추세추종', trend))
  console.log(formatSummary('미너비니', minervini))
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
