import { describe, it, expect } from 'vitest'
import { sliceUniverseAsOf, buildEvaluationDates } from './asOf.mjs'

function makeDates(n, startEpochDays = 19723) {
  // startEpochDays 19723 ≈ 2024-01-01. 순차 증가 날짜 문자열만 있으면 되므로 주말 구분은 하지 않는다.
  return Array.from({ length: n }, (_, i) => {
    const d = new Date((startEpochDays + i) * 86400000)
    return d.toISOString().slice(0, 10)
  })
}

function makeUniverse({ lengthA = 300, lengthB = 290 } = {}) {
  const datesA = makeDates(lengthA)
  const datesB = makeDates(lengthB, 19723 + (lengthA - lengthB)) // B는 A보다 짧게 시작(최근 lengthB일)
  const toSeries = (dates) => dates.map((date, i) => ({ date, high: 10 + i, low: 9 + i, close: 9.5 + i, volume: 1000 + i }))
  return {
    generatedAt: datesA[datesA.length - 1],
    tickers: [
      { ticker: 'AAA', name: 'A Corp', sector: 'Technology', series: toSeries(datesA) },
      { ticker: 'BBB', name: 'B Corp', sector: 'Technology', series: toSeries(datesB) },
    ],
  }
}

describe('sliceUniverseAsOf — 경계 테스트', () => {
  const universe = makeUniverse()
  const allDates = universe.tickers[0].series.map((b) => b.date)
  const boundaryDates = [allDates[0], allDates[50], allDates[150], allDates[250], allDates[allDates.length - 1]]

  it.each(boundaryDates)('경계일 %s: 절단된 유니버스의 어떤 종목도 그 이후 봉을 갖지 않는다', (asOfDate) => {
    const sliced = sliceUniverseAsOf(universe, asOfDate)
    for (const t of sliced.tickers) {
      expect(t.series.every((bar) => bar.date <= asOfDate)).toBe(true)
    }
  })

  it('원본 불변: 절단 후에도 원본 유니버스의 배열 길이·값이 그대로다', () => {
    const originalLengths = universe.tickers.map((t) => t.series.length)
    const originalFirstBars = universe.tickers.map((t) => ({ ...t.series[0] }))

    sliceUniverseAsOf(universe, allDates[100])

    universe.tickers.forEach((t, i) => {
      expect(t.series.length).toBe(originalLengths[i])
      expect(t.series[0]).toEqual(originalFirstBars[i])
    })
  })

  it('generatedAt이 asOfDate로 갱신된다', () => {
    const sliced = sliceUniverseAsOf(universe, allDates[100])
    expect(sliced.generatedAt).toBe(allDates[100])
  })
})

describe('buildEvaluationDates — 평가일 나열 규칙', () => {
  it('워밍업(252)~말단여유(60) 구간을 stepDays(5) 간격으로 나열한다', () => {
    const universe = makeUniverse({ lengthA: 400, lengthB: 400 })
    const dates = universe.tickers[0].series.map((b) => b.date)
    const evalDates = buildEvaluationDates(universe)

    expect(evalDates[0]).toBe(dates[252])
    expect(evalDates.every((d, i) => (i === 0 ? true : dates.indexOf(d) - dates.indexOf(evalDates[i - 1]) === 5))).toBe(true)
    expect(dates.indexOf(evalDates[evalDates.length - 1])).toBeLessThan(400 - 60)
  })

  it('데이터가 워밍업+말단여유보다 짧으면 빈 배열을 반환한다', () => {
    const universe = makeUniverse({ lengthA: 100, lengthB: 100 })
    expect(buildEvaluationDates(universe)).toEqual([])
  })

  it('옵션(warmupDays/holdingBufferDays/stepDays)을 커스텀할 수 있다', () => {
    const universe = makeUniverse({ lengthA: 100, lengthB: 100 })
    const dates = universe.tickers[0].series.map((b) => b.date)
    const evalDates = buildEvaluationDates(universe, { warmupDays: 10, holdingBufferDays: 10, stepDays: 20 })

    expect(evalDates).toEqual([dates[10], dates[30], dates[50], dates[70]])
  })

  it('가장 긴 종목의 series를 거래일 캘린더로 사용한다 (짧은 종목이 섞여 있어도)', () => {
    const universe = makeUniverse({ lengthA: 400, lengthB: 50 })
    const dates = universe.tickers[0].series.map((b) => b.date)
    const evalDates = buildEvaluationDates(universe)
    expect(evalDates[0]).toBe(dates[252])
  })
})
