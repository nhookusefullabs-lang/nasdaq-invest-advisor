import { describe, it, expect } from 'vitest'
import { evaluateExitSignals } from './exitSignals.js'

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

function findSignal(result, code) {
  return result.signals.find((s) => s.code === code)
}

const FORBIDDEN_WORDS = ['매수', '매도', '사세요', '파세요', '사야', '팔아', '추천합니다']

function assertNoRecommendationLanguage(evidence) {
  for (const w of FORBIDDEN_WORDS) {
    expect(evidence).not.toContain(w)
  }
}

describe('exitSignals.js — X1 50일선 이탈 (PRD_Nasdaq10 US-5 AC1)', () => {
  // 50일 평평(100) + 오늘(index50) target — SMA50(index50) = avg(close[1..50])
  function series50(target, volumes = null) {
    const closes = new Array(50).fill(100)
    closes.push(target)
    return seriesFromCloses(closes, volumes)
  }

  it('종가 == SMA50 정확 경계는 트리거되지 않는다 (조건은 미만)', () => {
    const result = evaluateExitSignals(series50(100))
    expect(findSignal(result, 'X1')).toBeUndefined()
  })

  it('종가가 SMA50보다 살짝 낮으면(99.99) X1 트리거', () => {
    const result = evaluateExitSignals(series50(99.99))
    const x1 = findSignal(result, 'X1')
    expect(x1).toBeDefined()
    assertNoRecommendationLanguage(x1.evidence)
  })

  it('거래량이 1.5×SMA50(volume) 이상이면 강도 "강"', () => {
    const volumes = new Array(51).fill(1_000_000)
    volumes[50] = 2_000_000
    const result = evaluateExitSignals(series50(90, volumes))
    expect(findSignal(result, 'X1').strength).toBe('강')
  })

  it('거래량이 평소 수준이면 강도 "중"', () => {
    const result = evaluateExitSignals(series50(90))
    expect(findSignal(result, 'X1').strength).toBe('중')
  })
})

describe('exitSignals.js — X2 데드크로스 (US-5 AC1, 최근 5거래일 경계)', () => {
  // 60일 상승(100→159) 후 20일 하락 — EMA12/EMA26 데드크로스가 정확히 절대인덱스70에서 발생
  function riseThenFallCloses() {
    const closes = []
    for (let i = 0; i < 60; i++) closes.push(100 + i * 1)
    const peak = closes[closes.length - 1]
    for (let i = 1; i <= 20; i++) closes.push(peak - i * 2)
    return closes
  }
  const fullCloses = riseThenFallCloses()

  it('크로스 발생 전(index69까지)에는 X2가 트리거되지 않는다', () => {
    const series = seriesFromCloses(fullCloses.slice(0, 70)) // t=69
    const result = evaluateExitSignals(series)
    expect(findSignal(result, 'X2')).toBeUndefined()
  })

  it('크로스 당일(index70=오늘)이면 X2 트리거', () => {
    const series = seriesFromCloses(fullCloses.slice(0, 71)) // t=70
    const result = evaluateExitSignals(series)
    const x2 = findSignal(result, 'X2')
    expect(x2).toBeDefined()
    assertNoRecommendationLanguage(x2.evidence)
  })

  it('경계: 크로스로부터 정확히 4거래일 후(오늘 포함 5일 내)도 X2 트리거', () => {
    const series = seriesFromCloses(fullCloses.slice(0, 75)) // t=74, 70과의 간격 4
    const result = evaluateExitSignals(series)
    expect(findSignal(result, 'X2')).toBeDefined()
  })

  it('경계: 크로스로부터 5거래일 후(간격 5, 유효기간 밖)는 X2 트리거되지 않는다', () => {
    const series = seriesFromCloses(fullCloses.slice(0, 76)) // t=75, 70과의 간격 5
    const result = evaluateExitSignals(series)
    expect(findSignal(result, 'X2')).toBeUndefined()
  })
})

