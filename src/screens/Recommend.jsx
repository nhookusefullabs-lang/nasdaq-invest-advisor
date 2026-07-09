import Disclaimer from '../components/Disclaimer.jsx'

export default function Recommend({ generatedAt, recommendation, selectedTickers, onToggleSelect, onGoToSimulation }) {
  const { list, relaxationApplied, insufficientSignal } = recommendation

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">추천 결과</h2>
      <p className="text-sm text-gray-500 mb-4">
        1단계 매수 신호(RSI·MACD·골든크로스) 통과 종목을 2단계 점수 순으로 정렬했습니다.
      </p>

      {relaxationApplied && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          조건 완화 적용됨 — 매수 신호 통과 종목이 부족해 기준을 완화했습니다.
        </div>
      )}

      {insufficientSignal && (
        <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
          매수 신호가 충분치 않습니다. (조건 완화 후에도 5개 미만)
        </div>
      )}

      <div className="space-y-2 mb-4">
        {list.map((r) => (
          <label
            key={r.ticker}
            className="flex items-center justify-between border border-gray-200 rounded px-3 py-2 cursor-pointer hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedTickers.includes(r.ticker)}
                onChange={() => onToggleSelect(r.ticker)}
              />
              <div>
                <p className="font-semibold text-sm">
                  {r.ticker} <span className="text-gray-500 font-normal">{r.name}</span>
                </p>
                <p className="text-xs text-gray-500">{r.reasons}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">{r.score.toFixed(1)}점</p>
            </div>
          </label>
        ))}
        {list.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">추천 가능한 종목이 없습니다.</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{selectedTickers.length}개 선택됨 (시뮬레이션은 1개 이상, 포트폴리오는 3~5개 필요)</p>
        <button
          type="button"
          disabled={selectedTickers.length === 0}
          onClick={onGoToSimulation}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          선택 종목 시뮬레이션 보기 →
        </button>
      </div>

      <Disclaimer generatedAt={generatedAt} />
    </div>
  )
}
