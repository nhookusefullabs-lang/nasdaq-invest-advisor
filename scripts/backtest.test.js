import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadDataset, runSmoke, toMinerviniInput, evaluateAsOf, buildSignalRecords, runSignalLoop } from './backtest.mjs'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'
import { buildConsensusRanking } from '../src/lib/consensus.js'
import { sliceUniverseAsOf, buildEvaluationDates } from './lib/asOf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/nasdaq100.2y.sample.json')

describe('backtest.mjs — US-1 부트스트랩', () => {
  it('실행 성공: 두 모드 요약을 출력할 수 있는 데이터를 만든다', () => {
    const dataset = loadDataset(FIXTURE_PATH)
    const { trend, minervini } = runSmoke(dataset)
    expect(Array.isArray(trend.list)).toBe(true)
    expect(Array.isArray(minervini.list)).toBe(true)
  })

  it('동형성: backtest.mjs가 앱 lib를 직접 호출한 결과와 완전히 동일하다 (재구현 없음)', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
    const expectedDataset = buildDataset(raw)
    const expectedTrend = recommend(expectedDataset.tickers)
    const expectedMinervini = runMinerviniRecommend(toMinerviniInput(expectedDataset.tickers))

    const dataset = loadDataset(FIXTURE_PATH)
    const { trend, minervini } = runSmoke(dataset)

    expect(dataset).toEqual(expectedDataset)
    expect(trend).toEqual(expectedTrend)
    expect(minervini).toEqual(expectedMinervini)
  })
})

describe('backtest.mjs — US-3 신호 재현 루프', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const evaluationDates = buildEvaluationDates(raw)

  it('평가일이 픽스처에서 1개 이상 나온다 (2년 픽스처는 워밍업+말단여유를 충분히 넘김)', () => {
    expect(evaluationDates.length).toBeGreaterThan(0)
  })

  it('재현 동형성: evaluateAsOf가 같은 슬라이스에 lib를 직접 호출한 결과와 일치한다', () => {
    const asOfDate = evaluationDates[Math.floor(evaluationDates.length / 2)]

    const sliced = sliceUniverseAsOf(raw, asOfDate)
    const expectedDataset = buildDataset(sliced)
    const expectedTrend = recommend(expectedDataset.tickers)
    const expectedMinervini = runMinerviniRecommend(toMinerviniInput(expectedDataset.tickers))
    const expectedConsensus = buildConsensusRanking(expectedTrend, expectedMinervini)

    const { dataset, trend, minervini, consensus } = evaluateAsOf(raw, asOfDate)

    expect(dataset).toEqual(expectedDataset)
    expect(trend).toEqual(expectedTrend)
    expect(minervini).toEqual(expectedMinervini)
    expect(consensus).toEqual(expectedConsensus)
  })

  it('전체 루프가 픽스처에서 완주하고 신호 레코드를 축적한다', () => {
    const records = runSignalLoop(raw, evaluationDates)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((r) => typeof r.date === 'string' && typeof r.ticker === 'string')).toBe(true)
  })
})

describe('buildSignalRecords — basis/grade/relaxationApplied 규칙', () => {
  const trendResult = {
    relaxationApplied: true,
    list: [
      { ticker: 'AAA', score: 90, signalPassed: true },
      { ticker: 'BBB', score: 80, signalPassed: true },
      { ticker: 'ZZZ', score: 95, signalPassed: false }, // 고득점 특별 편입 — allSignals(1단계 통과)에서는 제외
    ],
  }
  const minerviniResult = {
    relaxationApplied: false,
    list: [
      { ticker: 'CCC', score: 70 },
      { ticker: 'AAA', score: 60 },
    ],
  }
  const consensusResult = buildConsensusRanking(trendResult, minerviniResult)

  const records = buildSignalRecords('2026-01-05', { trend: trendResult, minervini: minerviniResult, consensus: consensusResult })

  it('trend 레코드는 relaxationApplied가 완화 발생 픽스처 규칙대로 채워지고 signalPassed=false는 제외한다', () => {
    const trendRecords = records.filter((r) => r.strategyKey === 'trend')
    expect(trendRecords.every((r) => r.relaxationApplied === true)).toBe(true)
    expect(trendRecords.some((r) => r.ticker === 'ZZZ')).toBe(false)
    expect(trendRecords.every((r) => r.grade === null)).toBe(true)
  })

  it('minervini 레코드는 완화 미발생 픽스처 규칙대로 relaxationApplied=false다', () => {
    const minerviniRecords = records.filter((r) => r.strategyKey === 'minervini')
    expect(minerviniRecords.every((r) => r.relaxationApplied === false)).toBe(true)
  })

  it('consensus 레코드는 grade에 따라 strategyKey(consensus_2star/1star)가 분리된다', () => {
    const consensusRecords = records.filter((r) => r.strategyKey.startsWith('consensus_'))
    const aaaRecord = consensusRecords.find((r) => r.ticker === 'AAA' && r.basis === 'allSignals')
    expect(aaaRecord.strategyKey).toBe('consensus_2star') // 두 모드 모두 통과
    expect(aaaRecord.grade).toBe('★★')

    const bbbRecord = consensusRecords.find((r) => r.ticker === 'BBB' && r.basis === 'allSignals')
    expect(bbbRecord.strategyKey).toBe('consensus_1star')
    expect(bbbRecord.grade).toBe('★')
  })

  it('basis가 top5/allSignals 두 벌로 기록된다', () => {
    const trendAll = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'allSignals')
    const trendTop5 = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
    expect(trendAll.length).toBe(2) // signalPassed:true인 AAA/BBB만
    expect(trendTop5.length).toBe(2) // 2개뿐이라 top5 슬라이스해도 그대로
  })
})
