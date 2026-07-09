import Disclaimer from '../components/Disclaimer.jsx'
import { buildPortfolio, MIN_PORTFOLIO_SIZE, MAX_PORTFOLIO_SIZE } from '../lib/portfolio.js'

export default function Portfolio({ generatedAt, selectedTickerData }) {
  const portfolio = buildPortfolio(selectedTickerData)

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">포트폴리오 구성 (균등 비중)</h2>
      <p className="text-sm text-gray-500 mb-4">
        안정형/공격형 등 위험성향별 구성은 다음 버전에서 제공됩니다.
      </p>

      {!portfolio && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          선택 종목이 {selectedTickerData.length}개입니다. 포트폴리오는 {MIN_PORTFOLIO_SIZE}~{MAX_PORTFOLIO_SIZE}개 종목을 선택해야 구성됩니다.
        </div>
      )}

      {portfolio && (
        <div className="border border-gray-200 rounded p-4 mb-4">
          <p className="text-sm text-gray-600 mb-3">구성 종목: {portfolio.tickers.join(', ')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">종합 예상 수익률 (균등 비중)</p>
              <p className={`text-2xl font-bold ${portfolio.equalWeightReturnPct >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {portfolio.equalWeightReturnPct >= 0 ? '+' : ''}
                {portfolio.equalWeightReturnPct.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">평균 개별 변동성 (상관관계 미반영)</p>
              <p className="text-2xl font-bold text-gray-800">
                {(portfolio.avgIndividualVolatility * 100).toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
      )}

      <Disclaimer generatedAt={generatedAt} />
    </div>
  )
}
