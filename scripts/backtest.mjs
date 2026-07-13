#!/usr/bin/env node
// v9 백테스트 엔진 (PRD_Nasdaq9.md §4.1, US-1) — "같은 코드" 원칙: 앱의 src/lib/*를 그대로
// import해 실행한다. 지표·판정·스코어링의 백테스트 전용 재구현은 어떤 이유로도 금지.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from '../src/lib/buildDataset.js'
import { recommend } from '../src/lib/recommend.js'
import { runMinerviniRecommend } from '../src/lib/minervini.js'
import { buildConsensusRanking } from '../src/lib/consensus.js'
import { currentRegime, regimeSeries } from '../src/lib/regime.js'
import { judgeEntryState } from '../src/lib/entryPoint.js'
import { hasFullYearData, rsRawScore, rsPercentile } from '../src/lib/indicators.js'
import { sliceUniverseAsOf, buildEvaluationDates, getCalendarDates } from './lib/asOf.mjs'
import { buildPriceIndex, aggregatePerformance } from './lib/performance.mjs'
import { buildFundamentalAxis, classifyRecordsByFundamentalVerdict, FUNDAMENTAL_AXIS_NOTE } from './lib/fundamentalHistory.mjs'
import { VARIANTS, evaluateVariant, evaluatePolicyVariant } from './lib/variants.mjs'
import { EXIT_RULES, aggregateExitPerformance, EXIT_LIMITATION_NOTE, COMBOS, aggregateComboPerformance, aggregateClimaxPartialPerformance } from './lib/exits.mjs'
import { ENTRY_VARIANTS, PULLBACK_ENTRY_VARIANTS, aggregateEntryVariant, judgePullbackObservationForRecord } from './lib/entries.mjs'
import { goldenCrossFreshnessDays, pivotBreakoutFreshnessDays, freshnessCohort, aggregateFreshnessCohorts } from './lib/freshness.mjs'
import { atomicWriteBacktest } from './validate-backtest.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = path.resolve(__dirname, '../public/data/nasdaq100.json')
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../public/data/backtest.json')
// v10 US-11: NGX(Nasdaq Next Gen 100) 파일럿 — 측정 전용 별도 유니버스 기본 경로.
const DEFAULT_NGX_DATA_PATH = path.resolve(__dirname, '../public/data/ngx100.json')
const DEFAULT_NGX_OUTPUT_PATH = path.resolve(__dirname, '../public/data/backtest_ngx.json')
const NGX_FUNDAMENTALS_FILENAME = 'fundamentals_ngx.json'
const NDX_FUNDAMENTALS_FILENAME = 'fundamentals.json'

/** raw nasdaq100.json({generatedAt, tickers}) 그대로 읽는다 (asOf 슬라이싱은 raw 형태에 대해 동작). */
export function loadRawUniverse(dataPath = DEFAULT_DATA_PATH) {
  return JSON.parse(readFileSync(dataPath, 'utf-8'))
}

/** raw nasdaq100.json({generatedAt, tickers}) 을 읽어 buildDataset()으로 파생한다. */
export function loadDataset(dataPath = DEFAULT_DATA_PATH) {
  return buildDataset(loadRawUniverse(dataPath))
}

/** dataset.tickers 중 dataSufficient한 것만, 미너비니 모드가 요구하는 형태({ticker,name,sector,series})로 추린다. */
export function toMinerviniInput(tickers) {
  return tickers.filter((t) => t.dataSufficient).map((t) => ({ ticker: t.ticker, name: t.name, sector: t.sector, series: t.series }))
}

/**
 * 최신 시점(dataset 그 자체) 기준 두 모드 추천을 각 1회 실행한다 (스모크).
 * recommend()/runMinerviniRecommend() 호출 결과 그대로 반환 — 백테스트 전용 재구현 없음.
 * v11 US-11: regime을 넘겨 앱과 동일한 gateRelaxedFallbackInDownturn 규칙을 그대로 적용한다.
 */
export function runSmoke(dataset) {
  const regime = currentRegime(dataset.tickers).regime
  const trend = recommend(dataset.tickers, undefined, regime)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers), regime)
  return { trend, minervini }
}

function formatSummary(label, result) {
  return `${label}: ${result.list.length}개 (level=${result.level}, relaxationApplied=${result.relaxationApplied}, insufficientSignal=${result.insufficientSignal})`
}

// --- US-3: 신호 재현 루프 — 평가일마다 슬라이스 → 두 모드 → 컨센서스, 전부 기존 lib 호출 ---

/**
 * asOfDate까지로 절단한 시점에서 두 모드 + 컨센서스 + 시장 국면을 재현한다
 * (백테스트 판정의 단일 진입점). regime은 슬라이스된(미래 데이터 없는) dataset.tickers
 * 기준으로 regime.js가 그대로 계산한다(재구현 없음, 시점 정합성은 슬라이싱이 이미 보장).
 * v11 US-11(승인된 채택 1): 국면을 recommend()/runMinerviniRecommend()에 그대로 넘겨 앱과
 * 완전히 동일한 gateRelaxedFallbackInDownturn 규칙이 신호 재현 루프에도 자동 적용되게 한다
 * (재구현 없음, "앱 분기가 src/lib에 있으므로 백테스트가 자동으로 동일 규칙 실행"). 이 때문에
 * buildPolicyVariants()의 relax_off_in_downturn 정책 변형은 이제 이미 게이트가 걸린
 * 기준선(baselineRecords) 위에서 같은 조건을 다시 걸게 되어 사실상 무변화(델타≈0)로
 * 수렴한다 — 이중 적용이 아니라 "채택 후 그 변형 실험 자체가 무의미해짐"이 기대되는
 * 결과다(buildPolicyVariants의 extraNote에 이 사실을 명시).
 */
export function evaluateAsOf(rawUniverse, asOfDate) {
  const sliced = sliceUniverseAsOf(rawUniverse, asOfDate)
  const dataset = buildDataset(sliced)
  const regime = currentRegime(dataset.tickers)
  const trend = recommend(dataset.tickers, undefined, regime.regime)
  const minervini = runMinerviniRecommend(toMinerviniInput(dataset.tickers), regime.regime)
  const consensus = buildConsensusRanking(trend, minervini)
  return { dataset, trend, minervini, consensus, regime }
}

/** 컨센서스 항목 하나가 어느 모드 신호에서 왔는지로 relaxationApplied를 판단한다. */
function consensusRelaxationApplied(entry, trendResult, minerviniResult) {
  if (entry.trend) return trendResult.relaxationApplied
  if (entry.minervini) return minerviniResult.relaxationApplied
  return false
}

/**
 * datasetTickers(dataset.tickers, deriveTickerData() 산출물 배열)에서 ticker 하나의 파생
 * 데이터를 찾는다 — 신선도 코호트(US-4) 계산에 필요한 macdLineSeries/signalLineSeries/series를
 * 얻기 위함. 못 찾으면(픽스처 테스트 등 datasetTickers 미전달) null.
 */
function findTickerData(datasetTickers, ticker) {
  return datasetTickers?.find((t) => t.ticker === ticker) ?? null
}

/**
 * 신호일 기준 진입 상태(0/1/2/3/'산정불가') — entryPoint.js의 judgeEntryState()를 그대로
 * 재사용한다(재구현 없음, v10 US-10 stateAxis/actionable_only_top5). datasetTickers가 없거나
 * (픽스처 테스트 등) 해당 티커의 원본 series를 못 찾으면 null(계산 대상 아님).
 */
function computeEntryState(datasetTickers, ticker) {
  const td = findTickerData(datasetTickers, ticker)
  if (!td?.series) return null
  return judgeEntryState(td.series).state
}

/**
 * datasetTickers(그 평가일 as-of 유니버스) 전체에서 RS 백분위 맵을 만든다 — minervini.js의
 * runMinerviniStage1()이 내부적으로 쓰는 것과 동일한 rsRawScore()/rsPercentile()/
 * hasFullYearData() 조합을 그대로 재호출한다(재구현 없음). trend 모드는 RS 백분위를 쓰지
 * 않지만, pullback.js의 P1(트렌드 템플릿 T8)이 strategyKey 무관하게 "이 티커가 이 날짜에
 * 유니버스 대비 RS 백분위가 얼마인지"를 필요로 하므로(v11 US-6), 모드와 독립적으로 매
 * 평가일 한 번만 계산해 모든 레코드에 공유한다.
 */
