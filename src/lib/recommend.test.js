import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { recommend } from './recommend.js'
import { PRESETS } from './presets.js'
import { buildDataset } from './buildDataset.js'

function makeTicker(overrides = {}) {
  return {
    ticker: 'TEST',
    name: 'Test Co',
    sector: 'Technology',
    dataSufficient: true,
    isLeadingSector: false,
    indicators: {
      rsi14: 60,
      macdLine: 1,
      disparity: 5,
      volTrend: 10,
      goldenCross5: true,
      goldenCross10: true,
      goldenCross3: true,
      goldenCross6: true,
      goldenCross20: true,
      volatility: 0.02,
    },
    simulation: { returnPct: 5 },
    ...overrides,
  }
}

describe('recommend - stage 1 strict pass', () => {
  it('passes tickers meeting RSI/MACD/golden-cross-5d and scores them', () => {
    const tickers = Array.from({ length: 6 }, (_, i) =>
      makeTicker({ ticker: `T${i}`, indicators: { ...makeTicker().indicators, disparity: i * 2 } })
    )
    const result = recommend(tickers)
    expect(result.relaxationApplied).toBe(false)
    expect(result.insufficientSignal).toBe(false)
    expect(result.list.length).toBe(6)
    // sorted descending by score
    for (let i = 1; i < result.list.length; i++) {
      expect(result.list[i - 1].score).toBeGreaterThanOrEqual(result.list[i].score)
    }
  })
})

describe('recommend - relaxation fallback', () => {
  it('relaxes golden cross window to 10d when strict pass < 5', () => {
    // 5개 종목이 relaxed10d 단계에서 정확히 MIN_RESULTS(5)를 채우므로 더 이상 완화되지 않아야 함
    const tickers = Array.from({ length: 5 }, (_, i) =>
      makeTicker({
        ticker: `T${i}`,
        indicators: { ...makeTicker().indicators, goldenCross5: false, goldenCross10: true },
      })
    )
    const result = recommend(tickers)
    expect(result.relaxationApplied).toBe(true)
    expect(result.level).toBe('relaxed10d')
    expect(result.list.length).toBe(5)
  })

  it('drops golden cross requirement entirely (rsiMacdOnly) when still < 5 after 10d relaxation', () => {
    const tickers = [
      makeTicker({ ticker: 'A', indicators: { ...makeTicker().indicators, goldenCross5: false, goldenCross10: false } }),
      makeTicker({ ticker: 'B', indicators: { ...makeTicker().indicators, goldenCross5: false, goldenCross10: false } }),
    ]
    const result = recommend(tickers)
    expect(result.level).toBe('rsiMacdOnly')
    expect(result.list.length).toBe(2)
  })

  it('shows insufficientSignal banner flag when even after full relaxation < 5 pass', () => {
    const tickers = [
      makeTicker({ ticker: 'A', indicators: { ...makeTicker().indicators, goldenCross5: false, goldenCross10: false } }),
    ]
    const result = recommend(tickers)
    expect(result.insufficientSignal).toBe(true)
    expect(result.list.length).toBe(1)
  })

  it('excludes tickers failing RSI/MACD even under full relaxation', () => {
    const tickers = [
      makeTicker({ ticker: 'A', indicators: { ...makeTicker().indicators, rsi14: 40 } }),
    ]
    const result = recommend(tickers)
    expect(result.list.length).toBe(0)
    expect(result.insufficientSignal).toBe(true)
  })
})

describe('recommend - scoring clamps', () => {
  it('clamps disparity/volume contributions and adds sector bonus', () => {
    const t = makeTicker({
      ticker: 'CAP',
      isLeadingSector: true,
      indicators: { ...makeTicker().indicators, disparity: 999, volTrend: 999 },
    })
    const result = recommend([t])
    expect(result.list[0].score).toBeCloseTo(100) // 60+30+10 clamped
  })

  it('scores non-leading-sector negative disparity/volume as 0 contribution', () => {
    const t = makeTicker({
      ticker: 'NEG',
      isLeadingSector: false,
      indicators: { ...makeTicker().indicators, disparity: -5, volTrend: -20 },
    })
    const result = recommend([t])
    expect(result.list[0].score).toBe(0)
  })
})

describe('recommend - data insufficiency exclusion', () => {
  it('excludes data-insufficient tickers entirely', () => {
    const tickers = [makeTicker({ ticker: 'BAD', dataSufficient: false, indicators: undefined, simulation: undefined })]
    const result = recommend(tickers)
    expect(result.list.length).toBe(0)
  })
})

