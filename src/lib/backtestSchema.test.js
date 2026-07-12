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

describe('validateBacktest — v2 signalQuality (v9.1 US-1 승인 기준 2)', () => {
  const v2Valid = () => ({
    ...loadFixture('backtest.valid.json'),
    schemaVersion: 2,
    strategies: loadFixture('backtest.valid.json').strategies.map((s) => ({ ...s, signalQuality: 'all' })),
  })

  it('v2 문서에 signalQuality가 있으면 통과한다', () => {
    const { valid, errors } = validateBacktest(v2Valid())
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('v2 문서에서 signalQuality enum 오류를 거부한다', () => {
    const data = v2Valid()
    data.strategies[0].signalQuality = 'weird'
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('signalQuality'))).toBe(true)
  })

  it('v2 문서에서 signalQuality 필드 자체가 없으면 거부한다', () => {
    const data = v2Valid()
    delete data.strategies[0].signalQuality
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('signalQuality'))).toBe(true)
  })

  it('v1 문서는 signalQuality가 없어도 통과한다 (하위 호환)', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })
})

describe('validateBacktest — freshnessCohorts (v9.1 US-4 승인 기준 4)', () => {
  it('freshnessCohorts 필드 자체가 없어도(구버전 산출물) 통과한다 (하위 호환)', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('유효한 freshnessCohorts 항목은 통과한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      freshnessCohorts: [
        {
          key: 'trend',
          sample: 'out',
          cohort: '0d',
          byHolding: [{ days: 20, signals: 3, winRate: 0.6, avgExcess: 0.02, medianExcess: 0.015, avgReturn: 0.03, mdd: 0.01 }],
        },
      ],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('key enum 오류(consensus_2star 등 정의되지 않은 전략)를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      freshnessCohorts: [{ key: 'consensus_2star', sample: 'out', cohort: '0d', byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('freshnessCohorts[0].key'))).toBe(true)
  })

  it('cohort enum 오류를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      freshnessCohorts: [{ key: 'trend', sample: 'out', cohort: '10d', byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('freshnessCohorts[0].cohort'))).toBe(true)
  })
})

describe('validateBacktest — regimeAxis (v10 US-7 승인 기준 3: v3 무효 픽스처 거부)', () => {
  it('schemaVersion 3을 지원 버전으로 허용한다', () => {
    const data = { ...loadFixture('backtest.valid.json'), schemaVersion: 3 }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('regimeAxis 필드 자체가 없어도(v1/v2 산출물) 통과한다 (하위 호환)', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('유효한 regimeAxis 항목은 통과한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      schemaVersion: 3,
      regimeAxis: [
        {
          strategyKey: 'trend',
          sample: 'out',
          regime: 'up',
          byHolding: [{ days: 20, signals: 5, winRate: 0.6, avgExcess: 0.02, medianExcess: 0.015, avgReturn: 0.03, mdd: 0.01 }],
        },
      ],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('regime enum 오류(정의되지 않은 국면 값)를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      schemaVersion: 3,
      regimeAxis: [{ strategyKey: 'trend', sample: 'out', regime: 'sideways', byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('regimeAxis[0].regime'))).toBe(true)
  })

  it('strategyKey enum 오류를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      schemaVersion: 3,
      regimeAxis: [{ strategyKey: 'bogus', sample: 'out', regime: 'up', byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('regimeAxis[0].strategyKey'))).toBe(true)
  })

  it('byHolding 항목의 수치 타입 오류를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      schemaVersion: 3,
      regimeAxis: [{ strategyKey: 'trend', sample: 'out', regime: 'up', byHolding: [{ days: 20, signals: '5', winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null }] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('regimeAxis[0].byHolding[0].signals'))).toBe(true)
  })
})

describe('validateBacktest — entryVariants (v10 US-8 승인 기준 3)', () => {
  const summary = { signals: 3, winRate: 0.6, avgExcess: 0.02, medianExcess: 0.015, avgReturn: 0.03, mdd: 0.01 }

  it('entryVariants 필드 자체가 없어도(v1/v2/US-7 산출물) 통과한다 (하위 호환)', () => {
    const { valid, errors } = validateBacktest(loadFixture('backtest.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('유효한 entryVariants 항목은 통과한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      entryVariants: [{ name: 'entry_pivot_trigger', signals: 3, fillRate: 0.67, byHolding: [{ days: 20, conditional: summary, opportunity: summary }] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('name 누락을 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      entryVariants: [{ signals: 3, fillRate: 0.67, byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('entryVariants[0].name'))).toBe(true)
  })

  it('fillRate 타입 오류를 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      entryVariants: [{ name: 'entry_close', signals: 3, fillRate: '1', byHolding: [] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('entryVariants[0].fillRate'))).toBe(true)
  })

  it('byHolding[].conditional/opportunity 누락을 거부한다', () => {
    const data = {
      ...loadFixture('backtest.valid.json'),
      entryVariants: [{ name: 'entry_close', signals: 3, fillRate: 1, byHolding: [{ days: 20 }] }],
    }
    const { valid, errors } = validateBacktest(data)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('entryVariants[0].byHolding[0].conditional'))).toBe(true)
    expect(errors.some((e) => e.includes('entryVariants[0].byHolding[0].opportunity'))).toBe(true)
  })
})
