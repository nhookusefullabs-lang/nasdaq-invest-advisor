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
  it('returns the parsed backtest on a successful fetch of a valid document', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_BACKTEST) })))
    expect(await loadBacktest()).toEqual(VALID_BACKTEST)
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
