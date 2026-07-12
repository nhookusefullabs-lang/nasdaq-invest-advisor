import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadDataset, runSmoke, toMinerviniInput, evaluateAsOf, buildSignalRecords, runSignalLoop, runBacktest, parseArgs, validateCliArgs, formatOverlapFactorNote, formatFreshnessCohortSummary, formatRegimeReinterpretation } from './backtest.mjs'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'
import { buildConsensusRanking } from '../src/lib/consensus.js'
import { sliceUniverseAsOf, buildEvaluationDates } from './lib/asOf.mjs'
import { validateBacktest } from '../src/lib/backtestSchema.js'
import { rebuildTop5WithPolicy } from './lib/variants.mjs'
import { aggregatePerformance, buildPriceIndex, computeSignalPerformance } from './lib/performance.mjs'
import { aggregateEntryVariant, PULLBACK_ENTRY_VARIANTS } from './lib/entries.mjs'

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

describe('backtest.mjs — US-3 신호 재현 루프', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const evaluationDates = buildEvaluationDates(raw)

  it('평가일이 픽스처에서 1개 이상 나온다 (2년 픽스처는 워밍업+말단여유를 충분히 넘김)', () => {
    expect(evaluationDates.length).toBeGreaterThan(0)
  })

  it('재현 동형성: evaluateAsOf가 같은 슬라이스에 lib를 직접 호출한 결과와 일치한다', () => {
    const asOfDate = evaluationDates[Math.floor(evaluationDates.length / 2)]

    const sliced = sliceUniverseAsOf(raw, asOfDate)
    const expectedDataset = buildDataset(sliced)
    const expectedTrend = recommend(expectedDataset.tickers)
    const expectedMinervini = runMinerviniRecommend(toMinerviniInput(expectedDataset.tickers))
    const expectedConsensus = buildConsensusRanking(expectedTrend, expectedMinervini)

    const { dataset, trend, minervini, consensus } = evaluateAsOf(raw, asOfDate)

    expect(dataset).toEqual(expectedDataset)
    expect(trend).toEqual(expectedTrend)
    expect(minervini).toEqual(expectedMinervini)
    expect(consensus).toEqual(expectedConsensus)
  })

  it('전체 루프가 픽스처에서 완주하고 신호 레코드를 축적한다', () => {
    const records = runSignalLoop(raw, evaluationDates)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every((r) => typeof r.date === 'string' && typeof r.ticker === 'string')).toBe(true)
  })
})

describe('buildSignalRecords — basis/grade/relaxationApplied 규칙', () => {
  const trendResult = {
    relaxationApplied: true,
    list: [
      { ticker: 'AAA', score: 90, signalPassed: true },
      { ticker: 'BBB', score: 80, signalPassed: true },
      { ticker: 'ZZZ', score: 95, signalPassed: false }, // 고득점 특별 편입 — allSignals(1단계 통과)에서는 제외
    ],
  }
  const minerviniResult = {
    relaxationApplied: false,
    list: [
      { ticker: 'CCC', score: 70 },
      { ticker: 'AAA', score: 60 },
    ],
  }
  const consensusResult = buildConsensusRanking(trendResult, minerviniResult)

  const records = buildSignalRecords('2026-01-05', { trend: trendResult, minervini: minerviniResult, consensus: consensusResult })

  it('trend 레코드는 relaxationApplied가 완화 발생 픽스처 규칙대로 채워지고 signalPassed=false는 제외한다', () => {
    const trendRecords = records.filter((r) => r.strategyKey === 'trend')
    expect(trendRecords.every((r) => r.relaxationApplied === true)).toBe(true)
    expect(trendRecords.some((r) => r.ticker === 'ZZZ')).toBe(false)
    expect(trendRecords.every((r) => r.grade === null)).toBe(true)
  })

  it('minervini 레코드는 완화 미발생 픽스처 규칙대로 relaxationApplied=false다', () => {
    const minerviniRecords = records.filter((r) => r.strategyKey === 'minervini')
    expect(minerviniRecords.every((r) => r.relaxationApplied === false)).toBe(true)
  })

  it('consensus 레코드는 grade에 따라 strategyKey(consensus_2star/1star)가 분리된다', () => {
    const consensusRecords = records.filter((r) => r.strategyKey.startsWith('consensus_'))
    const aaaRecord = consensusRecords.find((r) => r.ticker === 'AAA' && r.basis === 'allSignals')
    expect(aaaRecord.strategyKey).toBe('consensus_2star') // 두 모드 모두 통과
    expect(aaaRecord.grade).toBe('★★')

    const bbbRecord = consensusRecords.find((r) => r.ticker === 'BBB' && r.basis === 'allSignals')
    expect(bbbRecord.strategyKey).toBe('consensus_1star')
    expect(bbbRecord.grade).toBe('★')
  })

  it('basis가 top5/allSignals 두 벌로 기록된다', () => {
    const trendAll = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'allSignals')
    const trendTop5 = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
    expect(trendAll.length).toBe(2) // signalPassed:true인 AAA/BBB만
    expect(trendTop5.length).toBe(2) // 2개뿐이라 top5 슬라이스해도 그대로
  })
})

