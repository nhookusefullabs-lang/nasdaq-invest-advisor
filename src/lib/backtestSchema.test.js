import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateBacktest } from './backtestSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '__fixtures__')
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'))

describe('validateBacktest — 픽스처 (US-5)', () => {
  it('유효 픽스처를 통과시킨다', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('무효 픽스처를 거부한다 (schemaVersion + sample enum + byHolding 필드 누락 + 수치 타입, 3+ 동시)', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.invalid.json'))
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validateBacktest — 무효 케이스 3종 (US-5 승인 기준 2)', () => {
  const baseValid = () => loadFixture('backtest.valid.json')

  it('sample enum 오류를 거부한다', () => {
    const data = baseValid()
    data.strategies[0].sample = 'both'
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('sample'))).toBe(true)
  })

  it('byHolding 필드 누락을 거부한다', () => {
    const data = baseValid()
    delete data.strategies[0].byHolding[0].signals
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('signals'))).toBe(true)
  })

  it('수치 타입 오류를 거부한다', () => {
    const data = baseValid()
    data.strategies[0].byHolding[0].avgExcess = '0.012'
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('avgExcess'))).toBe(true)
  })
})

describe('validateBacktest — fundamentalAxis/variants', () => {
  it('fundamentalAxis:null을 허용한다 (US-6 이전 상태)', () => {
    const data = baseValidWithNullAxis()
    const { valid } = validateBacktest(data)
    expect(valid).toBe(true)
  })

  function baseValidWithNullAxis() {
    const data = loadFixture('backtest.valid.json')
    data.fundamentalAxis = null
    return data
  }

  it('variants[].adopted가 boolean이 아니면 거부한다', () => {
    const data = loadFixture('backtest.valid.json')
    data.variants = [{ name: 'x', adopted: 'false', outVsBaseline: { avgExcessDelta: 0, winRateDelta: 0 }, note: '' }]
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('adopted'))).toBe(true)
  })
})
