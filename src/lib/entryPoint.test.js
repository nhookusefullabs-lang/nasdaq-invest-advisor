import { describe, it, expect } from 'vitest'
import { computePivot, derivedPrices } from './entryPoint.js'
import { PIVOT_LOOKBACK, BUFFER, CHASE_LIMIT, FAR_BAND, STOP_PCT, ATR_STOP_MULT } from './constants/entry.js'

function seriesFromCloses(closes) {
  const start = new Date('2023-01-02T00:00:00Z')
  return closes.map((close, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), high: close, low: close, close, volume: 1_000_000 }
  })
}

/** 90일 평평한 베이스(100) 뒤 90일째(index 90)에 150으로 돌파, 이후 매일 +1씩 완만 상승. */
function breakoutThenGrind(totalDays) {
  const closes = []
  for (let i = 0; i < 90; i++) closes.push(100)
  for (let i = 90; i < totalDays; i++) closes.push(150 + (i - 90))
  return closes
}

describe('entryPoint.js — computePivot (design-entry-point-engine.md §2.1 3규칙)', () => {
  it('데이터 63거래일 미만이면 피벗 산정 불가', () => {
    const series = seriesFromCloses(new Array(PIVOT_LOOKBACK).fill(100))
    const result = computePivot(series)
    expect(result.valid).toBe(false)
    expect(result.pivot).toBeNull()
    expect(result.reason).toContain('산정 불가')
  })

  it('규칙1: 현재가가 선행 고점 이하 → pivot = PH_t (머리 위 저항선)', () => {
    // 68일 평평(100) + 69일째(index68) 110으로 스파이크 + 마지막날(index69) 100으로 복귀
    const closes = new Array(68).fill(100)
    closes.push(110) // index 68
    closes.push(100) // index 69 (오늘)
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe('머리 위 저항선')
    expect(result.pivot).toBe(110)
  })

  it('당일 제외 규칙: 오늘이 사상 최고가여도 PH_t에는 포함되지 않는다', () => {
    const closes = breakoutThenGrind(96) // t=95, closeT=150+5=155, 오늘이 지금까지의 최고가
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    // 오늘 종가(155)가 PH_t에 포함됐다면 PH_t는 155가 되어 closeT<=PH_t(규칙1)가 되지만,
    // 실제로는 PH_t가 그 이전 값(154)이라 closeT(155) > PH_t 분기로 간다.
    expect(result.precedingHigh).toBeLessThan(closes[closes.length - 1])
  })

  it('규칙2: 21거래일 이내 돌파 이벤트 → pivot = 돌파 당시 저항선(PH_B), breakoutIndex 정확', () => {
    const closes = breakoutThenGrind(106) // t=105, 돌파(index90)로부터 15거래일 후
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe('최근 돌파된 저항선')
    expect(result.breakoutIndex).toBe(90)
    expect(result.breakoutDate).toBe(series[90].date)
    expect(result.pivot).toBe(100) // 돌파 당시 저항선(베이스 100) — 현재 PH_t(154+)가 아님
  })

  it('21거래일 경계: 정확히 21거래일 전 돌파는 여전히 유효(규칙2)', () => {
    const closes = breakoutThenGrind(112) // t=111, 111-90=21
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe('최근 돌파된 저항선')
    expect(result.breakoutIndex).toBe(90)
  })

  it('21거래일 경계: 22거래일 전 돌파는 유효 기간 초과(규칙3, 저항선 소멸)', () => {
    const closes = breakoutThenGrind(113) // t=112, 112-90=22
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    expect(result.valid).toBe(false)
    expect(result.pivot).toBeNull()
    expect(result.reason).toContain('저항선 소멸')
  })

  it('규칙3: 돌파 후 장기 상승 지속(40거래일 경과, 교차 이벤트 없음) → 저항선 소멸', () => {
    const closes = breakoutThenGrind(131) // t=130, 130-90=40 > 21
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('저항선 소멸 — 다음 베이스 대기')
  })

  it('돌파 이벤트는 상향 교차일 하루만 기록되고, 지속 상승 구간에서 중복 기록되지 않는다', () => {
    const closes = breakoutThenGrind(106)
    const series = seriesFromCloses(closes)
    const result = computePivot(series)
    // 규칙2가 정확히 하나의 breakoutIndex(90)를 골랐다는 것 자체가 "중복 없음"의 증거 —
    // 만약 index91 이후도 매번 돌파로 잡혔다면 recentBreakouts의 마지막(가장 최근) 값이
    // 90이 아니라 더 큰 인덱스였을 것이다.
    expect(result.breakoutIndex).toBe(90)
  })
})

describe('entryPoint.js — derivedPrices (§3 파생 가격, 매직넘버 없이 상수만 사용)', () => {
  it('pivot이 null이면 파생 가격도 null', () => {
    expect(derivedPrices({ pivot: null, currentClose: 100 })).toBeNull()
  })

  it('트리거/유효상단/원거리경계가 상수 배율대로 pivot에서 산출된다', () => {
    const result = derivedPrices({ pivot: 100, currentClose: 105 })
    expect(result.trigger).toBeCloseTo(100 * (1 + BUFFER), 6)
    expect(result.upper).toBeCloseTo(100 * (1 + CHASE_LIMIT), 6)
    expect(result.farBand).toBeCloseTo(100 * (1 - FAR_BAND), 6)
  })

  it('고정 손절 참고가는 현재 종가 기준 STOP_PCT 비율로 산출된다', () => {
    const result = derivedPrices({ pivot: 100, currentClose: 105 })
    expect(result.stopFixed).toBeCloseTo(105 * (1 - STOP_PCT), 6)
  })

  it('ATR 비례 손절 참고가는 현재 종가 − ATR_STOP_MULT×ATR14로 산출된다', () => {
    const result = derivedPrices({ pivot: 100, currentClose: 105, atr14: 2 })
    expect(result.stopAtr).toBeCloseTo(105 - ATR_STOP_MULT * 2, 6)
  })

  it('atr14 미제공 시 stopAtr은 null(측정 불가)', () => {
    const result = derivedPrices({ pivot: 100, currentClose: 105 })
    expect(result.stopAtr).toBeNull()
  })
})