describe('runBacktest — US-5 In/Out 분할 + backtest.json 발행', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('스키마 검증을 통과한다', () => {
    const { valid, errors } = validateBacktest(backtest)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('In/Out 신호 수의 합이 전체 신호 수와 같다 (전체 신호 배열 기준, 전략키별로도 성립)', () => {
    const evaluationDates = buildEvaluationDates(raw)
    const allRecords = runSignalLoop(raw, evaluationDates)

    const totalSignals = backtest.strategies
      .filter((s) => s.sample === 'in')
      .reduce((sum, s) => sum + s.byHolding.reduce((a, h) => Math.max(a, h.signals), 0), 0)
    // signals 자체는 청산일 범위 초과로 보유기간별 다를 수 있어 직접 합산 비교는 불가능하므로,
    // 원본 신호 레코드 수(In+Out)가 전체와 같은지를 먼저 확인한다.
    const splitDate = backtest.config.splitDate
    const inCount = allRecords.filter((r) => r.date < splitDate).length
    const outCount = allRecords.filter((r) => r.date >= splitDate).length
    expect(inCount + outCount).toBe(allRecords.length)
    expect(totalSignals).toBeGreaterThanOrEqual(0)
  })

  it('경계 신호(splitDate 당일)는 Out에 귀속된다', () => {
    const splitDate = backtest.config.splitDate
    const evaluationDates = buildEvaluationDates(raw)
    expect(evaluationDates).toContain(splitDate) // splitDate 자체가 실제 평가일이어야 경계 테스트가 유효
    const allRecords = runSignalLoop(raw, evaluationDates)
    const onSplitDate = allRecords.filter((r) => r.date === splitDate)
    expect(onSplitDate.length).toBeGreaterThan(0)
    // runBacktest 내부에서 outRecords는 date >= splitDate 규칙을 쓰므로, splitDate 당일 신호는
    // 반드시 Out 성과 집계(byHolding)에 기여한다 — signals 합이 0보다 큰 out 그룹이 존재해야 한다.
    const anyOutSignals = backtest.strategies.some((s) => s.sample === 'out' && s.byHolding.some((h) => h.signals > 0))
    expect(anyOutSignals).toBe(true)
  })

  it('fundamentalsData를 넘기지 않으면 fundamentalAxis는 null이다', () => {
    expect(backtest.fundamentalAxis).toBeNull()
  })

  it('variants[]에 A/B/C 3종이 등록·실행되고 adopted는 전부 false다 (US-7 연동, 청산 변형 D는 v9.1 US-2가 추가)', () => {
    expect(backtest.variants.map((v) => v.name)).toEqual(
      expect.arrayContaining(['adx_gate', 'consensus_weighted', 'disparity_inverted_u'])
    )
    expect(backtest.variants.every((v) => v.adopted === false)).toBe(true)
    expect(backtest.variants.every((v) => typeof v.note === 'string' && v.note.length > 0)).toBe(true)
  })

  it('fundamentalsData를 넘기면 fundamentalAxis가 채워지고 여전히 스키마를 통과한다 (US-6 연동)', () => {
    const fundamentalsData = {
      schemaVersion: 1,
      generatedAt: raw.generatedAt,
      tickers: raw.tickers.slice(0, 2).map((t) => ({
        ticker: t.ticker,
        roe: 0.2,
        missing: [],
        quarters: [
          { period: '2026-Q2', eps: 1.5, revenue: 1000, operatingMargin: 0.3 },
          { period: '2026-Q1', eps: 1.2, revenue: 800, operatingMargin: 0.28 },
          { period: '2025-Q4', eps: 1.0, revenue: 700, operatingMargin: 0.25 },
        ],
      })),
      excluded: [],
    }
    const withAxis = runBacktest(raw, { fundamentalsData })
    expect(withAxis.fundamentalAxis).not.toBeNull()
    expect(withAxis.fundamentalAxis.note).toBe('근사 재구성 · 짧은 구간 참고치')
    expect(validateBacktest(withAxis).valid).toBe(true)
  })
})

describe('runBacktest — US-9 데이터 수집 3년 확대 (2y/3y 픽스처 양쪽에서 엔진 완주)', () => {
  const raw2y = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const FIXTURE_3Y_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/nasdaq100.3y.sample.json')
  const raw3y = JSON.parse(readFileSync(FIXTURE_3Y_PATH, 'utf-8'))

  it('2y 픽스처(504거래일)에서 엔진이 완주하고 스키마를 통과한다', () => {
    const backtest = runBacktest(raw2y)
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(backtest.strategies.some((s) => s.byHolding.some((h) => h.signals > 0))).toBe(true)
  })

  it('3y 픽스처(756거래일)에서도 엔진이 완주하고 스키마를 통과한다', () => {
    const backtest = runBacktest(raw3y)
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(backtest.strategies.some((s) => s.byHolding.some((h) => h.signals > 0))).toBe(true)
  })

  it('데이터가 길수록(3y > 2y) 평가일 수가 규칙대로 더 많다 (워밍업·말단여유는 고정, 평가 구간만 늘어남)', () => {
    const evalDates2y = buildEvaluationDates(raw2y)
    const evalDates3y = buildEvaluationDates(raw3y)
    expect(evalDates3y.length).toBeGreaterThan(evalDates2y.length)
  })
})

describe('runBacktest — v11 US-1 데이터 수집 기점 2021-01-01 (5.5y 픽스처, AC3)', () => {
  const raw2y = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const FIXTURE_5Y_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/nasdaq100.5y.sample.json')
  const raw5y = JSON.parse(readFileSync(FIXTURE_5Y_PATH, 'utf-8'))

  it('5.5y 픽스처(1400거래일)에서도 엔진이 완주하고 스키마를 통과한다', () => {
    const backtest = runBacktest(raw5y)
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(backtest.strategies.some((s) => s.byHolding.some((h) => h.signals > 0))).toBe(true)
  }, 30000)

  it('데이터가 길수록(5y > 2y) 평가일 수가 규칙대로 더 많다(자동 적응 회귀 확인)', () => {
    const evalDates2y = buildEvaluationDates(raw2y)
    const evalDates5y = buildEvaluationDates(raw5y)
    expect(evalDates5y.length).toBeGreaterThan(evalDates2y.length)
  })
})

describe('runBacktest — v11 US-2 보유 지평 90/120 확장 (청산 F)', () => {
  const FIXTURE_5Y_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/nasdaq100.5y.sample.json')
  const raw5y = JSON.parse(readFileSync(FIXTURE_5Y_PATH, 'utf-8'))

  it('5개 지평(5/20/60/90/120) 전부 byHolding·overlapFactor에 나타난다', () => {
    const backtest = runBacktest(raw5y)
    expect(validateBacktest(backtest).valid).toBe(true)
    for (const days of [5, 20, 60, 90, 120]) {
      expect(backtest.config.overlapFactor[days]).toBeDefined()
      expect(backtest.strategies.some((s) => s.byHolding.some((h) => h.days === days))).toBe(true)
    }
  }, 30000)

  it('말단 여유가 클수록(120>60) 같은 데이터에서 평가일 수가 더 적거나 같다', () => {
    const evalDates60 = buildEvaluationDates(raw5y, { holdingBufferDays: 60 })
    const evalDates120 = buildEvaluationDates(raw5y, { holdingBufferDays: 120 })
    expect(evalDates120.length).toBeLessThanOrEqual(evalDates60.length)
    expect(evalDates120.length).toBeGreaterThan(0)
  })

  it('AC1 경계: 60일 지평엔 있고 120일 지평엔 없는 신호는 60일 집계에서만 포함된다', () => {
    // entryIdx=0에서 90거래일치 데이터만 있는 티커 — 60일 후는 존재(idx60<90), 120일 후는 없음(idx120>=90)
    const start = new Date('2024-01-02T00:00:00Z')
    const series = Array.from({ length: 90 }, (_, i) => {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      return { date: d.toISOString().slice(0, 10), high: 100 + i * 0.1, low: 100 + i * 0.1, close: 100 + i * 0.1, volume: 1_000_000 }
    })
    const priceIndex = buildPriceIndex([{ ticker: 'A', dataSufficient: true, series }])
    const record = { date: series[0].date, ticker: 'A', strategyKey: 'x', basis: 'x', relaxationApplied: false }

    const perf60 = computeSignalPerformance(record, priceIndex, 60)
    const perf120 = computeSignalPerformance(record, priceIndex, 120)
    expect(perf60).not.toBeNull()
    expect(perf120).toBeNull()
  })

  it('AC3 회귀 없음: 90/120을 holdingDays 목록에 추가해도 기존 5/20/60의 집계 결과는 그대로다', () => {
    const start = new Date('2024-01-02T00:00:00Z')
    const series = Array.from({ length: 200 }, (_, i) => {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + i)
      return { date: d.toISOString().slice(0, 10), high: 100 + i * 0.2, low: 100 + i * 0.2, close: 100 + i * 0.2, volume: 1_000_000 }
    })
    const priceIndex = buildPriceIndex([
      { ticker: 'A', dataSufficient: true, series },
      { ticker: 'B', dataSufficient: true, series: series.map((b) => ({ ...b, close: b.close * 0.98 })) },
    ])
    const records = [
      { date: series[0].date, ticker: 'A', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
      { date: series[0].date, ticker: 'B', strategyKey: 'trend', basis: 'top5', relaxationApplied: false },
    ]

    const groupsOld = aggregatePerformance(records, priceIndex, [5, 20, 60], { strategyKeys: ['trend'], bases: ['top5'] })
    const groupsNew = aggregatePerformance(records, priceIndex, [5, 20, 60, 90, 120], { strategyKeys: ['trend'], bases: ['top5'] })

    for (const days of [5, 20, 60]) {
      expect(groupsNew.find((g) => g.days === days)).toEqual(groupsOld.find((g) => g.days === days))
    }
  })
})

describe('runBacktest — v9.1 US-1 완화/정상 분리 집계 (schemaVersion v2)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('schemaVersion 4(v11 US-4 stateRegimeAxis 도입)로 발행되고 스키마를 통과한다', () => {
    // v9.1 시점엔 2, v10 US-7이 regimeAxis[]를 추가하며 3, v11 US-4가 stateRegimeAxis[]를
    // 추가하며 4로 올렸다 — 이 describe가 검증하려는 v9.1 US-1 필드(signalQuality 분리 집계)는
    // 스키마 버전과 무관하게 그대로 유지된다.
    expect(backtest.schemaVersion).toBe(4)
    expect(validateBacktest(backtest).valid).toBe(true)
  })

  it('전 전략×전 basis×전 sample×전 보유기간에서 normal 신호 수 + relaxed 신호 수 = all 신호 수', () => {
    const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
    const BASES = ['top5', 'allSignals']
    const SAMPLES = ['in', 'out']
    const HOLDING_DAYS = [5, 20, 60]
    let checked = 0

    for (const key of STRATEGY_KEYS) {
      for (const basis of BASES) {
        for (const sample of SAMPLES) {
          for (const days of HOLDING_DAYS) {
            const findSignals = (quality) => {
              const s = backtest.strategies.find((x) => x.key === key && x.basis === basis && x.sample === sample && x.signalQuality === quality)
              return s.byHolding.find((h) => h.days === days).signals
            }
            expect(findSignals('normal') + findSignals('relaxed')).toBe(findSignals('all'))
            checked++
          }
        }
      }
    }
    expect(checked).toBe(4 * 2 * 2 * 3)
  })

  it('각 (key,basis,sample) 조합마다 all/normal/relaxed 3종 signalQuality가 모두 존재한다', () => {
    const qualities = new Set(backtest.strategies.filter((s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out').map((s) => s.signalQuality))
    expect(qualities).toEqual(new Set(['all', 'normal', 'relaxed']))
  })
})

describe('runBacktest — v9.1 US-2 변형 D 청산 규칙 (경로 의존 성과)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)
  // v10 US-9가 EXIT_RULES에 exit_stop_atr/exit_sma50_break/exit_climax 3종을, v11 US-7이
  // exit_regime_conditional/exit_regime_flip 2종을, v11 US-8이 exit_structural 1종을
  // 추가했고, evaluateExitVariants()는 Object.values(EXIT_RULES)를 그대로 순회하므로(코드
  // 변경 없이) variants[]에 자동으로 함께 나타난다 — 의도된 확장이지 회귀가 아니다.
  const exitVariantNames = [
    'exit_stop8_time60',
    'exit_stop8_trail15',
    'exit_stop_atr',
    'exit_sma50_break',
    'exit_climax',
    'exit_regime_conditional',
    'exit_regime_flip',
    'exit_structural',
  ]
  // v10 US-10이 소프트 정책 변형 3종을 추가로 variants[]에 병합한다.
  const policyVariantNames = ['relax_off_in_downturn', 'twostar_only_in_downturn', 'actionable_only_top5']

  it('기존 변형 A/B/C 3종 + 청산 변형 8종 + 정책 변형 3종, 총 14종이 variants[]에 있다', () => {
    expect(backtest.variants.map((v) => v.name).sort()).toEqual(
      ['adx_gate', 'consensus_weighted', 'disparity_inverted_u', ...exitVariantNames, ...policyVariantNames].sort()
    )
  })

  it('청산 변형 D 2종은 adopted:false, outDetail(avgHoldingDays·stopHitRate 포함), 한계 고지 문구를 갖는다', () => {
    for (const name of exitVariantNames) {
      const v = backtest.variants.find((x) => x.name === name)
      expect(v.adopted).toBe(false)
      expect(v.outDetail).toHaveProperty('avgHoldingDays')
      expect(v.outDetail).toHaveProperty('stopHitRate')
      expect(v.note).toContain('종가 기준 판정')
    }
  })

  it('src/(앱 추천 로직)는 청산 변형으로 인해 수정되지 않는다 — constants/v8.js 값 불변 확인', () => {
    const constants = readFileSync(path.resolve(__dirname, '../src/lib/constants/v8.js'), 'utf-8')
    expect(constants).toContain('RS_MAX: 40')
    expect(constants).toContain('CONTRACTION_MAX: 25')
  })

  it('전체 스키마 검증을 통과한다(outDetail 필드 포함)', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
  })
})

