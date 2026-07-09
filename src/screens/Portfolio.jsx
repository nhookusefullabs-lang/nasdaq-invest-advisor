import Disclaimer from '../components/Disclaimer.jsx'
import TickerPicker from '../components/TickerPicker.jsx'
import PortfolioPieChart from '../components/PortfolioPieChart.jsx'
import { buildPortfolio, DEFAULT_WEIGHT } from '../lib/portfolio.js'
import { assignPortfolioColors } from '../lib/portfolioColors.js'

export default function Portfolio({
  generatedAt,
  allTickerData,
  selectedTickers,
  selectedTickerData,
  weights,
  onToggleTicker,
  onWeightChange,
}) {
  const portfolio = buildPortfolio(selectedTickerData, weights)
  const colors = assignPortfolioColors(selectedTickers)
  const resetToEqual = () => selectedTickerData.forEach((t) => onWeightChange(t.ticker, DEFAULT_WEIGHT))

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">포트폴리오 구성 (비중 직접 설정)</h2>
      <p className="text-sm text-gray-500 mb-4">
        종목별로 상대 가중치를 입력하면 합계 대비 비율로 자동 환산됩니다. 안정형/공격형 등 위험성향별 자동 구성은 다음
        버전에서 제공됩니다.
      </p>

      <TickerPicker allTickers={allTickerData} selectedTickers={selectedTickers} onAdd={onToggleTicker} />

      {portfolio && (
        <PortfolioPieChart
          entries={selectedTickerData.map((t) => ({
            ticker: t.ticker,
            name: t.name,
            pct: portfolio.weightsPct[t.ticker],
            ...colors.get(t.ticker),
          }))}
        />
      )}

      <div className="border border-gray-200 rounded divide-y mb-4">
        {selectedTickerData.map((t) => (
          <div key={t.ticker} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colors.get(t.ticker)?.color }}
              />
              <p className="font-semibold truncate">
                {t.ticker} <span className="text-gray-500 font-normal">{t.name}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min="0"
                value={weights[t.ticker] ?? DEFAULT_WEIGHT}
                onChange={(e) => onWeightChange(t.ticker, Number(e.target.value))}
                aria-label={`${t.ticker} 가중치`}
                className="w-20 border border-gray-300 rounded px-2 py-1 text-right"
              />
              <span className="text-gray-400 text-xs w-14 text-right">
                {portfolio ? `${portfolio.weightsPct[t.ticker].toFixed(1)}%` : '-'}
              </span>
              <button
                type="button"
                onClick={() => onToggleTicker(t.ticker)}
                aria-label={`${t.ticker} 제거`}
                className="text-gray-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {selectedTickerData.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-400">선택된 종목이 없습니다.</p>
        )}
      </div>

      {selectedTickerData.length > 0 && (
        <div className="flex justify-end mb-4">
          <button type="button" onClick={resetToEqual} className="text-xs text-blue-600 hover:underline">
            균등 배분으로 초기화
          </button>
        </div>
      )}

      {!portfolio && selectedTickerData.length > 0 && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          가중치 합이 0입니다. 최소 한 종목의 가중치를 0보다 크게 입력해 주세요.
        </div>
      )}

      {portfolio && (
        <div className="border border-gray-200 rounded p-4 mb-4">
          <p className="text-sm text-gray-600 mb-3">구성 종목: {portfolio.tickers.join(', ')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">종합 예상 수익률 (가중 평균)</p>
              <p className={`text-2xl font-bold ${portfolio.weightedReturnPct >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {portfolio.weightedReturnPct >= 0 ? '+' : ''}
                {portfolio.weightedReturnPct.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">가중 평균 변동성 (상관관계 미반영)</p>
              <p className="text-2xl font-bold text-gray-800">
                {(portfolio.weightedVolatility * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
      )}

      <Disclaimer generatedAt={generatedAt} />
    </div>
  )
}
