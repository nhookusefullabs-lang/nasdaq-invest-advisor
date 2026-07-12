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

    expect(loaded.schemaVersion).toBe(4) // v10 US-12가 스키마를 4로 올림(의도된 확장)
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
    // brand-new v3 fields default (US-9) — a v1 record skips straight to v3 defaults
    expect(loaded.recommendMode).toBe('consensus')
    expect(loaded.hideRiskFlagged).toBe(false)
    expect(loaded.showFundamentalFail).toBe(false)
    // brand-new v4 fields default (US-12) — a v1 record skips straight to v4 defaults
    expect(loaded.positions).toEqual({})
    expect(loaded.expandedEntryEvidence).toEqual({})
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

// --- v2 → v3 마이그레이션 (PRD_Nasdaq8 §4.6, US-9) ---

describe('persistence - schema v2 -> v3 migration', () => {
  it('preserves selectedTickers/preset/customParams/researchRequests from a v2 record, fills new v3 fields with defaults', () => {
    const v2Record = {
      schemaVersion: 2,
      currentScreen: 'recommend',
      selectedTickers: ['AAPL', 'MSFT'],
      preset: 'aggressive',
      customParams: { rsiMin: 45, goldenCrossWindow: 10, highScoreThreshold: 75 },
      researchRequests: ['AAPL'],
      // v2 record never had recommendMode/hideRiskFlagged/showFundamentalFail
    }
    localStorage.setItem('nasdaqAdvisor.uiState', JSON.stringify(v2Record))

    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))

    expect(loaded.schemaVersion).toBe(4) // v10 US-12가 스키마를 4로 올림(의도된 확장)
    // existing v2 fields preserved (no data loss)
    expect(loaded.currentScreen).toBe('recommend')
    expect(loaded.selectedTickers).toEqual(['AAPL', 'MSFT'])
    expect(loaded.preset).toBe('aggressive')
    expect(loaded.customParams).toEqual({ rsiMin: 45, goldenCrossWindow: 10, highScoreThreshold: 75 })
    expect(loaded.researchRequests).toEqual(['AAPL'])
    // brand-new v3 fields default
    expect(loaded.recommendMode).toBe('consensus')
    expect(loaded.hideRiskFlagged).toBe(false)
    expect(loaded.showFundamentalFail).toBe(false)
    // brand-new v4 fields default (US-12)
    expect(loaded.positions).toEqual({})
    expect(loaded.expandedEntryEvidence).toEqual({})
  })

  it('resets an out-of-enum recommendMode value to "consensus"', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 3, recommendMode: 'momentum-only' })
    )
    const loaded = loadPersistedState(new Set([]))
    expect(loaded.recommendMode).toBe('consensus')
  })

  it('accepts each valid recommendMode enum value unchanged', () => {
    for (const mode of ['consensus', 'trend', 'minervini']) {
      localStorage.setItem('nasdaqAdvisor.uiState', JSON.stringify({ schemaVersion: 3, recommendMode: mode }))
      expect(loadPersistedState(new Set([])).recommendMode).toBe(mode)
    }
  })

  it('round-trips hideRiskFlagged/showFundamentalFail toggles', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 3, hideRiskFlagged: true, showFundamentalFail: true })
    )
    const loaded = loadPersistedState(new Set([]))
    expect(loaded.hideRiskFlagged).toBe(true)
    expect(loaded.showFundamentalFail).toBe(true)
  })
})

// --- v3 → v4 마이그레이션 (PRD_Nasdaq10 §4.4/US-12) ---