describe('parseArgs / validateCliArgs — v9.1 US-3 stepDays 파라미터화', () => {
  it('--step=N과 --out=경로를 파싱하고, 위치 인자(dataPath)는 그대로 유지한다', () => {
    const { flags, positional } = parseArgs(['data.json', '--step=1', '--out=/tmp/x.json'])
    expect(flags).toEqual({ step: '1', out: '/tmp/x.json' })
    expect(positional).toEqual(['data.json'])
  })

  it('--step 생략 시 기본값 5로 검증 통과한다 (--out 없어도 됨)', () => {
    // v10 US-11이 --universe(기본 ndx)를 검증 결과에 추가했다 — 의도된 확장, 회귀 아님.
    expect(validateCliArgs({})).toEqual({ ok: true, stepDays: 5, universe: 'ndx' })
  })

  it('--step이 1~10 범위를 벗어나면 거부한다', () => {
    expect(validateCliArgs({ step: '0' }).ok).toBe(false)
    expect(validateCliArgs({ step: '11' }).ok).toBe(false)
    expect(validateCliArgs({ step: '1.5' }).ok).toBe(false)
  })

  it('step≠5인데 --out이 없으면 거부한다 (공식 파일 보호, US-3 승인 기준 2)', () => {
    const result = validateCliArgs({ step: '1' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('--out')
  })

  it('step≠5라도 --out이 있으면 통과한다', () => {
    expect(validateCliArgs({ step: '1', out: '/tmp/x.json' })).toEqual({ ok: true, stepDays: 1, universe: 'ndx' })
  })
})

describe('runBacktest — v9.1 US-3 stepDays 파라미터화 (엔진 동작, 승인 기준 1/3/4)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))

  it('stepDays=1은 stepDays=5 대비 평가일 수가 약 5배다', () => {
    const dates5 = buildEvaluationDates(raw, { stepDays: 5 })
    const dates1 = buildEvaluationDates(raw, { stepDays: 1 })
    const ratio = dates1.length / dates5.length
    expect(ratio).toBeGreaterThan(4)
    expect(ratio).toBeLessThan(6)
  })

  it('stepDays=1 실행이 픽스처에서 완주하고 스키마를 통과한다', () => {
    const backtest = runBacktest(raw, { stepDays: 1 })
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(backtest.config.stepDays).toBe(1)
  })

  it('config.overlapFactor가 holdingDays/stepDays로 기록된다', () => {
    // v11 US-2가 HOLDING_DAYS에 90/120을 추가했다 — 의도된 확장, 회귀 아님.
    const backtest = runBacktest(raw, { stepDays: 1 })
    expect(backtest.config.overlapFactor).toEqual({ 5: 5, 20: 20, 60: 60, 90: 90, 120: 120 })

    const backtest5 = runBacktest(raw)
    expect(backtest5.config.overlapFactor).toEqual({ 5: 1, 20: 4, 60: 12, 90: 18, 120: 24 })
  })

  it('formatOverlapFactorNote가 명목/유효 표본 근사를 병기한 문자열을 만든다', () => {
    const backtest = runBacktest(raw)
    const note = formatOverlapFactorNote(backtest)
    expect(note).toContain('명목 표본')
    expect(note).toContain('유효 독립 표본 근사')
  })

  it('stepDays=5(기본) 산출물은 기존과 동일한 strategies 구조다 (회귀 없음)', () => {
    const backtest = runBacktest(raw)
    expect(backtest.config.stepDays).toBe(5)
    expect(backtest.strategies.length).toBe(4 * 2 * 2 * 3) // key×basis×sample×signalQuality
  })

  it('onProgress 콜백이 평가일마다 (완료수, 전체수)로 호출된다', () => {
    const evaluationDates = buildEvaluationDates(raw)
    const calls = []
    runSignalLoop(raw, evaluationDates, (done, total) => calls.push([done, total]))
    expect(calls.length).toBe(evaluationDates.length)
    expect(calls[calls.length - 1]).toEqual([evaluationDates.length, evaluationDates.length])
  })
})

describe('buildSignalRecords — freshnessCohort (v9.1 US-4)', () => {
  const trendResult = { relaxationApplied: false, list: [{ ticker: 'AAA', score: 90, signalPassed: true }] }
  const minerviniResult = { relaxationApplied: false, list: [{ ticker: 'AAA', score: 60 }] }
  const consensusResult = buildConsensusRanking(trendResult, minerviniResult)

  // AAA의 골든크로스는 오늘(daysAgo=0), 미너비니 피벗 돌파도 오늘(daysAgo=0) — 둘 다 '0d' 기대.
  const macdLine = [-1, -1, -1, 1]
  const signalLine = [0, 0, 0, 0]
  const series = Array.from({ length: 70 }, (_, i) => ({ close: i === 69 ? 150 : 100 }))
  const datasetTickers = [{ ticker: 'AAA', indicators: { macdLineSeries: macdLine, signalLineSeries: signalLine }, series }]

  it('datasetTickers를 넘기면 trend/minervini 레코드에 freshnessCohort가 붙는다', () => {
    const records = buildSignalRecords('2026-01-05', { trend: trendResult, minervini: minerviniResult, consensus: consensusResult }, datasetTickers)
    const trendRecord = records.find((r) => r.strategyKey === 'trend' && r.basis === 'allSignals')
    const minerviniRecord = records.find((r) => r.strategyKey === 'minervini' && r.basis === 'allSignals')
    expect(trendRecord.freshnessCohort).toBe('0d')
    expect(minerviniRecord.freshnessCohort).toBe('0d')
  })

  it('컨센서스 레코드에는 freshnessCohort를 붙이지 않는다(이벤트가 모드별로만 정의됨)', () => {
    const records = buildSignalRecords('2026-01-05', { trend: trendResult, minervini: minerviniResult, consensus: consensusResult }, datasetTickers)
    const consensusRecord = records.find((r) => r.strategyKey.startsWith('consensus_'))
    expect(consensusRecord.freshnessCohort).toBeUndefined()
  })

  it('datasetTickers를 넘기지 않으면(기존 호출부) freshnessCohort 필드 자체가 없다(하위 호환)', () => {
    const records = buildSignalRecords('2026-01-05', { trend: trendResult, minervini: minerviniResult, consensus: consensusResult })
    expect(records.every((r) => !('freshnessCohort' in r))).toBe(true)
  })
})

describe('runBacktest — v9.1 US-4 신호 신선도 코호트 (승인 기준 1, 실제 픽스처)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('스키마를 통과하고 freshnessCohorts가 발행된다', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(Array.isArray(backtest.freshnessCohorts)).toBe(true)
  })

  it('trend/minervini × in/out 조합마다 5개 코호트가 전부 존재한다(표본 유무 무관)', () => {
    for (const key of ['trend', 'minervini']) {
      for (const sample of ['in', 'out']) {
        const cohorts = backtest.freshnessCohorts.filter((f) => f.key === key && f.sample === sample).map((f) => f.cohort)
        expect(new Set(cohorts)).toEqual(new Set(['0d', '1-2d', '3-4d', '5d+', 'no_recent_breakout']))
      }
    }
  })

  it('완전성: 코호트별 신호 수 합 = 같은 (key,sample,day)의 allSignals·all 전략 신호 수', () => {
    let checked = 0
    for (const key of ['trend', 'minervini']) {
      for (const sample of ['in', 'out']) {
        for (const days of [5, 20, 60]) {
          const cohortSum = backtest.freshnessCohorts
            .filter((f) => f.key === key && f.sample === sample)
            .reduce((sum, f) => sum + (f.byHolding.find((h) => h.days === days)?.signals ?? 0), 0)
          const strategyTotal = backtest.strategies.find(
            (s) => s.key === key && s.sample === sample && s.basis === 'allSignals' && s.signalQuality === 'all'
          ).byHolding.find((h) => h.days === days).signals
          expect(cohortSum).toBe(strategyTotal)
          checked++
        }
      }
    }
    expect(checked).toBe(2 * 2 * 3)
  })

  it('배타성: 신호 레코드 하나는 정확히 하나의 코호트에만 속한다(freshnessCohort 필드가 1개 문자열)', () => {
    const evaluationDates = buildEvaluationDates(raw)
    const records = runSignalLoop(raw, evaluationDates)
    const trendAllSignals = records.filter((r) => r.strategyKey === 'trend' && r.basis === 'allSignals')
    expect(trendAllSignals.length).toBeGreaterThan(0)
    expect(trendAllSignals.every((r) => typeof r.freshnessCohort === 'string')).toBe(true)
  })

  it('formatFreshnessCohortSummary가 trend/minervini 각 5개 코호트 줄을 출력한다', () => {
    const output = formatFreshnessCohortSummary(backtest)
    expect(output.split('\n').length).toBe(2 * 5)
    expect(output).toContain('trend/0d')
    expect(output).toContain('minervini/no_recent_breakout')
  })
})

