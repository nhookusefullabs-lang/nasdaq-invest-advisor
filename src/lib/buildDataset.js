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

  return {
    generatedAt: raw.generatedAt,
    tickers: withSectorFlags,
    sectorReturns,
    leadingSectors: [...leadingSectors],
    excluded,
  }
}
