import { deriveTickerData } from './deriveTickerData.js'
import { computeLeadingSectors, applyLeadingSectorFlags } from './sectorAnalysis.js'

/**
 * public/data/nasdaq100.json 을 읽어 지표·주도섹터가 포함된 최종 데이터셋을 만든다.
 * 반환: { generatedAt, tickers, excluded }
 */
export async function loadNasdaq100() {
  const url = `${import.meta.env.BASE_URL}data/nasdaq100.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`데이터 로드 실패: ${res.status} ${url}`)
  const raw = await res.json()

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
