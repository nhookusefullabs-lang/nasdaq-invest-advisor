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
      }
    }
    // 수집 스크립트가 최소 110거래일을 보장하므로 전량 충분해야 함
    expect(sufficientCount).toBe(raw.tickers.length)
  })
})