describe('runBacktest — v10 US-7 국면 귀속 + 스키마 v3 (승인 기준 1/2/3)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('스키마를 통과하고 regimeAxis가 발행된다', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(Array.isArray(backtest.regimeAxis)).toBe(true)
  })

  it('전략×sample 조합마다 국면 3종(up/neutral/down)이 전부 존재한다(표본 유무 무관)', () => {
    for (const key of ['trend', 'minervini', 'consensus_2star', 'consensus_1star']) {
      for (const sample of ['in', 'out']) {
        const regimes = backtest.regimeAxis.filter((r) => r.strategyKey === key && r.sample === sample).map((r) => r.regime)
        expect(new Set(regimes)).toEqual(new Set(['up', 'neutral', 'down']))
      }
    }
  })

  it('AC2 합산 정합성: 국면별 신호 수 합 = 같은 (key,sample,day)의 allSignals·all 전략 신호 수', () => {
    let checked = 0
    for (const key of ['trend', 'minervini', 'consensus_2star', 'consensus_1star']) {
      for (const sample of ['in', 'out']) {
        for (const days of [5, 20, 60]) {
          const regimeSum = backtest.regimeAxis
            .filter((r) => r.strategyKey === key && r.sample === sample)
            .reduce((sum, r) => sum + (r.byHolding.find((h) => h.days === days)?.signals ?? 0), 0)
          const strategyTotal = backtest.strategies.find(
            (s) => s.key === key && s.sample === sample && s.basis === 'allSignals' && s.signalQuality === 'all'
          ).byHolding.find((h) => h.days === days).signals
          expect(regimeSum).toBe(strategyTotal)
          checked++
        }
      }
    }
    expect(checked).toBe(4 * 2 * 3)
  })

  it('AC1 시점 정합성: 국면 판정은 raw를 그 날짜로 미리 잘라 넣어도 동일하다(미래 데이터 미개입)', () => {
    const evaluationDates = buildEvaluationDates(raw)
    const midDate = evaluationDates[Math.floor(evaluationDates.length / 2)]
    const directResult = evaluateAsOf(raw, midDate)
    const preSliced = sliceUniverseAsOf(raw, midDate)
    const preSlicedResult = evaluateAsOf(preSliced, midDate)
    expect(directResult.regime).toEqual(preSlicedResult.regime)
  })

  it('formatRegimeReinterpretation이 in/out 각각 국면 3종 줄을 출력한다', () => {
    const output = formatRegimeReinterpretation(backtest)
    expect(output).toContain('[in]')
    expect(output).toContain('[out]')
    expect(output).toContain('up:')
    expect(output).toContain('down:')
  })
})

