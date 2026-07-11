import { describe, it, expect, afterEach, vi } from 'vitest'
import { loadBacktest, findStrategy, findHolding, getConfidenceSummary } from './backtestLoader.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VALID_BACKTEST = JSON.parse(readFileSync(path.resolve(__dirname, '__fixtures__/backtest.valid.json'), 'utf-8'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadBacktest', () => {
  it('returns the parsed backtest on a successful fetch of a valid v1 document, normalized with signalQuality:"all" (v9.1 US-1)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_BACKTEST) })))
    const result = await loadBacktest()
    expect(result.strategies.every((s) => s.signalQuality === 'all')).toBe(true)
    expect(result).toEqual({ ...VALID_BACKTEST, strategies: VALID_BACKTEST.strategies.map((s) => ({ ...s, signalQuality: 'all' })) })
  })

  it('returns a v2 document unmodified (signalQuality already present)', async () => {
    const v2 = { ...VALID_BACKTEST, schemaVersion: 2, strategies: VALID_BACKTEST.strategies.map((s) => ({ ...s, signalQuality: 'all' })) }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(v2) })))
    expect(await loadBacktest()).toEqual(v2)
  })

  it('returns null on a 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })))
    expect(await loadBacktest()).toBeNull()
  })

  it('returns null when the fetched JSON fails schema validation', async () => {
    const broken = { ...VALID_BACKTEST, schemaVersion: 99 }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(broken) })))
    expect(await loadBacktest()).toBeNull()
  })

  it('returns null when fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))))
    expect(await loadBacktest()).toBeNull()
  })

  it('loads normally when freshnessCohorts is absent (v9.1 US-4 승인 기준 4, 구버전 산출물 하위 호환)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_BACKTEST) })))
    const result = await loadBacktest()
    expect(result.freshnessCohorts).toBeUndefined()
  })
})

describe('findStrategy / findHolding', () => {
  it('finds the (key, sample, basis) match', () => {
    const s = findStrategy(VALID_BACKTEST, 'trend', 'out', 'top5')
    expect(s.key).toBe('trend')
  })

  it('returns null when no match exists', () => {
    expect(findStrategy(VALID_BACKTEST, 'trend', 'in', 'allSignals')).toBeNull()
  })

  it('finds the holding-days entry', () => {
    const s = findStrategy(VALID_BACKTEST, 'trend', 'out', 'top5')
    expect(findHolding(s, 20).days).toBe(20)
  })
})

describe('getConfidenceSummary — US-8 승인 기준', () => {
  it('backtest가 없으면 null이다 (graceful degradation)', () => {
    expect(getConfidenceSummary(null, 'trend')).toBeNull()
  })

  it('trend 모드는 strategyKey trend의 out/top5/20거래일 항목을 쓴다', () => {
    const summary = getConfidenceSummary(VALID_BACKTEST, 'trend')
    expect(summary.strategy.key).toBe('trend')
    expect(summary.holding20.days).toBe(20)
    expect(summary.insufficientSample).toBe(false)
  })

  it('consensus 모드는 consensus_2star를 대표값으로 쓴다', () => {
    const summary = getConfidenceSummary(VALID_BACKTEST, 'consensus')
    expect(summary).toBeNull() // 픽스처에 consensus_2star 항목이 없으므로 null이어야 정상
  })

  it('표본이 0인 축은 insufficientSample:true로 표시된다 (NaN 노출 금지)', () => {
    const zeroSample = {
      ...VALID_BACKTEST,
      strategies: [
        {
          key: 'minervini',
          sample: 'out',
          basis: 'top5',
          byHolding: [{ days: 20, signals: 0, winRate: null, avgExcess: null, medianExcess: null, avgReturn: null, mdd: null }],
          relaxedShare: null,
        },
      ],
    }
    const summary = getConfidenceSummary(zeroSample, 'minervini')
    expect(summary.insufficientSample).toBe(true)
    expect(Number.isNaN(summary.holding20.winRate)).toBe(false)
  })

  it('in 전용 픽스처(out 항목 없음)에서는 null을 반환한다 (In-Sample 미표시 보증)', () => {
    const inOnly = {
      ...VALID_BACKTEST,
      strategies: VALID_BACKTEST.strategies.map((s) => ({ ...s, sample: 'in' })),
    }
    expect(getConfidenceSummary(inOnly, 'trend')).toBeNull()
  })
})

describe('getConfidenceSummary — 20·60일 병기 (v9.1 US-5)', () => {
  it('holding60과 effectiveSample60(=signals/overlapFactor[60])을 함께 반환한다', () => {
    const withOverlap = { ...VALID_BACKTEST, config: { ...VALID_BACKTEST.config, overlapFactor: { 5: 1, 20: 4, 60: 12 } } }
    const summary = getConfidenceSummary(withOverlap, 'trend')
    expect(summary.holding60.days).toBe(60)
    expect(summary.effectiveSample60).toBeCloseTo(summary.holding60.signals / 12, 10)
  })

  it('config.overlapFactor가 없으면(v1 하위 호환) effectiveSample60이 null이다 (승인 기준 2)', () => {
    const summary = getConfidenceSummary(VALID_BACKTEST, 'trend')
    expect(summary.effectiveSample60).toBeNull()
  })

  it('60거래일 레코드 자체가 없으면(구버전 픽스처) null 전체 반환 대신 insufficientSample60:true로만 표시한다', () => {
    const no60 = {
      ...VALID_BACKTEST,
      strategies: [{ ...VALID_BACKTEST.strategies[0], byHolding: VALID_BACKTEST.strategies[0].byHolding.filter((h) => h.days !== 60) }],
    }
    const summary = getConfidenceSummary(no60, 'trend')
    expect(summary).not.toBeNull()
    expect(summary.holding20.days).toBe(20) // 20일 표시는 그대로 유지
    expect(summary.insufficientSample60).toBe(true)
    expect(summary.effectiveSample60).toBeNull()
  })
})
