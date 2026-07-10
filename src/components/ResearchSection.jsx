import { useState } from 'react'

// PRD_Nasdaq6.md §4.3: positive=빨강/negative=파랑 — 앱 전체 등락 색상 관례(PriceSparkline 등)와 일관
const SENTIMENT_LABEL = { positive: '긍정', neutral: '중립', negative: '부정' }
const SENTIMENT_COLOR = {
  positive: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
  negative: 'bg-blue-100 text-blue-700',
}

function firstSentence(text) {
  const match = text.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : text
}

/**
 * research: researchLoader.buildResearchMap()이 만든 티커별 리서치 항목 (없으면 아무것도 렌더링하지 않는다).
 * 접힘(기본): 센티먼트 배지 + summary 첫 문장 / 펼침: 전체 내용 + 출처 + 면책 문구.
 */
export default function ResearchSection({ research }) {
  const [expanded, setExpanded] = useState(false)
  if (!research) return null

  const {
    sentiment,
    summary,
    catalysts = [],
    risks = [],
    institutionalActivity,
    analystView,
    sources = [],
    origin,
    researchedAt,
    stale,
  } = research

  return (
    <div className="mt-2 border-t border-gray-100 pt-2 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-gray-500 font-semibold">AI 리서치</span>
          <span className={`px-1.5 py-0.5 rounded font-semibold ${SENTIMENT_COLOR[sentiment] ?? 'bg-gray-100 text-gray-600'}`}>
            {SENTIMENT_LABEL[sentiment] ?? sentiment}
          </span>
          {origin === 'userRequested' && (
            <span className="px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700">관심 종목 리서치</span>
          )}
          {stale && (
            <span className="px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
              ⚠ 이전 데이터 기준
            </span>
          )}
        </span>
        <span className="text-gray-400 shrink-0 ml-2">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {!expanded && <p className="text-gray-600 mt-1">{firstSentence(summary)}</p>}

      {expanded && (
        <div className="mt-2 space-y-2 text-gray-700">
          {stale && (
            <p className="rounded bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1">
              이 리서치는 이전 데이터 기준입니다.
            </p>
          )}

          <p>{summary}</p>

          {catalysts.length > 0 && (
            <div>
              <p className="font-semibold text-gray-500">긍정 촉매</p>
              <ul className="list-disc list-inside">
                {catalysts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {risks.length > 0 && (
            <div>
              <p className="font-semibold text-gray-500">리스크 요인</p>
              <ul className="list-disc list-inside">
                {risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {institutionalActivity && (
            <p>
              <span className="font-semibold text-gray-500">기관투자자 동향: </span>
              {institutionalActivity}
            </p>
          )}

          {analystView && (
            <p>
              <span className="font-semibold text-gray-500">애널리스트 시각: </span>
              {analystView}
            </p>
          )}

          {sources.length > 0 && (
            <div>
              <p className="font-semibold text-gray-500">출처</p>
              <ul className="list-disc list-inside">
                {sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {s.title}
                    </a>
                    {s.operatorProvided && <span className="text-gray-400"> (운영자 제공)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-gray-400">리서치 기준일: {researchedAt}</p>
          <p className="text-gray-400 border-t border-gray-100 pt-1">
            AI가 수집한 참고 정보이며 투자 판단의 근거가 아닙니다.
          </p>
        </div>
      )}
    </div>
  )
}
