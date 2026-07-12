// 시장 국면(market regime) 판정 — 시장 폭(breadth) 기반 3상태 히스테리시스 (PRD_Nasdaq10 §4.2, US-2)
// 순수 함수. 입력은 이미 슬라이스된 유니버스(buildDataset().tickers)를 전제하므로 미래 참조가 없다.

import { sma } from './indicators.js'
import {
  REGIME_UP_ENTER,
  REGIME_UP_EXIT,
  REGIME_DOWN_ENTER,
  REGIME_DOWN_EXIT,
  REGIME_SMA_PERIOD,
} from './constants/regime.js'

/** 유니버스의 거래일 캘린더 = 가장 긴 series (전 종목 대체로 동일 거래일, asOf.mjs의 관례와 동일). */
function calendarDates(tickers) {
  let longest = []
  for (const t of tickers) {
    if (t.series && t.series.length > longest.length) longest = t.series
  }
  return longest.map((bar) => bar.date)
}

/** 티커의 날짜별 {close, sma200} 조회 맵. */
function tickerDateIndex(ticker) {
  const closes = ticker.series.map((b) => b.close)
  const sma200Arr = sma(closes, REGIME_SMA_PERIOD)
  const byDate = new Map()
  ticker.series.forEach((bar, i) => {
    byDate.set(bar.date, { close: closes[i], sma200: sma200Arr[i] })
  })
  return byDate
}

/**
 * dataSufficient 종목 중 close>SMA200 비율의 일자별 시계열: [{date, value}].
 * SMA200 워밍업이 안 된 종목(짧은 데이터)은 그 날짜의 분모에서 제외되고, 대상이 하나도
 * 없으면 value:null.
 */
function breadthTimeSeries(tickers) {
  const sufficient = tickers.filter((t) => t.dataSufficient)
  const calendar = calendarDates(sufficient)
  const perTicker = sufficient.map(tickerDateIndex)

  return calendar.map((date) => {
    let above = 0
    let total = 0
    for (const byDate of perTicker) {
      const point = byDate.get(date)
      if (!point || point.sma200 == null) continue
      total++
      if (point.close > point.sma200) above++
    }
    return { date, value: total === 0 ? null : above / total }
  })
}

/** 현재(최신 거래일) breadth 값. SMA200 워밍업이 유니버스 전체에서 아직 부족하면 null. */
export function breadth(tickers) {
  const series = breadthTimeSeries(tickers)
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].value != null) return series[i].value
  }
  return null
}

function classifyInitial(value) {
  if (value >= REGIME_UP_EXIT) return 'up'
  if (value < REGIME_DOWN_ENTER) return 'down'
  return 'neutral'
}

/**
 * 히스테리시스 상태기계 — breadth 값 시계열에 국면 라벨을 부여한다 (PRD §4.2).
 * dates/values는 동일 길이, values[i]는 breadth 또는 null(계산 불가일).
 * null인 날은 regime:null로 표시되지만 내부 상태(state)는 유지되어, 다음 유효일에
 * 끊김 없이 이어서 판정한다(결측일 하루 때문에 초기 판정으로 되돌아가지 않음).
 * 반환: [{date, breadth, regime, transitionDate}]
 */
export function applyHysteresis(dates, values) {
  const out = []
  let state = null
  let transitionDate = null

  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const date = dates[i]

    if (value == null) {
      out.push({ date, breadth: null, regime: null, transitionDate: null })
      continue
    }

    if (state == null) {
      state = classifyInitial(value)
      transitionDate = date
    } else if (state === 'up' && value < REGIME_UP_EXIT) {
      state = 'neutral'
      transitionDate = date
    } else if (state === 'neutral' && value > REGIME_UP_ENTER) {
      state = 'up'
      transitionDate = date
    } else if (state === 'neutral' && value < REGIME_DOWN_ENTER) {
      state = 'down'
      transitionDate = date
    } else if (state === 'down' && value > REGIME_DOWN_EXIT) {
      state = 'neutral'
      transitionDate = date
    }

    out.push({ date, breadth: value, regime: state, transitionDate })
  }

  return out
}

/** 일자별 국면 시계열: [{date, breadth, regime, transitionDate}] (PRD §4.2 1단 — 국면별 분해용) */
export function regimeSeries(tickers) {
  const bSeries = breadthTimeSeries(tickers)
  return applyHysteresis(
    bSeries.map((b) => b.date),
    bSeries.map((b) => b.value),
  )
}

/** 최신 시점 국면 + breadth 값 + 직전 전환일. 계산 불가하면 전부 null. */
export function currentRegime(tickers) {
  const series = regimeSeries(tickers)
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].breadth != null) return series[i]
  }
  return {
    date: series.length ? series[series.length - 1].date : null,
    breadth: null,
    regime: null,
    transitionDate: null,
  }
}

/**
 * 승인된 채택 1 (v11 US-11, PRD_Nasdaq11 §4.6): 하락 국면(regime==='down')에서는 완화 폴백
 * 신호(relaxationApplied)를 추천 풀에서 제외한다 — v10 backtest의 relax_off_in_downturn
 * 변형 Out 실측(완화 신호 제외 시 +14.7%p)이 근거. recommend()/runMinerviniRecommend()가
 * 공유하는 결과 형태({list, relaxationApplied, ...})에 그대로 적용하는 순수 후처리 —
 * 두 함수의 마지막 단계에서 호출한다(재구현 없음).
 * regime이 'down'이 아니면(null·'up'·'neutral') 완전히 무변경 반환한다 — 승인 기준 1의
 * "상승·중립 국면은 v10과 완전 동일" 요구를 이 한 줄이 보장한다.
 * regimeGated: 실제로 하나 이상의 완화 신호가 걸러졌는지(배너 렌더링 조건, US-11 승인 기준 3).
 */
export function gateRelaxedFallbackInDownturn(result, regime) {
  if (regime !== 'down') return { ...result, regimeGated: false }
  const hasRelaxed = result.list.some((item) => item.relaxationApplied)
  if (!hasRelaxed) return { ...result, regimeGated: false }
  return { ...result, list: result.list.filter((item) => !item.relaxationApplied), regimeGated: true }
}
