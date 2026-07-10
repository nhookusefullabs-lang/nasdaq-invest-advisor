import { buildDataset } from './buildDataset.js'

/**
 * public/data/nasdaq100.json 을 읽어 지표·주도섹터가 포함된 최종 데이터셋을 만든다.
 * 반환: { generatedAt, tickers, excluded }
 */
export async function loadNasdaq100() {
  const url = `${import.meta.env.BASE_URL}data/nasdaq100.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`데이터 로드 실패: ${res.status} ${url}`)
  const raw = await res.json()
  return buildDataset(raw)
}
