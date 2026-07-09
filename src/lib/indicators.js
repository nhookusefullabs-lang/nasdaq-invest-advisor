// 지표 계산 순수 함수 모음 (PRD_Nasdaq4 §8 — 결정적 재현을 위해 방식 고정)
// 입력은 오름차순(과거→현재) 정렬된 숫자 배열을 기준으로 한다.

/** 단순이동평균(SMA). period 미만 구간은 null. 반환 길이 = closes.length */
export function sma(closes, period) {
  const out = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** 지수이동평균(EMA). 첫 period개의 SMA를 시드로 사용, 이후 표준 EMA 재귀식. */
export function ema(closes, period) {
  const out = new Array(closes.length).fill(null)
  if (closes.length < period) return out
  const k = 2 / (period + 1)
  let seed = 0
  for (let i = 0; i < period; i++) seed += closes[i]
  seed /= period
  out[period - 1] = seed
  for (let i = period; i < closes.length; i++) {
    out[i] = closes[i] * k + out[i - 1] * (1 - k)
  }
  return out
}

/** RSI(14) — Wilder 평활 방식. 반환 길이 = closes.length, 워밍업 구간은 null. */
export function rsiWilder(closes, period = 14) {
  const out = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return out

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = rsiFromAvg(avgGain, avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    // Wilder 평활: 직전 평균에 1/period 가중치로 새 값 반영
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = rsiFromAvg(avgGain, avgLoss)
  }
  return out
}

function rsiFromAvg(avgGain, avgLoss) {
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * MACD — MACD선 = EMA12 - EMA26, 시그널 = MACD의 EMA9, 히스토그램 = MACD - 시그널
 * 반환: { macdLine[], signalLine[], histogram[] } (모두 closes.length 길이, 워밍업 구간 null)
 */
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  )

  // MACD선이 정의된 구간만 모아 그 값들에 대해 EMA9(시그널) 계산 후 원래 인덱스로 재매핑
  const validIdx = []
  const validVals = []
  macdLine.forEach((v, i) => {
    if (v != null) {
      validIdx.push(i)
      validVals.push(v)
    }
  })
  const signalOnValid = ema(validVals, signalPeriod)
  const signalLine = new Array(closes.length).fill(null)
  validIdx.forEach((origIdx, i) => {
    signalLine[origIdx] = signalOnValid[i]
  })

  const histogram = closes.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  )

  return { macdLine, signalLine, histogram }
}

/** 이격도: (현재가 - SMA20) / SMA20 * 100 */
export function disparity(currentClose, sma20) {
  if (sma20 == null || sma20 === 0) return null
  return ((currentClose - sma20) / sma20) * 100
}

/**
 * 거래량 추세: (최근5일 평균 - 직전20일 평균) / 직전20일 평균 * 100
 * volumes는 오름차순 전체 시계열. 최신 시점 기준 최근 5일 vs 그 직전 20일.
 */
export function volumeTrend(volumes) {
  const n = volumes.length
  if (n < 25) return null
  const recent5 = volumes.slice(n - 5, n)
  const prior20 = volumes.slice(n - 25, n - 5)
  const recentAvg = average(recent5)
  const priorAvg = average(prior20)
  if (priorAvg === 0) return null
  return ((recentAvg - priorAvg) / priorAvg) * 100
}

function average(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

/**
 * 골든크로스: 최근 N 거래일(현재 포함) 이내에 MACD선이 시그널선을 상향 돌파했는지.
 * macdLine/signalLine은 동일 길이, 배열 끝이 최신 시점.
 */
export function goldenCrossWithin(macdLine, signalLine, days) {
  const n = macdLine.length
  const start = Math.max(1, n - days)
  for (let i = start; i < n; i++) {
    const prevM = macdLine[i - 1]
    const prevS = signalLine[i - 1]
    const curM = macdLine[i]
    const curS = signalLine[i]
    if (prevM == null || prevS == null || curM == null || curS == null) continue
    if (prevM <= prevS && curM > curS) return true
  }
  return false
}

/** 일별 수익률 배열 (오름차순 closes 기준, 길이 = closes.length - 1) */
export function dailyReturns(closes) {
  const out = []
  for (let i = 1; i < closes.length; i++) {
    out.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }
  return out
}

/** 표본표준편차 (ddof=1). 변동성 계산용. */
export function stddev(arr) {
  if (arr.length < 2) return null
  const mean = average(arr)
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}
