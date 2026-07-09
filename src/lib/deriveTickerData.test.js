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
        expect(derived.chart.sixMonth.length).toBe(rawTicker.series.length)
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
