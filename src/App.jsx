import { useEffect, useMemo, useState } from 'react'
import { loadNasdaq100 } from './lib/loadData.js'
import { loadResearch, buildResearchMap } from './lib/researchLoader.js'
import { loadFundamentals, buildFundamentalsMap } from './lib/fundamentalsLoader.js'
import { loadBacktest } from './lib/backtestLoader.js'
import { applyFilters, countWeek52Excluded } from './lib/filters.js'
import { recommend } from './lib/recommend.js'
import { runMinerviniRecommend } from './lib/minervini.js'
import { buildConsensusRanking } from './lib/consensus.js'
import { currentRegime } from './lib/regime.js'
import { PRESETS, DEFAULT_PRESET_KEY } from './lib/presets.js'
import { loadPersistedState, savePersistedState, DEFAULT_UI_STATE } from './lib/persistence.js'
import NavTabs from './components/NavTabs.jsx'
import ResearchRequestList from './components/ResearchRequestList.jsx'
import HomeSearch from './screens/HomeSearch.jsx'
import Recommend from './screens/Recommend.jsx'
import Simulation from './screens/Simulation.jsx'
import Portfolio from './screens/Portfolio.jsx'

const roundPct = (x) => Math.round(x * 10) / 10

// 선택된 종목 전체를 100/n 균등 비중으로 재배분한다 (기본값 및 "균등 배분" 리셋에 사용)
function equalSplit(tickers) {
  const n = tickers.length
  if (n === 0) return {}
  const share = roundPct(100 / n)
  return Object.fromEntries(tickers.map((t) => [t, share]))
}

