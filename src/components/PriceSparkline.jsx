const WIDTH = 160
const HEIGHT = 44
const PAD_Y = 4

// 상승(빨강)/하락(파랑) — 앱 전체에서 이미 쓰는 국내식 등락 색상 관례를 그대로 따른다
const UP_COLOR = '#dc2626'
const DOWN_COLOR = '#2563eb'

function buildLinePoints(closes) {
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const n = closes.length
  return closes.map((c, i) => {
    const x = n > 1 ? (i / (n - 1)) * WIDTH : WIDTH / 2
    const y = PAD_Y + (1 - (c - min) / range) * (HEIGHT - PAD_Y * 2)
    return { x, y }
  })
}

/** points: [{ date, close }] — 기간 오름차순, 최소 2개 이상 */
export default function PriceSparkline({ label, points }) {
  if (!points || points.length < 2) {
    return (
      <div className="flex-1 min-w-[120px]">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-xs text-gray-400">데이터 부족</p>
      </div>
    )
  }

  const closes = points.map((p) => p.close)
  const changePct = (closes.at(-1) / closes[0] - 1) * 100
  const positive = changePct >= 0
  const color = positive ? UP_COLOR : DOWN_COLOR
  const linePoints = buildLinePoints(closes)
  const linePath = linePoints.map((p) => `${p.x},${p.y}`).join(' ')
  const areaPath = [
    `M ${linePoints[0].x},${HEIGHT}`,
    ...linePoints.map((p) => `L ${p.x},${p.y}`),
    `L ${linePoints.at(-1).x},${HEIGHT}`,
    'Z',
  ].join(' ')

  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-xs font-bold ${positive ? 'text-red-600' : 'text-blue-600'}`}>
          {positive ? '+' : ''}
          {changePct.toFixed(1)}%
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={`${label} 가격 추이, ${points[0].date}부터 ${points.at(-1).date}까지 ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`}
      >
        <path d={areaPath} fill={color} opacity="0.1" />
        <polyline points={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}
