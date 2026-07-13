// 화면2 카드 — 진입 상태 배지 + 가격 세트 + 산출 근거 펼침 (PRD_Nasdaq10 §4.3/§5, US-13).
// entryPoint.js(judgeEntryState/derivedPrices)·indicators.js(atr)를 그대로 재사용 —
// 재구현 없음. tickerData(원본 series)가 없으면 아무것도 렌더링하지 않는다.
//
// changelog:
//   2026-07-12 최초 도입 — PRD_Nasdaq10 §4.3/§5, US-13
//   2026-07-13(v11.1 US-5) 상태0 배지 문구 하향(승인된 표시 조정, 근거: v11 실데이터
//     stateRegimeAxis 실측 — v10에서 기대했던 상태0 단독 엣지(+36~40%p)가 그대로
//     재현되지 않고 국면별로 −1.81%p~+0.59%p 수준의 훨씬 약하고 혼재된 성과로 나타남,
//     PRD_Nasdaq11.md §4.1 참고). "검증 진행 중"(마치 결과를 기다리는 중이라는 뉘앙스)에서
//     "최근 검증에서 성과가 재현되지 않았습니다"로 — 이미 나온 실측 결과를 과장 없이
//     보고한다. 검증 상태(pullbackCandidate: "측정중")와 재개 트리거가 표시는 그대로 유지
//     (그 정보 자체는 무해 — 해석 라벨만 정직하게 바꾼다).
import { judgeEntryState, derivedPrices } from '../lib/entryPoint.js'
import { judgePullback } from '../lib/pullback.js'
import { atr } from '../lib/indicators.js'
import { VERIFICATION_STATUS } from '../lib/constants/verification.js'

const STATE_BADGE = {
  0: { label: '눌림목 가설 재검증 중 — 최근 검증에서 성과가 재현되지 않았습니다', className: 'bg-gray-100 text-gray-600' },
  1: { label: '돌파 대기', className: 'bg-blue-50 text-blue-700' },
  2: { label: '매수 유효 구간', className: 'bg-green-50 text-green-700' },
  3: { label: '확장 — 추격 금지', className: 'bg-red-50 text-red-700' },
  산정불가: { label: '피벗 산정 불가', className: 'bg-gray-100 text-gray-400' },
}

function VerificationTag({ info }) {
  return <span className="text-gray-400"> ({info.status} · {info.basis})</span>
}

export default function EntryPriceCard({ tickerData, generatedAt, expanded = false, onToggleExpanded }) {
  if (!tickerData?.series) return null

  const result = judgeEntryState(tickerData.series)
  const badge = STATE_BADGE[result.state]

  if (result.state === '산정불가') {
    return (
      <div className="mt-1">
        <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${badge.className}`}>{badge.label}</span>
      </div>
    )
  }

  const currentClose = tickerData.series[tickerData.series.length - 1].close

  return (
    <div className="mt-1 text-xs">
      <span className={`inline-block px-1.5 py-0.5 rounded ${badge.className}`}>{badge.label}</span>

      {result.state === 0 && (
        <p className="text-gray-600 mt-0.5">
          트리거 {result.trigger.toFixed(2)} · 피벗까지 {result.distancePct.toFixed(1)}% — 관망
          {(() => {
            const pullback = judgePullback(tickerData.series)
            if (pullback.insufficientData) return null
            return (
              <>
                {' '}· 재개 트리거가 {pullback.triggerPrice.toFixed(2)}
                <VerificationTag info={VERIFICATION_STATUS.pullbackCandidate} />
              </>
            )
          })()}
        </p>
      )}

      {result.state === 1 && (
        <p className="text-gray-600 mt-0.5">
          트리거 {result.trigger.toFixed(2)} · 손절 참고 {(result.trigger * 0.92).toFixed(2)}
          <VerificationTag info={VERIFICATION_STATUS.stopFixed8pct} />
        </p>
      )}

      {result.state === 2 && (
        <>
          <p className="text-gray-600 mt-0.5">
            피벗 {result.evidence.pivot.toFixed(2)} · 유효 상단 {result.upper.toFixed(2)}
          </p>
          <p className="text-gray-600 mt-0.5">
            손절 참고: 고정 {(currentClose * 0.92).toFixed(2)}
            <VerificationTag info={VERIFICATION_STATUS.stopFixed8pct} />
            {(() => {
              const a = atr(tickerData.series, 14)
              if (a == null) return null
              const derived = derivedPrices({ pivot: result.evidence.pivot, currentClose, atr14: a })
              return (
                <>
                  {' '}· ATR 비례 {derived.stopAtr.toFixed(2)}
                  <VerificationTag info={VERIFICATION_STATUS.stopAtr} />
                </>
              )
            })()}
          </p>
          <p className="text-gray-600 mt-0.5">돌파 후 {result.daysSinceBreakout}거래일 경과</p>
          <p className="mt-0.5">
            <span className={`inline-block px-1.5 py-0.5 rounded ${result.volumeOK ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              거래량 동반 돌파 확인 {result.volumeOK ? '✓' : '⚠ 미확인'}
            </span>
            <VerificationTag info={VERIFICATION_STATUS.volumeConfirmedBreakout} />
          </p>
          {result.earlyBreakout && <p className="text-amber-600 mt-0.5">돌파 직후 — 가짜 돌파 위험 구간</p>}
        </>
      )}

      {result.state === 3 && <p className="text-gray-500 mt-0.5">{result.reason} — 다음 베이스 형성 대기</p>}

      <p className="text-gray-400 mt-0.5">목표가 없음 — 청산 규칙 참조</p>

      <button type="button" onClick={onToggleExpanded} className="text-blue-600 underline mt-0.5">
        {expanded ? '산출 근거 접기' : '산출 근거 펼치기'}
      </button>
      {expanded && (
        <div className="bg-gray-50 rounded p-1.5 mt-0.5 text-gray-500">
          <p>피벗 {result.evidence?.pivot?.toFixed(2) ?? '-'} (산정 기간 63거래일)</p>
          {result.evidence?.breakoutDate && <p>돌파일: {result.evidence.breakoutDate}</p>}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-0.5">
        피벗 기준일 {generatedAt} — 이후 가격 변동 미반영, 실시간 확인 필요
      </p>
      <p className="text-[11px] text-gray-400">
        진입 참고 가격은 과거 가격 구조에서 기계적으로 산출된 값이며 매수 권유가 아닙니다
      </p>
    </div>
  )
}