describe('exitSignals.js — X3 템플릿 붕괴 (US-5 AC2: minervini.js 재사용 확인)', () => {
  function seriesN(closes) {
    return seriesFromCloses(closes)
  }

  it('데이터 252거래일 미만이면 X3은 계산 대상에서 제외된다(트리거 없음)', () => {
    const result = evaluateExitSignals(seriesN(new Array(200).fill(100)), { rsPercentileValue: 90 })
    expect(findSignal(result, 'X3')).toBeUndefined()
  })

  it('건강한 지속 상승(전 조건 충족)에서는 X3이 트리거되지 않는다', () => {
    const closes = []
    for (let i = 0; i < 280; i++) closes.push(100 + i * 0.6)
    const result = evaluateExitSignals(seriesN(closes), { rsPercentileValue: 90 })
    expect(findSignal(result, 'X3')).toBeUndefined()
  })

  it('급락(다수 조건 붕괴, T1·T5 포함)에서는 X3 트리거 + 강도 "강" — evaluateTrendTemplate 실호출 확인', () => {
    const closes = []
    for (let i = 0; i < 250; i++) closes.push(100 + i * 0.5)
    for (let i = 0; i < 30; i++) closes.push(225 - i * 4)
    const result = evaluateExitSignals(seriesN(closes), { rsPercentileValue: 30 })
    const x3 = findSignal(result, 'X3')
    expect(x3).toBeDefined()
    expect(x3.strength).toBe('강')
    assertNoRecommendationLanguage(x3.evidence)
  })

  it('경계: 정확히 3개 조건 미충족(T1/T5/T8)이면 X3 트리거된다(미달 최소치)', () => {
    const closes = []
    for (let i = 0; i < 250; i++) closes.push(100 + i * 0.8)
    for (let i = 0; i < 20; i++) closes.push(300 - i * 3)
    const result = evaluateExitSignals(seriesN(closes), { rsPercentileValue: 40 })
    const x3 = findSignal(result, 'X3')
    expect(x3).toBeDefined()
  })

  it('경계: 2개만 미충족(T5/T8)이면 X3은 트리거되지 않는다(최소 3 미달)', () => {
    const closes = []
    for (let i = 0; i < 250; i++) closes.push(100 + i * 0.8)
    for (let i = 0; i < 15; i++) closes.push(300 - i * 1.5)
    const result = evaluateExitSignals(seriesN(closes), { rsPercentileValue: 40 })
    expect(findSignal(result, 'X3')).toBeUndefined()
  })
})

describe('exitSignals.js — X4 클라이맥스 런 (US-5 AC1)', () => {
  function baseThenSpike(spikePct) {
    const closes = new Array(60).fill(100)
    const spikeStart = closes.length - 10
    for (let i = spikeStart; i < closes.length; i++) {
      const progress = (i - spikeStart + 1) / 10
      closes[i] = 100 * (1 + (spikePct / 100) * progress)
    }
    return closes
  }

  it('10거래일 수익률·SMA50 이격 둘 다 +25% 이상이면 X4 트리거(정보성)', () => {
    const result = evaluateExitSignals(seriesFromCloses(baseThenSpike(30)))
    const x4 = findSignal(result, 'X4')
    expect(x4).toBeDefined()
    expect(x4.strength).toBe('정보')
    assertNoRecommendationLanguage(x4.evidence)
  })

  it('완만한 상승(+10%)에서는 X4가 트리거되지 않는다', () => {
    const result = evaluateExitSignals(seriesFromCloses(baseThenSpike(10)))
    expect(findSignal(result, 'X4')).toBeUndefined()
  })
})

describe('exitSignals.js — X5 돌파 후 최대 낙폭일 (US-5 AC1/AC2)', () => {
  function breakoutThenDrop({ afterDropGrindDays = 0, dropVolume = 1_000_000 } = {}) {
    const closes = new Array(90).fill(100)
    closes.push(101) // 돌파일 index90
    for (let k = 1; k <= 10; k++) closes.push(101 + k * 0.5) // 완만한 지속 상승 (index91~100)
    closes.push(90) // 큰 낙폭일 (index101)
    for (let k = 1; k <= afterDropGrindDays; k++) closes.push(90 + k * 0.5)

    const volumes = new Array(closes.length).fill(1_000_000)
    volumes[101] = dropVolume
    return seriesFromCloses(closes, volumes)
  }

  it('낙폭일이 오늘(경과 0일)이고 거래량 동반이면 X5 트리거', () => {
    const series = breakoutThenDrop({ afterDropGrindDays: 0, dropVolume: 2_000_000 })
    const result = evaluateExitSignals(series)
    const x5 = findSignal(result, 'X5')
    expect(x5).toBeDefined()
    assertNoRecommendationLanguage(x5.evidence)
  })

  it('낙폭일이 거래량 동반 없이 평소 수준이면 X5는 트리거되지 않는다', () => {
    const series = breakoutThenDrop({ afterDropGrindDays: 0, dropVolume: 1_000_000 })
    const result = evaluateExitSignals(series)
    expect(findSignal(result, 'X5')).toBeUndefined()
  })

  it('경계: 낙폭일로부터 6거래일 경과(유효기간 밖)면 거래량 동반이어도 트리거되지 않는다', () => {
    const series = breakoutThenDrop({ afterDropGrindDays: 6, dropVolume: 2_000_000 })
    const result = evaluateExitSignals(series)
    expect(findSignal(result, 'X5')).toBeUndefined()
  })

  it('돌파 이벤트가 없는 종목은 X5 계산 대상에서 제외된다', () => {
    const closes = new Array(70).fill(100)
    const volumes = new Array(70).fill(1_000_000)
    const result = evaluateExitSignals(seriesFromCloses(closes, volumes))
    expect(findSignal(result, 'X5')).toBeUndefined()
  })
})

describe('exitSignals.js — evaluateExitSignals 종합', () => {
  it('count는 signals.length와 같고, 트리거되지 않은 항목은 signals에 포함되지 않는다', () => {
    const closes = new Array(50).fill(100)
    closes.push(90) // X1만 트리거
    const result = evaluateExitSignals(seriesFromCloses(closes))
    expect(result.count).toBe(result.signals.length)
    expect(result.signals.every((s) => s.triggered)).toBe(true)
  })
})
