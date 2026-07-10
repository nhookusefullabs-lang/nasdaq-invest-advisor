import { describe, it, expect } from 'vitest'
import { getPool, validateTickers, formatPoolTable, formatValidationTable } from './select-pool.mjs'

function makeTicker(overrides = {}) {
  return {
    ticker: 'TEST',
    name: 'Test Co',
    sector: 'Technology',
    dataSufficient: true,
    isLeadingSector: false,
    indicators: {
      rsi14: 60,
      macdLine: 1,
      disparity: 5,
      volTrend: 10,
      goldenCross5: true,
      goldenCross10: true,
      volatility: 0.02,
    },
    simulation: { returnPct: 5 },
    ...overrides,
  }
}

describe('getPool', () => {
  it('reuses recommend.js to extract the pool from dataset.tickers', () => {
    const dataset = { tickers: [makeTicker({ ticker: 'AAA' }), makeTicker({ ticker: 'BBB' })] }
    const pool = getPool(dataset)
    expect(pool.list.map((r) => r.ticker).sort()).toEqual(['AAA', 'BBB'])
    // only 2 tickers total, so MIN_RESULTS(5) is never reached and relaxation runs to the loosest level
    expect(pool.level).toBe('rsiMacdOnly')
  })
})

describe('formatPoolTable', () => {
  it('renders an empty-pool message when no tickers pass', () => {
    expect(formatPoolTable({ list: [], level: 'rsiMacdOnly', relaxationApplied: true, insufficientSignal: true }))
      .toMatch(/비어 있습니다/)
  })

  it('renders a table with ticker/score/signal columns for a non-empty pool', () => {
    const dataset = { tickers: Array.from({ length: 6 }, (_, i) => makeTicker({ ticker: `T${i}` })) }
    const table = formatPoolTable(getPool(dataset))
    expect(table).toContain('T0')
    expect(table).toContain('기준 레벨: strict')
  })
})

describe('validateTickers', () => {
  const dataset = {
    tickers: [
      makeTicker({ ticker: 'AAA' }),
      makeTicker({ ticker: 'BAD', dataSufficient: false, insufficientReason: '거래일 부족 (50일 < 최소 110일)' }),
    ],
  }

  it('accepts a ticker present in the universe with sufficient data', () => {
    const [result] = validateTickers(['aaa'], dataset)
    expect(result).toEqual({ ticker: 'AAA', accepted: true, reason: null })
  })

  it('rejects a ticker outside the universe with a reason', () => {
    const [result] = validateTickers(['ZZZZ'], dataset)
    expect(result.accepted).toBe(false)
    expect(result.reason).toMatch(/유니버스에 없는/)
  })

  it('rejects a data-insufficient in-universe ticker with the original reason', () => {
    const [result] = validateTickers(['BAD'], dataset)
    expect(result.accepted).toBe(false)
    expect(result.reason).toMatch(/거래일 부족/)
  })
})

describe('formatValidationTable', () => {
  it('renders 승인/거부 columns', () => {
    const table = formatValidationTable([
      { ticker: 'AAA', accepted: true, reason: null },
      { ticker: 'ZZZZ', accepted: false, reason: '나스닥100 유니버스에 없는 티커' },
    ])
    expect(table).toContain('승인')
    expect(table).toContain('거부')
  })
})
