import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { deriveTickerData } from './deriveTickerData.js'

const dataPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/data/nasdaq100.json'
)

describe('deriveTickerData against collected data', () => {
  it('derives valid indicators for every ticker in the real dataset', () => {
    const raw = JSON.parse(readFileSync(dataPath, 'utf-8'))
    expect(raw.tickers.length).toBeGreaterThan(0)

    let sufficientCount = 0
    for (const rawTicker of raw.tickers) {
      const derived = deriveTickerData(rawTicker)
      if (derived.dataSufficient) {
        sufficientCount++
        expect(derived.indicators.rsi14).toBeGreaterThanOrEqual(0)
        expect(derived.indicators.rsi14).toBeLessThanOrEqual(100)
        expect(Number.isFinite(derived.indicators.disparity)).toBe(true)
        expect(Number.isFinite(derived.simulation.returnPct)).toBe(true)
        expect(derived.simulation.periodHigh).toBeGreaterThanOrEqual(derived.simulation.periodLow)

        expect(derived.chart.oneMonth.length).toBeGreaterThan(0)
        expect(derived.chart.oneMonth.length).toBeLessThanOrEqual(21)
        expect(derived.chart.threeMonth.length).toBe(63)
        // sixMonth는 최근 126거래일 고정창 (PRD_Nasdaq7 §2, US-2) — 12개월 재수집 후
        // series.length(약 251)가 126을 넘으므로 전체 기간이 아니라 126으로 캡됨
        expect(derived.chart.sixMonth.length).toBe(Math.min(126, rawTicker.series.length))
        // 창이 길수록(더 긴 기간) 더 많은(또는 같은) 거래일을 포함해야 한다
        expect(derived.chart.threeMonth.length).toBeGreaterThanOrEqual(derived.chart.oneMonth.length)
        expect(derived.chart.sixMonth.length).toBeGreaterThanOrEqual(derived.chart.threeMonth.length)
        // 각 창은 전체 시계열의 마지막 날짜로 끝나야 한다 (같은 종료 시점, 다른 시작 시점)
        const lastDate = rawTicker.series[rawTicker.series.length - 1].date
        expect(derived.chart.oneMonth.at(-1).date).toBe(lastDate)
        expect(derived.chart.threeMonth.at(-1).date).toBe(lastDate)
        expect(derived.chart.sixMonth.at(-1).date).toBe(lastDate)
      }
    }
    // 수집 스크립트가 최소 110거래일을 보장하므로 전량 충분해야 함
    expect(sufficientCount).toBe(raw.tickers.length)
  })
})

function makeSyntheticSeries(days) {
  const series = []
  const base = new Date('2026-01-01T00:00:00Z')
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000)
    const close = 100 + i * 0.1
    series.push({
      date: d.toISOString().slice(0, 10),
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000 + i,
    })
  }
  return series
}

describe('deriveTickerData - series passthrough (PRD_Nasdaq8 US-10)', () => {
  it('preserves the original bar array on dataSufficient tickers, for minervini.js to consume', () => {
    const raw = { ticker: 'T200', name: 'Test 200', sector: 'Technology', series: makeSyntheticSeries(200) }
    const derived = deriveTickerData(raw)
    expect(derived.dataSufficient).toBe(true)
    expect(derived.series).toBe(raw.series)
  })

  it('does not include a series field on a dataSufficient:false ticker', () => {
    const raw = { ticker: 'T5', name: 'Test 5', sector: 'Technology', series: makeSyntheticSeries(5) }
    const derived = deriveTickerData(raw)
    expect(derived.dataSufficient).toBe(false)
    expect(derived.series).toBeUndefined()
  })
})

describe('deriveTickerData - chart.sixMonth window (PRD_Nasdaq7 §2, US-2)', () => {
  it('caps sixMonth at the most recent 126 trading days for a 200-day series', () => {
    const raw = { ticker: 'T200', name: 'Test 200', sector: 'Technology', series: makeSyntheticSeries(200) }
    const derived = deriveTickerData(raw)
    expect(derived.dataSufficient).toBe(true)
    expect(derived.chart.sixMonth.length).toBe(126)
    expect(derived.chart.sixMonth.at(-1).date).toBe(raw.series.at(-1).date)
  })

  it('uses the full series for sixMonth when it has 126 days or fewer (no regression for v5-era 120-day data)', () => {
    const raw = { ticker: 'T120', name: 'Test 120', sector: 'Technology', series: makeSyntheticSeries(120) }
    const derived = deriveTickerData(raw)
    expect(derived.dataSufficient).toBe(true)
    expect(derived.chart.sixMonth.length).toBe(120)
  })

  it('keeps oneMonth(21) and threeMonth(63) windows unchanged by the sixMonth redefinition', () => {
    const raw = { ticker: 'T200', name: 'Test 200', sector: 'Technology', series: makeSyntheticSeries(200) }
    const derived = deriveTickerData(raw)
    expect(derived.chart.oneMonth.length).toBe(21)
    expect(derived.chart.threeMonth.length).toBe(63)
  })
})