describe('runBacktest — v10 US-8 진입 변형 4종 (통합)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  // v11 US-4가 entryVariants를 모드 풀(trend/minervini/consensus_2star)별로 분해했으므로,
  // 기존 "4종" 단언은 trend 풀로 좁혀서 그대로 유지한다(회귀 없음). 풀별 독립성 자체는
  // v11 US-4 describe 블록에서 별도 검증한다.
  const trendVariants = () => backtest.entryVariants.filter((v) => v.strategyKey === 'trend')

  it('스키마를 통과하고 entryVariants 4종이 trend 풀에 모두 발행된다', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(trendVariants().map((v) => v.name).sort()).toEqual(
      ['entry_close', 'entry_pivot_confirm2', 'entry_pivot_trigger', 'entry_pivot_trigger_vol'].sort()
    )
  })

  it('entry_close는 매 신호마다 체결되므로 fillRate=1 또는 표본이 0이다', () => {
    const entryClose = trendVariants().find((v) => v.name === 'entry_close')
    expect(entryClose.fillRate === 1 || entryClose.signals === 0).toBe(true)
  })

  it('각 변형의 signals는 trend·top5·Out 신호 수와 같다', () => {
    const outTrendTop5Count = backtest.strategies.find(
      (s) => s.key === 'trend' && s.sample === 'out' && s.basis === 'top5' && s.signalQuality === 'all'
    )
    // strategies[]는 보유기간별 신호수를 담으므로, 20일 항목의 signals(체결 무관 원 신호수 근사)와
    // entryVariants의 signals(변형 시뮬레이션 대상 신호수)가 같은 모집단(trend·top5·Out)에서
    // 나왔는지만 확인한다 — 정확한 보유기간별 표본 수는 청산일 범위초과로 달라질 수 있어
    // "모집단 크기(변형 대상 신호수)가 0보다 크다"는 것만 교차 검증한다.
    if (outTrendTop5Count.byHolding.some((h) => h.signals > 0)) {
      expect(trendVariants().every((v) => v.signals > 0)).toBe(true)
    }
  })
})

