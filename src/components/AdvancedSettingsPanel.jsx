import { useState } from 'react'
import { CUSTOM_PARAM_RANGES } from '../lib/constants.js'
import { PRESETS } from '../lib/presets.js'

const DEFAULT_PARAMS = {
  rsiMin: PRESETS.default.rsiMin,
  goldenCrossWindow: PRESETS.default.goldenCrossWindow,
  highScoreThreshold: PRESETS.default.highScoreThreshold,
}

const FIELDS = [
  { key: 'rsiMin', label: 'RSI 하한', ...CUSTOM_PARAM_RANGES.rsiMin },
  { key: 'goldenCrossWindow', label: '골든크로스 창(거래일)', ...CUSTOM_PARAM_RANGES.goldenCrossWindow },
  { key: 'highScoreThreshold', label: '고득점 편입 임계', ...CUSTOM_PARAM_RANGES.highScoreThreshold },
]

const clamp = (value, min, max) => {
  if (Number.isNaN(value)) return min
  return Math.max(min, Math.min(max, value))
}

/**
 * 프리셋 세그먼트(US-9) 아래 접이식 고급 설정 패널 (PRD_Nasdaq7 §3 Must-9, US-10) — 기본 접힘.
 * 파라미터를 조정하면 onParamChange(key, clampedValue)만 호출한다 — preset을 'custom'으로
 * 전환하는 결정은 App.jsx가 한다(패널은 상태를 소유하지 않는다).
 */
export default function AdvancedSettingsPanel({ customParams, onParamChange, onResetToDefault }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-200 rounded mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-semibold">고급 설정</span>
        <span className="text-gray-400 text-xs">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {FIELDS.map(({ key, label, min, max }) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <label htmlFor={`custom-param-${key}`} className="w-40 shrink-0">
                {label}
              </label>
              <input
                id={`custom-param-${key}`}
                type="number"
                min={min}
                max={max}
                value={customParams[key]}
                onChange={(e) => onParamChange(key, clamp(Number(e.target.value), min, max))}
                className="w-20 border border-gray-300 rounded px-2 py-1"
              />
              {customParams[key] !== DEFAULT_PARAMS[key] && (
                <span className="text-xs text-gray-400">
                  기본형 {DEFAULT_PARAMS[key]} → 현재 {customParams[key]}
                </span>
              )}
            </div>
          ))}

          <button type="button" onClick={onResetToDefault} className="text-xs text-blue-600 hover:underline">
            기본형으로 초기화
          </button>
        </div>
      )}
    </div>
  )
}
