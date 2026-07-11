import { validateBacktest } from './backtestSchema.js'

/**
 * v1 문서(schemaVersion===1, strategies[].signalQuality 필드 없음)를 v2 형태로 정규화한다 —
 * 각 전략 항목에 signalQuality:"all"을 채워 넣는다(research.json v1→v2 riskFlags 정규화와
 * 동일한 패턴). v2 문서는 이미 signalQuality가 있으므로 그대로 반환.
 */
function normalizeSignalQuality(data) {
  if (data.schemaVersion !== 1) return data
  return { ...data, strategies: data.strategies.map((s) => ({ ...s, signalQuality: 'all' })) }
}

/**
 * public/data/backtest.json을 fetch한다 (US-8, v2는 prd-v9.1-diagnostics.md US-1). backtest.json은
 * 존재하지 않을 수 있는 선택적 스냅샷이므로, 404/네트워크 오류/파싱 실패/스키마 불일치는 모두
 * null 반환으로 처리한다 (에러 UI 없음 — graceful degradation, research.json/fundamentals.json과
 * 동일 원칙). v1 문서는 정규화 후 반환하므로 호출자는 항상 v2 형태(signalQuality 존재)만 다룬다.
 */
export async function loadBacktest() {
  try {
    const url = `${import.meta.env.BASE_URL}data/backtest.json`
    const res = await fetch(url)
    if (!res.ok) return null

    const raw = await res.json()
    const { valid } = validateBacktest(raw)
    if (!valid) return null

    return normalizeSignalQuality(raw)
  } catch {
    return null
  }
}

/** backtest.strategies에서 (key, sample, basis, signalQuality)에 맞는 항목 하나를 찾는다. */
export function findStrategy(backtest, key, sample, basis, signalQuality = 'all') {
  return backtest?.strategies?.find((s) => s.key === key && s.sample === sample && s.basis === basis && (s.signalQuality ?? 'all') === signalQuality) ?? null
}

/** strategy.byHolding에서 보유기간 days에 맞는 항목을 찾는다. */
export function findHolding(strategy, days) {
  return strategy?.byHolding?.find((h) => h.days === days) ?? null
}

/**
 * modeKey('trend'|'minervini'|'consensus') → 화면에 노출할 신뢰도 요약(Out-of-Sample·top5,
 * 20거래일·60거래일 병기 — v9.1 US-5). backtest가 없거나, 해당 전략의 out/top5 항목이 없거나,
 * 20거래일 레코드가 없으면 null(호출자가 신뢰도 영역 전체를 렌더링하지 않도록 한다) — 20거래일은
 * US-8부터의 기존 하드 게이트를 그대로 유지한다. 60거래일 레코드가 없으면(구버전 픽스처 등)
 * null 처리하지 않고 insufficientSample60:true로만 표시한다(20일 표시는 그대로 유지).
 * consensus 모드는 ★★(consensus_2star)를 대표 지표로 쓴다 — PRD §7 스키마에 등급 통합 항목이
 * 없고, ★★가 더 강한 신호이므로 헤더 요약의 대표값으로 적합하다.
 */
export function getConfidenceSummary(backtest, modeKey) {
  if (!backtest) return null
  const strategyKey = modeKey === 'consensus' ? 'consensus_2star' : modeKey
  const strategy = findStrategy(backtest, strategyKey, 'out', 'top5')
  const holding20 = findHolding(strategy, 20)
  if (!strategy || !holding20) return null

  const holding60 = findHolding(strategy, 60)
  const insufficientSample60 = !holding60 || !holding60.signals || holding60.winRate == null || holding60.avgExcess == null

  // overlapFactor(v9.1 US-3)가 없는 v1 산출물은 유효 표본 근사를 계산하지 않는다(하위 호환,
  // 화면은 주석만 생략 — US-5 승인 기준 2).
  const overlapFactor60 = backtest.config?.overlapFactor?.[60]
  const effectiveSample60 = holding60 && overlapFactor60 ? holding60.signals / overlapFactor60 : null

  return {
    strategy,
    holding20,
    holding60,
    insufficientSample: !holding20.signals || holding20.winRate == null || holding20.avgExcess == null,
    insufficientSample60,
    effectiveSample60,
  }
}