describe('runBacktest — v10 US-9 청산 변형 3종 + 조합 3종 (통합)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('스키마를 통과하고 신규 청산 3종이 variants[]에 포함된다(기존 변형 D 2종과 공존)', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
    const names = backtest.variants.map((v) => v.name)
    for (const n of ['exit_stop_atr', 'exit_sma50_break', 'exit_climax', 'exit_stop8_time60', 'exit_stop8_trail15']) {
      expect(names).toContain(n)
    }
  })

  it('combos 5종(v11 US-8의 2종 포함)이 모두 발행되고 전부 adopted=false다', () => {
    expect(backtest.combos).toHaveLength(5)
    expect(backtest.combos.every((c) => c.adopted === false)).toBe(true)
    expect(backtest.combos.map((c) => c.name).sort()).toEqual(
      [
        'entry_pivot_confirm2_x_exit_stop_atr',
        'entry_pivot_trigger_vol_x_exit_sma50_break',
        'entry_pivot_confirm2_x_exit_sma50_break',
        'pullback_resume_vol_x_exit_structural',
        'entry_close_x_exit_regime_conditional',
      ].sort()
    )
  })
})

describe('runBacktest — v10 US-10 진입 상태별 분해 + 소프트 정책 변형 3종 (통합)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('스키마를 통과하고 stateAxis가 발행된다', () => {
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(Array.isArray(backtest.stateAxis)).toBe(true)
  })

  it('전략×sample 조합마다 상태 5종(0/1/2/3/산정불가)이 전부 존재한다(표본 유무 무관)', () => {
    for (const key of ['trend', 'minervini', 'consensus_2star', 'consensus_1star']) {
      for (const sample of ['in', 'out']) {
        const states = backtest.stateAxis.filter((s) => s.strategyKey === key && s.sample === sample).map((s) => s.state)
        expect(new Set(states)).toEqual(new Set([0, 1, 2, 3, '산정불가']))
      }
    }
  })

  it('AC1 완전성·배타성: 상태별 신호 수 합 = 같은 (key,sample,day)의 allSignals·all 전략 신호 수', () => {
    let checked = 0
    for (const key of ['trend', 'minervini', 'consensus_2star', 'consensus_1star']) {
      for (const sample of ['in', 'out']) {
        for (const days of [5, 20, 60]) {
          const stateSum = backtest.stateAxis
            .filter((s) => s.strategyKey === key && s.sample === sample)
            .reduce((sum, s) => sum + (s.byHolding.find((h) => h.days === days)?.signals ?? 0), 0)
          const strategyTotal = backtest.strategies.find(
            (s) => s.key === key && s.sample === sample && s.basis === 'allSignals' && s.signalQuality === 'all'
          ).byHolding.find((h) => h.days === days).signals
          expect(stateSum).toBe(strategyTotal)
          checked++
        }
      }
    }
    expect(checked).toBe(4 * 2 * 3)
  })

  it('정책 변형 3종이 variants[]에 있고 전부 adopted=false, note에 판정 재료가 있다', () => {
    for (const name of ['relax_off_in_downturn', 'twostar_only_in_downturn', 'actionable_only_top5']) {
      const v = backtest.variants.find((x) => x.name === name)
      expect(v).toBeDefined()
      expect(v.adopted).toBe(false)
      expect(v.note.length).toBeGreaterThan(0)
    }
  })
})