describe('recommend - high-score inclusion despite failed buy signal', () => {
  function highScoringSignalFailer(ticker) {
    // RSI 30 fails rsiOk at every stage-1 level, so this never passes the buy signal —
    // but disparity 15 (+60) and leading-sector (+10) alone reach score 70.
    return makeTicker({
      ticker,
      isLeadingSector: true,
      indicators: { ...makeTicker().indicators, rsi14: 30, disparity: 15, volTrend: 0 },
    })
  }

  it('includes a signal-failing ticker once its score reaches the 70-point threshold', () => {
    const passer = makeTicker({ ticker: 'PASS' })
    const highScorer = highScoringSignalFailer('HIGH')
    const result = recommend([passer, highScorer])

    const entry = result.list.find((r) => r.ticker === 'HIGH')
    expect(entry).toBeDefined()
    expect(entry.signalPassed).toBe(false)
    expect(entry.score).toBeCloseTo(70)
    expect(entry.reasons).toMatch(/매수 신호 미충족/)
  })

  it('excludes a signal-failing ticker scoring just under the 70-point threshold', () => {
    const almostHighScorer = makeTicker({
      ticker: 'ALMOST',
      isLeadingSector: false, // drops the +10 bonus, landing at 60 < 70
      indicators: { ...makeTicker().indicators, rsi14: 30, disparity: 15, volTrend: 0 },
    })
    const result = recommend([almostHighScorer])
    expect(result.list.length).toBe(0)
  })

  it('does not count high-score signal-failers toward insufficientSignal (that still tracks real signal passes only)', () => {
    const highScorer = highScoringSignalFailer('HIGH')
    const result = recommend([highScorer])
    expect(result.list.length).toBe(1) // shown, selectable
    expect(result.insufficientSignal).toBe(true) // but the buy-signal warning still fires
  })

  it('sorts signal-passers and high-score signal-failers together by score, and still caps at 10', () => {
    const passers = Array.from({ length: 8 }, (_, i) =>
      makeTicker({ ticker: `P${i}`, indicators: { ...makeTicker().indicators, disparity: 1 } }) // low score
    )
    const highScorers = Array.from({ length: 5 }, (_, i) => highScoringSignalFailer(`H${i}`))
    const result = recommend([...passers, ...highScorers])

    expect(result.list.length).toBe(10)
    // higher-scoring signal-failers should rank above the low-scoring passers
    expect(result.list[0].signalPassed).toBe(false)
    for (let i = 1; i < result.list.length; i++) {
      expect(result.list[i - 1].score).toBeGreaterThanOrEqual(result.list[i].score)
    }
  })
})

// --- v7 US-8: 프리셋 설정 객체화 — 핵심 회귀 기준 ---

describe('recommend - default preset regression (PRD_Nasdaq7 US-8 핵심 회귀 기준)', () => {
  it('produces byte-identical output to the pre-refactor v5 baseline on real data when called with no config (defaults to 기본형)', () => {
    const dataPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../public/data/nasdaq100.json'
    )
    const baselinePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '__fixtures__/recommend-default-baseline.json'
    )
    const raw = JSON.parse(readFileSync(dataPath, 'utf-8'))
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))

    const dataset = buildDataset(raw)
    const result = recommend(dataset.tickers) // no config -> 기본형

    expect(result).toEqual(baseline)
  })

  it('recommend(tickers) with no config equals recommend(tickers, PRESETS.default) explicitly', () => {
    const tickers = Array.from({ length: 6 }, (_, i) => makeTicker({ ticker: `T${i}` }))
    expect(recommend(tickers)).toEqual(recommend(tickers, PRESETS.default))
  })
})

describe('recommend - conservative/aggressive presets (US-8)', () => {
  it('conservative: requires RSI >= 55 and a 3-day golden cross at the strict level', () => {
    const passer = makeTicker({ ticker: 'PASS', indicators: { ...makeTicker().indicators, rsi14: 56, goldenCross3: true } })
    const failsRsi = makeTicker({ ticker: 'FAILRSI', indicators: { ...makeTicker().indicators, rsi14: 54, goldenCross3: true } })
    // pad with more conservative-eligible tickers so MIN_RESULTS doesn't force relaxation
    const filler = Array.from({ length: 4 }, (_, i) =>
      makeTicker({ ticker: `FILL${i}`, indicators: { ...makeTicker().indicators, rsi14: 56, goldenCross3: true } })
    )
    const result = recommend([passer, failsRsi, ...filler], PRESETS.conservative)
    expect(result.level).toBe('strict')
    expect(result.list.map((r) => r.ticker)).not.toContain('FAILRSI')
    expect(result.list.map((r) => r.ticker)).toContain('PASS')
  })

  it('conservative: high-score inclusion threshold is 80, not the default 70', () => {
    const highScorer = makeTicker({
      ticker: 'HIGH',
      isLeadingSector: true,
      indicators: { ...makeTicker().indicators, rsi14: 30, disparity: 15, volTrend: 0 }, // score 70 (60+10), fails signal (rsi<55)
    })
    // score 70 clears the default(70) threshold but not conservative's 80
    expect(recommend([highScorer], PRESETS.default).list.length).toBe(1)
    expect(recommend([highScorer], PRESETS.conservative).list.length).toBe(0)
  })

  it('aggressive: requires only RSI >= 45 and a 10-day golden cross at the strict level', () => {
    const passer = makeTicker({ ticker: 'PASS', indicators: { ...makeTicker().indicators, rsi14: 46, goldenCross10: true } })
    const filler = Array.from({ length: 4 }, (_, i) =>
      makeTicker({ ticker: `FILL${i}`, indicators: { ...makeTicker().indicators, rsi14: 46, goldenCross10: true } })
    )
    const failsRsi = makeTicker({ ticker: 'FAILRSI', indicators: { ...makeTicker().indicators, rsi14: 44, goldenCross10: true } })
    const result = recommend([passer, failsRsi, ...filler], PRESETS.aggressive)
    expect(result.level).toBe('strict')
    expect(result.list.map((r) => r.ticker)).not.toContain('FAILRSI')
    expect(result.list.map((r) => r.ticker)).toContain('PASS')
  })

  it('aggressive: high-score inclusion threshold is 60, more permissive than the default 70', () => {
    const midScorer = makeTicker({
      ticker: 'MID',
      isLeadingSector: false,
      indicators: { ...makeTicker().indicators, rsi14: 30, disparity: 15, volTrend: 0 }, // score 60, fails signal (rsi<45)
    })
    expect(recommend([midScorer], PRESETS.default).list.length).toBe(0)
    expect(recommend([midScorer], PRESETS.aggressive).list.length).toBe(1)
  })

  it('relaxation fallback doubles the golden-cross window per preset (conservative 3 -> 6, aggressive 10 -> 20)', () => {
    // conservative: only goldenCross6 true (not goldenCross3) -> falls back to relaxed10d level
    const tickers = Array.from({ length: 5 }, (_, i) =>
      makeTicker({ ticker: `T${i}`, indicators: { ...makeTicker().indicators, rsi14: 56, goldenCross3: false, goldenCross6: true } })
    )
    const result = recommend(tickers, PRESETS.conservative)
    expect(result.level).toBe('relaxed10d')
    expect(result.list.length).toBe(5)
  })
})

