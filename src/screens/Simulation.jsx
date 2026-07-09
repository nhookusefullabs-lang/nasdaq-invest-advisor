import Disclaimer from '../components/Disclaimer.jsx'
import TickerPicker from '../components/TickerPicker.jsx'
import PriceSparkline from '../components/PriceSparkline.jsx'

export default function Simulation({
  generatedAt,
  allTickerData,
  selectedTickers,
  selectedTickerData,
  onToggleTicker,
  onGoToPortfolio,
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">과거 3개월 시뮬레이션</h2>
      <p className="text-sm text-gray-500 mb-4">
        과거 3개월 실현 수익률 (미래 보장 아님) — 최근 63거래일 중 첫 거래일 종가를 매수가로 가정합니다.
      </p>

      <TickerPicker allTickers={allTickerData} selectedTickers={selectedTickers} onAdd={onToggleTicker} />

      <div className="space-y-3 mb-6">
        {selectedTickerData.map((t) => {
          const sim = t.simulation
          const positive = sim.returnPct >= 0
          return (
            <div key={t.ticker} className="border border-gray-200 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-sm">
                  {t.ticker} <span className="text-gray-500 font-normal">{t.name}</span>
                </p>
                <div className="flex items-center gap-3">
                  <p className={`font-bold text-sm ${positive ? 'text-red-600' : 'text-blue-600'}`}>
                    {positive ? '+' : ''}
                    {sim.returnPct.toFixed(2)}%
                  </p>
                  <button
                    type="button"
                    onClick={() => onToggleTicker(t.ticker)}
                    aria-label={`${t.ticker} 제거`}
                    className="text-gray-400 hover:text-red-600 text-xs"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600 mb-3">
                <div>매수가({sim.anchorDate}): {sim.anchorClose.toFixed(2)}</div>
                <div>현재가({sim.currentDate}): {sim.currentClose.toFixed(2)}</div>
                <div>기간 최고가: {sim.periodHigh.toFixed(2)}</div>
                <div>기간 최저가: {sim.periodLow.toFixed(2)}</div>
              </div>
              <div className="flex flex-wrap gap-4 pt-2 border-t border-gray-100">
                <PriceSparkline label="1개월" points={t.chart.oneMonth} />
                <PriceSparkline label="3개월" points={t.chart.threeMonth} />
                <PriceSparkline label="6개월" points={t.chart.sixMonth} />
              </div>
            </div>
          )
        })}
        {selectedTickerData.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">선택된 종목이 없습니다.</p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onGoToPortfolio}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700"
        >
          포트폴리오 구성 보기 →
        </button>
      </div>

      <Disclaimer generatedAt={generatedAt} />
    </div>
  )
}
