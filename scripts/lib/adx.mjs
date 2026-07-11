// ADX(Average Directional Index) — 백테스트 후보 변형 B(adx_gate) 전용 지표 (PRD_Nasdaq9.md
// §4.3, US-7). "채택 확정 시에만 별도 이터레이션에서 앱 반영" 원칙에 따라 앱 lib
// (src/lib/indicators.js)에는 넣지 않고 scripts/ 아래에만 둔다 — 아직 검증되지 않은 후보
// 지표이기 때문이다. Wilder의 원 계산법을 따른다.

function average(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

/** Wilder 평활: 첫 period개의 단순평균을 시드로, 이후 (이전값*(period-1)+새값)/period. */
function wilderSmooth(values, period) {
  if (values.length < period) return []
  const out = [average(values.slice(0, period))]
  for (let i = period; i < values.length; i++) {
    out.push((out[out.length - 1] * (period - 1) + values[i]) / period)
  }
  return out
}

/**
 * ADX(14) 스냅샷(현재 시점 값 하나) 계산. True Range/+DM/-DM을 각각 Wilder 평활한 뒤
 * +DI/-DI → DX → DX를 다시 Wilder 평활해 ADX를 얻는다. 안정적 계산에 최소 2×period+1개의
 * 바가 필요하며, 미달이면 null을 반환한다.
 */
export function adx(series, period = 14) {
  const n = series.length
  if (n < period * 2 + 1) return null

  const trArr = []
  const plusDmArr = []
  const minusDmArr = []
  for (let i = 1; i < n; i++) {
    const cur = series[i]
    const prev = series[i - 1]
    trArr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)))

    const upMove = cur.high - prev.high
    const downMove = prev.low - cur.low
    plusDmArr.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDmArr.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  const smoothTr = wilderSmooth(trArr, period)
  const smoothPlusDm = wilderSmooth(plusDmArr, period)
  const smoothMinusDm = wilderSmooth(minusDmArr, period)
  if (!smoothTr.length) return null

  const dxArr = smoothTr.map((tr, i) => {
    if (!tr) return 0
    const plusDi = (smoothPlusDm[i] / tr) * 100
    const minusDi = (smoothMinusDm[i] / tr) * 100
    const sum = plusDi + minusDi
    return sum === 0 ? 0 : (Math.abs(plusDi - minusDi) / sum) * 100
  })

  const adxArr = wilderSmooth(dxArr, period)
  if (!adxArr.length) return null

  return adxArr[adxArr.length - 1]
}
