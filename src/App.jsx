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

  const selectedTickerData = useMemo(() => {
    if (!dataset) return []
    const byTicker = new Map(dataset.tickers.map((t) => [t.ticker, t]))
    return uiState.selectedTickers.map((t) => byTicker.get(t)).filter(Boolean)
  }, [dataset, uiState.selectedTickers])

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

      <NavTabs current={uiState.currentScreen} onChange={setScreen} selectedCount={uiState.selectedTickers.length} />

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
          onToggleSelect={(ticker) =>
            setUiState((s) => ({
              ...s,
              selectedTickers: s.selectedTickers.includes(ticker)
                ? s.selectedTickers.filter((t) => t !== ticker)
                : [...s.selectedTickers, ticker],
            }))
          }
          onGoToSimulation={() => setScreen('simulation')}
        />
      )}

      {uiState.currentScreen === 'simulation' && (
        <Simulation
          generatedAt={dataset.generatedAt}
          selectedTickerData={selectedTickerData}
          onGoToPortfolio={() => setScreen('portfolio')}
        />
      )}

      {uiState.currentScreen === 'portfolio' && (
        <Portfolio generatedAt={dataset.generatedAt} selectedTickerData={selectedTickerData} />
      )}
    </div>
  )
}

function CenteredMessage({ children }) {
  return <div className="flex items-center justify-center min-h-screen text-gray-500">{children}</div>
}
