import { describe, it, expect } from 'vitest'
import { reconstructFundamentalHistory, fundamentalVerdictAsOf, buildFundamentalAxis, quarterToApproxReportDate, FUNDAMENTAL_AXIS_NOTE } from './fundamentalHistory.mjs'
import { evaluateFundamentalHurdle } from '../../src/lib/fundamentals.js'
import { buildPriceIndex } from './performance.mjs'

const SAMPLE_ITEM = {
  ticker: 'AAA',
  roe: 0.25,
  missing: [],
  quarters: [
    { period: '2026-Q2', eps: 1.5, revenue: 1000, operatingMargin: 0.3 },
    { period: '2026-Q1', eps: 1.2, revenue: 800, operatingMargin: 0.28 },
    { period: '2025-Q4', eps: 1.0, revenue: 700, operatingMargin: 0.25 },
    { period: '2025-Q3', eps: 0.9, revenue: 650, operatingMargin: 0.22 },
    { period: '2025-Q2', eps: 0.7, revenue: 500, operatingMargin: 0.2 },
  ],
}

describe('reconstructFundamentalHistory — 재구성 동형성 (US-6 승인 기준 1)', () => {
  it('재구성된 시점값으로 evaluateFundamentalHurdle을 직접 호출한 결과와 일치한다', () => {
    const history = reconstructFundamentalHistory(SAMPLE_ITEM)
    expect(history.length).toBe(4) // 5분기 → i=0..3, QoQ 비교 4쌍

    const point = history.find((p) => p.quarter === '2026-Q2')
    const expectedVerdict = evaluateFundamentalHurdle({
      ticker: 'AAA',
      epsGrowthQoQ_yoy: ((1.5 - 1.2) / Math.abs(1.2)) * 100,
      epsAccelerating: null,
      revenueGrowthQoQ_yoy: ((1000 - 800) / Math.abs(800)) * 100,
      marginImproving: 0.3 > 0.28,
      roe: 0.25,
      missing: [],
    })
    expect(point.verdict).toEqual(expectedVerdict)
  })

  it('quarters가 2개 미만이면 빈 배열을 반환한다', () => {
    expect(reconstructFundamentalHistory({ ticker: 'X', quarters: [{ period: '2026-Q2', eps: 1 }] })).toEqual([])
    expect(reconstructFundamentalHistory(null)).toEqual([])
  })
})

describe('quarterToApproxReportDate', () => {
  it('분기 종료일 + 45일로 근사 발표일을 계산한다', () => {
    expect(quarterToApproxReportDate('2025-Q2')).toBe('2025-08-14')
    expect(quarterToApproxReportDate('2025-Q3')).toBe('2025-11-14')
  })

  it('형식이 맞지 않으면 null을 반환한다', () => {
    expect(quarterToApproxReportDate('not-a-quarter')).toBeNull()
  })
})

describe('fundamentalVerdictAsOf', () => {
  const history = reconstructFundamentalHistory(SAMPLE_ITEM) // asOfDate: 2025-11-14, 2026-02-14, 2026-05-15, 2026-08-14

  it('평가일 이전 가장 최근 재구성 시점을 반환한다', () => {
    expect(fundamentalVerdictAsOf(history, '2026-03-01').asOfDate).toBe('2026-02-14')
  })

  it('가장 이른 재구성 시점보다 이전이면 null이다 (coveredFrom 밖)', () => {
    expect(fundamentalVerdictAsOf(history, '2025-09-01')).toBeNull()
  })
})

describe('buildFundamentalAxis — US-6 승인 기준 2/3/4', () => {
  function makeDates(n, startEpochDays = 20302) {
    // 20302 ≈ 2025-08-01
    return Array.from({ length: n }, (_, i) => new Date((startEpochDays + i) * 86400000).toISOString().slice(0, 10))
  }
  const dates = makeDates(400)
  const priceIndex = buildPriceIndex([
    { ticker: 'AAA', dataSufficient: true, series: dates.map((date, i) => ({ date, close: 100 + i, high: 100 + i, low: 100 + i, volume: 1000 })) },
  ])

  const fundamentalsData = { schemaVersion: 1, generatedAt: '2026-08-14', tickers: [SAMPLE_ITEM], excluded: [] }

  it('fundamentals.json이 없으면 null (엔진은 그래도 완주해야 한다)', () => {
    expect(buildFundamentalAxis(null, [], priceIndex, [5])).toBeNull()
  })

  it('coveredFrom(2025-11-14) 이전 평가일 신호는 집계에서 제외된다', () => {
    const records = [
      { date: '2025-09-01', ticker: 'AAA', strategyKey: 'trend', basis: 'allSignals', rank: 1, score: 80, grade: null, relaxationApplied: false }, // coveredFrom 이전 → 제외
      { date: '2025-12-01', ticker: 'AAA', strategyKey: 'trend', basis: 'allSignals', rank: 1, score: 80, grade: null, relaxationApplied: false }, // coveredFrom 이후 → 포함
    ]
    const axis = buildFundamentalAxis(fundamentalsData, records, priceIndex, [5])
    expect(axis.coveredFrom).toBe('2025-11-14')

    const totalSignals = axis.byVerdict.reduce((sum, v) => sum + v.byHolding.reduce((s, h) => s + h.signals, 0), 0)
    expect(totalSignals).toBe(1) // 2025-09-01 신호는 제외되어 1건만 집계됨
  })

  it('고정 문구가 산출물에 포함된다', () => {
    const axis = buildFundamentalAxis(fundamentalsData, [], priceIndex, [5])
    expect(axis.note).toBe(FUNDAMENTAL_AXIS_NOTE)
    expect(axis.note).toBe('근사 재구성 · 짧은 구간 참고치')
  })

  it('byVerdict는 pass/partial/fail 3종으로 고정 구성된다', () => {
    const axis = buildFundamentalAxis(fundamentalsData, [], priceIndex, [5])
    expect(axis.byVerdict.map((v) => v.verdict)).toEqual(['pass', 'partial', 'fail'])
  })
})