function buildRsPercentileMap(datasetTickers) {
  if (!datasetTickers) return new Map()
  const eligible = datasetTickers.filter((t) => t.series && hasFullYearData(t.series))
  const rawScores = eligible.map((t) => rsRawScore(t.series))
  const percentiles = rsPercentile(rawScores)
  return new Map(eligible.map((t, i) => [t.ticker, percentiles[i]]))
}

/**
 * 날짜 → { regime, transitionDate } 맵 (v11 US-7, exit_regime_flip 전용). regime.js의
 * regimeSeries()를 유니버스 전체(미절단)에 "딱 한 번"만 호출해서 만든다 — 재구현 없음.
 * 미래 참조처럼 보이지만 실제로는 아니다: breadthTimeSeries()의 SMA200은 항상 과거창만
 * 보고, applyHysteresis()의 상태기계는 날짜 오름차순으로 과거 상태만 이어받아 전진
 * 계산한다(둘 다 그 날짜 이후 데이터를 전혀 참조하지 않음) — 그래서 "그 날짜까지로 미리
 * 잘라 각각 다시 계산"한 것과 "전체를 한 번에 계산해 날짜로 조회"한 것이 정확히 같은
 * 값을 준다(exits.test.js의 AC2가 이를 직접 검증). 매 청산 시뮬레이션 스텝마다
 * 유니버스를 다시 슬라이스·재계산하는 것보다 훨씬 저렴하다.
 */
function buildRegimeDateMap(rawUniverse) {
  const dataset = buildDataset(rawUniverse)
  const series = regimeSeries(dataset.tickers)
  return new Map(series.map((s) => [s.date, { regime: s.regime, transitionDate: s.transitionDate }]))
}

/**
 * 평가일 하나의 { trend, minervini, consensus } 결과를 평탄한 신호 레코드 배열로 변환한다.
 * basis: top5(상위 5) / allSignals(1단계 통과 전체, 추세추종·미너비니는 recommend()가 이미
 * 반환한 list 전체를, 컨센서스는 두 모드 통합 리스트 전체를 사용 — 별도 재구현 없음).
 * datasetTickers(선택)를 넘기면 trend/minervini 레코드에 freshnessCohort(US-4)가 추가된다 —
 * 이벤트 정의가 모드별로만 존재하므로(PRD) 컨센서스 레코드에는 붙이지 않는다.
 * regimeInfo(선택, v10 US-7 — regime.js의 currentRegime() 반환값)를 넘기면 모든 레코드에
 * 그 평가일의 국면 코드(regime: 'up'|'neutral'|'down'|null)가 함께 실린다.
 * rsPercentileValue(v11 US-6, 선택)는 datasetTickers 전체에서 한 번만 계산해(buildRsPercentileMap)
 * 모든 레코드(전략 무관)에 공유한다 — pullback.js의 P1(트렌드 템플릿 T8) 재판정에 필요.
 */
export function buildSignalRecords(date, { trend, minervini, consensus }, datasetTickers = null, regimeInfo = null) {
  const regime = regimeInfo?.regime ?? null
  const rsPercentileMap = buildRsPercentileMap(datasetTickers)
  const records = []

  const addBasisPair = (items, mapFn) => {
    items.forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'allSignals', regime }))
    items.slice(0, 5).forEach((item, i) => records.push({ ...mapFn(item, i), basis: 'top5', regime }))
  }

  const trendPassed = trend.list.filter((t) => t.signalPassed)
  addBasisPair(trendPassed, (t, i) => {
    const td = findTickerData(datasetTickers, t.ticker)
    const daysAgo = td ? goldenCrossFreshnessDays(td.indicators.macdLineSeries, td.indicators.signalLineSeries) : null
    return {
      date,
      ticker: t.ticker,
      strategyKey: 'trend',
      rank: i + 1,
      score: t.score,
      grade: null,
      relaxationApplied: trend.relaxationApplied,
      entryState: computeEntryState(datasetTickers, t.ticker),
      rsPercentileValue: rsPercentileMap.get(t.ticker) ?? null,
      ...(td ? { freshnessCohort: freshnessCohort(daysAgo) } : {}),
    }
  })

  addBasisPair(minervini.list, (m, i) => {
    const td = findTickerData(datasetTickers, m.ticker)
    const daysAgo = td ? pivotBreakoutFreshnessDays(td.series) : null
    return {
      date,
      ticker: m.ticker,
      strategyKey: 'minervini',
      rank: i + 1,
      score: m.score,
      grade: null,
      relaxationApplied: minervini.relaxationApplied,
      entryState: computeEntryState(datasetTickers, m.ticker),
      rsPercentileValue: rsPercentileMap.get(m.ticker) ?? null,
      ...(td ? { freshnessCohort: freshnessCohort(daysAgo) } : {}),
    }
  })

  addBasisPair(consensus.list, (c, i) => ({
    date,
    ticker: c.ticker,
    strategyKey: c.grade === '★★' ? 'consensus_2star' : 'consensus_1star',
    rank: i + 1,
    score: c.consensusPercentile,
    grade: c.grade,
    relaxationApplied: consensusRelaxationApplied(c, trend, minervini),
    entryState: computeEntryState(datasetTickers, c.ticker),
    rsPercentileValue: rsPercentileMap.get(c.ticker) ?? null,
  }))

  return records
}

/**
 * evaluationDates 전체를 순회하며 신호 레코드를 축적한다 (100종목×주단위×2모드 규모 — 수만 건 수준).
 * onProgress(완료 개수, 전체 개수)는 선택적 진행률 콜백 — step=1(연산량 5배, US-3) 실행 시
 * CLI가 평가일 단위로 진행 상황을 출력하는 데 쓴다. 기본은 no-op(테스트 출력을 오염시키지 않음).
 */
export function runSignalLoop(rawUniverse, evaluationDates, onProgress = () => {}) {
  const records = []
  evaluationDates.forEach((date, i) => {
    const { dataset, trend, minervini, consensus, regime } = evaluateAsOf(rawUniverse, date)
    records.push(...buildSignalRecords(date, { trend, minervini, consensus }, dataset.tickers, regime))
    onProgress(i + 1, evaluationDates.length)
  })
  return records
}

// --- US-5: In/Out 분할 + backtest.json 발행 ---

const round4 = (x) => Math.round(x * 10000) / 10000
// v11 US-2(청산 F): 90/120일 지평 추가 — "청산을 늦추는 것 자체가 최고의 청산인가"를
// 60일 고정 보유와 나란히 판정하기 위한 기준선. 말단 여유(holdingBufferDays)도 120으로
// 늘려 120일 지평 신호가 데이터 끝자락에서 체계적으로 결측되지 않게 한다.
const HOLDING_DAYS = [5, 20, 60, 90, 120]
const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const BASES = ['top5', 'allSignals']
// v10 US-7: 국면 3상태 — regime.js의 히스테리시스 코드와 동일.
const REGIME_VALUES = ['up', 'neutral', 'down']
// v10 US-10: 진입 상태 4종 + 산정불가 — entryPoint.js의 judgeEntryState() 반환값과 동일.
const STATE_VALUES = [0, 1, 2, 3, '산정불가']
// v11 US-4: entryVariants의 모드별 분해 대상 풀 — PRD가 명시한 3개 풀만(consensus_1star 제외).
const ENTRY_VARIANT_MODE_POOLS = ['trend', 'minervini', 'consensus_2star']
// v11 US-10: 허들 교집합 4종 — pass/partial/fail은 classifyRecordsByFundamentalVerdict가 주는
// 상호 배타적 3분류 그대로(AC1의 "합=판정 가능 신호 전체" 불변식이 이 3종에서 성립), partialOrBetter
// (★★∩Partial+, PRD 전체에서 반복 인용되는 핵심 지표)는 pass∪partial을 합친 파생값이다 —
// signalQuality의 'all'(=normal+relaxed 합)과 같은 "배타적 분류 + 편의상 합계" 패턴.
const HURDLE_GROUPS = ['pass', 'partial', 'partialOrBetter', 'fail']

