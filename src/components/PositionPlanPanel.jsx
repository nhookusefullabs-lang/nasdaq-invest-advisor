// 화면 3·4 — 포지션 계획 계층 2 (PRD_Nasdaq10 §4.4 계층2, US-14). positionPlan.js의
// computePositionPlan()을 그대로 재사용한다(재구현 없음). 체결가 미입력 시 계획 산출부는
// 렌더링하지 않고 입력 필드만 보여준다(체결가는 필수, 체결일은 선택).
import { computePositionPlan } from '../lib/positionPlan.js'
import ExitSignalBadge from './ExitSignalBadge.jsx'

export default function PositionPlanPanel({ ticker, tickerData, position, onChangeEntryPrice, onChangeEntryDate }) {
  if (!tickerData?.series) return null

  const plan = position?.entryPrice
    ? computePositionPlan({ ticker, entryPrice: position.entryPrice, entryDate: position.entryDate ?? null }, tickerData.series)
    : null

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 text-xs">
      <p className="font-semibold text-gray-600 mb-1">청산 계획</p>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="flex items-center gap-1">
          체결가
          <input
            type="number"
            min="0"
            step="0.01"
            value={position?.entryPrice ?? ''}
            onChange={(e) => onChangeEntryPrice(ticker, e.target.value)}
            aria-label={`${ticker} 체결가`}
            className="w-20 border border-gray-300 rounded px-1.5 py-0.5"
          />
        </label>
        <label className="flex items-center gap-1">
          체결일(선택)
          <input
            type="date"
            value={position?.entryDate ?? ''}
            onChange={(e) => onChangeEntryDate(ticker, e.target.value)}
            aria-label={`${ticker} 체결일`}
            className="border border-gray-300 rounded px-1.5 py-0.5"
          />
        </label>
      </div>

      {plan && (
        <div className="space-y-1 text-gray-600">
          <p>
            R-배수: {plan.rMultiple >= 0 ? '+' : ''}
            {plan.rMultiple.toFixed(2)}R (현재 수익 {plan.currentReturnPct >= 0 ? '+' : ''}
            {plan.currentReturnPct.toFixed(1)}%)
          </p>
          <p>
            손절 참고: 고정 {plan.stopFixed.price.toFixed(2)} ({plan.stopFixed.verification.status} · {plan.stopFixed.verification.basis})
            {plan.stopAtr && (
              <>
                {' '}
                · ATR 비례 {plan.stopAtr.price.toFixed(2)} ({plan.stopAtr.verification.status} · {plan.stopAtr.verification.basis})
              </>
            )}
          </p>
          {plan.breakEvenAlert && <p className="text-amber-600">손절선을 체결가로 상향 검토 (+2R 도달)</p>}
          {plan.trailing.available ? (
            <p>
              트레일링 참고: {plan.trailing.trailingRefPrice.toFixed(2)} (손절·트레일링 중 높은 값 강조:{' '}
              {plan.trailing.effectiveStopPrice.toFixed(2)})
            </p>
          ) : (
            <p className="text-gray-400">{plan.trailing.reason}</p>
          )}
          {plan.profitProtection.available ? (
            plan.profitProtection.alert && (
              <p className="text-amber-600">이익 보호 알림: 최고 수익 대비 절반 이하로 반납했습니다</p>
            )
          ) : (
            <p className="text-gray-400">{plan.profitProtection.reason}</p>
          )}
        </div>
      )}

      <ExitSignalBadge tickerData={tickerData} />

      <p className="text-gray-400 mt-1">
        빠른 방어는 증권사 예약 주문(stop-loss)으로 — 본 시스템은 주 1회 갱신되므로 실시간 감시를 대체하지 않습니다
      </p>
      <p className="text-gray-400">청산 참고 정보는 기계적 규칙의 산출값이며 매도 권유가 아닙니다</p>
    </div>
  )
}
