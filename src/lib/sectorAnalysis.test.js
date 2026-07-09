import { describe, it, expect } from 'vitest'
import { computeLeadingSectors, applyLeadingSectorFlags } from './sectorAnalysis.js'

function t(ticker, sector, returnPct, dataSufficient = true) {
  return { ticker, sector, dataSufficient, simulation: { returnPct } }
}

describe('computeLeadingSectors', () => {
  it('excludes single-constituent sectors from leading sector ranking', () => {
    const tickers = [
      t('A', 'Tech', 10),
      t('B', 'Tech', 20),
      t('C', 'Solo', 999), // 1종목 섹터 → 제외되어야 함
      t('D', 'Health', 5),
      t('E', 'Health', 7),
    ]
    const { sectorReturns, leadingSectors } = computeLeadingSectors(tickers)
    expect(sectorReturns.find((s) => s.sector === 'Solo')).toBeUndefined()
    expect(leadingSectors.has('Solo')).toBe(false)
  })

  it('ranks sectors by equal-weighted average return, top 3', () => {
    const tickers = [
      t('A1', 'S1', 30), t('A2', 'S1', 30), // avg 30
      t('B1', 'S2', 20), t('B2', 'S2', 20), // avg 20
      t('C1', 'S3', 10), t('C2', 'S3', 10), // avg 10
      t('D1', 'S4', 0), t('D2', 'S4', 0),   // avg 0
    ]
    const { leadingSectors } = computeLeadingSectors(tickers)
    expect([...leadingSectors]).toEqual(['S1', 'S2', 'S3'])
  })

  it('excludes data-insufficient tickers from sector average', () => {
    const tickers = [
      t('A', 'Tech', 10),
      t('B', 'Tech', 1000, false), // 데이터 부족 → 평균에서 제외되어야
    ]
    const { sectorReturns } = computeLeadingSectors(tickers)
    // Tech now has only 1 sufficient constituent → excluded as single-constituent sector
    expect(sectorReturns.find((s) => s.sector === 'Tech')).toBeUndefined()
  })
})

describe('applyLeadingSectorFlags', () => {
  it('flags tickers belonging to leading sectors', () => {
    const tickers = [t('A', 'Tech', 10), t('B', 'Other', 5)]
    const flagged = applyLeadingSectorFlags(tickers, new Set(['Tech']))
    expect(flagged.find((x) => x.ticker === 'A').isLeadingSector).toBe(true)
    expect(flagged.find((x) => x.ticker === 'B').isLeadingSector).toBe(false)
  })
})
