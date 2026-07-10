import { describe, it, expect } from 'vitest'
import { buildConsensusRanking } from './consensus.js'

/**
 * namedScores: {ticker: score(1~100)} — 나머지 자리는 F{score} 필러로 채워 population을
 * 정확히 1..100으로 만든다. population이 1..100이면 percentileOf(v)===v가 정확히 성립해
 * (원소 v 이하 개수 = v개 / 전체 100개 × 100 = v) 손으로 기대 백분위를 맞추기 쉬워진다.
 */
function makeListWithPercentiles(namedScores) {
  const reverseByScore = {}
  Object.entries(namedScores).forEach(([ticker, score]) => {
    reverseByScore[score] = ticker
  })
  const list = []
  for (let score = 1; score <= 100; score++) {
    const ticker = reverseByScore[score] ?? `F${score}`
    list.push({ ticker, name: ticker, sector: 'Technology', score, reasons: `reason-${ticker}`, signalPassed: true })
  }
  return { list, insufficientSignal: false, relaxationApplied: false, level: 'strict' }
}

describe('buildConsensusRanking - 평균의 함정 방지 (US-6)', () => {
  it('ranks a balanced 75/75 (★★) ticker above an unbalanced 90/40 (★★) ticker', () => {
    const trend = makeListWithPercentiles({ A: 90, B: 75 })
    const minervini = makeListWithPercentiles({ A: 40, B: 75 })
    const result = buildConsensusRanking(trend, minervini)

    const a = result.list.find((e) => e.ticker === 'A')
    const b = result.list.find((e) => e.ticker === 'B')
    expect(a.grade).toBe('★★')
    expect(b.grade).toBe('★★')
    expect(a.consensusPercentile).toBeCloseTo(65) // (90+40)/2
    expect(b.consensusPercentile).toBeCloseTo(75) // (75+75)/2
    expect(result.list.indexOf(b)).toBeLessThan(result.list.indexOf(a))
  })
})

describe('buildConsensusRanking - ★★는 항상 ★ 위 (US-6)', () => {
  it('places a ★★ ticker above a ★ ticker even when the ★ ticker has a far higher percentile', () => {
    const trend = makeListWithPercentiles({ C: 100, D: 10 })
    const minervini = makeListWithPercentiles({ D: 10 }) // C는 미너비니 결과에 없음(단일 모드)
    const result = buildConsensusRanking(trend, minervini)

    const c = result.list.find((e) => e.ticker === 'C')
    const d = result.list.find((e) => e.ticker === 'D')
    expect(c.grade).toBe('★')
    expect(c.consensusPercentile).toBeCloseTo(100)
    expect(d.grade).toBe('★★')
    expect(d.consensusPercentile).toBeCloseTo(10)
    expect(result.list.indexOf(d)).toBeLessThan(result.list.indexOf(c))
  })

  it('labels which single mode a ★ ticker passed', () => {
    const trend = makeListWithPercentiles({ ONLY_TREND: 80 })
    const minervini = makeListWithPercentiles({ ONLY_MIN: 80 })
    const result = buildConsensusRanking(trend, minervini)
    const trendOnly = result.list.find((e) => e.ticker === 'ONLY_TREND')
    const minOnly = result.list.find((e) => e.ticker === 'ONLY_MIN')
    expect(trendOnly.singleModeLabel).toBe('추세추종')
    expect(minOnly.singleModeLabel).toBe('미너비니')
  })
})

describe('buildConsensusRanking - 한쪽 모드 결과가 빈 경우에도 정상 동작 (US-6)', () => {
  it('works from trend-only data when minervini has no results (insufficientSignal)', () => {
    const trend = makeListWithPercentiles({ X: 80 })
    const minervini = { list: [], insufficientSignal: true }
    const result = buildConsensusRanking(trend, minervini)

    expect(result.minerviniInsufficientSignal).toBe(true)
    expect(result.trendInsufficientSignal).toBe(false)
    expect(result.list.length).toBe(100) // trend 쪽 100개 전부 ★ 등급으로 채워짐
    const x = result.list.find((e) => e.ticker === 'X')
    expect(x.grade).toBe('★')
    expect(x.minervini).toBeNull()
  })

  it('does not throw when both inputs are null/undefined', () => {
    expect(() => buildConsensusRanking(null, undefined)).not.toThrow()
    expect(buildConsensusRanking(null, undefined).list).toEqual([])
  })
})

describe('buildConsensusRanking - 원점수는 결과에 보존되지만 정렬 기준이 아님 (US-6)', () => {
  it('exposes each mode raw score/percentile per ticker without summing them into the sort key', () => {
    const trend = makeListWithPercentiles({ A: 90 })
    const minervini = makeListWithPercentiles({ A: 40 })
    const result = buildConsensusRanking(trend, minervini)
    const a = result.list.find((e) => e.ticker === 'A')
    expect(a.trend.score).toBe(90)
    expect(a.trend.percentile).toBeCloseTo(90)
    expect(a.minervini.score).toBe(40)
    expect(a.minervini.percentile).toBeCloseTo(40)
    // consensusPercentile은 90+40=130이 아니라 평균(65)
    expect(a.consensusPercentile).toBeCloseTo(65)
  })
})
