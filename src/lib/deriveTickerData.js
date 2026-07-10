import {
  sma,
  ema,
  rsiWilder,
  macd,
  disparity,
  volumeTrend,
  goldenCrossWithin,
  dailyReturns,
  stddev,
  bollingerBands,
  week52HighLow,
  stochastic,
  atrPercent,
  obv,
} from './indicators.js'

// 3개월 시뮬레이션·화면 표시 창 (PRD §4.3, §7): 최근 63거래일
const SIM_WINDOW = 63
// 시뮬레이션 화면의 1개월 미니 차트 창 (약 21거래일)
const ONE_MONTH_WINDOW = 21
// 시뮬레이션 화면의 6개월 미니 차트 창 (약 126거래일, PRD_Nasdaq7 §2 — 12개월 수집 전환의
// 파급효과 차단: "수집된 전체 기간"이 아니라 고정된 최근 126거래일로 정의한다).
// 수집 데이터가 126거래일 이하면(v5 6개월 수집 데이터 등) 전체 기간을 그대로 사용한다.
const SIX_MONTH_WINDOW = 126
// 지표(SMA20/RSI14/MACD 워밍업) 안정 계산을 위한 최소 거래일 (수집 스크립트와 동일 기준)
const MIN_TRADING_DAYS = 110

const toChartPoints = (bars) => bars.map((b) => ({ date: b.date, close: b.close }))

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
    // 원본 바 배열 보존 (PRD_Nasdaq8 US-10) — 미너비니 모드(minervini.js)가 자체 지표
    // (rsRawScore/hasFullYearData 등)를 계산하려면 파생 지표가 아니라 원본 series가
    // 필요하다. 기존 indicators/chart 필드는 무수정, 추가 전용.
    series,
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
      // 추천 프리셋(PRD_Nasdaq7 §3 Must-7, US-8)의 보수형/공격형 기준·완화 창.
      // 기본형(5/10)은 위 두 필드를 그대로 재사용한다.
      goldenCross3: goldenCrossWithin(macdLine, signalLine, 3),
      goldenCross6: goldenCrossWithin(macdLine, signalLine, 6),
      goldenCross20: goldenCrossWithin(macdLine, signalLine, 20),
      // 고급 설정(US-10)의 임의 골든크로스 창(1~20)을 recommend.js가 즉석 계산할 수 있도록
      // 원본 MACD/시그널 시계열도 함께 보관한다 — 위 goldenCross{N} 이산 필드는 프리셋
      // 3종의 고정 창(3/5/6/10/20)만 커버하므로, 그 외 임의 값은 이 배열로 계산한다.
      macdLineSeries: macdLine,
      signalLineSeries: signalLine,
      volatility,
      // v7 신규 필터 5종 지표 (PRD_Nasdaq7 §4.1, US-7) — 추천 스코어링에는 사용하지 않는다.
      bollinger: bollingerBands(series),
      week52: week52HighLow(series), // 252거래일 미만이면 null (US-5 countWeek52Excluded 참고)
      stochastic: stochastic(series),
      atrPercent: atrPercent(series),
      obv: obv(series),
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
    // 시뮬레이션 화면의 1/3/6개월 미니 차트용 종가 시계열. 6개월 창은 최근 126거래일 고정
    // (데이터가 126거래일 이하면 전체 기간 사용).
    chart: {
      oneMonth: toChartPoints(series.slice(-ONE_MONTH_WINDOW)),
      threeMonth: toChartPoints(window63),
      sixMonth: toChartPoints(series.slice(-SIX_MONTH_WINDOW)),
    },
    // sectorAnalysis.computeLeadingSectors() 실행 후 채워짐
    isLeadingSector: false,
  }
}
