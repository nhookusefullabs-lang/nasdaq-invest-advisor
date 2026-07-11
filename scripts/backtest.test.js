import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadDataset, runSmoke, toMinerviniInput } from './backtest.mjs'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/nasdaq100.2y.sample.json')

describe('backtest.mjs — US-1 부트스트랩', () => {
  it('실행 성공: 두 모드 요약을 출력할 수 있는 데이터를 만든다', () => {
    const dataset = loadDataset(FIXTURE_PATH)
    const { trend, minervini } = runSmoke(dataset)
    expect(Array.isArray(trend.list)).toBe(true)
    expect(Array.isArray(minervini.list)).toBe(true)
  })

  it('동형성: backtest.mjs가 앱 lib를 직접 호출한 결과와 완전히 동일하다 (재구현 없음)', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
    const expectedDataset = buildDataset(raw)
    const expectedTrend = recommend(expectedDataset.tickers)
    const expectedMinervini = runMinerviniRecommend(toMinerviniInput(expectedDataset.tickers))

    const dataset = loadDataset(FIXTURE_PATH)
    const { trend, minervini } = runSmoke(dataset)

    expect(dataset).toEqual(expectedDataset)
    expect(trend).toEqual(expectedTrend)
    expect(minervini).toEqual(expectedMinervini)
  })
})
