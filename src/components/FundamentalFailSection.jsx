import { useState } from 'react'

/**
 * 펀더멘털 허들 Fail 종목을 추천 리스트에서 숨기지 않고, 사유와 함께 하단 접이식 섹션으로
 * 분리해 보여준다 (PRD_Nasdaq8 §4.4, US-11 — "숨기지 않고 사유와 함께 표시"). 기본 접힘.
 * failed가 빈 배열이면(펀더멘털 데이터 없음/전원 통과) 아무것도 렌더링하지 않는다.
 */
export default function FundamentalFailSection({ failed }) {
  const [expanded, setExpanded] = useState(false)
  if (!failed || failed.length === 0) return null

  return (
    <div className="border border-gray-200 rounded mb-4 mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-gray-600">펀더멘털 미달</span>
          <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{failed.length}개</span>
        </span>
        <span className="text-gray-400 text-xs">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {expanded && (
        <ul className="px-3 pb-3 space-y-2 text-xs">
          {failed.map((f) => (
            <li key={f.ticker}>
              <p className="font-semibold">
                {f.ticker} <span className="text-gray-500 font-normal">{f.name}</span>
              </p>
              <p className="text-gray-500">{f.reasons.join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