/**
 * 유니버스 메타 통계(v10 US-11) — hasFullYearData(252거래일) 미만 종목 수/비율.
 * NGX는 신규상장이 많아 이 비율이 높을 것으로 예상(파일럿 판정 재료, PRD §4.1).
 */
function computeUniverseStats(dataset) {
  const sufficientTickers = dataset.tickers.filter((t) => t.dataSufficient)
  const shortCount = sufficientTickers.filter((t) => !hasFullYearData(t.series)).length
  return {
    tickerCount: sufficientTickers.length,
    hasFullYearDataExcludedCount: shortCount,
    hasFullYearDataExcludedRatio: sufficientTickers.length ? round4(shortCount / sufficientTickers.length) : null,
  }
}

function computeRelaxedShare(records) {
  if (!records.length) return null
  const count = records.filter((r) => r.relaxationApplied).length
  return round4(count / records.length)
}

// v9.1 US-3: stepDays를 1로 낮추면(매일 평가) 인접 평가일의 보유 구간이 크게 겹쳐
// "명목 표본 수"가 부풀려진다 — 보유기간별 overlapFactor(= holdingDays/stepDays)를
// config에 명시해, 화면·리포트가 "유효 독립 표본 근사 = 명목 표본 ÷ overlapFactor"를
// 함께 읽을 수 있게 한다(표본 착시 방지, 값 자체를 자동 보정하지는 않음).
function computeOverlapFactor(holdingDays, stepDays) {
  return Object.fromEntries(holdingDays.map((days) => [days, round4(days / stepDays)]))
}

// v9.1 US-1: 완화 폴백 신호(relaxationApplied:true)와 정상 신호를 분리 집계하는 차원.
// "all"은 기존 v1과 동일한 전체 집계(화면2가 계속 이것만 사용), normal/relaxed는 운영자
// 분석용으로 추가 발행한다(가설 ① — In 구간 추세추종 붕괴가 완화 신호 탓인지 판정 재료).
const SIGNAL_QUALITIES = ['all', 'normal', 'relaxed']

function filterByQuality(records, quality) {
  if (quality === 'all') return records
  if (quality === 'normal') return records.filter((r) => !r.relaxationApplied)
  return records.filter((r) => r.relaxationApplied)
}

/**
 * 전체 백테스트 실행: 평가일 나열 → 신호 재현 → 신호일 기준 In(전반 50%)/Out(후반 50%) 분할
 * → 성과 집계(전체·정상·완화 3중 집계) → backtest.json v2 스키마 형태로 조립한다.
 * 경계 규칙: splitDate 당일 신호는 Out에 귀속된다(splitDate = Out 구간의 첫 평가일).
 * fundamentalAxis는 US-6, variants는 US-7, signalQuality 분리는 v9.1 US-1이 채운다.
 */
export function runBacktest(
  rawUniverse,
  {
    warmupDays = 252,
    holdingBufferDays = 120,
    stepDays = 5,
    holdingDays = HOLDING_DAYS,
    topN = 5,
    fundamentalsData = null,
    onProgress = () => {},
    universe = 'ndx',
  } = {}
) {
  const evaluationDates = buildEvaluationDates(rawUniverse, { warmupDays, holdingBufferDays, stepDays })
  const records = runSignalLoop(rawUniverse, evaluationDates, onProgress)

  const splitIndex = Math.floor(evaluationDates.length / 2)
  const splitDate = evaluationDates.length ? (evaluationDates[splitIndex] ?? null) : null
  const inRecords = splitDate ? records.filter((r) => r.date < splitDate) : records
  const outRecords = splitDate ? records.filter((r) => r.date >= splitDate) : []

  const dataset = buildDataset(rawUniverse)
  const priceIndex = buildPriceIndex(dataset.tickers)
  const universeStats = computeUniverseStats(dataset)

  const aggregateAllQualities = (sampleRecords) =>
    Object.fromEntries(
      SIGNAL_QUALITIES.map((quality) => [
        quality,
        aggregatePerformance(filterByQuality(sampleRecords, quality), priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: BASES }),
      ])
    )

  const inGroupsByQuality = aggregateAllQualities(inRecords)
  const outGroupsByQuality = aggregateAllQualities(outRecords)

  const strategies = []
  for (const key of STRATEGY_KEYS) {
    for (const basis of BASES) {
      for (const [sample, groupsByQuality, sampleRecords] of [
        ['in', inGroupsByQuality, inRecords],
        ['out', outGroupsByQuality, outRecords],
      ]) {
        for (const signalQuality of SIGNAL_QUALITIES) {
          const groups = groupsByQuality[signalQuality]
          const byHolding = groups
            .filter((g) => g.strategyKey === key && g.basis === basis)
            .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
          const matchingRecords = filterByQuality(
            sampleRecords.filter((r) => r.strategyKey === key && r.basis === basis),
            signalQuality
          )
          strategies.push({ key, sample, basis, signalQuality, byHolding, relaxedShare: computeRelaxedShare(matchingRecords) })
        }
      }
    }
  }

  const calendarDates = getCalendarDates(rawUniverse)
  const fundamentalAxis = buildFundamentalAxis(fundamentalsData, records, priceIndex, holdingDays)
  const variants = VARIANTS.map((v) => evaluateVariant(rawUniverse, v, { evaluationDates, splitDate, mainRecords: records, priceIndex }))
  // v11 US-7: exit_regime_flip 전용 날짜→국면 맵 — 한 번만 계산해 공유(레코드별 재계산 없음).
  const regimeByDate = buildRegimeDateMap(rawUniverse)
  const exitVariants = evaluateExitVariants(outRecords, strategies, priceIndex, regimeByDate)

  // v9.1 US-4 가설 ③: 신선 신호(0~2d)와 지연 신호(3d+/no_recent_breakout)의 성과 차이를
  // In/Out 양쪽에서 측정한다(basis는 allSignals만 — top5는 코호트별 표본이 너무 작아짐).
  const freshnessCohorts = [
    ...aggregateFreshnessCohorts(inRecords, priceIndex, holdingDays).map((f) => ({ ...f, sample: 'in' })),
    ...aggregateFreshnessCohorts(outRecords, priceIndex, holdingDays).map((f) => ({ ...f, sample: 'out' })),
  ]

  const regimeAxis = buildRegimeAxis(inRecords, outRecords, priceIndex, holdingDays)

  // v10 US-8: 진입 변형 4종 — 기존 변형 D(exitVariants)와 동일 스코프(trend·top5·Out)에서
  // 비교해야 §7의 최종 조합 실험(진입×청산)이 같은 기준선을 공유한다.
  const outTrendTop5 = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
  // v11 US-4: entryVariants에 strategyKey 축 추가 — 진입 변형(피벗 트리거 등)은 티커/가격
  // 구조 기반이라 모드 무관이지만, 실제 효과가 모드별 풀에서도 같은지는 실측이 없었다
  // (v10까지는 trend·top5 기준만 측정). 각 모드의 자기 top5·Out 레코드로 독립 계산한다
  // (풀 간 신호 누출 없음 — US-4 AC2).
  const entryVariants = ENTRY_VARIANT_MODE_POOLS.flatMap((strategyKey) => {
    const poolTop5 = outRecords.filter((r) => r.strategyKey === strategyKey && r.basis === 'top5')
    return Object.values(ENTRY_VARIANTS).map((variant) => ({
      strategyKey,
      ...aggregateEntryVariant(poolTop5, priceIndex, variant, holdingDays),
    }))
  })

  // v10 US-9: 진입×청산 조합 3종(§7 최종 대결 재료) — 채택 결정은 하지 않는다(adopted 항상 false).
  const combos = COMBOS.map((combo) => ({
    name: combo.name,
    adopted: false,
    ...aggregateComboPerformance(outTrendTop5, priceIndex, combo.entryVariant, combo.exitRule),
    // v11.1 US-4: 조합도 청산 변형과 동일한 국면별 분해를 갖는다.
    regimeDetail: buildRegimeDetail(outTrendTop5, priceIndex, (bucket) => aggregateComboPerformance(bucket, priceIndex, combo.entryVariant, combo.exitRule)),
  }))

  // v10 US-10: 진입 상태별 분해 + 소프트 정책 변형 3종
  const stateAxis = buildStateAxis(inRecords, outRecords, priceIndex, holdingDays)
  const policyVariants = buildPolicyVariants(outRecords, priceIndex)

  // v11 US-4: 상태×국면 2차원 분해 (schemaVersion 4)
  const stateRegimeAxis = buildStateRegimeAxis(inRecords, outRecords, priceIndex, holdingDays)

  // v11 US-6: 눌림목 진입 변형 3종 × sample × basis × 국면
  const pullbackAxis = buildPullbackAxis(inRecords, outRecords, priceIndex, holdingDays)

  // v11.1 US-1: 눌림목 관찰 조건(P1~P4) 퍼널 — 어느 단계에서 신호가 고사하는지 진단
  const pullbackFunnel = buildPullbackFunnel(inRecords, outRecords, priceIndex)

  // v11 US-9: 청산 변형 E(클라이맥스 부분 청산) — 3자 비교(무청산/전량/부분)
  const { climaxPartial, climaxPartialVariant } = buildClimaxPartial(outTrendTop5, priceIndex, strategies, exitVariants)

  // v11 US-10: 허들 교집합 축(양 유니버스) — ★★∩펀더멘털 판정 × sample × 국면
  const hurdleIntersection = buildHurdleIntersection(fundamentalsData, inRecords, outRecords, priceIndex, holdingDays)

  return {
    schemaVersion: 4,
    generatedAt: rawUniverse.generatedAt,
    config: {
      dataFrom: calendarDates[0] ?? null,
      dataTo: calendarDates[calendarDates.length - 1] ?? null,
      stepDays,
      holdingDays,
      warmupDays,
      splitDate,
      benchmark: 'universe_equal_weight',
      topN,
      overlapFactor: computeOverlapFactor(holdingDays, stepDays),
      universe,
      universeStats,
    },
    strategies,
    fundamentalAxis,
    variants: [...variants, ...exitVariants, ...policyVariants, climaxPartialVariant],
    freshnessCohorts,
    regimeAxis,
    entryVariants,
    combos,
    stateAxis,
    stateRegimeAxis,
    pullbackAxis,
    pullbackFunnel,
    climaxPartial,
    hurdleIntersection,
  }
}

