import { DEFAULT_FILTER_STATE } from './filters.js'
import { CUSTOM_PARAM_RANGES } from './constants.js'

// 선택 상태 유지 (PRD §4.5, v7 §3 Must-10): localStorage에 스키마 버전 키와 함께 저장.
// 데이터 재수집으로 사라진 티커는 복원 시 조용히 제거하고, 버전 불일치 시에도 앱이 깨지지 않게 기본값으로 시작한다.
// v1→v2(PRD_Nasdaq7, US-6): 신규 필터 상태·프리셋·고급설정·리서치 요청 목록 필드 추가.
// v2→v3(PRD_Nasdaq8, US-9): 추천 모드·리스크/펀더멘털 토글 필드 추가. v1→v2와 동일한
// 원칙 — 기존 필드는 전부 보존, 신규 필드만 기본값으로 채운다(완전 초기화 아님).
// v1 데이터도 v3까지 한 번에 마이그레이션 가능(v2 전용 필드가 없어도 동일한 병합 로직이
// 안전하게 기본값을 채워 넣으므로 별도의 v1→v2→v3 단계 분리가 필요 없음).

const STORAGE_KEY = 'nasdaqAdvisor.uiState'
const SCHEMA_VERSION = 3
const MIGRATABLE_FROM_VERSIONS = [1, 2]
const RECOMMEND_MODE_VALUES = ['consensus', 'trend', 'minervini']

const DEFAULT_CUSTOM_PARAMS = { rsiMin: 50, goldenCrossWindow: 5, highScoreThreshold: 70 }

export const DEFAULT_UI_STATE = {
  schemaVersion: SCHEMA_VERSION,
  currentScreen: 'home',
  searchQuery: '',
  filters: DEFAULT_FILTER_STATE,
  selectedTickers: [],
  weights: {}, // 티커별 상대 가중치 (포트폴리오 화면에서 수동 입력, 정규화 전 원값)
  preset: 'default', // 'conservative' | 'default' | 'aggressive' | 'custom' (US-8/US-9)
  customParams: DEFAULT_CUSTOM_PARAMS, // 고급 설정 파라미터 (US-10)
  researchRequests: [], // 리서치 요청 목록 티커 배열, v6 연계 (US-11)
  recommendMode: 'consensus', // 'consensus' | 'trend' | 'minervini' (PRD_Nasdaq8 US-9)
  hideRiskFlagged: false, // 리서치 리스크 플래그 종목 숨기기 토글 (PRD_Nasdaq8 US-9)
  showFundamentalFail: false, // 펀더멘털 허들 Fail 종목 표시 토글 (PRD_Nasdaq8 US-9)
}

/** 허용 범위를 벗어난 파라미터만 개별적으로 기본형 값으로 되돌린다 (전체 리셋이 아님). */
function clampCustomParams(customParams) {
  const result = { ...DEFAULT_CUSTOM_PARAMS }
  if (!customParams || typeof customParams !== 'object') return result
  for (const [key, { min, max }] of Object.entries(CUSTOM_PARAM_RANGES)) {
    const v = customParams[key]
    if (typeof v === 'number' && v >= min && v <= max) {
      result[key] = v
    }
  }
  return result
}

function sanitizeTickerArray(arr, validTickerSet) {
  return Array.isArray(arr) ? arr.filter((t) => validTickerSet.has(t)) : []
}

/** validTickerSet: Set<string> — 현재 로드된 데이터의 티커 집합 */
export function loadPersistedState(validTickerSet) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_UI_STATE }

    const parsed = JSON.parse(raw)
    if (parsed.schemaVersion !== SCHEMA_VERSION && !MIGRATABLE_FROM_VERSIONS.includes(parsed.schemaVersion)) {
      return { ...DEFAULT_UI_STATE }
    }

    const weights =
      parsed.weights && typeof parsed.weights === 'object'
        ? Object.fromEntries(Object.entries(parsed.weights).filter(([t]) => validTickerSet.has(t)))
        : {}

    return {
      ...DEFAULT_UI_STATE,
      ...parsed,
      schemaVersion: SCHEMA_VERSION,
      // v1 저장분은 신규 필터 5종 필드가 아예 없으므로, DEFAULT_FILTER_STATE와 병합하면
      // 기존 4종은 보존되고 신규 5종은 자연히 기본값('off')으로 채워진다.
      filters: { ...DEFAULT_FILTER_STATE, ...(parsed.filters ?? {}) },
      selectedTickers: sanitizeTickerArray(parsed.selectedTickers, validTickerSet),
      weights,
      preset: typeof parsed.preset === 'string' ? parsed.preset : DEFAULT_UI_STATE.preset,
      customParams: clampCustomParams(parsed.customParams),
      researchRequests: sanitizeTickerArray(parsed.researchRequests, validTickerSet),
      recommendMode: RECOMMEND_MODE_VALUES.includes(parsed.recommendMode)
        ? parsed.recommendMode
        : DEFAULT_UI_STATE.recommendMode,
      hideRiskFlagged: typeof parsed.hideRiskFlagged === 'boolean' ? parsed.hideRiskFlagged : DEFAULT_UI_STATE.hideRiskFlagged,
      showFundamentalFail:
        typeof parsed.showFundamentalFail === 'boolean' ? parsed.showFundamentalFail : DEFAULT_UI_STATE.showFundamentalFail,
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
