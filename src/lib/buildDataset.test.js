import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from './buildDataset.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('buildDataset — NGX 픽스처의 나스닥100 스키마 동일성 (PRD_Nasdaq10 US-1 AC4)', () => {
  const ngxRaw = JSON.parse(
    readFileSync(path.resolve(__dirname, '__fixtures__/ngx100.sample.json'), 'utf-8'),
  )
  const ndxRaw = JSON.parse(
    readFileSync(path.resolve(__dirname, '__fixtures__/nasdaq100.3y.sample.json'), 'utf-8'),
  )

  it('NGX 픽스처가 나스닥100과 동일한 {generatedAt, tickers[{ticker,name,sector,series}]} 형태다', () => {
    expect(typeof ngxRaw.generatedAt).toBe('string')
    expect(Array.isArray(ngxRaw.tickers)).toBe(true)
    for (const t of ngxRaw.tickers) {
      expect(typeof t.ticker).toBe('string')
      expect(typeof t.name).toBe('string')
      expect(typeof t.sector).toBe('string')
      expect(Array.isArray(t.series)).toBe(true)
      const bar = t.series[0]
      expect(Object.keys(bar).sort()).toEqual(['close', 'date', 'high', 'low', 'volume'])
    }
  })

  it('buildDataset()이 NGX 픽스처를 나스닥100 픽스처와 동일한 파이프라인으로 에러 없이 처리한다', () => {
    const ndxDataset = buildDataset(ndxRaw)
    const ngxDataset = buildDataset(ngxRaw)

    expect(Object.keys(ngxDataset).sort()).toEqual(Object.keys(ndxDataset).sort())
    expect(ngxDataset.tickers.length).toBe(ngxRaw.tickers.length)
    expect(ngxDataset.tickers.every((t) => t.dataSufficient)).toBe(true)
    expect(ngxDataset.excluded).toEqual([])
  })

  it('NGX 픽스처의 최상위 excluded[] 필드(가드레일/이중상장 제외 사유)는 buildDataset에 영향을 주지 않는다', () => {
    expect(ngxRaw.excluded.length).toBeGreaterThan(0)
    expect(() => buildDataset(ngxRaw)).not.toThrow()
  })
})
