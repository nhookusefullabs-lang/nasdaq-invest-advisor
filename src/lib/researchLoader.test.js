import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadResearch, buildResearchMap } from './researchLoader.js'

const VALID_RESEARCH = {
  schemaVersion: 1,
  researchedAt: '2026-07-11',
  basedOnDataOf: '2026-07-08',
  items: [
    {
      ticker: 'AXON',
      sentiment: 'positive',
      summary: '요약',
      catalysts: [],
      risks: [],
      sources: [{ title: '기사', url: 'https://example.com', date: '2026-07-09' }],
      signalPassed: false,
      origin: 'recommended',
    },
  ],
  skipped: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadResearch', () => {
  it('returns the parsed research on a successful fetch of a valid document', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_RESEARCH) })))
    const result = await loadResearch()
    expect(result).toEqual(VALID_RESEARCH)
  })

  it('returns null on a 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    expect(await loadResearch()).toBeNull()
  })

  it('returns null when the fetched JSON fails schema validation', async () => {
    const broken = { ...VALID_RESEARCH, items: [{ ticker: 'AXON' }] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(broken) })))
    expect(await loadResearch()).toBeNull()
  })

  it('returns null when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    expect(await loadResearch()).toBeNull()
  })
})

describe('buildResearchMap - stale detection', () => {
  const validTickerSet = new Set(['AXON'])

  it('is not stale when basedOnDataOf matches the current dataset generatedAt', () => {
    const map = buildResearchMap(VALID_RESEARCH, '2026-07-08', validTickerSet)
    expect(map.get('AXON').stale).toBe(false)
  })

  it('is stale when basedOnDataOf differs from the current dataset generatedAt', () => {
    const map = buildResearchMap(VALID_RESEARCH, '2026-07-15', validTickerSet)
    expect(map.get('AXON').stale).toBe(true)
  })

  it('returns an empty map when research is null (file missing / load failed)', () => {
    const map = buildResearchMap(null, '2026-07-08', validTickerSet)
    expect(map.size).toBe(0)
  })
})

describe('buildResearchMap - universe filtering', () => {
  it('silently drops items for tickers outside the current universe', () => {
    const map = buildResearchMap(VALID_RESEARCH, '2026-07-08', new Set(['OTHER']))
    expect(map.has('AXON')).toBe(false)
    expect(map.size).toBe(0)
  })
})

describe('buildResearchMap - riskFlags normalization (US-8)', () => {
  const validTickerSet = new Set(['AXON'])

  it('normalizes a v1 item (no riskFlags field) to an empty array', () => {
    const map = buildResearchMap(VALID_RESEARCH, '2026-07-08', validTickerSet)
    expect(map.get('AXON').riskFlags).toEqual([])
  })

  it('preserves a v2 item riskFlags array as-is', () => {
    const v2 = {
      ...VALID_RESEARCH,
      schemaVersion: 2,
      items: [{ ...VALID_RESEARCH.items[0], riskFlags: [{ type: 'litigation', description: '소송 진행 중' }] }],
    }
    const map = buildResearchMap(v2, '2026-07-08', validTickerSet)
    expect(map.get('AXON').riskFlags).toEqual([{ type: 'litigation', description: '소송 진행 중' }])
  })
})