describe('persistence - schema v3 -> v4 migration', () => {
  it('preserves every existing v3 field (v8/v9 필드 포함) and fills new v4 fields with defaults (AC1 무손실 마이그레이션)', () => {
    const v3Record = {
      schemaVersion: 3,
      currentScreen: 'simulation',
      searchQuery: 'app',
      selectedTickers: ['AAPL', 'MSFT'],
      weights: { AAPL: 60, MSFT: 40 },
      filters: { disparityMin: 5, bollingerState: 'on' },
      preset: 'aggressive',
      customParams: { rsiMin: 45, goldenCrossWindow: 10, highScoreThreshold: 75 },
      researchRequests: ['AAPL'],
      recommendMode: 'minervini',
      hideRiskFlagged: true,
      showFundamentalFail: true,
      // v3 레코드에는 positions/expandedEntryEvidence가 아예 없음
    }
    localStorage.setItem('nasdaqAdvisor.uiState', JSON.stringify(v3Record))

    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))

    expect(loaded.schemaVersion).toBe(4)
    // 기존 v3 필드 전부 보존
    expect(loaded.currentScreen).toBe('simulation')
    expect(loaded.searchQuery).toBe('app')
    expect(loaded.selectedTickers).toEqual(['AAPL', 'MSFT'])
    expect(loaded.weights).toEqual({ AAPL: 60, MSFT: 40 })
    expect(loaded.filters.disparityMin).toBe(5)
    expect(loaded.filters.bollingerState).toBe('on')
    expect(loaded.preset).toBe('aggressive')
    expect(loaded.customParams).toEqual({ rsiMin: 45, goldenCrossWindow: 10, highScoreThreshold: 75 })
    expect(loaded.researchRequests).toEqual(['AAPL'])
    expect(loaded.recommendMode).toBe('minervini')
    expect(loaded.hideRiskFlagged).toBe(true)
    expect(loaded.showFundamentalFail).toBe(true)
    // 신규 v4 필드는 기본값
    expect(loaded.positions).toEqual({})
    expect(loaded.expandedEntryEvidence).toEqual({})
  })

  it('round-trips a valid position(entryPrice + entryDate)', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 4, positions: { AAPL: { entryPrice: 150.5, entryDate: '2026-01-05' } } })
    )
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded.positions).toEqual({ AAPL: { entryPrice: 150.5, entryDate: '2026-01-05' } })
  })

  it('drops a position for a ticker no longer present in the current universe (AC2 사라진 티커 제거)', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({ schemaVersion: 4, positions: { AAPL: { entryPrice: 100 }, DELISTED: { entryPrice: 50 } } })
    )
    const loaded = loadPersistedState(new Set(['AAPL']))
    expect(loaded.positions).toEqual({ AAPL: { entryPrice: 100 } })
  })

  it('discards a whole position entry when entryPrice is invalid (0/negative/non-number) — AC2 무효 position 정리', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({
        schemaVersion: 4,
        positions: {
          ZERO: { entryPrice: 0 },
          NEG: { entryPrice: -10 },
          NOTNUM: { entryPrice: '150' },
          OK: { entryPrice: 100 },
        },
      })
    )
    const loaded = loadPersistedState(new Set(['ZERO', 'NEG', 'NOTNUM', 'OK']))
    expect(loaded.positions).toEqual({ OK: { entryPrice: 100 } })
  })

  it('keeps a position without entryDate, and drops a malformed entryDate while keeping entryPrice', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({
        schemaVersion: 4,
        positions: { AAPL: { entryPrice: 100 }, MSFT: { entryPrice: 200, entryDate: 12345 } },
      })
    )
    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))
    expect(loaded.positions.AAPL).toEqual({ entryPrice: 100 })
    expect(loaded.positions.MSFT).toEqual({ entryPrice: 200 })
  })

  it('round-trips expandedEntryEvidence and drops delisted-ticker/non-boolean entries', () => {
    localStorage.setItem(
      'nasdaqAdvisor.uiState',
      JSON.stringify({
        schemaVersion: 4,
        expandedEntryEvidence: { AAPL: true, DELISTED: true, MSFT: 'yes' },
      })
    )
    const loaded = loadPersistedState(new Set(['AAPL', 'MSFT']))
    expect(loaded.expandedEntryEvidence).toEqual({ AAPL: true })
  })

  it('전체 스토리지 회귀: v4 필드가 없는 기존 저장분도 기본값으로 정상 로드된다 (AC3)', () => {
    const state = loadPersistedState(new Set(['AAPL']))
    expect(state.positions).toEqual({})
    expect(state.expandedEntryEvidence).toEqual({})
  })
})
