// 화면2 상단 국면 배지 (PRD_Nasdaq10 §4.2 2단, US-13) — regime.js가 계산한 현재 국면 +
// backtest.json의 regimeAxis(★★ 컨센서스 Out 조건부 성과)를 함께 표시한다.
// backtest.json v3(regimeAxis) 부재 시 영역 전체를 비표시(graceful degradation) — 국면 자체는
// dataset만으로 계산 가능하지만, 검증된 Out 성과 맥락 없이 국면만 보여주는 것은 PRD의
// "측정이 먼저" 원칙에 어긋나므로 backtest 존재를 함께 게이트한다.
const REGIME_LABELS = { up: '상승', neutral: '중립', down: '하락' }
const MIN_SAMPLE = 50

export default function RegimeBadge({ regimeInfo, backtest }) {
  if (!backtest?.regimeAxis || !regimeInfo?.regime) return null

  const entry = backtest.regimeAxis.find(
    (r) => r.strategyKey === 'consensus_2star' && r.sample === 'out' && r.regime === regimeInfo.regime
  )
  const d20 = entry?.byHolding?.find((h) => h.days === 20)
  const label = REGIME_LABELS[regimeInfo.regime] ?? regimeInfo.regime
  const breadthPct = Math.round(regimeInfo.breadth * 100)
  const sufficientSample = d20 && d20.signals >= MIN_SAMPLE

  return (
    <div className="mb-4 rounded bg-slate-50 border border-slate-200 px-3 py-2">
      <p className="text-sm font-semibold text-slate-700">
        현재 시장 폭 {breadthPct}% — {label} 국면
      </p>
      {sufficientSample ? (
        <p className="text-xs text-slate-600 mt-1">
          이 국면에서 ★★ 컨센서스의 검증 초과수익: {(d20.avgExcess * 100).toFixed(1)}%p · 표본 {d20.signals}건
        </p>
      ) : (
        <p className="text-xs text-gray-400 mt-1">표본 부족 — 참고 불가</p>
      )}
      <p className="text-[11px] text-gray-400 mt-1">국면 분류는 기계적 지표이며 시장 예측이 아닙니다</p>
    </div>
  )
}
