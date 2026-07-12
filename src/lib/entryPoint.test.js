import { describe, it, expect } from 'vitest'
import { computePivot, derivedPrices, judgeEntryState } from './entryPoint.js'
import { PIVOT_LOOKBACK, BUFFER, CHASE_LIMIT, FAR_BAND, STOP_PCT, ATR_STOP_MULT } from './constants/entry.js'

function seriesFromCloses(closes, volumes = null) {
  const start = new Date('2023-01-02T00:00:00Z')
  return closes.map((close, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    return {
      date: d.toISOString().slice(0, 10),
      high: close,
      low: close,
      close,
      volume: volumes ? volumes[i] : 1_000_000,
    }
  })
}

/**
 * 90일 평평한 베이스(100) 뒤 90일째(index 90)에 돌파 & 오늘(daysSinceBreakout=0)인 픽스처.
 * U 경계(105) 등 정확한 오늘 종가를 검증할 때 사용 — 플랫 유지 구간이 없어 "돌파 이후 재돌파"
 * 잡음이 생기지 않는다.
 */
function singleDayBreakout(todayClose, volumes = null) {
  const closes = new Array(90).fill(100)
  closes.push(todayClose) // index 90 = 돌파일 = 오늘
  return seriesFromCloses(closes, volumes)
}

/**
 * 90일 평평한 베이스(100) 뒤 90일째에 돌파(breakoutJumpTo)하고, 이후 daysAfterBreakout일
 * 동안 매일 dailyIncrement씩 완만히 계속 상승하는 픽스처. 계속 상승하므로(정체 없음)
 * 돌파 다음날부터는 매일 "전일 종가 > 전일 PH"가 유지되어 재돌파로 오인되지 않는다
 * (§2.1 크로스 조건은 "직전일이 PH 이하"일 때만 성립).
 */
function slowGrindAfterBreakout({ breakoutJumpTo = 101, dailyIncrement = 0.1, daysAfterBreakout = 15, volumes = null }) {
  const closes = new Array(90).fill(100)
  closes.push(breakoutJumpTo) // index 90
  for (let k = 1; k <= daysAfterBreakout; k++) {
    closes.push(breakoutJumpTo + dailyIncrement * k)
  }
  return seriesFromCloses(closes, volumes)
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

describe('entryPoint.js — judgeEntryState 상태 경계 (§5 의사코드, PRD_Nasdaq10 US-4 AC1)', () => {
  it('FAR_BAND 경계(P×0.90) 정확히 그 값이면 상태 1(경계는 미만일 때만 상태0)', () => {
    // 70일 평평(100) → pivot=100(규칙1), closeT를 정확히 90으로 설정
    const closes = new Array(69).fill(100)
    closes.push(90) // 오늘 종가 = P*0.90 정확히
    const series = seriesFromCloses(closes)
    const result = judgeEntryState(series)
    expect(result.state).toBe(1)
  })

  it('FAR_BAND 경계보다 살짝 낮으면(P×0.899) 상태 0', () => {
    const closes = new Array(69).fill(100)
    closes.push(89.9)
    const series = seriesFromCloses(closes)
    const result = judgeEntryState(series)
    expect(result.state).toBe(0)
    expect(result.distancePct).toBeLessThan(0)
  })

  it('오늘 종가가 피벗 P와 정확히 같으면(규칙1 경계) 상태 1', () => {
    const closes = new Array(70).fill(100) // 전부 평평 → PH_t=100=closeT
    const series = seriesFromCloses(closes)
    const result = judgeEntryState(series)
    expect(result.state).toBe(1)
  })

  it('유효상단 U(P×1.05) 정확히 그 값이면 상태 2', () => {
    const series = singleDayBreakout(105) // pivot=100 → U=105
    const result = judgeEntryState(series)
    expect(result.state).toBe(2)
    expect(result.upper).toBeCloseTo(105, 6)
  })

  it('유효상단보다 살짝 높으면(105.01) 상태 3 — "유효 구간(+5%) 초과"', () => {
    const series = singleDayBreakout(105.01)
    const result = judgeEntryState(series)
    expect(result.state).toBe(3)
    expect(result.reason).toContain('유효 구간')
  })

  it('갭업으로 유효상단을 크게 초과하면(오늘 종가 130) 상태 3', () => {
    const series = singleDayBreakout(130)
    const result = judgeEntryState(series)
    expect(result.state).toBe(3)
  })
})

describe('entryPoint.js — judgeEntryState 경과일·earlyBreakout·volumeOK (US-4 AC2)', () => {
  it('daysSinceBreakout이 오늘−돌파일 인덱스 차이로 정확히 계산된다', () => {
    const series = slowGrindAfterBreakout({ daysAfterBreakout: 15 }) // breakoutIndex=90, t=105
    const result = judgeEntryState(series)
    expect(result.state).toBe(2)
    expect(result.daysSinceBreakout).toBe(15)
  })

  it('돌파 당일이 오늘이면(경과 0일) earlyBreakout=true', () => {
    const series = singleDayBreakout(101) // 오늘이 곧 돌파일 (index90 = t)
    const result = judgeEntryState(series)
    expect(result.state).toBe(2)
    expect(result.daysSinceBreakout).toBe(0)
    expect(result.earlyBreakout).toBe(true)
  })

  it('돌파 후 15거래일 경과면 earlyBreakout=false', () => {
    const series = slowGrindAfterBreakout({ daysAfterBreakout: 15 })
    const result = judgeEntryState(series)
    expect(result.earlyBreakout).toBe(false)
  })

  it('돌파일 거래량이 1.5×SMA50(volume) 이상이면 volumeOK=true', () => {
    const volumes = new Array(106).fill(1_000_000)
    volumes[90] = 2_000_000 // 돌파일 거래량 스파이크
    const series = slowGrindAfterBreakout({ daysAfterBreakout: 15, volumes })
    const result = judgeEntryState(series)
    expect(result.state).toBe(2)
    expect(result.volumeOK).toBe(true)
  })

  it('엣지케이스(§8): 무거래량 돌파는 상태 2를 유지하되 volumeOK=false(강등 아님, 경고만)', () => {
    const volumes = new Array(106).fill(1_000_000)
    volumes[90] = 1_200_000 // 1.5배 문턱(약 1,506,000) 미달
    const series = slowGrindAfterBreakout({ daysAfterBreakout: 15, volumes })
    const result = judgeEntryState(series)
    expect(result.state).toBe(2)
    expect(result.volumeOK).toBe(false)
  })
})

describe('entryPoint.js — judgeEntryState 엣지 케이스 (설계서 §8, US-4 AC3)', () => {
  it('엣지케이스(§8-1): 상장 63거래일 미만 → 산정불가', () => {
    const series = seriesFromCloses(new Array(PIVOT_LOOKBACK).fill(100))
    const result = judgeEntryState(series)
    expect(result.state).toBe('산정불가')
  })

  it('엣지케이스(§8-2): 돌파 후 장기 상승 지속(40거래일 경과, 교차 이벤트 없음) → 저항선 소멸(상태3)', () => {
    const closes = new Array(90).fill(100)
    for (let i = 90; i < 131; i++) closes.push(150 + (i - 90))
    const series = seriesFromCloses(closes)
    const result = judgeEntryState(series)
    expect(result.state).toBe(3)
    expect(result.reason).toContain('저항선 소멸')
  })
})