describe('recommend - arbitrary golden-cross windows via raw series (US-10 고급 설정)', () => {
  // signal flat at 0, macd rises from -1 to +1 between index 3 and 4 -> a cross at index 4.
  const signalLineSeries = Array(10).fill(0)
  const macdLineSeries = [-1, -1, -1, -1, 1, 1, 1, 1, 1, 1]

  // Deliberately does NOT spread makeTicker()'s indicators (which default every discrete
  // goldenCross{3,5,6,10,20} flag to true) — this fixture must exercise the array-based
  // fallback path exclusively, not the discrete-field shortcut.
  function makeCustomTicker(overrides = {}) {
    return {
      ticker: 'CUSTOM',
      name: 'Custom Co',
      sector: 'Technology',
      dataSufficient: true,
      isLeadingSector: false,
      indicators: {
        rsi14: 60,
        macdLine: 1, // scalar (last value), macdOk requires > 0
        disparity: 5,
        volTrend: 10,
        volatility: 0.02,
        macdLineSeries,
        signalLineSeries,
      },
      simulation: { returnPct: 5 },
      ...overrides,
    }
  }

  it('window=7 (not a discrete preset window) detects the cross via macdLineSeries/signalLineSeries', () => {
    // 5 tickers so the strict level alone already reaches MIN_RESULTS and the loop stops there
    // (recommend keeps relaxing past a level until it hits MIN_RESULTS or runs out of levels).
    const tickers = Array.from({ length: 5 }, (_, i) => makeCustomTicker({ ticker: `T${i}` }))
    const config = { rsiMin: 50, goldenCrossWindow: 7, goldenCrossRelaxedWindow: 14, highScoreThreshold: 70 }
    const result = recommend(tickers, config)
    expect(result.level).toBe('strict')
    expect(result.list.length).toBe(5)
  })

  it('window=5 (too narrow to reach the cross at index 4) does not detect it, falling back through relaxation', () => {
    const tickers = Array.from({ length: 5 }, (_, i) => makeCustomTicker({ ticker: `T${i}` }))
    const config = { rsiMin: 50, goldenCrossWindow: 5, goldenCrossRelaxedWindow: 14, highScoreThreshold: 70 }
    const result = recommend(tickers, config)
    // strict(5) fails to see the index-4 cross, but relaxed(14) does -> falls back and stops there
    expect(result.level).toBe('relaxed10d')
    expect(result.list.length).toBe(5)
  })

  it('does not crash when macdLineSeries/signalLineSeries are absent for a non-discrete window (fails golden cross, still reachable via rsiMacdOnly relaxation)', () => {
    const config = { rsiMin: 50, goldenCrossWindow: 7, goldenCrossRelaxedWindow: 14, highScoreThreshold: 70 }
    const bare = { ...makeCustomTicker({ ticker: 'BARE' }), indicators: { rsi14: 60, macdLine: 1, disparity: 5, volTrend: 10, volatility: 0.02 } }
    const result = recommend([bare], config)
    // strict(7) and relaxed(14) both lack goldenCross data (undefined field, no series) -> false;
    // rsiMacdOnly ignores golden cross entirely, so rsiOk+macdOk alone still surfaces it.
    expect(result.level).toBe('rsiMacdOnly')
    expect(result.list.length).toBe(1)
  })
})
