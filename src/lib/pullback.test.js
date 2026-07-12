import { describe, it, expect } from 'vitest'
import { judgePullback } from './pullback.js'
import { evaluateTrendTemplate } from './minervini.js'
import { computePivot } from './entryPoint.js'
import { PIVOT_LOOKBACK } from './constants/entry.js'
import {
  PULLBACK_DEPTH_MIN_PCT,
  PULLBACK_DEPTH_MAX_PCT,
  PULLBACK_OBSERVATION_VALID_DAYS,
  PULLBACK_STOP_MULT,
} from './constants/pullback.js'

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
 * 68일 평평(100) + 69일째(index68) 200으로 스파이크(피벗) + 마지막날(index69, 오늘)이
 * depthPct만큼 피벗 대비 하락한 픽스처. peakIndex=68(단일 최고점)이라 눌림/직전 구간이
 * 각각 1일(index69 / index67)로 단순해져 P2·P4 개별 경계를 손쉽게 통제할 수 있다.
 */
function singleDayPullback(depthPct, volumes = null) {
  const closes = new Array(70).fill(100)
  closes[68] = 200
  closes[69] = 200 * (1 - depthPct / 100)
  return seriesFromCloses(closes, volumes)
}

describe('judgePullback — 데이터 부족', () => {
  it(`${PIVOT_LOOKBACK}거래일 미만이면 insufficientData:true`, () => {
    const series = seriesFromCloses(new Array(PIVOT_LOOKBACK).fill(100))
    const result = judgePullback(series)
    expect(result.insufficientData).toBe(true)
    expect(result.observed).toBe(false)
  })
})

describe('judgePullback — P2 경계 (피벗 대비 −10%~−25%, AC1)', () => {
  it('정확히 −10%(하한)는 P2를 충족한다', () => {
    expect(judgePullback(singleDayPullback(10)).checks.P2).toBe(true)
  })

  it('−10%에 미달(−9.99%)이면 P2 미충족', () => {
    expect(judgePullback(singleDayPullback(9.99)).checks.P2).toBe(false)
  })

  it('정확히 −25%(상한)는 P2를 충족한다', () => {
    expect(judgePullback(singleDayPullback(25)).checks.P2).toBe(true)
  })

  it('−25%를 초과(−25.01%)하면 P2 미충족(붕괴로 간주)', () => {
    expect(judgePullback(singleDayPullback(25.01)).checks.P2).toBe(false)
  })
})

describe('judgePullback — P3 경계 (현재가 > SMA200, AC1)', () => {
  // 200일 시리즈: index136에 스파이크(300, 피벗 겸 트레일링63일 창에 포함), 나머지 100.
  // SMA200(index199 기준) = (198*100 + 300 + closeT)/200 이므로, closeT가 "다른 199일의
  // 평균"과 정확히 같아지는 지점이 곧 SMA200과 같아지는 경계다(평균의 자기회귀 성질).
  function p3Fixture(closeT) {
    const closes = new Array(200).fill(100)
    closes[136] = 300
    closes[199] = closeT
    return seriesFromCloses(closes)
  }
  const boundary = (198 * 100 + 300) / 199

  it('SMA200 바로 위면 P3 충족', () => {
    const result = judgePullback(p3Fixture(boundary + 0.01))
    expect(result.insufficientData).toBe(false)
    expect(result.checks.P3).toBe(true)
  })

  it('SMA200 바로 아래면 P3 미충족', () => {
    const result = judgePullback(p3Fixture(boundary - 0.01))
    expect(result.checks.P3).toBe(false)
  })
})

describe('judgePullback — P4 경계 (눌림 구간 vs 직전 상승 구간 거래량, AC1)', () => {
  it('눌림일 거래량 < 직전 상승일 거래량이면 P4 충족(고갈)', () => {
    const volumes = new Array(70).fill(1_000_000)
    volumes[69] = 500_000 // 눌림 구간(오늘 하루)
    volumes[67] = 1_500_000 // 직전 상승 구간(피벗 전날 하루)
    const result = judgePullback(singleDayPullback(15, volumes))
    expect(result.checks.P4).toBe(true)
  })

  it('눌림일 거래량 > 직전 상승일 거래량이면 P4 미충족', () => {
    const volumes = new Array(70).fill(1_000_000)
    volumes[69] = 1_500_000
    volumes[67] = 500_000
    const result = judgePullback(singleDayPullback(15, volumes))
    expect(result.checks.P4).toBe(false)
  })

  it('두 구간 거래량이 정확히 같으면 P4 미충족(엄격한 미만 비교, 대칭 경계)', () => {
    const volumes = new Array(70).fill(1_000_000)
    volumes[69] = 900_000
    volumes[67] = 900_000
    const result = judgePullback(singleDayPullback(15, volumes))
    expect(result.checks.P4).toBe(false)
  })

  it('직전 상승 구간(동일 길이)을 확보할 과거 데이터가 없으면 P4 미충족(비교 불가)', () => {
    // 스파이크가 시리즈 시작 근처(index5)라 눌림 구간 길이(58일)만큼의 "직전" 구간이
    // 존재하지 않는다(rallyStart<0) — 창 길이 대칭성 위반 상황을 안전하게 false 처리.
    const closes = [100, 100, 100, 100, 100, 200] // index0..5
    for (let i = 6; i < 64; i++) closes.push(200 - (i - 5) * 0.5) // index6..63, 완만한 하락
    const result = judgePullback(seriesFromCloses(closes))
    expect(result.insufficientData).toBe(false)
    expect(result.checks.P4).toBe(false)
  })
})

