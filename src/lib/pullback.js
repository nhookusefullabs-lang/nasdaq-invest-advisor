// 눌림목("건강한 눌림") 판정 — 관찰 조건 P1~P4 + 파생 가격 (PRD_Nasdaq11 §4.2, US-5) — 순수 함수.
// 트렌드 템플릿(P1)과 피벗(P2 거리 기준)은 기존 lib을 그대로 호출한다(재구현 금지) — 이 파일이
// 새로 판정하는 것은 P3(SMA200 위)·P4(눌림 구간 거래량 고갈)와 파생 가격(눌림 저점/재개
// 트리거가/구조 손절 참고가)뿐이다.

import { sma } from './indicators.js'
import { evaluateTrendTemplate } from './minervini.js'
import { computePivot } from './entryPoint.js'
import { PIVOT_LOOKBACK } from './constants/entry.js'
import {
  PULLBACK_DEPTH_MIN_PCT,
  PULLBACK_DEPTH_MAX_PCT,
  PULLBACK_P3_SMA_PERIOD,
  PULLBACK_TRIGGER_WINDOW_DAYS,
  PULLBACK_OBSERVATION_VALID_DAYS,
  PULLBACK_STOP_MULT,
} from './constants/pullback.js'

const average = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length

/**
 * 피벗 형성일(peakIndex) 산정 — computePivot()의 피벗 값(phT = 직전 PIVOT_LOOKBACK일 내
 * 최고 종가)이 실제로 어느 날 찍혔는지를 같은 창에서 역산한다(값 자체는 재계산하지
 * 않고 재사용 — entryPoint.js가 준 pivot 값과 일치하는 날을 찾을 뿐).
 */
function findPeakIndex(closes, t) {
  let peakIndex = t - PIVOT_LOOKBACK
  let maxVal = closes[peakIndex]
  for (let i = peakIndex; i < t; i++) {
    if (closes[i] > maxVal) {
      maxVal = closes[i]
      peakIndex = i
    }
  }
  return peakIndex
}

/**
 * 관찰 조건 P1~P4 판정 + 파생 가격. 반환:
 * { observed, insufficientData, checks:{P1,P2,P3,P4}, missingConditions, pivot, distancePct,
 *   depthPct, peakDate, pullbackLow, triggerPrice, stopReference, observationValidDays }
 * insufficientData=true면 나머지 필드는 계산되지 않는다(피벗 산정 자체가 불가한 경우).
 */
export function judgePullback(series, { rsPercentileValue = null } = {}) {
  const n = series.length
  if (n < PIVOT_LOOKBACK + 1) {
    return { observed: false, insufficientData: true, reason: '피벗 산정 불가 (데이터 부족)' }
  }

  const pivotResult = computePivot(series)
  if (!pivotResult.valid) {
    return { observed: false, insufficientData: true, reason: pivotResult.reason }
  }

  const closes = series.map((b) => b.close)
  const volumes = series.map((b) => b.volume)
  const t = n - 1
  const closeT = closes[t]
  const { pivot } = pivotResult

  // P2 — 피벗 대비 −10%~−25% (entryPoint.js의 피벗을 그대로 재사용, 거리 계산만 이 파일 담당)
  const distancePct = ((closeT - pivot) / pivot) * 100
  const depthPct = -distancePct
  const P2 = depthPct >= PULLBACK_DEPTH_MIN_PCT && depthPct <= PULLBACK_DEPTH_MAX_PCT

  // P1 — 트렌드 템플릿 (minervini.js 재사용, 재구현 금지)
  const template = evaluateTrendTemplate(series, rsPercentileValue)
  const P1 = template.allPassed

  // P3 — 현재가 > SMA200 (기본형. SMA50 엄격형은 constants에 예비만 — 미적용)
  const sma200 = sma(closes, PULLBACK_P3_SMA_PERIOD)[t]
  const P3 = sma200 != null && closeT > sma200

  // P4 — 눌림 구간(피벗 형성일 이후) 평균 거래량 < 직전 상승 구간(피벗 형성일 이전 동일 길이) 평균
  const peakIndex = findPeakIndex(closes, t)
  const pullbackLength = t - peakIndex
  const rallyStart = peakIndex - pullbackLength
  let P4 = false
  if (rallyStart >= 0) {
    const pullbackAvgVol = average(volumes.slice(peakIndex + 1, t + 1))
    const rallyAvgVol = average(volumes.slice(rallyStart, peakIndex))
    P4 = pullbackAvgVol < rallyAvgVol
  }

  const checks = { P1, P2, P3, P4 }
  const missingConditions = Object.keys(checks).filter((k) => !checks[k])
  const observed = P1 && P2 && P3 && P4

  // 파생 가격 — 눌림 저점(피벗 형성일 이후 최저 종가), 재개 트리거가(직전 N거래일 최고 종가,
  // 오늘 포함), 구조 손절 참고가(눌림 저점 × 계수)
  const pullbackLow = Math.min(...closes.slice(peakIndex + 1, t + 1))
  const triggerWindowStart = Math.max(0, t - PULLBACK_TRIGGER_WINDOW_DAYS + 1)
  const triggerPrice = Math.max(...closes.slice(triggerWindowStart, t + 1))
  const stopReference = pullbackLow * PULLBACK_STOP_MULT

  return {
    observed,
    insufficientData: false,
    checks,
    missingConditions,
    pivot,
    distancePct,
    depthPct,
    peakDate: series[peakIndex].date,
    pullbackLow,
    triggerPrice,
    stopReference,
    observationValidDays: PULLBACK_OBSERVATION_VALID_DAYS,
  }
}
