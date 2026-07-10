import { useEffect, useMemo, useState } from 'react'
import { loadNasdaq100 } from './lib/loadData.js'
import { loadResearch, buildResearchMap } from './lib/researchLoader.js'
import { applyFilters, countWeek52Excluded } from './lib/filters.js'
import { recommend } from './lib/recommend.js'
import { PRESETS, DEFAULT_PRESET_KEY } from './lib/presets.js'
import { loadPersistedState, savePersistedState, DEFAULT_UI_STATE } from './lib/persistence.js'
import NavTabs from './components/NavTabs.jsx'
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

  useEffect(() => {
    loadNasdaq100()
      .then(async (d) => {
        setDataset(d)
        const validSet = new Set(d.tickers.map((t) => t.ticker))
        setUiState(loadPersistedState(validSet))

        // research.json은 선택적 스냅샷 — 없거나 스키마가 안 맞아도 앱은 정상 동작해야 한다
        const research = await loadResearch()
        setResearchMap(buildResearchMap(research, d.generatedAt, validSet))
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

      {uiState.currentScreen === 'home' && (
        <HomeSearch
          searchQuery={uiState.searchQuery}
          onSearchQueryChange={(searchQuery) => setUiState((s) => ({ ...s, searchQuery }))}
          filters={uiState.filters}
          onFiltersChange={(filters) => setUiState((s) => ({ ...s, filters }))}
          filteredTickers={filteredTickers}
          week52ExcludedCount={week52ExcludedCount}
          onGoToRecommend={() => setScreen('recommend')}
        />
      )}

      {uiState.currentScreen === 'recommend' && (
        <Recommend
          generatedAt={dataset.generatedAt}
          recommendation={recommendation}
          researchMap={researchMap}
          preset={uiState.preset}
          onPresetChange={changePreset}
          customParams={uiState.customParams}
          onCustomParamChange={changeCustomParam}
          onResetToDefault={() => changePreset(DEFAULT_PRESET_KEY)}
          selectedTickers={uiState.selectedTickers}
          onToggleSelect={toggleSelectedTicker}
          onGoToSimulation={() => setScreen('simulation')}
        />
      )}

      {uiState.currentScreen === 'simulation' && (
        <Simulation
          generatedAt={dataset.generatedAt}
          allTickerData={availableTickerData}
          researchMap={researchMap}
          selectedTickers={uiState.selectedTickers}
          selectedTickerData={selectedTickerData}
          onToggleTicker={toggleSelectedTicker}
          onGoToPortfolio={() => setScreen('portfolio')}
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
        />
      )}
    </div>
  )
}

function CenteredMessage({ children }) {
  return <div className="flex items-center justify-center min-h-screen text-gray-500">{children}</div>
}