export default function App() {
  const [dataset, setDataset] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [uiState, setUiState] = useState(DEFAULT_UI_STATE)
  const [researchMap, setResearchMap] = useState(new Map())
  const [fundamentalsMap, setFundamentalsMap] = useState(new Map())
  const [backtest, setBacktest] = useState(null)

  useEffect(() => {
    loadNasdaq100()
      .then(async (d) => {
        setDataset(d)
        const validSet = new Set(d.tickers.map((t) => t.ticker))
        setUiState(loadPersistedState(validSet))

        // research.json/fundamentals.json/backtest.json은 선택적 스냅샷 — 없거나 스키마가
        // 안 맞아도 앱은 정상 동작해야 한다 (US-7/US-11/v9 US-8 graceful degradation)
        const research = await loadResearch()
        setResearchMap(buildResearchMap(research, d.generatedAt, validSet))

        const fundamentals = await loadFundamentals()
        setFundamentalsMap(buildFundamentalsMap(fundamentals, validSet))

        setBacktest(await loadBacktest())
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  useEffect(() => {
    if (dataset) savePersistedState(uiState)
  }, [uiState, dataset])

  const filteredTickers = useMemo(() => {
    if (!dataset) return []
    return applyFilters(dataset.tickers, uiState.filters, uiState.searchQuery, dataset.universeAtrPercents)
  }, [dataset, uiState.filters, uiState.searchQuery])

  // 52주 필터가 켜져 있을 때 안내할, 252거래일 미만이라 판정 대상에서 제외된 종목 수
  const week52ExcludedCount = useMemo(() => {
    if (!dataset) return 0
    return countWeek52Excluded(
      dataset.tickers.filter((t) => t.dataSufficient).map((t) => t.indicators.week52)
    )
  }, [dataset])

  // preset='custom'이면 고급 설정(US-10)의 customParams를 recommend() 설정으로 변환한다.
  // 완화 창은 "동일 로직 유지 (창 2배)" 규칙을 그대로 임의값에 적용 — recommend.js가
  // macdLineSeries/signalLineSeries로 임의 창을 즉석 계산하도록 이미 일반화돼 있다(US-10).
  const activeConfig =
    uiState.preset === 'custom'
      ? {
          rsiMin: uiState.customParams.rsiMin,
          goldenCrossWindow: uiState.customParams.goldenCrossWindow,
          goldenCrossRelaxedWindow: uiState.customParams.goldenCrossWindow * 2,
          highScoreThreshold: uiState.customParams.highScoreThreshold,
        }
      : (PRESETS[uiState.preset] ?? PRESETS[DEFAULT_PRESET_KEY])
  const recommendation = useMemo(() => recommend(filteredTickers, activeConfig), [filteredTickers, activeConfig])

  // 미너비니 모드(PRD_Nasdaq8 US-4/US-5)는 원전 기준 고정 — 추세추종처럼 프리셋/고급설정의
  // 대상이 아니므로 activeConfig 없이 filteredTickers만으로 계산한다.
  const minerviniResult = useMemo(() => runMinerviniRecommend(filteredTickers), [filteredTickers])
  const consensusResult = useMemo(
    () => buildConsensusRanking(recommendation, minerviniResult),
    [recommendation, minerviniResult]
  )

  const changeRecommendMode = (recommendMode) => setUiState((s) => ({ ...s, recommendMode }))

  const toggleHideRiskFlagged = () => setUiState((s) => ({ ...s, hideRiskFlagged: !s.hideRiskFlagged }))

  // 프리셋 버튼 클릭 시: preset 전환 + 고급 설정 값도 그 프리셋 값으로 덮어쓴다(PRD_Nasdaq7 §3 Must-9).
  const changePreset = (key) =>
    setUiState((s) => ({
      ...s,
      preset: key,
      customParams: {
        rsiMin: PRESETS[key].rsiMin,
        goldenCrossWindow: PRESETS[key].goldenCrossWindow,
        highScoreThreshold: PRESETS[key].highScoreThreshold,
      },
    }))

  // 고급 설정 파라미터를 직접 조정하면 preset이 'custom'으로 전환된다.
  const changeCustomParam = (key, value) =>
    setUiState((s) => ({ ...s, preset: 'custom', customParams: { ...s.customParams, [key]: value } }))

  const availableTickerData = useMemo(() => {
    if (!dataset) return []
    return dataset.tickers.filter((t) => t.dataSufficient)
  }, [dataset])

  // 화면2 진입가/청산신호 카드(v10 US-13)가 티커별 원본 series를 조회하는 데 쓴다.
  const tickerDataMap = useMemo(() => new Map(availableTickerData.map((t) => [t.ticker, t])), [availableTickerData])

  // 화면2 국면 배지(v10 US-13) — regime.js가 dataset.tickers만으로 계산(백엔드 호출 없음).
  const regimeInfo = useMemo(() => {
    if (!dataset) return null
    return currentRegime(dataset.tickers)
  }, [dataset])

  const selectedTickerData = useMemo(() => {
    if (!dataset) return []
    const byTicker = new Map(dataset.tickers.map((t) => [t.ticker, t]))
    return uiState.selectedTickers.map((t) => byTicker.get(t)).filter(Boolean)
  }, [dataset, uiState.selectedTickers])

  const toggleSelectedTicker = (ticker) =>
    setUiState((s) => {
      const isSelected = s.selectedTickers.includes(ticker)
      const selectedTickers = isSelected
        ? s.selectedTickers.filter((t) => t !== ticker)
        : [...s.selectedTickers, ticker]
      return { ...s, selectedTickers, weights: equalSplit(selectedTickers) }
    })

  // 한 종목의 비중을 조정하면 나머지 종목들이 남은 비중(100 - value)을 균등하게 나눠 가져
  // 전체 합이 항상 100이 되도록 자동 재조정한다.
  const adjustTickerWeight = (ticker, rawValue) =>
    setUiState((s) => {
      const others = s.selectedTickers.filter((t) => t !== ticker)
      if (others.length === 0) {
        return { ...s, weights: { [ticker]: 100 } }
      }
      const value = Math.max(0, Math.min(100, rawValue))
      const othersShare = roundPct((100 - value) / others.length)
      const weights = { [ticker]: value }
      others.forEach((t) => {
        weights[t] = othersShare
      })
      return { ...s, weights }
    })

  const resetWeightsToEqual = () =>
    setUiState((s) => ({ ...s, weights: equalSplit(s.selectedTickers) }))

  // 리서치 요청 목록 (US-11, v6 연계 절충안 A) — 담기/해제 토글, 중복 자동 방지 (배열 필터/추가)
  const toggleResearchRequest = (ticker) =>
    setUiState((s) => {
      const isRequested = s.researchRequests.includes(ticker)
      const researchRequests = isRequested
        ? s.researchRequests.filter((t) => t !== ticker)
        : [...s.researchRequests, ticker]
      return { ...s, researchRequests }
    })

  const removeResearchRequest = (ticker) =>
    setUiState((s) => ({ ...s, researchRequests: s.researchRequests.filter((t) => t !== ticker) }))

  const clearResearchRequests = () => setUiState((s) => ({ ...s, researchRequests: [] }))

  // 화면2 진입가 산출 근거 카드 펼침/접힘 토글 (v10 US-12/US-13)
  const toggleEntryEvidence = (ticker) =>
    setUiState((s) => ({
      ...s,
      expandedEntryEvidence: { ...s.expandedEntryEvidence, [ticker]: !s.expandedEntryEvidence[ticker] },
    }))

  // 화면 3·4 청산 계획(체결가 필수·체결일 선택) 입력 (v10 US-14). 체결가가 비거나
  // 무효(0 이하)면 해당 포지션 자체를 지운다 — persistence.js의 sanitizePositions와
  // 동일 원칙("체결가 없는 포지션은 의미 없음").
  const setPositionEntryPrice = (ticker, rawValue) =>
    setUiState((s) => {
      const value = rawValue === '' ? NaN : Number(rawValue)
      const positions = { ...s.positions }
      if (!(value > 0)) {
        delete positions[ticker]
      } else {
        positions[ticker] = { ...positions[ticker], entryPrice: value }
      }
      return { ...s, positions }
    })

  const setPositionEntryDate = (ticker, dateValue) =>
    setUiState((s) => {
      const existing = s.positions[ticker]
      if (!existing) return s // 체결가 없이 체결일만 입력할 순 없음(체결가가 필수)
      const positions = {
        ...s.positions,
        [ticker]: dateValue ? { ...existing, entryDate: dateValue } : { entryPrice: existing.entryPrice },
      }
      return { ...s, positions }
    })

  if (loadError) {
    return <CenteredMessage>데이터 로드 실패: {loadError}</CenteredMessage>
  }
  if (!dataset) {
    return <CenteredMessage>데이터 로딩 중...</CenteredMessage>
  }

  const setScreen = (currentScreen) => setUiState((s) => ({ ...s, currentScreen }))

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">나스닥 종목추천</h1>
      <p className="text-sm text-gray-500 mb-6">기술적 지표 기반 나스닥100 종목 추천 · 3개월 시뮬레이션</p>

      <NavTabs current={uiState.currentScreen} onChange={setScreen} />

      <ResearchRequestList
        tickers={uiState.researchRequests}
        onRemove={removeResearchRequest}
        onClearAll={clearResearchRequests}
      />

      {uiState.currentScreen === 'home' && (
        <HomeSearch
          searchQuery={uiState.searchQuery}
          onSearchQueryChange={(searchQuery) => setUiState((s) => ({ ...s, searchQuery }))}
          filters={uiState.filters}
          onFiltersChange={(filters) => setUiState((s) => ({ ...s, filters }))}
          filteredTickers={filteredTickers}
          week52ExcludedCount={week52ExcludedCount}
          researchRequests={uiState.researchRequests}
          onToggleResearchRequest={toggleResearchRequest}
          onGoToRecommend={() => setScreen('recommend')}
        />
      )}

      {uiState.currentScreen === 'recommend' && (
        <Recommend
          generatedAt={dataset.generatedAt}
          recommendation={recommendation}
          minerviniResult={minerviniResult}
          consensusResult={consensusResult}
          recommendMode={uiState.recommendMode}
          onModeChange={changeRecommendMode}
          researchMap={researchMap}
          fundamentalsMap={fundamentalsMap}
          hideRiskFlagged={uiState.hideRiskFlagged}
          onToggleHideRiskFlagged={toggleHideRiskFlagged}
          preset={uiState.preset}
          onPresetChange={changePreset}
          customParams={uiState.customParams}
          onCustomParamChange={changeCustomParam}
          onResetToDefault={() => changePreset(DEFAULT_PRESET_KEY)}
          researchRequests={uiState.researchRequests}
          onToggleResearchRequest={toggleResearchRequest}
          selectedTickers={uiState.selectedTickers}
          onToggleSelect={toggleSelectedTicker}
          onGoToSimulation={() => setScreen('simulation')}
          backtest={backtest}
          regimeInfo={regimeInfo}
          tickerDataMap={tickerDataMap}
          expandedEntryEvidence={uiState.expandedEntryEvidence}
          onToggleEntryEvidence={toggleEntryEvidence}
        />
      )}

      {uiState.currentScreen === 'simulation' && (
        <Simulation
          generatedAt={dataset.generatedAt}
          allTickerData={availableTickerData}
          researchMap={researchMap}
          researchRequests={uiState.researchRequests}
          onToggleResearchRequest={toggleResearchRequest}
          selectedTickers={uiState.selectedTickers}
          selectedTickerData={selectedTickerData}
          onToggleTicker={toggleSelectedTicker}
          onGoToPortfolio={() => setScreen('portfolio')}
          positions={uiState.positions}
          onChangeEntryPrice={setPositionEntryPrice}
          onChangeEntryDate={setPositionEntryDate}
        />
      )}

      {uiState.currentScreen === 'portfolio' && (
        <Portfolio
          generatedAt={dataset.generatedAt}
          allTickerData={availableTickerData}
          selectedTickers={uiState.selectedTickers}
          selectedTickerData={selectedTickerData}
          weights={uiState.weights}
          onToggleTicker={toggleSelectedTicker}
          onWeightChange={adjustTickerWeight}
          onResetWeights={resetWeightsToEqual}
          positions={uiState.positions}
          onChangeEntryPrice={setPositionEntryPrice}
          onChangeEntryDate={setPositionEntryDate}
        />
      )}
    </div>
  )
}

function CenteredMessage({ children }) {
  return <div className="flex items-center justify-center min-h-screen text-gray-500">{children}</div>
}
