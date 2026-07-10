import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateFundamentals } from './fundamentalsSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '__fixtures__')
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'))

function validTicker(overrides = {}) {
  return {
    ticker: 'AAPL',
    epsGrowthQoQ_yoy: 24.1,
    epsAccelerating: true,
    revenueGrowthQoQ_yoy: 18.3,
    marginImproving: true,
    roe: 0.312,
    quarters: [{ period: '2026-Q2', eps: 1.52, revenue: 111184000000, operatingMargin: 0.302 }],
    missing: [],
    ...overrides,
  }
}

function validDoc(tickers) {
  return { schemaVersion: 1, generatedAt: '2026-07-09', tickers, excluded: [] }
}

describe('validateFundamentals - fixtures (US-2)', () => {
  it('passes the valid fixture', () => {
    const { valid, errors } = validateFundamentals(loadFixture('fundamentals.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('fails the invalid fixture (schemaVersion + roe type + missing bad code, 3+ issues at once)', () => {
    const { valid, errors } = validateFundamentals(loadFixture('fundamentals.invalid.json'))
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validateFundamentals - individual failure cases (3케이스 이상)', () => {
  it('rejects a wrong schemaVersion', () => {
    const doc = { ...validDoc([validTicker()]), schemaVersion: 2 }
    const { valid, errors } = validateFundamentals(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('schemaVersion'))).toBe(true)
  })

  it('rejects a non-numeric roe (type error)', () => {
    const doc = validDoc([validTicker({ roe: '0.312' })])
    const { valid, errors } = validateFundamentals(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('roe'))).toBe(true)
  })

  it('rejects an invalid code in missing[]', () => {
    const doc = validDoc([validTicker({ missing: ['F1', 'F9'] })])
    const { valid, errors } = validateFundamentals(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('missing'))).toBe(true)
  })

  it('accepts null for nullable numeric/boolean fields (판정불가)', () => {
    const doc = validDoc([
      validTicker({ epsGrowthQoQ_yoy: null, epsAccelerating: null, roe: null, missing: ['F1', 'F2', 'F5'] }),
    ])
    expect(validateFundamentals(doc).valid).toBe(true)
  })

  it('rejects a malformed quarters entry', () => {
    const doc = validDoc([validTicker({ quarters: [{ period: '2026-Q2', eps: 'x', revenue: 1, operatingMargin: 1 }] })])
    const { valid, errors } = validateFundamentals(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('quarters'))).toBe(true)
  })

  it('rejects an excluded entry missing a reason', () => {
    const doc = { ...validDoc([validTicker()]), excluded: [{ ticker: 'MSTR' }] }
    const { valid, errors } = validateFundamentals(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('reason'))).toBe(true)
  })
})
