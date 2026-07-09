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
