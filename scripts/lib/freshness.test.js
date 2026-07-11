import { describe, it, expect } from 'vitest'
import { goldenCrossFreshnessDays, pivotBreakoutFreshnessDays, freshnessCohort, FRESHNESS_COHORTS } from './freshness.mjs'
import { goldenCrossWithin, pivotProximity } from '../../src/lib/indicators.js'

// n=15, signalLine 전부 0 고정, macdLine은 crossIdx 이전엔 -1, 그 이후로는 계속 +1
// (재교차 없음 — crossIdx에서 딱 한 번만 상향 돌파).
function macdSeriesWithCrossAt(n, crossIdx) {
  const macdLine = Array.from({ length: n }, (_, i) => (i < crossIdx ? -1 : 1))
  const signalLine = new Array(n).fill(0)
  return { macdLine, signalLine }
}

describe('goldenCrossFreshnessDays — 재사용 검증 (US-4 승인 기준 2)', () => {
  it('goldenCrossWithin을 그대로 호출해 daysAgo를 판정한다(직접 호출 결과와 정확히 일치)', () => {
    const n = 15
    const crossIdx = 10 // daysAgo = (n-1) - crossIdx = 4
    const { macdLine, signalLine } = macdSeriesWithCrossAt(n, crossIdx)
    const daysAgo = goldenCrossFreshnessDays(macdLine, signalLine)
    expect(daysAgo).toBe(4)
    expect(goldenCrossWithin(macdLine, signalLine, daysAgo + 1)).toBe(true)
    expect(goldenCrossWithin(macdLine, signalLine, daysAgo)).toBe(false)
  })
})

describe('goldenCrossFreshnessDays/pivotBreakoutFreshnessDays — 코호트 배정 (US-4 승인 기준 3, 5개 이상)', () => {
  const n = 15
  const cases = [
    { crossIdx: 14, expectedDaysAgo: 0, cohort: '0d' },
    { crossIdx: 13, expectedDaysAgo: 1, cohort: '1-2d' },
    { crossIdx: 12, expectedDaysAgo: 2, cohort: '1-2d' },
    { crossIdx: 11, expectedDaysAgo: 3, cohort: '3-4d' },
    { crossIdx: 9, expectedDaysAgo: 5, cohort: '5d+' },
  ]

  cases.forEach(({ crossIdx, expectedDaysAgo, cohort }) => {
    it(`crossIdx=${crossIdx} → daysAgo=${expectedDaysAgo} → 코호트 ${cohort}`, () => {
      const { macdLine, signalLine } = macdSeriesWithCrossAt(n, crossIdx)
      const daysAgo = goldenCrossFreshnessDays(macdLine, signalLine)
      expect(daysAgo).toBe(expectedDaysAgo)
      expect(freshnessCohort(daysAgo)).toBe(cohort)
    })
  })

  it('lookback(10거래일) 안에 크로스가 없으면 no_recent_breakout으로 배정된다', () => {
    const macdLine = new Array(n).fill(-1) // 크로스 자체가 없음
    const signalLine = new Array(n).fill(0)
    const daysAgo = goldenCrossFreshnessDays(macdLine, signalLine)
    expect(daysAgo).toBeNull()
    expect(freshnessCohort(daysAgo)).toBe('no_recent_breakout')
  })
})

// series 끝에서 daysAgo번째 날의 종가만 150(신고가), 나머지는 전부 100 — pivotProximity가
// 정확히 그 날에만 0을 반환하도록 구성한다(재구현 없이 pivotProximity 재사용 검증).
function seriesWithBreakoutAt(n, breakoutIdx) {
  return Array.from({ length: n }, (_, i) => ({ close: i === breakoutIdx ? 150 : 100 }))
}

describe('pivotBreakoutFreshnessDays — pivotProximity 재사용 검증 (US-4 승인 기준 2/3)', () => {
  const n = 80

  it('pivotProximity를 그대로 호출해 daysAgo를 판정한다(직접 호출 결과와 정확히 일치)', () => {
    const series = seriesWithBreakoutAt(n, 75) // daysAgo = 79-75 = 4
    const daysAgo = pivotBreakoutFreshnessDays(series)
    expect(daysAgo).toBe(4)
    expect(pivotProximity(series.slice(0, series.length - daysAgo))).toBe(0)
    expect(pivotProximity(series.slice(0, series.length - daysAgo + 1))).not.toBe(0)
  })

  it('breakout일이 오늘(daysAgo=0)이면 0d 코호트로 배정된다', () => {
    const daysAgo = pivotBreakoutFreshnessDays(seriesWithBreakoutAt(n, 79))
    expect(daysAgo).toBe(0)
    expect(freshnessCohort(daysAgo)).toBe('0d')
  })

  it('breakout일이 2거래일 전이면 1-2d 코호트로 배정된다', () => {
    const daysAgo = pivotBreakoutFreshnessDays(seriesWithBreakoutAt(n, 77))
    expect(daysAgo).toBe(2)
    expect(freshnessCohort(daysAgo)).toBe('1-2d')
  })

  it('breakout일이 4거래일 전이면 3-4d 코호트로 배정된다', () => {
    const daysAgo = pivotBreakoutFreshnessDays(seriesWithBreakoutAt(n, 75))
    expect(daysAgo).toBe(4)
    expect(freshnessCohort(daysAgo)).toBe('3-4d')
  })

  it('breakout일이 7거래일 전이면 5d+ 코호트로 배정된다', () => {
    const daysAgo = pivotBreakoutFreshnessDays(seriesWithBreakoutAt(n, 72))
    expect(daysAgo).toBe(7)
    expect(freshnessCohort(daysAgo)).toBe('5d+')
  })

  it('최근 10거래일 내 돌파가 없으면(오래된 돌파) no_recent_breakout으로 배정된다', () => {
    const daysAgo = pivotBreakoutFreshnessDays(seriesWithBreakoutAt(n, 40)) // 실제 daysAgo=39, lookback 밖
    expect(daysAgo).toBeNull()
    expect(freshnessCohort(daysAgo)).toBe('no_recent_breakout')
  })

  it('63거래일 미만 데이터는 안전하게 null 처리된다(no_recent_breakout)', () => {
    const shortSeries = seriesWithBreakoutAt(50, 49)
    expect(pivotBreakoutFreshnessDays(shortSeries)).toBeNull()
  })
})

describe('FRESHNESS_COHORTS — 배타성/완전성', () => {
  it('5개 코호트가 정확히 정의되어 있고 중복이 없다', () => {
    expect(FRESHNESS_COHORTS.length).toBe(5)
    expect(new Set(FRESHNESS_COHORTS).size).toBe(5)
  })

  it('daysAgo(null 포함, 0~9)는 항상 정확히 하나의 코호트에만 귀속된다', () => {
    const inputs = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    for (const daysAgo of inputs) {
      const cohort = freshnessCohort(daysAgo)
      expect(FRESHNESS_COHORTS).toContain(cohort)
    }
  })
})
