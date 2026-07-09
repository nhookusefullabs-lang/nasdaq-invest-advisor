import { describe, it, expect } from 'vitest'
import { recommend } from './recommend.js'

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
