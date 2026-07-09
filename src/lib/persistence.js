import { DEFAULT_FILTER_STATE } from './filters.js'

// 선택 상태 유지 (PRD §4.5): localStorage에 스키마 버전 키와 함께 저장.
// 데이터 재수집으로 사라진 티커는 복원 시 조용히 제거하고, 버전 불일치 시에도 앱이 깨지지 않게 기본값으로 시작한다.

const STORAGE_KEY = 'nasdaqAdvisor.uiState'
const SCHEMA_VERSION = 1

export const DEFAULT_UI_STATE = {
  schemaVersion: SCHEMA_VERSION,
  currentScreen: 'home',
  searchQuery: '',
  filters: DEFAULT_FILTER_STATE,
  selectedTickers: [],
  weights: {}, // 티커별 상대 가중치 (포트폴리오 화면에서 수동 입력, 정규화 전 원값)
}

/** validTickerSet: Set<string> — 현재 로드된 데이터의 티커 집합 */
export function loadPersistedState(validTickerSet) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_UI_STATE }

    const parsed = JSON.parse(raw)
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return { ...DEFAULT_UI_STATE }
    }

    const selectedTickers = Array.isArray(parsed.selectedTickers)
      ? parsed.selectedTickers.filter((t) => validTickerSet.has(t))
      : []

    const weights =
      parsed.weights && typeof parsed.weights === 'object'
        ? Object.fromEntries(Object.entries(parsed.weights).filter(([t]) => validTickerSet.has(t)))
        : {}

    return {
      ...DEFAULT_UI_STATE,
      ...parsed,
      filters: { ...DEFAULT_FILTER_STATE, ...(parsed.filters ?? {}) },
      selectedTickers,
      weights,
    }
  } catch {
    return { ...DEFAULT_UI_STATE }
  }
}

export function savePersistedState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }))
  } catch {
    // localStorage 사용 불가(프라이빗 모드 등) — 저장만 건너뛰고 앱은 정상 동작
  }
}