/**
 * 전략×sample×국면×보유기간 성과표 (v10 US-7, PRD §4.2 1단). allSignals 기준만 사용한다
 * (top5를 국면별로 다시 쪼개면 표본이 급격히 작아짐 — freshnessCohorts와 동일 원칙).
 * aggregatePerformance()를 그대로 재사용(재구현 없음).
 */
function buildRegimeAxis(inRecords, outRecords, priceIndex, holdingDays) {
  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const allSignalsRecords = records.filter((r) => r.basis === 'allSignals')
    for (const regime of REGIME_VALUES) {
      const regimeRecords = allSignalsRecords.filter((r) => r.regime === regime)
      const groups = aggregatePerformance(regimeRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: ['allSignals'] })
      for (const key of STRATEGY_KEYS) {
        const byHolding = groups
          .filter((g) => g.strategyKey === key)
          .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
        axis.push({ strategyKey: key, sample, regime, byHolding })
      }
    }
  }
  return axis
}

/**
 * 전략×sample×진입상태×보유기간 성과표 (v10 US-10, v9.1 no_recent_breakout 코호트 발견의
 * 정밀 재검증). allSignals 기준만 사용한다(top5를 상태별로 다시 쪼개면 표본이 급격히
 * 작아짐 — regimeAxis/freshnessCohorts와 동일 원칙). aggregatePerformance() 재사용.
 */
function buildStateAxis(inRecords, outRecords, priceIndex, holdingDays) {
  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const allSignalsRecords = records.filter((r) => r.basis === 'allSignals')
    for (const state of STATE_VALUES) {
      const stateRecords = allSignalsRecords.filter((r) => r.entryState === state)
      const groups = aggregatePerformance(stateRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: ['allSignals'] })
      for (const key of STRATEGY_KEYS) {
        const byHolding = groups
          .filter((g) => g.strategyKey === key)
          .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
        axis.push({ strategyKey: key, sample, state, byHolding })
      }
    }
  }
  return axis
}

/**
 * 전략×sample×진입상태×국면×보유기간 성과표 (v11 US-4, PRD §4.5) — v10 발견 #6(상태0 눌림목
 * 교집합)의 "구조 몫(상태) vs 국면 몫(V자 회복)" 분리가 1차 목표. stateAxis/regimeAxis와
 * 동일 패턴(allSignals 기준만, aggregatePerformance 재사용)을 2차원으로 조합한다.
 */
function buildStateRegimeAxis(inRecords, outRecords, priceIndex, holdingDays) {
  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const allSignalsRecords = records.filter((r) => r.basis === 'allSignals')
    for (const state of STATE_VALUES) {
      for (const regime of REGIME_VALUES) {
        const cellRecords = allSignalsRecords.filter((r) => r.entryState === state && r.regime === regime)
        const groups = aggregatePerformance(cellRecords, priceIndex, holdingDays, { strategyKeys: STRATEGY_KEYS, bases: ['allSignals'] })
        for (const key of STRATEGY_KEYS) {
          const byHolding = groups
            .filter((g) => g.strategyKey === key)
            .map((g) => ({ days: g.days, signals: g.signals, winRate: g.winRate, avgExcess: g.avgExcess, medianExcess: g.medianExcess, avgReturn: g.avgReturn, mdd: g.mdd }))
          axis.push({ strategyKey: key, sample, state, regime, byHolding })
        }
      }
    }
  }
  return axis
}

/**
 * 눌림목 진입 변형 3종 × sample × basis × 국면 성과표 (v11 US-6, PRD §4.2). trend·전략
 * 신호만 대상(entryVariants[]의 US-4 이전 원래 스코프와 동일 — pullbackAxis는 PRD가 명시한
 * "3종×sample×basis×국면×byHolding" 4차원만 다룬다). entries.mjs의 aggregateEntryVariant()를
 * regime으로 사전 필터링한 레코드에 그대로 재사용한다(재구현 없음). adopted는 항상 false
 * (측정 전용 — 채택 결정은 운영자 몫).
 */
function buildPullbackAxis(inRecords, outRecords, priceIndex, holdingDays) {
  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const trendRecords = records.filter((r) => r.strategyKey === 'trend')
    for (const basis of BASES) {
      const basisRecords = trendRecords.filter((r) => r.basis === basis)
      for (const regime of REGIME_VALUES) {
        const regimeRecords = basisRecords.filter((r) => r.regime === regime)
        for (const variant of Object.values(PULLBACK_ENTRY_VARIANTS)) {
          const agg = aggregateEntryVariant(regimeRecords, priceIndex, variant, holdingDays)
          axis.push({ sample, basis, regime, adopted: false, ...agg })
        }
      }
    }
  }
  return axis
}

/**
 * 눌림목 관찰 조건 퍼널(v11.1 US-1) — P1 → ∩P2 → ∩P3 → ∩P4(observed) 단계별 통과 수를
 * pullbackAxis와 동일한 sample×basis×국면 모집단에서 집계한다. judgePullback()의 checks가
 * 4개 조건을 서로 독립적으로 반환하므로(entries.mjs의 judgePullbackObservationForRecord
 * 재사용, 재구현 없음), 여기서는 그 결과를 누적 교집합으로 필터링만 한다 — 판정 로직
 * 자체는 건드리지 않는다. 목적은 "P1~P4 중 어느 단계에서 신호가 고사하는지" 진단이지
 * 조건 완화가 아니다(Out of Scope).
 */
