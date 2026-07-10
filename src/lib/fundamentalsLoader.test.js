import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadFundamentals, buildFundamentalsMap } from './fundamentalsLoader.js'

const VALID_FUNDAMENTALS = {
  schemaVersion: 1,
  generatedAt: '2026-07-08',
  tickers: [
    {
      ticker: 'AXON',
      epsGrowthQoQ_yoy: 31,
      epsAccelerating: true,
      revenueGrowthQoQ_yoy: 25,
      marginImproving: true,
      roe: 0.22,
      quarters: [],
      missing: [],
    },
  ],
  excluded: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFundamentals', () => {
  it('returns the parsed fundamentals on a successful fetch of a valid document', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_FUNDAMENTALS) })))
    expect(await loadFundamentals()).toEqual(VALID_FUNDAMENTALS)
  })

  it('returns null on a 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    expect(await loadFundamentals()).toBeNull()
  })

  it('returns null when the fetched JSON fails schema validation', async () => {
    const broken = { ...VALID_FUNDAMENTALS, tickers: [{ ticker: 'AXON' }] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(broken) })))
    expect(await loadFundamentals()).toBeNull()
  })

  it('returns null when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    expect(await loadFundamentals()).toBeNull()
  })
})

describe('buildFundamentalsMap', () => {
  it('maps tickers by symbol', () => {
    const map = buildFundamentalsMap(VALID_FUNDAMENTALS, new Set(['AXON']))
    expect(map.get('AXON').roe).toBe(0.22)
  })

  it('returns an empty map when fundamentals is null (file missing / load failed)', () => {
    const map = buildFundamentalsMap(null, new Set(['AXON']))
    expect(map.size).toBe(0)
  })

  it('silently drops items for tickers outside the current universe', () => {
    const map = buildFundamentalsMap(VALID_FUNDAMENTALS, new Set(['OTHER']))
    expect(map.has('AXON')).toBe(false)
    expect(map.size).toBe(0)
  })
})
