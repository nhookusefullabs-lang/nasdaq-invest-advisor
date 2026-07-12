import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { breadth, regimeSeries, currentRegime, applyHysteresis } from './regime.js'
import { buildDataset } from './buildDataset.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function makeSeries(days, closeAt) {
  const arr = []
  const start = new Date('2024-01-01T00:00:00Z')
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    const close = closeAt(i)
    arr.push({ date: d.toISOString().slice(0, 10), high: close, low: close, close, volume: 1_000_000 })
  }
  return arr
}

const dates = [
  '2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05',
  '2024-01-08', '2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12',
]

describe('regime.js — applyHysteresis (PRD_Nasdaq10 US-2 AC1: 히스테리시스 깜빡임 방지)', () => {
  it('중립 데드존(0.40~0.65) 안에서 오실레이션해도 계속 중립 — 단일 문턱이면 매번 뒤집혔을 값', () => {
    const values = [0.50, 0.60, 0.50, 0.60, 0.50, 0.60]
    const result = applyHysteresis(dates.slice(0, values.length), values)
    expect(result.every((r) => r.regime === 'neutral')).toBe(true)
  })

  it('상승 진입 후 0.55~0.65 사이를 오르내려도 상승 유지 — 단일 0.65 문턱이면 매번 뒤집혔을 값', () => {
    const values = [0.70, 0.60, 0.70, 0.60, 0.70]
    const result = applyHysteresis(dates.slice(0, values.length), values)
    expect(result.every((r) => r.regime === 'up')).toBe(true)
  })

  it('실제 경계 통과 시에는 정확히 전이하고, 전이 없는 날은 transitionDate가 그대로 유지된다', () => {
    const values = [0.70, 0.60, 0.50, 0.60, 0.35, 0.45, 0.55]
    const result = applyHysteresis(dates.slice(0, values.length), values)
    expect(result.map((r) => r.regime)).toEqual(['up', 'up', 'neutral', 'neutral', 'down', 'down', 'neutral'])
    expect(result.map((r) => r.transitionDate)).toEqual([
      dates[0], dates[0], dates[2], dates[2], dates[4], dates[4], dates[6],
    ])
  })

  it('결측(breadth 계산 불가)일이 끼어도 다음 유효일은 직전 상태를 이어간다 (재초기화 없음)', () => {
    const values = [0.70, null, 0.60]
    const result = applyHysteresis(dates.slice(0, values.length), values)
    expect(result[0]).toMatchObject({ regime: 'up', transitionDate: dates[0] })
    expect(result[1]).toMatchObject({ regime: null, breadth: null, transitionDate: null })
    // 0.60은 상승 유지 문턱(0.55) 위이므로 재분류 없이 그대로 'up' — 직전 transitionDate 보존
    expect(result[2]).toMatchObject({ regime: 'up', transitionDate: dates[0] })
  })
})

describe('regime.js — 초기 상태 판정 (PRD_Nasdaq10 US-2 AC2)', () => {
  it('breadth === 0.55(상승 유지 경계)는 초기 상태를 상승으로 분류한다', () => {
    const result = applyHysteresis(['2024-01-01'], [0.55])
    expect(result[0]).toMatchObject({ regime: 'up', transitionDate: '2024-01-01' })
  })

  it('breadth === 0.40(하락 진입 경계)는 초기 상태를 중립으로 분류한다 (조건은 미만)', () => {
    const result = applyHysteresis(['2024-01-01'], [0.40])
    expect(result[0]).toMatchObject({ regime: 'neutral', transitionDate: '2024-01-01' })
  })

  it('breadth === 0.399는 초기 상태를 하락으로 분류한다', () => {
    const result = applyHysteresis(['2024-01-01'], [0.399])
    expect(result[0]).toMatchObject({ regime: 'down', transitionDate: '2024-01-01' })
  })
})

describe('regime.js — breadth() dataSufficient 반영 (PRD_Nasdaq10 US-2 AC3)', () => {
  const tickerA = {
    ticker: 'A', dataSufficient: true,
    series: makeSeries(300, (i) => 100 + i * 0.5), // 단조 상승 → 워밍업 후 항상 close > SMA200
  }
  const tickerBExcluded = {
    ticker: 'B', dataSufficient: false, // dataSufficient=false는 series가 있어도 반드시 제외
    series: makeSeries(300, (i) => 200 - i * 0.5), // 잘못 포함되면 breadth를 끌어내릴 하락 시계열
  }
  const tickerCShort = {
    ticker: 'C', dataSufficient: true,
    series: makeSeries(150, (i) => 200 - i * 0.5), // SMA200 워밍업 불가(150<200) → 항상 제외
  }

  it('dataSufficient=false 종목은 series가 있어도 breadth 계산에서 제외된다', () => {
    const value = breadth([tickerA, tickerBExcluded])
    expect(value).toBe(1) // B가 섞였다면 1보다 작아야 정상인데, 제외되어 A만 반영되어 1
  })

  it('SMA200 워밍업이 불가한 짧은 데이터 종목(150일)은 dataSufficient=true여도 분모에서 제외된다', () => {
    const value = breadth([tickerA, tickerCShort])
    expect(value).toBe(1)
  })

  it('대상 종목이 전혀 없으면(모두 워밍업 불가) breadth는 null', () => {
    const value = breadth([tickerCShort])
    expect(value).toBeNull()
  })

  it('currentRegime()이 최신 유효 시점의 국면·breadth·전환일을 함께 반환한다', () => {
    const result = currentRegime([tickerA])
    expect(result.regime).toBe('up')
    expect(result.breadth).toBe(1)
    expect(typeof result.transitionDate).toBe('string')
  })

  it('regimeSeries()는 워밍업 이전 구간을 breadth:null/regime:null로, 이후는 유효값으로 채운다', () => {
    const series = regimeSeries([tickerA])
    expect(series[0]).toMatchObject({ breadth: null, regime: null })
    expect(series[series.length - 1]).toMatchObject({ breadth: 1, regime: 'up' })
  })
})

describe('regime.js — 5.5년 픽스처 (PRD_Nasdaq11 US-1 AC2: 상승·하락 양쪽 판정)', () => {
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, '__fixtures__/nasdaq100.5y.sample.json'), 'utf-8'))
  const dataset = buildDataset(raw)

  it('상승(불장)·하락(약세장) 국면이 모두 시계열에 등장한다', () => {
    const series = regimeSeries(dataset.tickers)
    const regimes = new Set(series.map((s) => s.regime))
    expect(regimes.has('up')).toBe(true)
    expect(regimes.has('down')).toBe(true)
  })

  it('하락 국면 표본이 실제로 쌓일 만큼 충분하다(v10의 "표본 30건" 한계를 이 픽스처가 해소)', () => {
    const series = regimeSeries(dataset.tickers)
    const downDays = series.filter((s) => s.regime === 'down').length
    expect(downDays).toBeGreaterThan(50)
  })
})