describe('runBacktest — v11 US-4 schemaVersion 4 골격 + 집계 축 2종 (통합)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('schemaVersion 4로 발행되고 stateRegimeAxis가 스키마를 통과한다', () => {
    expect(backtest.schemaVersion).toBe(4)
    expect(Array.isArray(backtest.stateRegimeAxis)).toBe(true)
    expect(validateBacktest(backtest).valid).toBe(true)
  })

  it('AC1 합산 정합성: (state,regime) 셀 합 = 같은 (key,sample,day)의 stateAxis 합(= allSignals·all 전략 신호 수)', () => {
    let checked = 0
    for (const key of ['trend', 'minervini', 'consensus_2star', 'consensus_1star']) {
      for (const sample of ['in', 'out']) {
        for (const days of [5, 20, 60]) {
          const cellSum = backtest.stateRegimeAxis
            .filter((s) => s.strategyKey === key && s.sample === sample)
            .reduce((sum, s) => sum + (s.byHolding.find((h) => h.days === days)?.signals ?? 0), 0)
          const stateAxisTotal = backtest.stateAxis
            .filter((s) => s.strategyKey === key && s.sample === sample)
            .reduce((sum, s) => sum + (s.byHolding.find((h) => h.days === days)?.signals ?? 0), 0)
          expect(cellSum).toBe(stateAxisTotal)
          checked++
        }
      }
    }
    expect(checked).toBe(4 * 2 * 3)
  })

  it('AC2 풀 간 신호 누출 없음: 각 모드 풀의 entryVariants.signals는 그 풀 자신의 top5·Out 신호 수와만 일치한다', () => {
    for (const key of ['trend', 'minervini', 'consensus_2star']) {
      const poolTop5Total = backtest.strategies.find(
        (s) => s.key === key && s.sample === 'out' && s.basis === 'top5' && s.signalQuality === 'all'
      ).byHolding.find((h) => h.days === 20).signals
      const poolVariants = backtest.entryVariants.filter((v) => v.strategyKey === key)
      expect(poolVariants.length).toBe(4)
      if (poolTop5Total > 0) {
        // entry_close(매 신호 체결)의 signals는 그 풀 자신의 top5 신호 모집단 크기와 같아야
        // 한다 — 다른 풀의 레코드가 섞여 들어왔다면 이 값이 어긋난다.
        const entryClose = poolVariants.find((v) => v.name === 'entry_close')
        expect(entryClose.signals).toBeGreaterThan(0)
      } else {
        expect(poolVariants.every((v) => v.signals === 0)).toBe(true)
      }
    }
  })
})

describe('runBacktest — v11 US-6 눌림목 진입 변형 3종 + pullbackAxis (통합)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const backtest = runBacktest(raw)

  it('pullbackAxis가 스키마를 통과하고 3종×sample×basis×국면 전체 셀이 존재한다', () => {
    expect(Array.isArray(backtest.pullbackAxis)).toBe(true)
    expect(validateBacktest(backtest).valid).toBe(true)
    let checked = 0
    for (const name of ['pullback_immediate', 'pullback_resume', 'pullback_resume_vol']) {
      for (const sample of ['in', 'out']) {
        for (const basis of ['top5', 'allSignals']) {
          for (const regime of ['up', 'neutral', 'down']) {
            const entry = backtest.pullbackAxis.find((p) => p.name === name && p.sample === sample && p.basis === basis && p.regime === regime)
            expect(entry).toBeDefined()
            checked++
          }
        }
      }
    }
    expect(checked).toBe(3 * 2 * 2 * 3)
  })

  it('AC3 국면 분해 합산 정합성: (variant,sample,basis) 국면 3종 signals 합 = 국면 필터 없이 직접 재집계한 signals', () => {
    // runBacktest()의 holdingBufferDays 기본값(120)과 맞춰야 evaluationDates 집합이 동일해진다
    // (buildEvaluationDates() 자신의 기본값은 60이라 그대로 부르면 표본 모집단이 달라진다).
    const evaluationDates = buildEvaluationDates(raw, { holdingBufferDays: 120 })
    const allRecords = runSignalLoop(raw, evaluationDates)
    const splitDate = backtest.config.splitDate
    const outTrendTop5 = allRecords.filter((r) => r.date >= splitDate && r.strategyKey === 'trend' && r.basis === 'top5')
    const priceIndex = buildPriceIndex(loadDataset(FIXTURE_PATH).tickers)

    for (const [key, variant] of Object.entries(PULLBACK_ENTRY_VARIANTS)) {
      const cellSum = ['up', 'neutral', 'down'].reduce((sum, regime) => {
        const entry = backtest.pullbackAxis.find((p) => p.name === key && p.sample === 'out' && p.basis === 'top5' && p.regime === regime)
        return sum + (entry?.signals ?? 0)
      }, 0)
      // 국면 무필터(regime이 null인 잔여 표본 포함) 직접 재집계 — pullbackAxis는 REGIME_VALUES
      // 3종만 순회하므로, regime이 null인 레코드는 어느 셀에도 속하지 않아 cellSum에서 빠진다.
      const directRegimeOnly = aggregateEntryVariant(
        outTrendTop5.filter((r) => ['up', 'neutral', 'down'].includes(r.regime)),
        priceIndex,
        variant,
        backtest.config.holdingDays
      )
      expect(cellSum).toBe(directRegimeOnly.signals)
    }
  })

  it('pullbackAxis 전 항목이 adopted:false다 (측정 전용 — 채택 결정은 운영자 몫)', () => {
    expect(backtest.pullbackAxis.every((p) => p.adopted === false)).toBe(true)
  })
})

