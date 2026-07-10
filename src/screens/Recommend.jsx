import Disclaimer from '../components/Disclaimer.jsx'
import ResearchSection from '../components/ResearchSection.jsx'
import { PRESETS, PRESET_KEYS } from '../lib/presets.js'

// preset 상태 문자열 -> 배너·보조 문구에 쓰는 표시 라벨. 'custom'은 US-10(고급 설정)에서
// 실제로 도달 가능해진다 — 그 전까지는 세그먼트가 이 라벨을 그릴 일이 없다.
function presetLabel(preset) {
  return preset === 'custom' ? '사용자 설정' : (PRESETS[preset]?.label ?? PRESETS.default.label)
}

export default function Recommend({
  generatedAt,
  recommendation,
  researchMap,
  preset,
  onPresetChange,
  selectedTickers,
  onToggleSelect,
  onGoToSimulation,
}) {
  const { list, relaxationApplied, insufficientSignal } = recommendation
  const label = presetLabel(preset)
  const isNonDefaultPreset = (preset ?? 'default') !== 'default'

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">추천 결과</h2>
      <p className="text-sm text-gray-500 mb-4">
        1단계 매수 신호(RSI·MACD·골든크로스) 통과 종목을 2단계 점수 순으로 정렬했습니다. 신호를 통과하지
        못했어도 점수 70점 이상인 종목은 고득점 특별 편입으로 함께 보여줍니다.
      </p>

      <div className="flex items-center gap-2 mb-1" role="group" aria-label="추천 프리셋">
        {PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetChange(key)}
            aria-pressed={preset === key}
            className={`px-3 py-1.5 rounded text-sm font-semibold border ${
              preset === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {PRESETS[key].label}
          </button>
        ))}
        {preset === 'custom' && (
          <span className="px-3 py-1.5 rounded text-sm font-semibold border bg-purple-50 text-purple-700 border-purple-200">
            사용자 설정
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {preset === 'custom'
          ? '고급 설정에서 직접 조정한 파라미터를 사용 중입니다'
          : (PRESETS[preset] ?? PRESETS.default).description}
      </p>

      {relaxationApplied && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          조건 완화 적용됨 — {label} 기준 매수 신호 통과 종목이 부족해 조건을 완화했습니다.
        </div>
      )}

      {insufficientSignal && (
        <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
          {label} 기준 매수 신호가 충분치 않습니다. (조건 완화 후에도 5개 미만)
        </div>
      )}

      <div className="space-y-2 mb-4">
        {list.map((r) => (
          <div key={r.ticker} className="border border-gray-200 rounded px-3 py-2 hover:bg-gray-50">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedTickers.includes(r.ticker)}
                  onChange={() => onToggleSelect(r.ticker)}
                />
                <div>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {r.ticker} <span className="text-gray-500 font-normal">{r.name}</span>
                    {!r.signalPassed && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700">고득점 편입</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{r.reasons}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">{r.score.toFixed(1)}점</p>
              </div>
            </label>
            {researchMap?.get(r.ticker) && isNonDefaultPreset && (
              <p className="text-xs text-gray-400 mt-1">리서치 풀은 기본형 기준으로 선정되었습니다.</p>
            )}
            <ResearchSection research={researchMap?.get(r.ticker)} />
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">추천 가능한 종목이 없습니다.</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{selectedTickers.length}개 선택됨 (시뮬레이션·포트폴리오는 1개 이상부터 가능)</p>
        <button
          type="button"
          disabled={selectedTickers.length === 0}
          onClick={onGoToSimulation}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          선택 종목 시뮬레이션 보기 →
        </button>
      </div>

      <Disclaimer generatedAt={generatedAt} />
    </div>
  )
}
