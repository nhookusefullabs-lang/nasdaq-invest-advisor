import { useEffect, useMemo, useState } from 'react'
import { loadNasdaq100 } from './lib/loadData.js'
import { applyFilters } from './lib/filters.js'
import { recommend } from './lib/recommend.js'
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

  useEffect(() => {
    loadNasdaq100()
      .then((d) => {
        setDataset(d)
        const validSet = new Set(d.tickers.map((t) => t.ticker))
        setUiState(loadPersistedState(validSet))
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  useEffect(() => {
    if (dataset) savePersistedState(uiState)
  }, [uiState, dataset])

  const filteredTickers = useMemo(() => {
    if (!dataset) return []
    return applyFilters(dataset.tickers, uiState.filters, uiState.searchQuery)
  }, [dataset, uiState.filters, uiState.searchQuery])

  const recommendation = useMemo(() => recommend(filteredTickers), [filteredTickers])

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
          onGoToRecommend={() => setScreen('recommend')}
        />
      )}

      {uiState.currentScreen === 'recommend' && (
        <Recommend
          generatedAt={dataset.generatedAt}
          recommendation={recommendation}
          selectedTickers={uiState.selectedTickers}
          onToggleSelect={toggleSelectedTicker}
          onGoToSimulation={() => setScreen('simulation')}
        />
      )}

      {uiState.currentScreen === 'simulation' && (
        <Simulation
          generatedAt={dataset.generatedAt}
          allTickerData={availableTickerData}
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