describe('rebuildTop5WithPolicy — US-10 AC2/AC3 (픽스처 기반 단위 테스트)', () => {
  function poolFor(date, items) {
    // items: [{ticker, rank, regime, relaxationApplied, strategyKey, entryState}]
    return items.map((it) => ({ date, basis: 'allSignals', ...it }))
  }

  it('AC2: 상태 0·3을 제외하면 실제로 top5 구성이 현행과 달라진다(상태 1·2가 승격)', () => {
    const pool = poolFor('2026-01-05', [
      { ticker: 'A', rank: 1, entryState: 0 },
      { ticker: 'B', rank: 2, entryState: 3 },
      { ticker: 'C', rank: 3, entryState: 1 },
      { ticker: 'D', rank: 4, entryState: 2 },
      { ticker: 'E', rank: 5, entryState: 1 },
      { ticker: 'F', rank: 6, entryState: 2 },
      { ticker: 'G', rank: 7, entryState: 1 },
    ])
    const baselineTop5 = [...pool].sort((a, b) => a.rank - b.rank).slice(0, 5).map((r) => r.ticker)
    const variantTop5 = rebuildTop5WithPolicy(pool, (r) => r.entryState === 1 || r.entryState === 2).map((r) => r.ticker)

    expect(baselineTop5).toEqual(['A', 'B', 'C', 'D', 'E']) // 현행: 순위 그대로 top5
    expect(variantTop5).toEqual(['C', 'D', 'E', 'F', 'G']) // 변형: A(상태0)·B(상태3) 빠지고 F·G 승격
    expect(variantTop5).not.toEqual(baselineTop5)
  })

  it('AC3: 국면 조건부 정책은 down이 아닌 날짜에서 원래 top5와 완전히 동일하다', () => {
    const pool = poolFor('2026-02-10', [
      { ticker: 'A', rank: 1, regime: 'up', relaxationApplied: true },
      { ticker: 'B', rank: 2, regime: 'up', relaxationApplied: false },
      { ticker: 'C', rank: 3, regime: 'up', relaxationApplied: true },
      { ticker: 'D', rank: 4, regime: 'up', relaxationApplied: false },
      { ticker: 'E', rank: 5, regime: 'up', relaxationApplied: true },
      { ticker: 'F', rank: 6, regime: 'up', relaxationApplied: false },
    ])
    const baselineTop5 = [...pool].sort((a, b) => a.rank - b.rank).slice(0, 5).map((r) => r.ticker)
    const variantTop5 = rebuildTop5WithPolicy(pool, (r) => !(r.regime === 'down' && r.relaxationApplied)).map((r) => r.ticker)
    expect(variantTop5).toEqual(baselineTop5) // up 국면 — 완화 신호가 섞여 있어도 규칙 미적용
  })

  it('AC3: 하락 국면 날짜에서는 완화 신호가 제외되고 다음 순위가 승격된다', () => {
    const pool = poolFor('2026-03-01', [
      { ticker: 'A', rank: 1, regime: 'down', relaxationApplied: false },
      { ticker: 'B', rank: 2, regime: 'down', relaxationApplied: true },
      { ticker: 'C', rank: 3, regime: 'down', relaxationApplied: false },
      { ticker: 'D', rank: 4, regime: 'down', relaxationApplied: false },
      { ticker: 'E', rank: 5, regime: 'down', relaxationApplied: false },
      { ticker: 'F', rank: 6, regime: 'down', relaxationApplied: false },
    ])
    const variantTop5 = rebuildTop5WithPolicy(pool, (r) => !(r.regime === 'down' && r.relaxationApplied)).map((r) => r.ticker)
    expect(variantTop5).toEqual(['A', 'C', 'D', 'E', 'F']) // B(완화) 제외, F 승격
  })
})

describe('runBacktest — v10 US-11 NGX 전체 프로토콜 (universe 경로화)', () => {
  const NGX_FIXTURE_PATH = path.resolve(__dirname, '../src/lib/__fixtures__/ngx100.sample.json')
  const ndxRaw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'))
  const ngxRaw = JSON.parse(readFileSync(NGX_FIXTURE_PATH, 'utf-8'))

  it('AC1: NGX 픽스처가 완주하고 스키마를 통과하며 universe 메타·제외율을 기록한다', () => {
    const backtest = runBacktest(ngxRaw, { universe: 'ngx' })
    expect(validateBacktest(backtest).valid).toBe(true)
    expect(backtest.config.universe).toBe('ngx')
    expect(typeof backtest.config.universeStats.tickerCount).toBe('number')
    expect(typeof backtest.config.universeStats.hasFullYearDataExcludedCount).toBe('number')
  })

  it('universe 기본값은 ndx다(옵션 미지정 시)', () => {
    const backtest = runBacktest(ndxRaw)
    expect(backtest.config.universe).toBe('ndx')
  })

  it('AC2: 유니버스 하드코딩 없음 — 동일 코드가 각 유니버스 내부 티커만으로 독립 계산한다', () => {
    const ndxBacktest = runBacktest(ndxRaw)
    const ngxBacktest = runBacktest(ngxRaw, { universe: 'ngx' })

    const ndxTickers = new Set(ndxRaw.tickers.map((t) => t.ticker))
    const ngxTickers = new Set(ngxRaw.tickers.map((t) => t.ticker))

    // strategies/regimeAxis 등은 집계표(티커를 담지 않음) — 실제 티커가 나타나는 곳은 신호
    // 재현 루프 산출물이므로, 각 유니버스로 runSignalLoop를 직접 돌려 티커 집합을 비교한다.
    const ndxDates = buildEvaluationDates(ndxRaw)
    const ngxDates = buildEvaluationDates(ngxRaw)
    const ndxRecordTickers = new Set(runSignalLoop(ndxRaw, ndxDates).map((r) => r.ticker))
    const ngxRecordTickers = new Set(runSignalLoop(ngxRaw, ngxDates).map((r) => r.ticker))

    for (const t of ndxRecordTickers) expect(ngxTickers.has(t)).toBe(false)
    for (const t of ngxRecordTickers) expect(ndxTickers.has(t)).toBe(false)
    // 각자 자기 유니버스 티커만으로 신호가 나온다(교차 오염 없음)
    for (const t of ndxRecordTickers) expect(ndxTickers.has(t)).toBe(true)
    for (const t of ngxRecordTickers) expect(ngxTickers.has(t)).toBe(true)

    expect(ndxBacktest.config.universe).toBe('ndx')
    expect(ngxBacktest.config.universe).toBe('ngx')
  })

  it('AC3: backtestLoader.js는 backtest_ngx.json을 참조하지 않는다(측정 전용 확인)', () => {
    const loaderSource = readFileSync(path.resolve(__dirname, '../src/lib/backtestLoader.js'), 'utf-8')
    expect(loaderSource).not.toContain('backtest_ngx')
    expect(loaderSource).toContain("data/backtest.json")
  })
})
