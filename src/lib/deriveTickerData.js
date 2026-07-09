import { sma, ema, rsiWilder, macd, disparity, volumeTrend, goldenCrossWithin, dailyReturns, stddev } from './indicators.js'

// 3개월 시뮬레이션·화면 표시 창 (PRD §4.3, §7): 최근 63거래일
const SIM_WINDOW = 63
// 지표(SMA20/RSI14/MACD 워밍업) 안정 계산을 위한 최소 거래일 (수집 스크립트와 동일 기준)
const MIN_TRADING_DAYS = 110

/**
 * 원본 티커 레코드({ticker,name,sector,series}) → 지표·시뮬레이션이 포함된 파생 데이터.
 * 데이터 부족(거래일 부족/워밍업 불가)이면 dataSufficient=false + 사유만 반환한다 (PRD §4.1, §7).
 */
export function deriveTickerData(raw) {
  const { ticker, name, sector, series } = raw

  if (!series || series.length < MIN_TRADING_DAYS) {
    return {
      ticker, name, sector,
      dataSufficient: false,
      insufficientReason: `거래일 부족 (${series?.length ?? 0}일 < 최소 ${MIN_TRADING_DAYS}일)`,
    }
  }

  const window63 = series.slice(-SIM_WINDOW)
  if (window63.length < SIM_WINDOW) {
    return {
      ticker, name, sector,
      dataSufficient: false,
      insufficientReason: `최근 63거래일 데이터 부족 (${window63.length}일)`,
    }
  }

  const closes = series.map((b) => b.close)
  const volumes = series.map((b) => b.volume)
  const sma20Arr = sma(closes, 20)
  const rsiArr = rsiWilder(closes, 14)
  const { macdLine, signalLine } = macd(closes)
  const lastIdx = closes.length - 1

  const sma20 = sma20Arr[lastIdx]
  const rsi14 = rsiArr[lastIdx]
  const macdVal = macdLine[lastIdx]
  const signalVal = signalLine[lastIdx]

  if (sma20 == null || rsi14 == null || macdVal == null || signalVal == null) {
    return {
      ticker, name, sector,
      dataSufficient: false,
      insufficientReason: '지표 계산 워밍업 구간 부족 (SMA20/RSI14/MACD)',
    }
  }

  const anchor = window63[0]
  const currentBar = series[lastIdx]
  const windowCloses = window63.map((b) => b.close)
  const periodHigh = Math.max(...window63.map((b) => b.high))
  const periodLow = Math.min(...window63.map((b) => b.low))
  const returnPct = (currentBar.close / anchor.close - 1) * 100
  const volatility = stddev(dailyReturns(windowCloses))

  return {
    ticker,
    name,
    sector,
    dataSufficient: true,
    insufficientReason: null,
    indicators: {
      currentClose: currentBar.close,
      sma20,
      disparity: disparity(currentBar.close, sma20),
      volTrend: volumeTrend(volumes),
      rsi14,
      macdLine: macdVal,
      signalLine: signalVal,
      goldenCross5: goldenCrossWithin(macdLine, signalLine, 5),
      goldenCross10: goldenCrossWithin(macdLine, signalLine, 10),
      volatility,
    },
    simulation: {
      anchorDate: anchor.date,
      anchorClose: anchor.close,
      currentDate: currentBar.date,
      currentClose: currentBar.close,
      returnPct,
      periodHigh,
      periodLow,
    },
    // sectorAnalysis.computeLeadingSectors() 실행 후 채워짐
    isLeadingSector: false,
  }
}
