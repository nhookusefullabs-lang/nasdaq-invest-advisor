import { useState } from 'react'

const VERDICT_LABEL = { pass: 'Pass', partial: 'Partial', insufficientFundamentals: '판정불가' }
const VERDICT_COLOR = {
  pass: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  insufficientFundamentals: 'bg-gray-100 text-gray-500',
}

/**
 * evaluation: fundamentals.js evaluateFundamentalHurdle()의 반환값. verdict==='fail'인
 * 항목은 이 배지에 도달하지 않는다 — Fail은 카드 자체가 화면 하단 FundamentalFailSection으로
 * 분리되기 때문(US-11). evaluation이 null이면(fundamentals.json 부재/해당 티커 없음)
 * 아무것도 렌더링하지 않아 US-10 상태와 시각적으로 동일하게 유지한다.
 * <label> 안이 아니라 카드의 형제 위치에 둬야 한다 (체크박스 클릭 버블링 방지, v7 US-11 패턴).
 */
export default function FundamentalBadge({ evaluation }) {
  const [expanded, setExpanded] = useState(false)
  if (!evaluation) return null

  const { verdict, reasons, epsAccelerating, marginImproving } = evaluation

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5"
      >
        <span className={`px-1.5 py-0.5 rounded font-semibold ${VERDICT_COLOR[verdict]}`}>
          펀더멘털 {VERDICT_LABEL[verdict]}
        </span>
        <span className="text-gray-400">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {expanded && (
        <ul className="mt-1 list-disc list-inside text-gray-600 space-y-0.5">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {epsAccelerating != null && <li>EPS 성장 가속 여부: {epsAccelerating ? '예' : '아니오'} (참고)</li>}
          {marginImproving != null && <li>영업이익률 개선 여부: {marginImproving ? '예' : '아니오'} (참고)</li>}
        </ul>
      )}
    </div>
  )
}
