import { useState } from 'react'
import { computeResearchCheckState } from '../lib/researchCheck.js'

const RISK_TYPE_LABEL = {
  earnings_imminent: '실적 발표 임박',
  litigation: '소송',
  regulatory: '규제',
  guidance_cut: '가이던스 하향',
  other: '기타',
}

/**
 * research: researchLoader.buildResearchMap()이 만든 티커별 항목(또는 undefined).
 * 배지는 요약, ResearchSection(접이식 상세)과 병존한다 (PRD_Nasdaq8 §4.5, US-12).
 */
export default function ResearchCheckBadge({ research }) {
  const [expanded, setExpanded] = useState(false)
  const { state, flags } = computeResearchCheckState(research)

  if (state === 'none') {
    return (
      <span className="mt-1 inline-block text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">리서치 미실시</span>
    )
  }

  if (state === 'ok') {
    return (
      <span className="mt-1 inline-block text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">리서치 점검 ✓</span>
    )
  }

  if (flags.length === 0) {
    return (
      <span className="mt-1 inline-block text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">⚠ 리서치 점검 필요</span>
    )
  }

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5"
      >
        <span className="px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-700">
          ⚠ 리스크 플래그 {flags.length}건
        </span>
        <span className="text-gray-400">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {expanded && (
        <ul className="mt-1 list-disc list-inside text-gray-600 space-y-0.5">
          {flags.map((f, i) => (
            <li key={i}>
              <span className="font-semibold">{RISK_TYPE_LABEL[f.type] ?? f.type}</span>: {f.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
