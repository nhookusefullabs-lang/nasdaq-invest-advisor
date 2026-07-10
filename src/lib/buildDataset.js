import { deriveTickerData } from './deriveTickerData.js'
import { computeLeadingSectors, applyLeadingSectorFlags } from './sectorAnalysis.js'

/**
 * 파싱된 nasdaq100.json 원본({generatedAt, tickers})을 지표·주도섹터가 포함된
 * 최종 데이터셋으로 변환한다. 브라우저(fetch)와 Node CLI(fs) 양쪽에서 공유하는 순수 함수.
 * 반환: { generatedAt, tickers, sectorReturns, leadingSectors, excluded }
 */
export function buildDataset(raw) {
  const derived = raw.tickers.map(deriveTickerData)
  const excluded = derived
    .filter((t) => !t.dataSufficient)
    .map((t) => ({ ticker: t.ticker, reason: t.insufficientReason }))

  const { sectorReturns, leadingSectors } = computeLeadingSectors(derived)
  const withSectorFlags = applyLeadingSectorFlags(derived, leadingSectors)

  // ATR% 변동성 필터(US-5 passesAtrPercentile)는 절대 임계가 아닌 유니버스 상대 백분위
  // 기준이므로, 개별 종목이 아니라 풀 단위로 모집단을 한 번만 계산해 둔다 (PRD_Nasdaq7 §3 Must-4).
  const universeAtrPercents = withSectorFlags
    .filter((t) => t.dataSufficient && t.indicators.atrPercent != null)
    .map((t) => t.indicators.atrPercent)

  return {
    generatedAt: raw.generatedAt,
    tickers: withSectorFlags,
    sectorReturns,
    leadingSectors: [...leadingSectors],
    excluded,
    universeAtrPercents,
  }
}
