// 홈/검색 화면 상세 필터 4종 (PRD §4.1) — 초기 상태는 모두 꺼짐(= 전체 표시)

import { sma } from './indicators.js'
import {
  WEEK52_PROXIMITY_PCT,
  BOLLINGER_LOWER_PROXIMITY_MULT,
  STOCHASTIC_OVERSOLD,
  STOCHASTIC_OVERBOUGHT,
  ATR_PERCENTILE_LOW,
  ATR_PERCENTILE_HIGH,
  OBV_SMA_WINDOW,
} from './constants.js'

export const DEFAULT_FILTER_STATE = {
  disparityMin: null, // 이격도 하한(%), null = 미적용
  volumeTrendMin: null, // 거래량 추세 하한(%), null = 미적용
  leadingSectorOnly: false, // 주도 섹터만
  rsiState: 'off', // 'off' | 'overheated' | 'oversold'
}

export function applyFilters(tickers, filters, query = '') {
  const q = query.trim().toLowerCase()
  return tickers
    .filter((t) => t.dataSufficient)
    .filter((t) => !q || t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .filter((t) => filters.disparityMin == null || t.indicators.disparity >= filters.disparityMin)
    .filter((t) => filters.volumeTrendMin == null || t.indicators.volTrend >= filters.volumeTrendMin)
    .filter((t) => !filters.leadingSectorOnly || t.isLeadingSector)
    .filter((t) => {
      if (filters.rsiState === 'overheated') return t.indicators.rsi14 >= 70
      if (filters.rsiState === 'oversold') return t.indicators.rsi14 <= 30
      return true
    })
}

// --- v7 신규 필터 판정 함수 (PRD_Nasdaq7 §3 Must 1~5, §4.1) ---
// 기존 필터 4종(위)과 달리, 화면1 UI 연결(US-7)은 이후 스토리에서 이루어진다.
// 여기서는 이미 계산된 지표 값을 받아 통과/탈락만 판정하는 순수 함수만 제공한다.

/** 볼린저밴드: 'lowerProximity'(하단 근접, 종가 ≤ 하단밴드×1.02) | 'upperBreakout'(상단 돌파, 종가 ≥ 상단밴드) */
export function passesBollinger(close, bands, option) {
  if (!bands) return false
  if (option === 'lowerProximity') return close <= bands.lower * BOLLINGER_LOWER_PROXIMITY_MULT
  if (option === 'upperBreakout') return close >= bands.upper
  return true
}

/** 52주 신고가/신저가: 'nearHigh'(신고가 대비 −5% 이내) | 'nearLow'(신저가 대비 +5% 이내) */
export function passesWeek52(close, week52, option) {
  if (!week52) return false
  if (option === 'nearHigh') return close >= week52.high * (1 - WEEK52_PROXIMITY_PCT / 100)
  if (option === 'nearLow') return close <= week52.low * (1 + WEEK52_PROXIMITY_PCT / 100)
  return true
}

/** 252거래일 미만이라 week52HighLow()가 null을 반환한(=필터 판정에서 제외된) 종목 수 (UI 안내용) */
export function countWeek52Excluded(week52Results) {
  return week52Results.filter((w) => w == null).length
}

/** 스토캐스틱: 'oversold'(%K ≤ 20, 과매도) | 'overbought'(%K ≥ 80, 과매수) */
export function passesStochastic(stoch, option) {
  if (!stoch || stoch.slowK == null) return false
  if (option === 'oversold') return stoch.slowK <= STOCHASTIC_OVERSOLD
  if (option === 'overbought') return stoch.slowK >= STOCHASTIC_OVERBOUGHT
  return true
}

/** population 내에서 value가 차지하는 백분위(0~100) — (value 이하 개수) / 전체 개수 × 100 */
function percentileRank(value, population) {
  const belowOrEqual = population.filter((v) => v <= value).length
  return (belowOrEqual / population.length) * 100
}

/**
 * ATR% 변동성: 'low'(유니버스 백분위 하위 30%) | 'high'(상위 30%, 즉 백분위 70 이상).
 * universeAtrPercents: 유니버스 dataSufficient 종목 전체의 ATR% 값 배열(모집단) — 절대
 * 임계가 아닌 상대 백분위이므로, 개별 종목이 아니라 풀 단위로 계산한 배열을 함께 넘겨야 한다.
 */
export function passesAtrPercentile(atrPercentValue, universeAtrPercents, option) {
  if (atrPercentValue == null || !universeAtrPercents?.length) return false
  const rank = percentileRank(atrPercentValue, universeAtrPercents)
  if (option === 'low') return rank <= ATR_PERCENTILE_LOW
  if (option === 'high') return rank >= ATR_PERCENTILE_HIGH
  return true
}

/** OBV 거래량 흐름: 'rising'(OBV > OBV의 SMA20, 매집 신호) | 'falling'(OBV < OBV의 SMA20, 분산 신호) */
export function passesObv(obvArray, option) {
  if (!obvArray || obvArray.length < OBV_SMA_WINDOW) return false
  const smaArr = sma(obvArray, OBV_SMA_WINDOW)
  const lastObv = obvArray[obvArray.length - 1]
  const lastSma = smaArr[smaArr.length - 1]
  if (lastSma == null) return false
  if (option === 'rising') return lastObv > lastSma
  if (option === 'falling') return lastObv < lastSma
  return true
}
