import { useState } from 'react'
import { findStrategy, findHolding, getConfidenceSummary } from '../lib/backtestLoader.js'

// PRD_Nasdaq9.md §4.5 — 요약 바로 아래에 항상 동반해야 하는 고정 고지 문구(생략 불가).
export const BACKTEST_DISCLAIMER =
  '과거 성과는 미래 수익을 보장하지 않습니다. 현재 구성 종목 기준 백테스트로 생존 편향이 존재하며, 거래 비용은 반영되지 않았습니다.'

const HOLDING_DAYS = [5, 20, 60]

function formatPct(v, digits = 1) {
  if (v == null) return '표본 부족'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(digits)}%p`
}

function SummaryLine({ holding20, insufficientSample }) {
  if (insufficientSample) {
    return <p className="text-slate-700">최근 검증 구간(Out-of-Sample) 표본 부족 — 신뢰도 표시를 생략합니다 (20거래일 보유 기준).</p>
  }
  return (
    <p className="text-slate-700">
      최근 검증 구간(Out-of-Sample) 승률 {Math.round(holding20.winRate * 100)}% · 유니버스 대비{' '}
      {formatPct(holding20.avgExcess)} (상위 5종목 · 20거래일 보유 기준)
    </p>
  )
}

function HoldingTable({ strategy }) {
  if (!strategy) return null
  return (
    <table className="w-full text-left mt-1">
      <thead>
        <tr className="text-gray-400">
          <th className="pr-3 font-normal">보유기간</th>
          <th className="pr-3 font-normal">표본</th>
          <th className="pr-3 font-normal">승률</th>
          <th className="font-normal">초과수익</th>
        </tr>
      </thead>
      <tbody>
        {HOLDING_DAYS.map((days) => {
          const h = findHolding(strategy, days)
          return (
            <tr key={days}>
              <td className="pr-3">{days}거래일</td>
              <td className="pr-3">{h?.signals ?? 0}건</td>
              <td className="pr-3">{h?.winRate != null ? `${Math.round(h.winRate * 100)}%` : '-'}</td>
              <td>{h?.avgExcess != null ? formatPct(h.avgExcess) : '-'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ConsensusGradeComparison({ backtest }) {
  const twoStar = findStrategy(backtest, 'consensus_2star', 'out', 'top5')
  const oneStar = findStrategy(backtest, 'consensus_1star', 'out', 'top5')
  if (!twoStar && !oneStar) return null

  return (
    <div className="mt-2">
      <p className="font-semibold text-gray-500">★★ vs ★ 비교 (20거래일)</p>
      {[
        ['★★', twoStar],
        ['★', oneStar],
      ].map(([label, strategy]) => {
        const h = findHolding(strategy, 20)
        return (
          <p key={label}>
            {label}: {h?.signals ? `승률 ${Math.round(h.winRate * 100)}% · 초과수익 ${formatPct(h.avgExcess)} (표본 ${h.signals}건)` : '표본 부족'}
          </p>
        )
      })}
    </div>
  )
}

function FundamentalAxisReference({ fundamentalAxis }) {
  if (!fundamentalAxis) return null
  return (
    <div className="mt-2">
      <p className="font-semibold text-gray-500">펀더멘털 축 (참고, {fundamentalAxis.note})</p>
      {fundamentalAxis.byVerdict.map((v) => {
        const h = findHolding(v, 20)
        return (
          <p key={v.verdict}>
            {v.verdict}: {h?.signals ? `승률 ${Math.round(h.winRate * 100)}% · 초과수익 ${formatPct(h.avgExcess)} (표본 ${h.signals}건)` : '표본 부족'}
          </p>
        )
      })}
    </div>
  )
}

/**
 * 화면2 신뢰도 표시 (US-8). backtest.json이 없거나(loadBacktest→null), 해당 모드의
 * Out-of-Sample·top5·20거래일 항목이 없으면 아무것도 렌더링하지 않는다(graceful degradation
 * — v8 화면과 시각적으로 동일). 렌더링될 때는 요약과 고정 고지 문구를 분리 불가능하게
 * 하나의 블록으로 함께 반환한다(In-Sample 데이터는 어떤 경로로도 화면에 노출하지 않는다).
 */
export default function BacktestConfidence({ backtest, modeKey }) {
  const [expanded, setExpanded] = useState(false)

  const summary = getConfidenceSummary(backtest, modeKey)
  if (!summary) return null

  const { strategy, holding20, insufficientSample } = summary

  return (
    <div className="mb-4 rounded bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <SummaryLine holding20={holding20} insufficientSample={insufficientSample} />
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="text-xs text-slate-500 underline shrink-0">
          {expanded ? '접기' : '상세 보기'}
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-1">{BACKTEST_DISCLAIMER}</p>

      {expanded && (
        <div className="mt-2 text-xs text-slate-600 border-t border-slate-200 pt-2">
          <p>
            평가 기간: {backtest.config?.dataFrom} ~ {backtest.config?.dataTo} (표본 수 {holding20.signals}건, Out-of-Sample 기준)
          </p>
          <HoldingTable strategy={strategy} />
          {modeKey === 'consensus' && <ConsensusGradeComparison backtest={backtest} />}
          <FundamentalAxisReference fundamentalAxis={backtest.fundamentalAxis} />
        </div>
      )}
    </div>
  )
}
