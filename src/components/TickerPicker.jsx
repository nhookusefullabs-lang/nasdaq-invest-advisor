import { useState } from 'react'

/** allTickers: dataSufficient 티커 전체 목록. selectedTickers: 현재 선택된 티커 문자열 배열. */
export default function TickerPicker({ allTickers, selectedTickers, onAdd }) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const candidates = allTickers
    .filter((t) => !selectedTickers.includes(t.ticker))
    .filter((t) => !q || t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .slice(0, 8)

  return (
    <div className="border border-gray-200 rounded p-3 mb-4">
      <p className="text-sm font-semibold mb-2">종목 직접 추가</p>
      <input
        type="text"
        placeholder="티커 또는 종목명 검색 (예: AAPL, Apple)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 mb-2 text-sm"
      />
      <div className="max-h-48 overflow-y-auto divide-y border border-gray-100 rounded">
        {candidates.map((t) => (
          <div key={t.ticker} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <span className="font-semibold">{t.ticker}</span>{' '}
              <span className="text-gray-500">{t.name}</span>
            </div>
            <button
              type="button"
              onClick={() => onAdd(t.ticker)}
              className="text-blue-600 text-xs font-semibold hover:underline"
            >
              + 추가
            </button>
          </div>
        ))}
        {candidates.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-gray-400">
            {q ? '검색 결과가 없습니다.' : '추가할 수 있는 종목이 없습니다.'}
          </p>
        )}
      </div>
    </div>
  )
}
