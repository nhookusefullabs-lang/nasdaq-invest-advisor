import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  applyDisparityInvertedU,
  applyAdxGate,
  applyConsensusWeighted,
  VARIANTS,
  evaluateVariant,
  runVariantSignalLoop,
} from './variants.mjs'
import { stage1Pass } from '../../src/lib/recommend.js'
import { PRESETS, DEFAULT_PRESET_KEY } from '../../src/lib/presets.js'
import { buildDataset } from '../../src/lib/buildDataset.js'
import { buildEvaluationDates } from './asOf.mjs'
import { buildPriceIndex } from './performance.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.resolve(__dirname, '../../src/lib/__fixtures__/nasdaq100.2y.sample.json')

describe('applyDisparityInvertedU — 변형 A (US-7 승인 기준 3)', () => {
  it('과열 구간(이격도 12%)에서 현행 선형 클램프와 다른 점수를 낸다', () => {
    const dataset = {
      tickers: [{ ticker: 'AAA', isLeadingSector: false, indicators: { disparity: 12, volTrend: 0 } }],
    }
    const trendResult = { list: [{ ticker: 'AAA', name: 'A', sector: 'Technology', score: 48, signalPassed: true, relaxationApplied: false }], relaxationApplied: false, level: 'strict', insufficientSignal: false }

    const result = applyDisparityInvertedU(trendResult, dataset)
    // 현행: (12/15)*60 = 48. 역U자: 12는 과열 구간 → (15-12)/(15-8)*60 ≈ 25.7
    expect(result.list[0].score).not.toBe(48)
    expect(result.list[0].score).toBeLessThan(48)
  })

  it('신호 미통과(signalPassed:false) 종목은 재점수화 대상에서 제외된다', () => {
    const dataset = { tickers: [{ ticker: 'ZZZ', isLeadingSector: false, indicators: { disparity: 5, volTrend: 0 } }] }
    const trendResult = { list: [{ ticker: 'ZZZ', name: 'Z', sector: 'Technology', score: 90, signalPassed: false, relaxationApplied: false }], relaxationApplied: false, level: 'strict', insufficientSignal: true }
    const result = applyDisparityInvertedU(trendResult, dataset)
    expect(result.list).toEqual([])
  })
})

describe('applyAdxGate — 변형 B (US-7 승인 기준 3)', () => {
  const config = PRESETS[DEFAULT_PRESET_KEY]

  function makeSeries(kind) {
    const n = 40
    if (kind === 'trend') {
      return Array.from({ length: n }, (_, i) => ({ date: String(i).padStart(3, '0'), close: 100 + i, high: 100 + i + 0.5, low: 100 + i - 0.5, volume: 1000 }))
    }
    return Array.from({ length: n }, (_, i) => {
      const c = 100 + (i % 2 === 0 ? 2 : -2)
      return { date: String(i).padStart(3, '0'), close: c, high: c + 0.5, low: c - 0.5, volume: 1000 }
    })
  }

  function makeTicker(ticker, seriesKind) {
    return {
      ticker,
      name: ticker,
      sector: 'Technology',
      dataSufficient: true,
      isLeadingSector: false,
      indicators: { rsi14: 60, macdLine: 1, disparity: 5, volTrend: 10 },
      series: makeSeries(seriesKind),
    }
  }

  it('두 종목 모두 (ADX 없이) stage1Pass는 통과한다 — 비교 대상이 ADX 게이트 하나뿐임을 보증', () => {
    const trendTicker = makeTicker('TREND', 'trend')
    const chopTicker = makeTicker('CHOP', 'chop')
    expect(stage1Pass(trendTicker, 'rsiMacdOnly', config)).toBe(true)
    expect(stage1Pass(chopTicker, 'rsiMacdOnly', config)).toBe(true)
  })

  it('ADX(14)≥20 게이트를 추가하면 강한 추세 종목만 남고 횡보 종목은 제외된다', () => {
    const dataset = { tickers: [makeTicker('TREND', 'trend'), makeTicker('CHOP', 'chop')] }
    const result = applyAdxGate(dataset, 'rsiMacdOnly', config)
    const tickers = result.list.map((r) => r.ticker)
    expect(tickers).toContain('TREND')
    expect(tickers).not.toContain('CHOP')
  })
})

describe('applyConsensusWeighted — 변형 C', () => {
  it('50:50 가중치는 현행 buildConsensusRanking과 동일한 순서를 낸다 (항등성 검증)', () => {
    const trendResult = { list: [{ ticker: 'AAA', name: 'A', sector: 'Technology', score: 90 }, { ticker: 'BBB', name: 'B', sector: 'Technology', score: 50 }] }
    const minerviniResult = { list: [{ ticker: 'AAA', name: 'A', sector: 'Technology', score: 70 }] }
    const result = applyConsensusWeighted(trendResult, minerviniResult, { trend: 0.5, minervini: 0.5 })
    expect(result.list[0].ticker).toBe('AAA') // ★★ (양쪽 통과)가 항상 위
    expect(result.list[0].grade).toBe('★★')
    expect(result.list[1].grade).toBe('★')
  })

  it('가중치를 바꾸면 컨센서스 백분위가 달라진다', () => {
    const trendResult = { list: [{ ticker: 'AAA', name: 'A', sector: 'Technology', score: 90 }, { ticker: 'BBB', name: 'B', sector: 'Technology', score: 50 }] }
    const minerviniResult = { list: [{ ticker: 'AAA', name: 'A', sector: 'Technology', score: 10 }, { ticker: 'BBB', name: 'B', sector: 'Technology', score: 90 }] }
    const equal = applyConsensusWeighted(trendResult, minerviniResult, { trend: 0.5, minervini: 0.5 })
    const trendHeavy = applyConsensusWeighted(trendResult, minerviniResult, { trend: 0.9, minervini: 0.1 })
    const aaaEqual = equal.list.find((r) => r.ticker === 'AAA').consensusPercentile
    const aaaTrendHeavy = trendHeavy.list.find((r) => r.ticker === 'AAA').consensusPercentile
    expect(aaaTrendHeavy).not.toBe(aaaEqual)
  })
})

describe('VARIANTS + evaluateVariant — US-7 승인 기준 1/4 (픽스처 기반)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const evaluationDates = buildEvaluationDates(raw)
  const dataset = buildDataset(raw)
  const priceIndex = buildPriceIndex(dataset.tickers)

  it('변형 3종(A/B/C)이 등록되어 있다', () => {
    expect(VARIANTS.map((v) => v.name)).toEqual(['disparity_inverted_u', 'adx_gate', 'consensus_weighted'])
  })

  it('각 변형이 픽스처에서 완주하고 outVsBaseline 델타를 기록하며 adopted는 항상 false다', () => {
    const splitIndex = Math.floor(evaluationDates.length / 2)
    const splitDate = evaluationDates[splitIndex]

    for (const variant of VARIANTS) {
      const variantRecords = runVariantSignalLoop(raw, evaluationDates, variant)
      expect(Array.isArray(variantRecords)).toBe(true)

      const result = evaluateVariant(raw, variant, { evaluationDates, splitDate, mainRecords: variantRecords, priceIndex })
      expect(result.adopted).toBe(false)
      expect(result.name).toBe(variant.name)
      expect(typeof result.note).toBe('string')
      expect(result.note.length).toBeGreaterThan(0)
      expect(result.outVsBaseline).toHaveProperty('avgExcessDelta')
      expect(result.outVsBaseline).toHaveProperty('winRateDelta')
    }
  })
})
