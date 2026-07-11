import { validateBacktest } from './backtestSchema.js'

/**
 * public/data/backtest.json을 fetch한다 (US-8). backtest.json은 존재하지 않을 수 있는
 * 선택적 스냅샷이므로, 404/네트워크 오류/파싱 실패/스키마 불일치는 모두 null 반환으로
 * 처리한다 (에러 UI 없음 — graceful degradation, research.json/fundamentals.json과 동일 원칙).
 */
export async function loadBacktest() {
  try {
    const url = `${import.meta.env.BASE_URL}data/backtest.json`
    const res = await fetch(url)
    if (!res.ok) return null

    const raw = await res.json()
    const { valid } = validateBacktest(raw)
    if (!valid) return null

    return raw
  } catch {
    return null
  }
}

/** backtest.strategies에서 (key, sample, basis)에 맞는 항목 하나를 찾는다. */
export function findStrategy(backtest, key, sample, basis) {
  return backtest?.strategies?.find((s) => s.key === key && s.sample === sample && s.basis === basis) ?? null
}

/** strategy.byHolding에서 보유기간 days에 맞는 항목을 찾는다. */
export function findHolding(strategy, days) {
  return strategy?.byHolding?.find((h) => h.days === days) ?? null
}

/**
 * modeKey('trend'|'minervini'|'consensus') → 화면에 노출할 신뢰도 요약(Out-of-Sample·top5·20거래일만).
 * backtest가 없거나, 해당 전략의 out/top5 항목이 없거나, 20거래일 레코드가 없으면 null
 * (호출자가 신뢰도 영역 전체를 렌더링하지 않도록 한다).
 * consensus 모드는 ★★(consensus_2star)를 대표 지표로 쓴다 — PRD §7 스키마에 등급 통합 항목이
 * 없고, ★★가 더 강한 신호이므로 헤더 요약의 대표값으로 적합하다.
 */
export function getConfidenceSummary(backtest, modeKey) {
  if (!backtest) return null
  const strategyKey = modeKey === 'consensus' ? 'consensus_2star' : modeKey
  const strategy = findStrategy(backtest, strategyKey, 'out', 'top5')
  const holding20 = findHolding(strategy, 20)
  if (!strategy || !holding20) return null

  return { strategy, holding20, insufficientSample: !holding20.signals || holding20.winRate == null || holding20.avgExcess == null }
}
