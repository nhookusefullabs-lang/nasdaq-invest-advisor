/**
 * 종목 카드/행에 붙는 "리서치 요청" 토글 (PRD_Nasdaq7 §3 Must-11, US-11).
 * label로 감싸진 카드(화면2)에서 클릭 시 상위 체크박스가 토글되지 않도록 stopPropagation한다
 * — ResearchSection(US-6)에서 겪었던 동일한 label 클릭-버블링 문제.
 */
export default function ResearchRequestToggle({ ticker, requested, onToggle }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle(ticker)
      }}
      aria-pressed={requested}
      className={`px-1.5 py-0.5 rounded text-xs border shrink-0 ${
        requested
          ? 'bg-purple-100 text-purple-700 border-purple-200'
          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {requested ? '리서치 요청됨 ✓' : '리서치 요청'}
    </button>
  )
}