function buildPullbackFunnel(inRecords, outRecords, priceIndex) {
  const funnel = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const trendRecords = records.filter((r) => r.strategyKey === 'trend')
    for (const basis of BASES) {
      const basisRecords = trendRecords.filter((r) => r.basis === basis)
      for (const regime of REGIME_VALUES) {
        const regimeRecords = basisRecords.filter((r) => r.regime === regime)
        // signals = 가격 인덱스에서 실제로 조회 가능한 레코드 수 — aggregateEntryVariant()의
        // fillResults.length(pullbackAxis의 signals 필드)와 정확히 같은 모집단이라 두 축을
        // 직접 대조할 수 있다(backtest.test.js에서 교차 검증).
        const judgements = regimeRecords.map((r) => judgePullbackObservationForRecord(r, priceIndex)).filter(Boolean)
        const measurable = judgements.filter((j) => !j.insufficientData)
        const p1 = measurable.filter((j) => j.checks.P1)
        const p1p2 = p1.filter((j) => j.checks.P2)
        const p1p2p3 = p1p2.filter((j) => j.checks.P3)
        const observed = p1p2p3.filter((j) => j.checks.P4)
        funnel.push({
          sample,
          basis,
          regime,
          signals: judgements.length,
          insufficientData: judgements.length - measurable.length,
          steps: { p1: p1.length, p1p2: p1p2.length, p1p2p3: p1p2p3.length, observed: observed.length },
        })
      }
    }
  }
  return funnel
}

/**
 * 청산 변형 E(클라이맥스 부분 청산, v11 US-9) — 3자 비교(무청산/전량 클라이맥스 청산/부분 청산)를
 * 구성한다. 무청산=strategies[]의 trend·top5·Out·all·60거래일 고정 보유(evaluateExitVariants가
 * 쓰는 baseline60과 동일 정의 — 재사용, 재계산 없음), 전량 클라이맥스 청산=exitVariants에서
 * 이미 계산된 'exit_climax'(v10 US-9) 항목을 그대로 참조(재계산 없음 — "v10 결과 참조").
 * outTrendTop5(entryVariants/combos와 동일 스코프)에 대해서만 부분 청산을 새로 계산한다.
 */
// v11.1 US-3: 3자 비교 수치를 사람이 읽을 note 문장으로 만든다(퍼센트, %p 표기 — 다른
// 청산 후보들의 note 관례와 동일). 표본 없는 축은 "측정 불가"로 명시(NaN/undefined 노출 금지).
function formatClimaxComparisonNote(comparison) {
  const pct = (h) => (h && h.avgExcess != null ? `${(h.avgExcess * 100).toFixed(2)}%p(표본 ${h.signals})` : '측정 불가')
  return `3자 비교(평균 초과수익, Out·trend·top5): 무청산 ${pct(comparison.noExit)} / 전량 클라이맥스 청산 ${pct(comparison.fullClimaxExit)} / 부분 청산(50%+잔여) ${pct(comparison.partialClimaxExit)}`
}

