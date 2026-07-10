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

// --- v7 신규 지표 (PRD_Nasdaq7 §4.1) ---
// 아래 함수들은 위 함수들과 달리 원본 바 배열(series: [{date,high,low,close,volume}], 오름차순)을
// 입력으로 받는다 — 52주 고저/스토캐스틱/ATR이 종가 외에 고가·저가도 필요하기 때문에 통일했다.
// 모두 "현재 시점(배열 끝)" 기준 스냅샷 하나만 반환한다 (필터 판정에 최신값만 필요).

/** 52주 신고가/신저가 계산 창(거래일). 미만이면 계산 자체를 하지 않는다. */
const WEEK52_WINDOW = 252

/**
 * 볼린저밴드 — 중심선 SMA(period), 상단/하단 = 중심선 ± mult × 표본표준편차(period).
 * 데이터가 period 미만이면 null.
 */
export function bollingerBands(series, period = 20, mult = 2) {
  if (series.length < period) return null
  const closes = series.slice(-period).map((b) => b.close)
  const middle = average(closes)
  const sd = stddev(closes)
  return { middle, upper: middle + mult * sd, lower: middle - mult * sd }
}

/**
 * 52주(252거래일) 신고가/신저가. "52주"의 의미가 왜곡되지 않도록, 데이터가 252거래일
 * 미만이면 전체 기간으로 대충 계산하지 않고 null을 반환한다.
 */
export function week52HighLow(series) {
  if (series.length < WEEK52_WINDOW) return null
  const window = series.slice(-WEEK52_WINDOW)
  const high = Math.max(...window.map((b) => b.high))
  const low = Math.min(...window.map((b) => b.low))
  return { high, low }
}

/** period 구간에 null이 하나라도 섞이면 그 지점은 null (분모 0 등 워밍업 전파용). */
function smaAllowingNulls(arr, period) {
  const out = new Array(arr.length).fill(null)
  for (let i = period - 1; i < arr.length; i++) {
    const window = arr.slice(i - period + 1, i + 1)
    if (window.some((v) => v == null)) continue
    out[i] = average(window)
  }
  return out
}

/**
 * Slow Stochastic — Fast %K = (종가 − N일 최저 저가) / (N일 최고 고가 − N일 최저 저가) × 100,
 * Slow %K = Fast %K의 SMA(kSmooth), %D = Slow %K의 SMA(dSmooth). 현재 시점 스냅샷만 반환.
 * N일간 고가=저가(분모 0)이면 그날의 Fast %K는 null이며, 이 null이 이후 평활 구간에 전파된다.
 */
export function stochastic(series, kPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const n = series.length
  if (n < kPeriod) return { slowK: null, slowD: null }

  const fastK = new Array(n).fill(null)
  for (let i = kPeriod - 1; i < n; i++) {
    const window = series.slice(i - kPeriod + 1, i + 1)
    const highMax = Math.max(...window.map((b) => b.high))
    const lowMin = Math.min(...window.map((b) => b.low))
    const denom = highMax - lowMin
    fastK[i] = denom === 0 ? null : ((series[i].close - lowMin) / denom) * 100
  }

  const slowKArr = smaAllowingNulls(fastK, kSmooth)
  const slowDArr = smaAllowingNulls(slowKArr, dSmooth)

  return { slowK: slowKArr[n - 1], slowD: slowDArr[n - 1] }
}

/**
 * ATR(Average True Range) — True Range = max(고−저, |고−전일종가|, |저−전일종가|),
 * ATR = TR의 Wilder 평활(period). 첫 ATR은 첫 period개 TR의 단순평균을 시드로 사용.
 * 데이터가 (period+1)개 미만이면 null (TR 계산에 전일 종가가 필요하므로 +1).
 */
export function atr(series, period = 14) {
  const n = series.length
  if (n < period + 1) return null

  const trArr = []
  for (let i = 1; i < n; i++) {
    const cur = series[i]
    const prev = series[i - 1]
    trArr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)))
  }

  let value = average(trArr.slice(0, period))
  for (let i = period; i < trArr.length; i++) {
    value = (value * (period - 1) + trArr[i]) / period
  }
  return value
}

/** ATR을 최신 종가로 나눈 백분율(ATR%) — 필터의 상대 변동성 판정용. */
export function atrPercent(series, period = 14) {
  const value = atr(series, period)
  const lastClose = series[series.length - 1]?.close
  if (value == null || !lastClose) return null
  return (value / lastClose) * 100
}

/**
 * OBV(On-Balance Volume) — 종가 상승일 +거래량, 하락일 −거래량, 보합 0의 누적합.
 * 다른 v7 신규 지표와 달리 필터 판정(OBV vs OBV의 SMA20)에 과거 흐름 전체가 필요하므로
 * 스냅샷이 아닌 series와 동일 길이의 누적 배열을 반환한다. out[0] = 0 (기준점).
 */
export function obv(series) {
  const out = new Array(series.length).fill(0)
  for (let i = 1; i < series.length; i++) {
    const diff = series[i].close - series[i - 1].close
    const delta = diff > 0 ? series[i].volume : diff < 0 ? -series[i].volume : 0
    out[i] = out[i - 1] + delta
  }
  return out
}
