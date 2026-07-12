import { describe, it, expect } from 'vitest'
import { computePositionPlan } from './positionPlan.js'
import { STOP_PCT } from './constants/entry.js'
import { VERIFICATION_STATUS } from './constants/verification.js'

function seriesFromCloses(closes, { startDate = '2024-01-02', withNoiseForAtr = true } = {}) {
  const start = new Date(`${startDate}T00:00:00Z`)
  return closes.map((close, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    // ATR 계산이 워밍업될 수 있도록 고가/저가에 약간의 폭을 둔다(0이면 TR이 전부 0이 되어
    // atr()가 정상 동작하지만 stopAtr==stopFixed에 가까워 구분이 안 되므로 폭을 둔다).
    const spread = withNoiseForAtr ? close * 0.01 : 0
    return { date: d.toISOString().slice(0, 10), high: close + spread, low: close - spread, close, volume: 1_000_000 }
  })
}

describe('positionPlan.js — R-배수 (PRD_Nasdaq10 US-6 AC1)', () => {
  it('현재 수익 8%, 초기 리스크 8%(STOP_PCT) → R=1.0', () => {
    const series = seriesFromCloses(new Array(20).fill(100).concat([108]))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100 }, series)
    expect(plan.currentReturnPct).toBeCloseTo(8, 6)
    expect(plan.rMultiple).toBeCloseTo(8 / (STOP_PCT * 100), 6)
  })

  it('경계: R 정확히 2.0(수익률 16%)이면 브레이크이븐 알림 발생', () => {
    const series = seriesFromCloses(new Array(20).fill(100).concat([116]))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100 }, series)
    expect(plan.rMultiple).toBeCloseTo(2, 6)
    expect(plan.breakEvenAlert).toBe(true)
  })

  it('경계: R이 2.0보다 살짝 낮으면(수익률 15.9%) 브레이크이븐 알림 없음', () => {
    const series = seriesFromCloses(new Array(20).fill(100).concat([115.9]))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100 }, series)
    expect(plan.breakEvenAlert).toBe(false)
  })
})

describe('positionPlan.js — 이익 보호 알림 (US-6 AC1, 50% 반납 경계)', () => {
  const dates = Array.from({ length: 10 }, (_, i) => {
    const d = new Date('2024-02-01T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  function heldSeries(closesAfterEntry) {
    return closesAfterEntry.map((close, i) => ({ date: dates[i], high: close, low: close, close, volume: 1_000_000 }))
  }

  it('경계: 최고 수익 정확히 +20%, 현재 수익이 그 정확히 절반(+10%)이면 이익 보호 알림 발생', () => {
    const series = heldSeries([100, 110, 120, 115, 110]) // entryPrice=100, peak=120(+20%), 현재=110(+10%)
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100, entryDate: dates[0] }, series)
    expect(plan.profitProtection.peakReturnPct).toBeCloseTo(20, 6)
    expect(plan.profitProtection.alert).toBe(true)
  })

  it('경계: 절반보다 살짝 많이 보존(+10.1%)하면 이익 보호 알림 없음', () => {
    const series = heldSeries([100, 110, 120, 115, 110.1])
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100, entryDate: dates[0] }, series)
    expect(plan.profitProtection.alert).toBe(false)
  })

  it('최고 수익이 +20% 미만이면(예: +19%) 아무리 반납해도 이익 보호 알림 없음', () => {
    const series = heldSeries([100, 110, 119, 105, 100.5])
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100, entryDate: dates[0] }, series)
    expect(plan.profitProtection.peakReturnPct).toBeCloseTo(19, 6)
    expect(plan.profitProtection.alert).toBe(false)
  })
})

describe('positionPlan.js — entryDate 유무 분기 (US-6 AC2)', () => {
  it('entryDate 미제공 시 트레일링·이익 보호는 "체결일 입력 시 제공" 상태', () => {
    const series = seriesFromCloses(new Array(20).fill(100).concat([105]))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100 }, series)
    expect(plan.trailing).toEqual({ available: false, reason: '체결일 입력 시 제공' })
    expect(plan.profitProtection).toEqual({ available: false, reason: '체결일 입력 시 제공' })
  })

  it('entryDate 제공 시 보유 중 최고 종가×0.85 트레일링 참고가와 손절선 중 큰 값이 강조된다', () => {
    const dates = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04']
    const series = dates.map((date, i) => ({ date, high: [100, 130, 130, 125][i], low: [100, 130, 130, 125][i], close: [100, 130, 130, 125][i], volume: 1_000_000 }))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100, entryDate: dates[0] }, series)
    expect(plan.trailing.available).toBe(true)
    expect(plan.trailing.maxClose).toBe(130)
    expect(plan.trailing.trailingRefPrice).toBeCloseTo(130 * 0.85, 6)
    expect(plan.trailing.effectiveStopPrice).toBeCloseTo(Math.max(plan.stopFixed.price, 130 * 0.85), 6)
  })

  it('entryDate가 시리즈 범위 밖(미래)이면 "체결일 이후 데이터 없음" 상태', () => {
    const series = seriesFromCloses(new Array(20).fill(100))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100, entryDate: '2999-01-01' }, series)
    expect(plan.trailing).toEqual({ available: false, reason: '체결일 이후 데이터 없음' })
  })
})

describe('positionPlan.js — 검증 상태 매핑 (US-6 AC3)', () => {
  it('verification.js에 고정 −8% 손절의 열위 상태가 존재한다', () => {
    expect(VERIFICATION_STATUS.stopFixed8pct.status).toBe('열위')
  })

  it('positionPlan 출력의 stopFixed/stopAtr에 검증 상태 코드가 실린다', () => {
    const series = seriesFromCloses(new Array(20).fill(100).concat([105]))
    const plan = computePositionPlan({ ticker: 'X', entryPrice: 100 }, series)
    expect(plan.stopFixed.verification.status).toBe('열위')
    expect(plan.stopAtr.verification.status).toBe('측정중')
  })
})
