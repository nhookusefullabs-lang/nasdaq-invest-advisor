// 청산 신호 계층 1 — 종목 수준 추세 건강 신호 X1~X5 (PRD_Nasdaq10 §4.4, US-5) — 순수 함수.
// "규칙 충족의 기계적 표시"만 한다 — 매수/매도 권유 표현 금지(리서치 배지 원칙과 동일선).

import { sma, ema, goldenCrossWithin, disparity } from './indicators.js'
import { evaluateTrendTemplate } from './minervini.js'
import { findBreakoutEvents } from './entryPoint.js'
import { VOL_MULT } from './constants/entry.js'
import {
  X1_STRONG_VOLUME_MULT,
  X2_RECENCY_DAYS,
  X3_BREAKDOWN_MIN_MISSING,
  X4_RETURN_10D_MIN_PCT,
  X4_SMA50_DISPARITY_MIN_PCT,
  X5_RECENCY_DAYS,
} from './constants/exit.js'

/** X1 — 50일선 이탈: close < SMA50. 거래량 ≥1.5×50일평균이면 "강". */
function checkX1(closes, volumes) {
  const n = closes.length
  const sma50 = sma(closes, 50)[n - 1]
  if (sma50 == null) return null

  const triggered = closes[n - 1] < sma50
  if (!triggered) return { code: 'X1', triggered: false }

  const volSma50 = sma(volumes, 50)[n - 1]
  const strong = volSma50 != null && volumes[n - 1] >= X1_STRONG_VOLUME_MULT * volSma50
  return {
    code: 'X1',
    triggered: true,
    strength: strong ? '강' : '중',
    evidence: `50일선 이탈 (종가 ${closes[n - 1].toFixed(2)} < SMA50 ${sma50.toFixed(2)})${strong ? ' · 거래량 동반' : ''}`,
  }
}

/**
 * X2 — 데드크로스: EMA12가 EMA26을 하향 교차 (최근 5거래일 내).
 * indicators.goldenCrossWithin(macdLine, signalLine, days)는 macdLine이 signalLine을
 * 상향 교차했는지를 본다 — 인자를 (ema26, ema12) 순서로 뒤집어 호출하면 "ema26이 ema12를
 * 상향 교차" = "ema12가 ema26을 하향 교차(데드크로스)"와 동치이므로 재구현 없이 그대로 재사용한다.
 */
function checkX2(closes) {
  const n = closes.length
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  if (ema12[n - 1] == null || ema26[n - 1] == null) return null

  const triggered = goldenCrossWithin(ema26, ema12, X2_RECENCY_DAYS)
  if (!triggered) return { code: 'X2', triggered: false }

  return {
    code: 'X2',
    triggered: true,
    strength: '중',
    evidence: `EMA12가 EMA26을 하향 교차 (최근 ${X2_RECENCY_DAYS}거래일 내)`,
  }
}

/**
 * X3 — 템플릿 붕괴: 트렌드 템플릿 미충족 ≥3개 (T1 또는 T5 포함 시 "강").
 * minervini.js의 evaluateTrendTemplate()을 그대로 호출한다(재구현 금지).
 * rsPercentileValue(T8 판정에 필요)는 유니버스 단위로 미리 계산해 호출부가 전달한다.
 */
function checkX3(series, rsPercentileValue) {
  const template = evaluateTrendTemplate(series, rsPercentileValue)
  if (template.insufficientData) return null

  const missingCount = template.missingConditions.length
  const triggered = missingCount >= X3_BREAKDOWN_MIN_MISSING
  if (!triggered) return { code: 'X3', triggered: false }

  const strong = template.missingConditions.includes('T1') || template.missingConditions.includes('T5')
  return {
    code: 'X3',
    triggered: true,
    strength: strong ? '강' : '중',
    evidence: `트렌드 템플릿 ${missingCount}개 조건 미충족 (${template.missingConditions.join(', ')})`,
  }
}

/** X4 — 클라이맥스 런: 10거래일 수익률 ≥+25% 그리고 SMA50 대비 이격 ≥+25% (정보성 — 강세에 매도 검토). */
function checkX4(closes) {
  const n = closes.length
  if (n < 11) return null

  const sma50 = sma(closes, 50)[n - 1]
  if (sma50 == null) return null

  const return10d = ((closes[n - 1] - closes[n - 11]) / closes[n - 11]) * 100
  const disp = disparity(closes[n - 1], sma50)
  const triggered = return10d >= X4_RETURN_10D_MIN_PCT && disp != null && disp >= X4_SMA50_DISPARITY_MIN_PCT
  if (!triggered) return { code: 'X4', triggered: false }

  return {
    code: 'X4',
    triggered: true,
    strength: '정보',
    evidence: `10거래일 수익률 +${return10d.toFixed(1)}% · SMA50 이격 +${disp.toFixed(1)}% — 단기 급등(클라이맥스 런) 패턴 감지`,
  }
}

/**
 * X5 — 돌파 후 최대 낙폭일: 최근 돌파 이벤트 이후 일별수익률이 가장 낮은 날이 최근
 * X5_RECENCY_DAYS거래일 내 + 그날 거래량이 VOL_MULT×50일평균 이상(거래량 동반).
 * 돌파 이벤트 탐지는 entryPoint.js의 findBreakoutEvents()를 그대로 재사용한다(재구현 금지).
 */
function checkX5(series, closes, volumes) {
  const events = findBreakoutEvents(series)
  if (events.length === 0) return null

  const lastBreakout = events[events.length - 1]
  const t = closes.length - 1
  if (lastBreakout.index >= t) return null // 돌파 당일=오늘 — 낙폭일 판정 대상 없음

  let worstIdx = null
  let worstReturn = Infinity
  for (let d = lastBreakout.index + 1; d <= t; d++) {
    const ret = (closes[d] - closes[d - 1]) / closes[d - 1]
    if (ret < worstReturn) {
      worstReturn = ret
      worstIdx = d
    }
  }
  if (worstIdx == null) return null

  const withinRecency = t - worstIdx <= X5_RECENCY_DAYS - 1 // "최근 5거래일 내" = 오늘 포함 5일(오프셋 0~4)
  const volSma50 = sma(volumes, 50)[worstIdx]
  const volumeConfirmed = volSma50 != null && volumes[worstIdx] >= VOL_MULT * volSma50
  const triggered = withinRecency && volumeConfirmed
  if (!triggered) return { code: 'X5', triggered: false }

  return {
    code: 'X5',
    triggered: true,
    strength: '경고',
    evidence: `돌파 후 최대 낙폭일(${series[worstIdx].date}, ${(worstReturn * 100).toFixed(1)}%)이 최근 ${X5_RECENCY_DAYS}거래일 내 + 거래량 동반`,
  }
}

/**
 * 종목 수준 추세 건강 신호 X1~X5 판정. 반환: { signals, count, allChecks }
 * - signals: triggered:true인 항목만 (코드/강도/근거 문자열)
 * - allChecks: 계산 가능했던 항목 전부(트리거 여부 무관, null은 계산 불가로 제외)
 */
export function evaluateExitSignals(series, { rsPercentileValue = null } = {}) {
  const closes = series.map((b) => b.close)
  const volumes = series.map((b) => b.volume)

  const allChecks = [
    checkX1(closes, volumes),
    checkX2(closes),
    checkX3(series, rsPercentileValue),
    checkX4(closes),
    checkX5(series, closes, volumes),
  ].filter(Boolean)

  const signals = allChecks.filter((c) => c.triggered)

  return { signals, count: signals.length, allChecks }
}
