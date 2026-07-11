// 시점 슬라이서 (PRD_Nasdaq9.md §4.1, US-2) — 백테스트 전용 유틸리티. 판정 로직이 아니라
// "미래 데이터를 물리적으로 전달하지 않기 위한" 데이터 절단만 담당한다. 절단된 결과를
// buildDataset()에 넘기면 dataSufficient/hasFullYearData 등은 기존 lib 함수가 절단된
// 길이 기준으로 자연스럽게 판정한다 — 이 파일은 별도 판정을 하지 않는다.

/**
 * raw universe({generatedAt, tickers:[{ticker,name,sector,series}]})를 asOfDate(포함) 이하의
 * 봉만 남긴 새 유니버스로 절단한다. 원본은 수정하지 않는다(각 티커 객체·series 배열 모두 새로 생성).
 */
export function sliceUniverseAsOf(universe, asOfDate) {
  return {
    ...universe,
    generatedAt: asOfDate,
    tickers: universe.tickers.map((t) => ({
      ...t,
      series: t.series.filter((bar) => bar.date <= asOfDate),
    })),
  }
}

/** universe.tickers 중 가장 긴 series를 거래일 캘린더 기준으로 삼는다 (전 종목 대체로 동일 거래일). */
export function getCalendarDates(universe) {
  let longest = []
  for (const t of universe.tickers) {
    if (t.series.length > longest.length) longest = t.series
  }
  return longest.map((bar) => bar.date)
}

/**
 * 평가일 목록: 워밍업(warmupDays) 이후부터 말단 여유(holdingBufferDays)를 제외한 구간을
 * stepDays 간격으로 나열한다. 캘린더 길이가 warmupDays+holdingBufferDays에 못 미치면
 * 빈 배열을 반환한다(짧은 데이터에서의 안전한 처리).
 */
export function buildEvaluationDates(universe, { warmupDays = 252, holdingBufferDays = 60, stepDays = 5 } = {}) {
  const dates = getCalendarDates(universe)
  const end = dates.length - holdingBufferDays
  const result = []
  for (let i = warmupDays; i < end; i += stepDays) {
    result.push(dates[i])
  }
  return result
}
