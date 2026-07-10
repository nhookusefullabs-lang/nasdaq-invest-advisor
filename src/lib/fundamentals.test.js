import { describe, it, expect } from 'vitest'
import { evaluateFundamentalHurdle } from './fundamentals.js'

function makeItem(overrides = {}) {
  return {
    ticker: 'TEST',
    epsGrowthQoQ_yoy: 31,
    epsAccelerating: true,
    revenueGrowthQoQ_yoy: 25,
    marginImproving: true,
    roe: 0.22,
    quarters: [],
    missing: [],
    ...overrides,
  }
}

describe('evaluateFundamentalHurdle - null 입력', () => {
  it('returns null when item itself is missing (fundamentals.json에 해당 티커 없음)', () => {
    expect(evaluateFundamentalHurdle(null)).toBeNull()
    expect(evaluateFundamentalHurdle(undefined)).toBeNull()
  })
})

describe('evaluateFundamentalHurdle - pass', () => {
  it('passes when all three core criteria (F1/F3/F5) clear the threshold', () => {
    const result = evaluateFundamentalHurdle(makeItem())
    expect(result.verdict).toBe('pass')
    expect(result.coreResults).toEqual({ F1: true, F3: true, F5: true })
  })

  it('boundary: exactly-at-threshold values pass (>=, not >)', () => {
    const result = evaluateFundamentalHurdle(
      makeItem({ epsGrowthQoQ_yoy: 20, revenueGrowthQoQ_yoy: 20, roe: 0.17 }),
    )
    expect(result.verdict).toBe('pass')
  })
})

describe('evaluateFundamentalHurdle - fail', () => {
  it('fails when all three core criteria miss the threshold', () => {
    const result = evaluateFundamentalHurdle(makeItem({ epsGrowthQoQ_yoy: 5, revenueGrowthQoQ_yoy: 12, roe: 0.05 }))
    expect(result.verdict).toBe('fail')
    expect(result.coreResults).toEqual({ F1: false, F3: false, F5: false })
  })

  it('boundary: just-below-threshold values fail', () => {
    const result = evaluateFundamentalHurdle(
      makeItem({ epsGrowthQoQ_yoy: 19.9, revenueGrowthQoQ_yoy: 19.9, roe: 0.169 }),
    )
    expect(result.verdict).toBe('fail')
  })
})

describe('evaluateFundamentalHurdle - partial', () => {
  it('is partial when exactly one of three core criteria passes', () => {
    const result = evaluateFundamentalHurdle(makeItem({ epsGrowthQoQ_yoy: 31, revenueGrowthQoQ_yoy: 12, roe: 0.05 }))
    expect(result.verdict).toBe('partial')
    expect(result.coreResults).toEqual({ F1: true, F3: false, F5: false })
  })

  it('is partial when exactly two of three core criteria pass', () => {
    const result = evaluateFundamentalHurdle(makeItem({ epsGrowthQoQ_yoy: 31, revenueGrowthQoQ_yoy: 25, roe: 0.05 }))
    expect(result.verdict).toBe('partial')
    expect(result.coreResults).toEqual({ F1: true, F3: true, F5: false })
  })
})

describe('evaluateFundamentalHurdle - insufficientFundamentals (판정불가 다수)', () => {
  it('is insufficientFundamentals, not fail, when two of three core criteria are missing', () => {
    const result = evaluateFundamentalHurdle(makeItem({ missing: ['F1', 'F3'] }))
    expect(result.verdict).toBe('insufficientFundamentals')
    expect(result.coreResults).toEqual({ F1: null, F3: null, F5: true })
  })

  it('is insufficientFundamentals when all three core values are null even without an explicit missing[] entry', () => {
    const result = evaluateFundamentalHurdle(
      makeItem({ epsGrowthQoQ_yoy: null, revenueGrowthQoQ_yoy: null, roe: null, missing: [] }),
    )
    expect(result.verdict).toBe('insufficientFundamentals')
    expect(result.coreResults).toEqual({ F1: null, F3: null, F5: null })
  })

  it('remains a normal verdict (not insufficientFundamentals) when only one core criterion is indeterminate', () => {
    const result = evaluateFundamentalHurdle(makeItem({ missing: ['F1'] }))
    expect(result.verdict).toBe('partial')
    expect(result.coreResults).toEqual({ F1: null, F3: true, F5: true })
  })
})

describe('evaluateFundamentalHurdle - F2/F4는 참고 배지만, 판정에 미반영', () => {
  it('carries epsAccelerating/marginImproving through unchanged and does not affect verdict', () => {
    const failing = evaluateFundamentalHurdle(
      makeItem({ epsGrowthQoQ_yoy: 5, revenueGrowthQoQ_yoy: 5, roe: 0.05, epsAccelerating: true, marginImproving: true }),
    )
    expect(failing.verdict).toBe('fail')
    expect(failing.epsAccelerating).toBe(true)
    expect(failing.marginImproving).toBe(true)
  })

  it('reports epsAccelerating/marginImproving as null when their codes are in missing[]', () => {
    const result = evaluateFundamentalHurdle(makeItem({ missing: ['F2', 'F4'] }))
    expect(result.epsAccelerating).toBeNull()
    expect(result.marginImproving).toBeNull()
    expect(result.verdict).toBe('pass') // F1/F3/F5 unaffected by F2/F4 missing
  })
})

describe('evaluateFundamentalHurdle - 근거 문자열은 충족/미충족/판정불가를 구분한다', () => {
  it('marks a passing criterion with a checkmark and its signed percentage', () => {
    const result = evaluateFundamentalHurdle(makeItem({ epsGrowthQoQ_yoy: 31 }))
    expect(result.reasons).toContain('EPS +31% ✓')
  })

  it('marks a failing criterion with a cross and its signed percentage', () => {
    const result = evaluateFundamentalHurdle(makeItem({ revenueGrowthQoQ_yoy: 12 }))
    expect(result.reasons).toContain('매출 +12% ✗')
  })

  it('marks an indeterminate criterion distinctly, without a check or cross', () => {
    const result = evaluateFundamentalHurdle(makeItem({ missing: ['F5'] }))
    expect(result.reasons).toContain('ROE 판정불가')
    expect(result.reasons.some((r) => r.includes('ROE') && (r.includes('✓') || r.includes('✗')))).toBe(false)
  })

  it('formats a negative growth rate with a leading minus, not a double sign', () => {
    const result = evaluateFundamentalHurdle(makeItem({ epsGrowthQoQ_yoy: -8 }))
    expect(result.reasons).toContain('EPS -8% ✗')
  })
})