function buildClimaxPartial(outTrendTop5, priceIndex, strategies, exitVariants) {
  const baseline = strategies.find((s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out' && s.signalQuality === 'all')
  const baseline60 = baseline?.byHolding?.find((h) => h.days === 60) ?? null
  const fullClimax = exitVariants.find((v) => v.name === 'exit_climax')
  const outDetail = aggregateClimaxPartialPerformance(outTrendTop5, priceIndex)
  const comparison = {
    noExit: baseline60 ? { signals: baseline60.signals, avgExcess: baseline60.avgExcess, medianExcess: baseline60.medianExcess } : null,
    fullClimaxExit: fullClimax ? { signals: fullClimax.outDetail.signals, avgExcess: fullClimax.outDetail.avgExcess, medianExcess: fullClimax.outDetail.medianExcess } : null,
    partialClimaxExit: { signals: outDetail.signals, avgExcess: outDetail.avgExcess, medianExcess: outDetail.medianExcess },
  }
  // outVsBaseline은 다른 모든 variants[] 항목이 공유하는 필수 필드다(validateVariant) —
  // evaluateExitVariants와 동일한 무청산(60거래일 고정 보유) 기준 델타 계산을 그대로 재사용.
  const bothMeasurable = outDetail.avgExcess != null && outDetail.winRate != null && baseline60?.avgExcess != null && baseline60?.winRate != null
  const outVsBaseline = {
    avgExcessDelta: bothMeasurable ? round4(outDetail.avgExcess - baseline60.avgExcess) : null,
    winRateDelta: bothMeasurable ? round4(outDetail.winRate - baseline60.winRate) : null,
  }

  return {
    climaxPartial: { name: 'exit_climax_partial', adopted: false, outDetail, comparison },
    // v11.1 US-3: variants[]에도 같은 결과를 등록 — exit_structural 등 다른 청산 후보들과
    // 동일한 채널(outVsBaseline·outDetail.발동률·평균보유일 + note)로 조회·비교할 수 있게
    // 한다. climaxPartial 위 필드(comparison 등 구조화된 3자 비교)는 계속 유지 — 이 등록은
    // 추가일 뿐 대체가 아니다. validateVariant()의 outDetail.stopHitRate는 다른 청산
    // 변형들과 공유하는 필수 필드라, "50% 부분 청산이 발동했는가"라는 동일 개념인
    // climaxTriggerRate를 그대로 별칭한다(재계산 없음).
    climaxPartialVariant: {
      name: 'exit_climax_partial',
      adopted: false,
      outVsBaseline,
      outDetail: { ...outDetail, stopHitRate: outDetail.climaxTriggerRate },
      note: formatClimaxComparisonNote(comparison),
      // v11.1 US-4: 국면별 분해도 다른 청산 변형과 동일하게 병기.
      regimeDetail: buildRegimeDetail(outTrendTop5, priceIndex, (bucket) => {
        const d = aggregateClimaxPartialPerformance(bucket, priceIndex)
        return { ...d, stopHitRate: d.climaxTriggerRate }
      }),
    },
  }
}

/**
 * 허들 교집합 축 (v11 US-10, 양 유니버스): ★★(consensus_2star) ∩ 펀더멘털 허들 판정 ×
 * sample × 국면 × byHolding. fundamentalHistory.mjs의 classifyRecordsByFundamentalVerdict를
 * 그대로 재사용(evaluateFundamentalHurdle 임계값 재구현 없음) — sample당 1회만 분류하고,
 * 국면별 분해는 이미 분류된 pass/partial/fail 레코드를 regime으로 다시 필터링만 한다.
 * fundamentalsData가 없으면 null(buildFundamentalAxis와 동일한 하위 호환 원칙).
 */
function buildHurdleIntersection(fundamentalsData, inRecords, outRecords, priceIndex, holdingDays) {
  if (!fundamentalsData) return null

  const axis = []
  for (const [sample, records] of [
    ['in', inRecords],
    ['out', outRecords],
  ]) {
    const consensus2starAllSignals = records.filter((r) => r.strategyKey === 'consensus_2star' && r.basis === 'allSignals')
    const classified = classifyRecordsByFundamentalVerdict(fundamentalsData, consensus2starAllSignals)
    if (!classified || !classified.coveredFrom) continue

    for (const regime of REGIME_VALUES) {
      const pass = classified.byVerdict.pass.filter((r) => r.regime === regime)
      const partial = classified.byVerdict.partial.filter((r) => r.regime === regime)
      const fail = classified.byVerdict.fail.filter((r) => r.regime === regime)
      const groupRecords = { pass, partial, partialOrBetter: [...pass, ...partial], fail }

      for (const hurdleGroup of HURDLE_GROUPS) {
        axis.push({
          sample,
          regime,
          hurdleGroup,
          coveredFrom: classified.coveredFrom,
          note: FUNDAMENTAL_AXIS_NOTE,
          byHolding: aggregatePerformance(groupRecords[hurdleGroup], priceIndex, holdingDays, {
            strategyKeys: ['consensus_2star'],
            bases: ['allSignals'],
          }).map((g) => ({
            days: g.days,
            signals: g.signals,
            winRate: g.winRate,
            avgExcess: g.avgExcess,
            medianExcess: g.medianExcess,
            avgReturn: g.avgReturn,
            mdd: g.mdd,
          })),
        })
      }
    }
  }
  return axis
}

/**
 * 소프트 정책 변형 3종 (측정만, PRD §3 Should/§7). 이미 계산된 outRecords에 정책 필터만
 * 적용한다(재시뮬레이션 없음 — evaluatePolicyVariant 참고).
 * - relax_off_in_downturn/twostar_only_in_downturn: 국면 조건부(하락 국면에서만 규칙 적용,
 *   다른 국면은 predicate가 항상 true라 원래 top5와 동일 — US-10 AC3).
 * - actionable_only_top5: 국면 무관, trend 신호를 상태 1·2(실행 가능)로만 재구성.
 */
function buildPolicyVariants(outRecords, priceIndex) {
  const trendAllSignals = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'allSignals')
  const trendTop5 = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
  const consensusAllSignals = outRecords.filter((r) => (r.strategyKey === 'consensus_2star' || r.strategyKey === 'consensus_1star') && r.basis === 'allSignals')
  const consensusTop5 = outRecords.filter((r) => (r.strategyKey === 'consensus_2star' || r.strategyKey === 'consensus_1star') && r.basis === 'top5')

  // v11 US-11(승인된 채택 1)부터 recommend()/runMinerviniRecommend() 자체가 이미 하락
  // 국면에서 완화 신호를 제외하므로(evaluateAsOf 참고), 아래 baselineRecords(trendTop5)는
  // 이 정책이 이미 적용된 상태로 들어온다 — predicate가 걸러낼 대상이 남아있지 않아 이
  // 변형의 델타는 이제 항상 0에 수렴한다(이중 적용이 아니라 "채택 후 실험 자체가
  // 무의미해짐"이 기대되는 결과 — 콘솔·note에 명시해 혼동 방지).
  const relaxOffInDownturn = evaluatePolicyVariant('relax_off_in_downturn', {
    poolRecords: trendAllSignals,
    baselineRecords: trendTop5,
    predicate: (r) => !(r.regime === 'down' && r.relaxationApplied),
    priceIndex,
    sampleThreshold: 50,
    extraNote:
      '하락 국면(regime=down)에서만 완화 신호 제외 — 다른 국면은 현행과 동일. ' +
      'v11 US-11부터 이 규칙이 recommend()/runMinerviniRecommend() 자체에 채택되어 ' +
      '기준선이 이미 이 규칙을 포함한 상태다 — 델타는 이제 항상 0에 가까워야 정상(이중 적용 아님)',
  })

  const twostarOnlyInDownturn = evaluatePolicyVariant('twostar_only_in_downturn', {
    poolRecords: consensusAllSignals,
    baselineRecords: consensusTop5,
    predicate: (r) => !(r.regime === 'down' && r.strategyKey === 'consensus_1star'),
    priceIndex,
    sampleThreshold: 50,
    extraNote: '하락 국면에서만 ★(consensus_1star) 제외, ★★만 구성 — 다른 국면은 현행과 동일',
  })

  const actionableOnlyTop5 = evaluatePolicyVariant('actionable_only_top5', {
    poolRecords: trendAllSignals,
    baselineRecords: trendTop5,
    predicate: (r) => r.entryState === 1 || r.entryState === 2,
    priceIndex,
    sampleThreshold: 100,
    extraNote: '국면 무관 — 상태 0(원거리)·3(확장)·산정불가 제외, 상태 1·2(실행 가능)로만 top5 구성',
  })

  return [relaxOffInDownturn, twostarOnlyInDownturn, actionableOnlyTop5]
}

/**
 * 청산 변형·조합의 국면별 분해(v11.1 US-4) — 신호일 국면(상승/중립/하락)별로 computeOutDetail
 * (이미 존재하는 aggregateExitPerformance/aggregateComboPerformance/
 * aggregateClimaxPartialPerformance 중 하나를 그대로 넘겨받아 재사용, 재구현 없음)을 다시
 * 호출하고, 같은 국면 구간의 기준선(60거래일 고정 보유)도 함께 병기한다 — 청산 A의
 * "중립·하락 국면에서 MDD 개선" 같은 선커밋 판정 기준을 진단 스크립트 없이 backtest.json
 * 자체에서 바로 대조할 수 있게 하는 것이 목적이다.
 */
function buildRegimeDetail(outTrendTop5, priceIndex, computeOutDetail) {
  return REGIME_VALUES.map((regime) => {
    const bucket = outTrendTop5.filter((r) => r.regime === regime)
    const detail = computeOutDetail(bucket)
    const baselineGroups = aggregatePerformance(bucket, priceIndex, [60], { strategyKeys: ['trend'], bases: ['top5'] })
    const baselineRow = baselineGroups.find((g) => g.days === 60) ?? null
    return {
      regime,
      signals: detail.signals,
      winRate: detail.winRate ?? null,
      avgExcess: detail.avgExcess ?? null,
      medianExcess: detail.medianExcess ?? null,
      mdd: detail.mdd ?? null,
      stopHitRate: detail.stopHitRate ?? null,
      avgHoldingDays: detail.avgHoldingDays ?? null,
      baseline: {
        signals: baselineRow?.signals ?? 0,
        winRate: baselineRow?.winRate ?? null,
        avgExcess: baselineRow?.avgExcess ?? null,
        medianExcess: baselineRow?.medianExcess ?? null,
        mdd: baselineRow?.mdd ?? null,
      },
    }
  })
}

// v9.1 US-2 가설 ②: trend/top5 Out 신호에 경로 의존 청산(변형 D) 2종을 적용해, 현행
// 60거래일 고정 보유(all·signalQuality) 대비 성과 델타를 계산한다. 채택 결정은 하지 않는다
// (adopted 항상 false — 손절·트레일링 채택은 운영자 몫).
// v11.1 US-2: outTrendTop5는 신호일 종가 체결(entry_close와 동일 가정)로 측정하는 모집단이라
// entryType='breakout'로 명시한다 — entry_close.type도 'breakout'이라 기존 가정과 일치할 뿐,
// 새 후보를 추가하는 것은 아니다. exit_structural 외의 규칙은 entryType을 읽지 않으므로
// 무해하다. 이전에는 entryType이 비어 있어 exit_structural이 "유형 불명 → 안전 기본값(손절
// 미가동)" 경로로만 빠져 발동률이 항상 0%였다(v11 US-8의 의도된 단독-호출 기본값이었으나,
// 실측 결과 이 경로가 exit_structural의 유일한 일반 측정 채널이라 무의미했다 — v11.1 수리).
export function evaluateExitVariants(outRecords, strategies, priceIndex, regimeByDate = new Map()) {
  const outTrendTop5 = outRecords.filter((r) => r.strategyKey === 'trend' && r.basis === 'top5')
  const baseline = strategies.find((s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out' && s.signalQuality === 'all')
  const baseline60 = baseline?.byHolding?.find((h) => h.days === 60) ?? null

  return Object.values(EXIT_RULES).map((rule) => {
    const outDetail = aggregateExitPerformance(outTrendTop5, priceIndex, rule, { regimeByDate, entryType: 'breakout' })
    const bothMeasurable = outDetail.avgExcess != null && outDetail.winRate != null && baseline60?.avgExcess != null && baseline60?.winRate != null
    const outVsBaseline = {
      avgExcessDelta: bothMeasurable ? round4(outDetail.avgExcess - baseline60.avgExcess) : null,
      winRateDelta: bothMeasurable ? round4(outDetail.winRate - baseline60.winRate) : null,
    }
    const note = [
      `Out 표본 ${outDetail.signals}건 (trend·top5 기준) vs 현행 60거래일 고정 보유(표본 ${baseline60?.signals ?? 0}건)`,
      EXIT_LIMITATION_NOTE,
    ].join(' / ')
    const regimeDetail = buildRegimeDetail(outTrendTop5, priceIndex, (bucket) => aggregateExitPerformance(bucket, priceIndex, rule, { regimeByDate, entryType: 'breakout' }))
    return { name: rule.name, adopted: false, outVsBaseline, outDetail, note, regimeDetail }
  })
}

function formatInOutSummary(backtest) {
  const lines = []
  for (const s of backtest.strategies) {
    if (s.basis !== 'top5' || s.signalQuality !== 'all') continue
    const d20 = s.byHolding.find((h) => h.days === 20)
    if (!d20 || d20.signals === 0) continue
    lines.push(`  ${s.key} (${s.sample}): 20거래일 승률 ${(d20.winRate * 100).toFixed(1)}% · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p (표본 ${d20.signals})`)
  }
  return lines.join('\n')
}

// v9.1 US-1 가설 ①: In 구간 추세추종 붕괴가 완화 폴백 신호 탓인지 판정하기 위한
// In/Out × normal/relaxed 비교표 (allSignals 기준 — top5는 완화 신호가 거의 없어 표본이 너무 작음).
function formatSignalQualityComparison(backtest) {
  const lines = []
  for (const sample of ['in', 'out']) {
    for (const quality of ['normal', 'relaxed']) {
      const s = backtest.strategies.find((x) => x.key === 'trend' && x.basis === 'allSignals' && x.sample === sample && x.signalQuality === quality)
      const d20 = s?.byHolding?.find((h) => h.days === 20)
      const label = `${sample}/${quality}`
      if (!d20 || d20.signals === 0) {
        lines.push(`  ${label}: 표본 부족`)
        continue
      }
      lines.push(`  ${label}: 승률 ${(d20.winRate * 100).toFixed(1)}% · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p (표본 ${d20.signals})`)
    }
  }
  return lines.join('\n')
}

// v9.1 US-3: 명목 표본(신호 수)과 겹침 보정을 반영한 유효 독립 표본 근사를 병기한다
// (stepDays가 holdingDays보다 작으면 인접 평가일의 보유 구간이 겹쳐 표본이 과대해 보인다).
export function formatOverlapFactorNote(backtest) {
  const trendOut20 = backtest.strategies.find(
    (s) => s.key === 'trend' && s.basis === 'top5' && s.sample === 'out' && s.signalQuality === 'all'
  )?.byHolding?.find((h) => h.days === 20)
  const factor = backtest.config.overlapFactor?.[20]
  if (!trendOut20 || !factor) return '겹침 보정: 계산 불가'
  const effective = round4(trendOut20.signals / factor)
  return `겹침 보정(20거래일 기준): 명목 표본 ${trendOut20.signals} / 유효 독립 표본 근사 ${effective} (overlapFactor=${factor})`
}

// v9.1 US-4 가설 ③: Out 구간 코호트별 20일·60일 초과수익 표 — 신선 신호(0d/1-2d)와
// 지연 신호(3d+/5d+/no_recent_breakout)의 성과 차이가 왕복 거래비용 가정을 넘는지 판정 재료.
export function formatFreshnessCohortSummary(backtest) {
  const lines = []
  for (const key of ['trend', 'minervini']) {
    for (const cohort of ['0d', '1-2d', '3-4d', '5d+', 'no_recent_breakout']) {
      const entry = backtest.freshnessCohorts?.find((f) => f.key === key && f.sample === 'out' && f.cohort === cohort)
      const parts = [20, 60].map((days) => {
        const h = entry?.byHolding?.find((b) => b.days === days)
        if (!h || h.signals === 0) return `${days}일 표본 부족`
        return `${days}일 초과수익 ${(h.avgExcess * 100).toFixed(2)}%p (표본 ${h.signals})`
      })
      lines.push(`  ${key}/${cohort}: ${parts.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

// v10 US-7: In/Out 각각의 국면 구성비 + 국면별 성과 — In/Out 역전을 "기간"이 아니라
// "국면"의 지식으로 재해석하기 위한 표(PRD §4.2 1단 목표). trend/allSignals/20거래일 기준.
export function formatRegimeReinterpretation(backtest) {
  const findEntry = (sample, regime) => backtest.regimeAxis?.find((r) => r.strategyKey === 'trend' && r.sample === sample && r.regime === regime)

  const lines = []
  for (const sample of ['in', 'out']) {
    const totalSignals = REGIME_VALUES.reduce((sum, regime) => sum + (findEntry(sample, regime)?.byHolding?.find((h) => h.days === 20)?.signals ?? 0), 0)
    lines.push(`  [${sample}] 국면 구성 (trend·allSignals·20거래일 신호 수 기준, 총 ${totalSignals}건)`)
    for (const regime of REGIME_VALUES) {
      const d20 = findEntry(sample, regime)?.byHolding?.find((h) => h.days === 20)
      if (!d20 || d20.signals === 0) {
        lines.push(`    ${regime}: 표본 부족`)
        continue
      }
      const share = totalSignals ? ((d20.signals / totalSignals) * 100).toFixed(1) : '0.0'
      lines.push(`    ${regime}: 구성비 ${share}% (표본 ${d20.signals}) · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p`)
    }
  }
  return lines.join('\n')
}

// v11 US-4: 상태0(원거리 눌림목 후보) × 국면 표 — v10 발견 #6의 "구조 몫 vs 국면 몫" 분리가
// 1차 목표(PRD §4.5). trend/out/20거래일 기준으로 국면별 성과를 나란히 보여준다.
export function formatState0RegimeTable(backtest) {
  const lines = []
  for (const regime of REGIME_VALUES) {
    const entry = backtest.stateRegimeAxis?.find((r) => r.strategyKey === 'trend' && r.sample === 'out' && r.state === 0 && r.regime === regime)
    const d20 = entry?.byHolding?.find((h) => h.days === 20)
    if (!d20 || d20.signals === 0) {
      lines.push(`  상태0 × ${regime}: 표본 부족`)
      continue
    }
    lines.push(`  상태0 × ${regime}: 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p · 승률 ${(d20.winRate * 100).toFixed(1)}% (표본 ${d20.signals})`)
  }
  return lines.join('\n')
}

// v11 US-6: 눌림목 진입 변형 3종 × 국면 비교표 (allSignals·Out·20거래일, conditional 기준) —
// v10 상태 0 실측(+36~40%p·승률 84~91%, 표본 11~56건)과의 대조 주석을 함께 남긴다. 체결
// 시뮬레이션(재개 확인)이 실측 재현치를 그대로 복제하진 않는다는 한계를 명시한다.
export function formatPullbackComparison(backtest) {
  const lines = []
  for (const name of ['pullback_immediate', 'pullback_resume', 'pullback_resume_vol']) {
    for (const regime of REGIME_VALUES) {
      const entry = backtest.pullbackAxis?.find((p) => p.name === name && p.sample === 'out' && p.basis === 'allSignals' && p.regime === regime)
      const d20 = entry?.byHolding?.find((h) => h.days === 20)?.conditional
      if (!entry || !d20 || d20.signals === 0) {
        lines.push(`  ${name} × ${regime}: 표본 부족`)
        continue
      }
      const fillRatePct = entry.fillRate != null ? `${(entry.fillRate * 100).toFixed(1)}%` : 'N/A'
      lines.push(`  ${name} × ${regime}: 체결률 ${fillRatePct} · 초과수익 ${(d20.avgExcess * 100).toFixed(2)}%p · 승률 ${(d20.winRate * 100).toFixed(1)}% (표본 ${d20.signals})`)
    }
  }
  lines.push(
    '  참고(v10 상태0 실측): 트렌드템플릿+피벗−10%↑눌림 교집합 초과수익 +36~40%p·승률 84~91%(표본 11~56건, In+1.1%p와 격차 커 국면 몫 분리 필요) — 위 체결 시뮬레이션 수치와는 조건·표본이 달라 직접 비교엔 한계가 있다.'
  )
  return lines.join('\n')
}

// v11.1 US-1: 눌림목 관찰 조건 퍼널표 — P1 → ∩P2 → ∩P3 → ∩P4(observed) 단계별 통과 수를
// sample=out·basis=allSignals·국면별로 나열한다(pullbackAxis 판정에 실제로 쓰이는 모집단과
// 동일 스코프). 어느 단계에서 신호가 고사하는지 한눈에 보이도록 하는 진단용 — 조건 자체를
// 바꾸는 도구가 아니다.
export function formatPullbackFunnel(backtest) {
  const lines = []
  for (const regime of REGIME_VALUES) {
    const entry = backtest.pullbackFunnel?.find((f) => f.sample === 'out' && f.basis === 'allSignals' && f.regime === regime)
    if (!entry) {
      lines.push(`  ${regime}: 데이터 없음`)
      continue
    }
    const { steps } = entry
    lines.push(
      `  ${regime} (평가 대상 ${entry.signals}건, 산정불가 ${entry.insufficientData}건): P1 ${steps.p1} → ∩P2 ${steps.p1p2} → ∩P3 ${steps.p1p2p3} → ∩P4(관찰) ${steps.observed}`
    )
  }
  return lines.join('\n')
}

function loadFundamentalsIfPresent(dataPath, fundamentalsFileName = NDX_FUNDAMENTALS_FILENAME) {
  // nasdaq100.json과 같은 디렉터리의 fundamentals(_ngx).json을 선택적으로 사용한다(US-6/US-11) —
  // 없으면 조용히 null(엔진은 fundamentalAxis:null로 정상 완주, graceful degradation).
  const candidate = path.join(path.dirname(dataPath), fundamentalsFileName)
  if (!existsSync(candidate)) return null
  try {
    return JSON.parse(readFileSync(candidate, 'utf-8'))
  } catch {
    return null
  }
}

// v10 US-11: NGX vs 나스닥100 ★★ 컨센서스 비교 (§7 판정 기준 3항목 재료). 기존 production
// backtest.json이 있으면 함께 읽어 비교하고, 없으면(신선 실행 등) 조용히 생략한다.
function formatNgxVsNdxComparison(ngxBacktest, ndxOutputPath) {
  if (!existsSync(ndxOutputPath)) {
    return `나스닥100 백테스트(${ndxOutputPath})가 없어 비교를 생략합니다.`
  }
  let ndxBacktest
  try {
    ndxBacktest = JSON.parse(readFileSync(ndxOutputPath, 'utf-8'))
  } catch {
    return `나스닥100 백테스트(${ndxOutputPath}) 읽기 실패로 비교를 생략합니다.`
  }

  const find2starOut20 = (bt) => bt.strategies?.find((s) => s.key === 'consensus_2star' && s.sample === 'out' && s.basis === 'top5' && (s.signalQuality ?? 'all') === 'all')?.byHolding?.find((h) => h.days === 20)

  const ndx = find2starOut20(ndxBacktest)
  const ngx = find2starOut20(ngxBacktest)
  const fmt = (h) => (h && h.signals > 0 ? `승률 ${(h.winRate * 100).toFixed(1)}% · 초과수익 ${(h.avgExcess * 100).toFixed(2)}%p (표본 ${h.signals})` : '표본 부족')

  return [
    `나스닥100 ★★(out·top5·20거래일): ${fmt(ndx)}`,
    `NGX      ★★(out·top5·20거래일): ${fmt(ngx)}`,
    `NGX 펀더멘털 Pass 표본·Out 표본 ≥50/≥100 등 §7 판정 기준표는 운영자가 별도 확인.`,
  ].join('\n')
}

// v9.1 US-3: --step=N(기본 5, 허용 1~10) / --out=경로 형태의 named 플래그를 파싱한다.
// 첫 번째 non-flag 인자는 여전히 dataPath(위치 인자, 하위 호환)로 취급한다.
export function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) flags[m[1]] = m[2]
    else positional.push(arg)
  }
  return { flags, positional }
}

/**
 * 파싱된 flags를 검증하고 stepDays를 확정한다 (main()과 테스트가 공유하는 순수 함수).
 * 반환: { ok: true, stepDays } | { ok: false, error }
 */
export function validateCliArgs(flags) {
  const stepDays = flags.step !== undefined ? Number(flags.step) : 5
  if (!Number.isInteger(stepDays) || stepDays < 1 || stepDays > 10) {
    return { ok: false, error: `--step은 1~10 사이 정수여야 합니다 (받은 값: ${flags.step})` }
  }
  // 화면 표시용 공식 backtest.json은 항상 step=5 산출물이라는 운영 규칙(README 참고) —
  // step≠5 실험 실행이 실수로 공식 파일을 덮어쓰지 않도록 --out을 강제한다.
  if (stepDays !== 5 && !flags.out) {
    return { ok: false, error: '--step이 5가 아니면 --out=경로를 반드시 지정해야 합니다 (공식 backtest.json 보호)' }
  }
  // v10 US-11: --universe는 ndx(기본)|ngx만 허용.
  const universe = flags.universe ?? 'ndx'
  if (universe !== 'ndx' && universe !== 'ngx') {
    return { ok: false, error: `--universe는 ndx 또는 ngx여야 합니다 (받은 값: ${flags.universe})` }
  }
  return { ok: true, stepDays, universe }
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))

  const validated = validateCliArgs(flags)
  if (!validated.ok) {
    console.error(`✗ ${validated.error}`)
    process.exitCode = 1
    return
  }
  const { stepDays, universe } = validated

  const defaultDataPath = universe === 'ngx' ? DEFAULT_NGX_DATA_PATH : DEFAULT_DATA_PATH
  const defaultOutputPath = universe === 'ngx' ? DEFAULT_NGX_OUTPUT_PATH : DEFAULT_OUTPUT_PATH
  const fundamentalsFileName = universe === 'ngx' ? NGX_FUNDAMENTALS_FILENAME : NDX_FUNDAMENTALS_FILENAME

  const dataPath = flags.data ? path.resolve(flags.data) : positional[0] ? path.resolve(positional[0]) : defaultDataPath
  const outputPath = flags.out ? path.resolve(flags.out) : defaultOutputPath

  const rawUniverse = loadRawUniverse(dataPath)
  const dataset = buildDataset(rawUniverse)
  const { trend, minervini } = runSmoke(dataset)

  console.log(`데이터 기준일: ${dataset.generatedAt} (${dataPath})`)
  console.log(formatSummary('추세추종', trend))
  console.log(formatSummary('미너비니', minervini))

  const evaluationDates = buildEvaluationDates(rawUniverse, { stepDays })
  console.log(`평가일 ${evaluationDates.length}개 (stepDays=${stepDays})`)

  // step=1은 evaluationDates가 약 5배로 늘어 연산량도 비례 증가한다 — 평가일 단위 진행률 로그.
  const logEvery = Math.max(1, Math.floor(evaluationDates.length / 10))
  const onProgress = (done, total) => {
    if (done % logEvery === 0 || done === total) console.log(`  진행률: ${done}/${total} 평가일`)
  }

  const fundamentalsData = loadFundamentalsIfPresent(dataPath, fundamentalsFileName)
  const backtest = runBacktest(rawUniverse, { fundamentalsData, stepDays, onProgress, universe })
  console.log(`유니버스: ${universe} (제외율: hasFullYearData 미달 ${backtest.config.universeStats.hasFullYearDataExcludedCount}/${backtest.config.universeStats.tickerCount})`)
  console.log(`In/Out 분할: splitDate=${backtest.config.splitDate}`)
  console.log(formatInOutSummary(backtest))
  console.log('추세추종 신호 품질 비교 (가설 ① 판정 재료, allSignals·20거래일):')
  console.log(formatSignalQualityComparison(backtest))
  console.log(formatOverlapFactorNote(backtest))
  console.log('신호 신선도 코호트 (가설 ③ 판정 재료, Out·allSignals·20/60거래일):')
  console.log(formatFreshnessCohortSummary(backtest))
  console.log('국면별 재해석 (In/Out 역전을 국면 지식으로 재해석, v10 US-7):')
  console.log(formatRegimeReinterpretation(backtest))
  console.log('상태0 × 국면 (v10 발견 #6의 구조 몫 vs 국면 몫 분리, v11 US-4, trend·Out·20거래일):')
  console.log(formatState0RegimeTable(backtest))
  console.log('눌림목 관찰 조건(P1~P4) 퍼널 (v11.1 US-1, allSignals·Out):')
  console.log(formatPullbackFunnel(backtest))
  console.log('눌림목 진입 변형 3종 × 국면 비교 (v11 US-6, allSignals·Out·20거래일):')
  console.log(formatPullbackComparison(backtest))
  console.log(backtest.fundamentalAxis ? `펀더멘털 축: coveredFrom=${backtest.fundamentalAxis.coveredFrom}` : '펀더멘털 축: fundamentals.json 없음(생략)')
  if (universe === 'ngx') {
    console.log('NGX vs 나스닥100 ★★ 컨센서스 비교 (v10 US-11, PRD §7 판정 기준 재료):')
    console.log(formatNgxVsNdxComparison(backtest, DEFAULT_OUTPUT_PATH))
  }

  const result = atomicWriteBacktest(outputPath, backtest)
  if (!result.ok) {
    console.error(`✗ ${outputPath}: 스키마 검증 실패`)
    result.errors.forEach((e) => console.error(`  - ${e}`))
    process.exitCode = 1
    return
  }
  console.log(`✓ ${outputPath} 작성 완료`)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
