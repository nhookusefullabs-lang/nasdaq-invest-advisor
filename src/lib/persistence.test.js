import { describe, it, expect, beforeEach } from 'vitest'
import { loadPersistedState, savePersistedState, DEFAULT_UI_STATE } from './persistence.js'

// jsdom/localStorage 의존 없이 간단한 인메모리 mock 사용
function makeMemoryStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  globalThis.localStorage = makeMemoryStorage()
})

describe('persistence', () => {
  it('returns defaults when nothing stored', () => {
    const state = loadPersistedState(new Set(['AAPL']))
    expect(state).toEqual(DEFAULT_UI_STATE)
  })

  it('round-trips saved state', () => {
    const toSave = {
      ...DEFAULT_UI_STATE,
      currentScreen: 'recommend',
      selectedTickers: ['AAPL', 'MSFT'],
    }
    savePersistedState(toSave)
    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))
    expect(loaded.currentScreen).toBe('recommend')
    expect(loaded.selectedTickers).toEqual(['AAPL', 'MSFT'])
  })

  it('silently drops tickers no longer present in current data', () => {
    savePersistedState({ ...DEFAULT_UI_STATE, selectedTickers: ['AAPL', 'DELISTED'] })
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded.selectedTickers).toEqual(['AAPL'])
  })

  it('falls back to defaults on schema version mismatch', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 999, currentScreen: 'portfolio', selectedTickers: ['AAPL'] })
    )
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded).toEqual(DEFAULT_UI_STATE)
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('nasdaqAdvisor.uiState', '{not valid json')
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded).toEqual(DEFAULT_UI_STATE)
  })
})

// --- v1 → v2 마이그레이션 (PRD_Nasdaq7 §3 Must-10, US-6) ---

describe('persistence - schema v1 -> v2 migration', () => {
  it('preserves selectedTickers/weights/existing filters from a v1 record, fills new v2 fields with defaults', () => {
    const v1Record = {
      schemaVersion: 1,
      currentScreen: 'portfolio',
      searchQuery: 'app',
      selectedTickers: ['AAPL', 'MSFT'],
      weights: { AAPL: 60, MSFT: 40 },
      filters: { disparityMin: 5, volumeTrendMin: null, leadingSectorOnly: true, rsiState: 'oversold' },
      // v1 record never had preset/customParams/researchRequests or the 5 new filter fields
    }
    localStorage.setItem('nasdaqAdvisor.uiState', JSON.stringify(v1Record))

    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))

    expect(loaded.schemaVersion).toBe(2)
    expect(loaded.currentScreen).toBe('portfolio')
    expect(loaded.searchQuery).toBe('app')
    expect(loaded.selectedTickers).toEqual(['AAPL', 'MSFT'])
    expect(loaded.weights).toEqual({ AAPL: 60, MSFT: 40 })
    // existing filter fields preserved
    expect(loaded.filters.disparityMin).toBe(5)
    expect(loaded.filters.leadingSectorOnly).toBe(true)
    expect(loaded.filters.rsiState).toBe('oversold')
    // new v7 filter fields default to 'off'
    expect(loaded.filters.bollingerState).toBe('off')
    expect(loaded.filters.week52State).toBe('off')
    expect(loaded.filters.stochasticState).toBe('off')
    expect(loaded.filters.atrState).toBe('off')
    expect(loaded.filters.obvState).toBe('off')
    // brand-new v2 fields default
    expect(loaded.preset).toBe('default')
    expect(loaded.customParams).toEqual({ rsiMin: 50, goldenCrossWindow: 5, highScoreThreshold: 70 })
    expect(loaded.researchRequests).toEqual([])
  })

  it('resets only the out-of-range customParams field, preserving in-range values (not a full reset)', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({
        schemaVersion: 2,
        preset: 'custom',
        customParams: { rsiMin: 999, goldenCrossWindow: 10, highScoreThreshold: 80 }, // rsiMin out of [30,70]
      })
    )
    const loaded = loadPersistedState(new Set([]))
    expect(loaded.customParams.rsiMin).toBe(50) // reset to default
    expect(loaded.customParams.goldenCrossWindow).toBe(10) // preserved (in range)
    expect(loaded.customParams.highScoreThreshold).toBe(80) // preserved (in range)
  })

  it('drops researchRequests tickers no longer present in the current universe', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 2, researchRequests: ['AAPL', 'DELISTED'] })
    )
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded.researchRequests).toEqual(['AAPL'])
  })

  it('defaults every new v7 filter field to off with no stored data (regression baseline)', () => {
    const state = loadPersistedState(new Set(['AAPL']))
    expect(state.filters.bollingerState).toBe('off')
    expect(state.filters.week52State).toBe('off')
    expect(state.filters.stochasticState).toBe('off')
    expect(state.filters.atrState).toBe('off')
    expect(state.filters.obvState).toBe('off')
  })
})