describe('judgePullback — AC2: 피벗·트렌드 템플릿은 기존 lib 재사용(재구현 없음)', () => {
  it('checks.P1은 evaluateTrendTemplate().allPassed와, pivot은 computePivot().pivot과 정확히 일치한다', () => {
    const series = singleDayPullback(15)
    const rsPercentileValue = 80
    const result = judgePullback(series, { rsPercentileValue })
    expect(result.checks.P1).toBe(evaluateTrendTemplate(series, rsPercentileValue).allPassed)
    expect(result.pivot).toBe(computePivot(series).pivot)
  })
})

describe('judgePullback — 파생 가격 손계산 (AC3)', () => {
  // 60일 평평(100) + index60 피벗(200) + index61~75(15일) 눌림 구간: [190,180,170,160,150,
  // 140,135,142,148,150,146,150,153,151,150]. 최저점은 index67=135(마지막날 종가가 아님을
  // 확인 — 창 전체 최저를 잡는지 검증), 직전10거래일(index66~75) 최고는 index73=153.
  const decline = [190, 180, 170, 160, 150, 140, 135, 142, 148, 150, 146, 150, 153, 151, 150]
  const closes = [...new Array(60).fill(100), 200, ...decline]
  const series = seriesFromCloses(closes)
  const result = judgePullback(series)

  it('눌림 저점 = 피벗 이후 구간 전체 최저 종가(135, 마지막날 종가와 다름)', () => {
    expect(result.pullbackLow).toBe(135)
  })

  it('재개 트리거가 = 직전 10거래일(오늘 포함) 최고 종가(153)', () => {
    expect(result.triggerPrice).toBe(153)
  })

  it(`구조 손절 참고가 = 눌림 저점 × ${PULLBACK_STOP_MULT}`, () => {
    expect(result.stopReference).toBeCloseTo(135 * PULLBACK_STOP_MULT, 6)
  })

  it('peakDate는 피벗이 형성된 날짜(index60)와 일치한다', () => {
    expect(result.peakDate).toBe(series[60].date)
  })
})

describe('judgePullback — 관찰 조건 통합 (P1~P4 전부 충족 → observed:true)', () => {
  // 낮은 베이스(50→57.45, 150일) 이후 급격한 상승(57.45→400, 110일)으로 장기 이평을 낮게
  // 유지한 채 신고가를 찍고, 최근 5거래일 동안 −15% 조정(depth 15%, P2 범위 내) — 실제
  // "긴 상승 후 얕은 눌림" 형태를 만들어 트렌드 템플릿(P1)까지 함께 통과시킨다.
  function build() {
    const closes = []
    for (let i = 0; i < 150; i++) closes.push(50 + 0.05 * i)
    const afterBase = closes[149]
    const peak = 400
    const step = (peak - afterBase) / 110
    for (let i = 0; i < 110; i++) closes.push(afterBase + step * (i + 1))
    for (let i = 0; i < 5; i++) closes.push(peak * (1 - (15 / 100) * (i + 1) / 5))
    return closes
  }
  const closes = build()
  const n = closes.length
  const volumes = new Array(n).fill(1_000_000)
  for (let i = n - 5; i < n; i++) volumes[i] = 500_000 // 눌림 구간 저거래량
  for (let i = n - 10; i < n - 5; i++) volumes[i] = 1_800_000 // 직전 상승 구간 고거래량
  const series = seriesFromCloses(closes, volumes)
  const result = judgePullback(series, { rsPercentileValue: 80 })

  it('P1~P4가 모두 충족되고 observed=true다', () => {
    expect(result.checks).toEqual({ P1: true, P2: true, P3: true, P4: true })
    expect(result.observed).toBe(true)
    expect(result.missingConditions).toEqual([])
  })

  it('observationValidDays는 constants/pullback.js 값(30)을 그대로 노출한다', () => {
    expect(result.observationValidDays).toBe(PULLBACK_OBSERVATION_VALID_DAYS)
  })
})

describe('judgePullback — missingConditions', () => {
  it('P2만 미충족인 얕은 눌림에서 missingConditions에 P2가 포함된다', () => {
    const result = judgePullback(singleDayPullback(3))
    expect(result.missingConditions).toContain('P2')
  })
})

describe('constants/pullback.js — 상수 경계값 노출', () => {
  it('PULLBACK_DEPTH_MIN_PCT=10, PULLBACK_DEPTH_MAX_PCT=25 (PRD §4.2 표 그대로)', () => {
    expect(PULLBACK_DEPTH_MIN_PCT).toBe(10)
    expect(PULLBACK_DEPTH_MAX_PCT).toBe(25)
  })
})
