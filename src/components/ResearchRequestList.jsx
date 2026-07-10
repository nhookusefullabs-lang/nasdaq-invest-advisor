import { useState } from 'react'

/**
 * 공통 접이식 "리서치 요청 목록" 패널 (PRD_Nasdaq7 §3 Must-11, US-11) — 모든 화면에서
 * 동일하게 접근 가능하도록 App.jsx 레이아웃에 한 번만 렌더링한다. 기본 접힘.
 * 이 컴포넌트는 리서치를 실행하지 않는다 — 목록 수집·복사까지만 (Out of Scope).
 */
export default function ResearchRequestList({ tickers, onRemove, onClearAll }) {
  const [expanded, setExpanded] = useState(false)
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied' | 'fallback'

  const copyText = tickers.join(', ')

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('클립보드 API 사용 불가')
      await navigator.clipboard.writeText(copyText)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      // 클립보드 API 실패(권한 거부, 미지원 브라우저 등) 시 텍스트를 선택 가능한 형태로 노출
      setCopyState('fallback')
    }
  }

  return (
    <div className="border border-gray-200 rounded mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">리서치 요청 목록</span>
          {tickers.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">{tickers.length}개</span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {tickers.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">담긴 종목이 없습니다. 종목 카드의 "리서치 요청" 버튼으로 담을 수 있습니다.</p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5 mb-3">
                {tickers.map((t) => (
                  <li key={t} className="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-xs">
                    {t}
                    <button
                      type="button"
                      onClick={() => onRemove(t)}
                      aria-label={`${t} 리서치 요청 제거`}
                      className="text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3">
                <button type="button" onClick={handleCopy} className="text-xs text-blue-600 hover:underline">
                  목록 복사
                </button>
                <button type="button" onClick={onClearAll} className="text-xs text-gray-500 hover:underline">
                  전체 비우기
                </button>
                {copyState === 'copied' && <span className="text-xs text-green-600">복사됨</span>}
              </div>

              {copyState === 'fallback' && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">
                    자동 복사에 실패했습니다. 아래 텍스트를 직접 선택해 복사하세요.
                  </p>
                  <input
                    readOnly
                    value={copyText}
                    onFocus={(e) => e.target.select()}
                    aria-label="리서치 요청 목록 복사용 텍스트"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
