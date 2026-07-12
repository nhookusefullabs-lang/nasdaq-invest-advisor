// 화면2 카드 — 매도 신호 배지 (PRD_Nasdaq10 §4.4 계층1, US-13). exitSignals.js를 그대로
// 재사용한다(재구현 없음). rsPercentileValue는 화면2가 유니버스 단위로 미리 계산해두지
// 않으므로 null로 전달 — X3(템플릿 붕괴)는 이 카드 맥락에서 계산 대상에서 제외된다(다른
// X1/X2/X4/X5는 정상 판정). tickerData(원본 series)가 없으면 아무것도 렌더링하지 않는다.
import { evaluateExitSignals } from '../lib/exitSignals.js'

export default function ExitSignalBadge({ tickerData }) {
  if (!tickerData?.series) return null

  const { signals } = evaluateExitSignals(tickerData.series, { rsPercentileValue: null })

  if (signals.length === 0) {
    return <p className="text-xs text-gray-400 mt-1">매도 신호 없음</p>
  }

  return (
    <details className="text-xs mt-1">
      <summary className="text-amber-700 cursor-pointer">⚠ 매도 신호 {signals.length}건</summary>
      <ul className="mt-1 space-y-0.5 text-gray-600 pl-3 list-disc">
        {signals.map((s) => (
          <li key={s.code}>
            {s.code}({s.strength}): {s.evidence}
          </li>
        ))}
      </ul>
    </details>
  )
}
