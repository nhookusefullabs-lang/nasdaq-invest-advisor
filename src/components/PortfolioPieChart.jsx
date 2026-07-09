import { useState } from 'react'
import { OTHER_COLOR } from '../lib/portfolioColors.js'

const GAP_DEG = 1.2
const SIZE = 200
const CENTER = SIZE / 2
const R_OUTER = 90
const R_INNER = 58
const LABEL_R = (R_OUTER + R_INNER) / 2

function polarToCartesian(angleDeg, r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) }
}

function donutSlicePath(startAngle, endAngle) {
  const startOuter = polarToCartesian(endAngle, R_OUTER)
  const endOuter = polarToCartesian(startAngle, R_OUTER)
  const startInner = polarToCartesian(endAngle, R_INNER)
  const endInner = polarToCartesian(startAngle, R_INNER)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ')
}

/** entries: [{ ticker, name, pct, color, isOther }] — pct in 0..100, sums to ~100 */
export default function PortfolioPieChart({ entries }) {
  const [hovered, setHovered] = useState(null)

  const colored = entries.filter((e) => !e.isOther).sort((a, b) => b.pct - a.pct)
  const otherEntries = entries.filter((e) => e.isOther)
  const otherPct = otherEntries.reduce((s, e) => s + e.pct, 0)

  const segments = [
    ...colored,
    ...(otherEntries.length > 0
      ? [{ ticker: '기타', name: `${otherEntries.length}개 종목`, pct: otherPct, color: OTHER_COLOR, isOther: true }]
      : []),
  ]

  const total = segments.reduce((s, e) => s + e.pct, 0) || 1
  let angle = 0
  const arcs = segments.map((seg) => {
    const sweep = (seg.pct / total) * 360
    const rawStart = angle
    const rawEnd = angle + sweep
    angle = rawEnd
    const start = Math.min(rawStart + GAP_DEG / 2, rawEnd - GAP_DEG / 2)
    const end = Math.max(rawStart + GAP_DEG / 2, rawEnd - GAP_DEG / 2)
    const mid = (rawStart + rawEnd) / 2
    return { ...seg, start, end, labelPos: polarToCartesian(mid, LABEL_R) }
  })

  const activeSeg = arcs.find((seg) => seg.ticker === hovered)

  return (
    <div className="relative flex justify-center mb-4" style={{ width: SIZE, margin: '0 auto' }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`포트폴리오 비중 파이차트, ${entries.length}개 종목`}
      >
        {arcs.map((seg) => (
          <path
            key={seg.ticker}
            d={donutSlicePath(seg.start, seg.end)}
            fill={seg.color}
            tabIndex={0}
            className="cursor-pointer outline-none"
            style={{ opacity: hovered && hovered !== seg.ticker ? 0.35 : 1, transition: 'opacity 120ms' }}
            onMouseEnter={() => setHovered(seg.ticker)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(seg.ticker)}
            onBlur={() => setHovered(null)}
          />
        ))}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" fontSize="22" fontWeight="700" className="fill-gray-800">
          {entries.length}
        </text>
        <text x={CENTER} y={CENTER + 16} textAnchor="middle" fontSize="11" className="fill-gray-400">
          종목
        </text>
      </svg>

      {activeSeg && (
        <div
          className="absolute pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap -translate-x-1/2 -translate-y-full"
          style={{ left: activeSeg.labelPos.x, top: activeSeg.labelPos.y - 6 }}
        >
          <span className="font-bold">{activeSeg.pct.toFixed(1)}%</span>{' '}
          <span className="text-gray-300">{activeSeg.ticker}</span>
        </div>
      )}
    </div>
  )
}
