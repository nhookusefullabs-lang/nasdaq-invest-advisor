import Disclaimer from '../components/Disclaimer.jsx'
import ResearchSection from '../components/ResearchSection.jsx'
import AdvancedSettingsPanel from '../components/AdvancedSettingsPanel.jsx'
import ResearchRequestToggle from '../components/ResearchRequestToggle.jsx'
import FundamentalBadge from '../components/FundamentalBadge.jsx'
import FundamentalFailSection from '../components/FundamentalFailSection.jsx'
import ResearchCheckBadge from '../components/ResearchCheckBadge.jsx'
import BacktestConfidence from '../components/BacktestConfidence.jsx'
import RegimeBadge from '../components/RegimeBadge.jsx'
import EntryPriceCard from '../components/EntryPriceCard.jsx'
import ExitSignalBadge from '../components/ExitSignalBadge.jsx'
import { PRESETS, PRESET_KEYS } from '../lib/presets.js'
import { TREND_TEMPLATE, TREND_TEMPLATE_RELAXED_MIN_CONDITIONS } from '../lib/constants/v8.js'
import { evaluateFundamentalHurdle } from '../lib/fundamentals.js'
import { computeResearchCheckState } from '../lib/researchCheck.js'

// preset 상태 문자열 -> 배너·보조 문구에 쓰는 표시 라벨. 'custom'은 US-10(v7 고급 설정)에서
// 실제로 도달 가능해진다 — 그 전까지는 세그먼트가 이 라벨을 그릴 일이 없다.
function presetLabel(preset) {
  return preset === 'custom' ? '사용자 설정' : (PRESETS[preset]?.label ?? PRESETS.default.label)
}

const MODE_KEYS = ['consensus', 'trend', 'minervini']
const MODE_LABELS = { consensus: '통합', trend: '추세추종', minervini: '미너비니' }

// list 항목을 펀더멘털 허들 판정(fail 여부)에 따라 나눈다 (PRD_Nasdaq8 §4.4, US-11).
// fundamentalsMap이 없거나(fundamentals.json 미제공) 해당 티커 항목이 없으면
// evaluateFundamentalHurdle이 null을 반환하므로 그 종목은 자연히 visible로 남고
// 배지도 렌더링되지 않는다 — 별도 분기 없이도 "US-10 상태와 시각적으로 동일"이 보장된다.
function splitByFundamentalVerdict(list, fundamentalsMap) {
  const visible = []
  const failed = []
  for (const item of list) {
    const evaluation = evaluateFundamentalHurdle(fundamentalsMap?.get(item.ticker))
    if (evaluation?.verdict === 'fail') {
      failed.push({ ticker: item.ticker, name: item.name, reasons: evaluation.reasons })
    } else {
      visible.push({ ...item, fundamentalEvaluation: evaluation })
    }
  }
  return { visible, failed }
}

// "리스크 플래그 종목 숨기기" 토글이 켜져 있을 때 ⚠ 상태(리스크 플래그 있음 또는 부정적
// 센티먼트) 종목만 걸러낸다 (PRD_Nasdaq8 §4.5, US-12). fundamentals의 Fail과 달리 별도
// 섹션으로 옮기지 않고 그냥 숨긴다 — 토글이 꺼져 있으면(기본값) 아무것도 걸러내지 않는다.
function filterHiddenRiskFlagged(list, researchMap, hideRiskFlagged) {
  if (!hideRiskFlagged) return list
  return list.filter((item) => computeResearchCheckState(researchMap?.get(item.ticker)).state !== 'flagged')
}

// 체크박스가 있는 <label>은 클릭 버블링으로 그 안의 버튼까지 토글해 버리므로, 리서치 요청
// 토글·펀더멘털 배지·리서치 상세는 label 바깥(형제)에 배치한다 (v7 US-11 "체크박스 오작동
// 방지" 패턴 재사용).
function SelectAndResearch({
  ticker,
  selectedTickers,
  onToggleSelect,
  researchRequests,
  onToggleResearchRequest,
  children,
  fundamentalEvaluation,
  researchSection,
  tickerData,
  generatedAt,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  return (
    <div className="border border-gray-200 rounded px-3 py-2 hover:bg-gray-50">
      <label className="flex items-center justify-between cursor-pointer">
        <div className="flex items-center gap-3 flex-1">
          <input type="checkbox" checked={selectedTickers.includes(ticker)} onChange={() => onToggleSelect(ticker)} />
          {children}
        </div>
      </label>
      {onToggleResearchRequest && (
        <div className="mt-1">
          <ResearchRequestToggle
            ticker={ticker}
            requested={researchRequests.includes(ticker)}
            onToggle={onToggleResearchRequest}
          />
        </div>
      )}
      <FundamentalBadge evaluation={fundamentalEvaluation} />
      <EntryPriceCard
        tickerData={tickerData}
        generatedAt={generatedAt}
        expanded={!!expandedEntryEvidence?.[ticker]}
        onToggleExpanded={() => onToggleEntryEvidence?.(ticker)}
      />
      <ExitSignalBadge tickerData={tickerData} />
      {researchSection}
    </div>
  )
}

function ModeSegment({ recommendMode, onModeChange }) {
  return (
    <div className="flex items-center gap-2 mb-4" role="group" aria-label="추천 모드">
      {MODE_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onModeChange?.(key)}
          aria-pressed={recommendMode === key}
          className={`px-3 py-1.5 rounded text-sm font-semibold border ${
            recommendMode === key
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {MODE_LABELS[key]}
        </button>
      ))}
    </div>
  )
}

// v8에서는 항상 "설계값" 안내였지만, backtest.json이 존재하면(US-8) 실측 검증이 반영되었음을
// 알리는 문구로 교체한다 — 부재 시(생성 전/그래도 무방한 상태) 기존 v8 문구를 그대로 유지한다.
function DesignValueNotice({ backtest }) {
  return (
    <p className="text-xs text-gray-400 mt-4">
      {backtest ? `실측 검증 결과 표시 중 (${backtest.generatedAt} 기준)` : '배점·기준값은 v9 백테스트로 조정 예정인 설계값입니다.'}
    </p>
  )
}

function TrendModeView({
  generatedAt,
  recommendation,
  researchMap,
  fundamentalsMap,
  hideRiskFlagged,
  preset,
  onPresetChange,
  customParams,
  onCustomParamChange,
  onResetToDefault,
  researchRequests,
  onToggleResearchRequest,
  selectedTickers,
  onToggleSelect,
  backtest,
  tickerDataMap,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  const { relaxationApplied, insufficientSignal } = recommendation
  const { visible: afterFundamentals, failed } = splitByFundamentalVerdict(recommendation.list, fundamentalsMap)
  const list = filterHiddenRiskFlagged(afterFundamentals, researchMap, hideRiskFlagged)
  const label = presetLabel(preset)
  const isNonDefaultPreset = (preset ?? 'default') !== 'default'

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        1단계 매수 신호(RSI·MACD·골든크로스) 통과 종목을 2단계 점수 순으로 정렬했습니다. 신호를 통과하지
        못했어도 점수 70점 이상인 종목은 고득점 특별 편입으로 함께 보여줍니다.
      </p>

      <BacktestConfidence backtest={backtest} modeKey="trend" />

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

      {customParams && (
        <AdvancedSettingsPanel
          customParams={customParams}
          onParamChange={onCustomParamChange}
          onResetToDefault={onResetToDefault}
        />
      )}

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
            {onToggleResearchRequest && (
              <div className="mt-1">
                <ResearchRequestToggle
                  ticker={r.ticker}
                  requested={researchRequests.includes(r.ticker)}
                  onToggle={onToggleResearchRequest}
                />
              </div>
            )}
            <FundamentalBadge evaluation={r.fundamentalEvaluation} />
            <EntryPriceCard
              tickerData={tickerDataMap?.get(r.ticker)}
              generatedAt={generatedAt}
              expanded={!!expandedEntryEvidence?.[r.ticker]}
              onToggleExpanded={() => onToggleEntryEvidence?.(r.ticker)}
            />
            <ExitSignalBadge tickerData={tickerDataMap?.get(r.ticker)} />
            <ResearchCheckBadge research={researchMap?.get(r.ticker)} />
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

      <FundamentalFailSection failed={failed} />
    </>
  )
}

function TrendTemplateChecklist({ templateChecks }) {
  return (
    <div className="grid grid-cols-8 gap-1 text-[10px] mt-1" aria-label="트렌드 템플릿 체크리스트">
      {templateChecks.map((c) => (
        <span
          key={c.code}
          title={c.code}
          className={`text-center rounded px-0.5 py-0.5 ${c.passed ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}
        >
          {c.code}
          {c.passed ? '✓' : '✗'}
        </span>
      ))}
    </div>
  )
}

function MinerviniModeView({
  minerviniResult,
  researchMap,
  fundamentalsMap,
  hideRiskFlagged,
  researchRequests,
  onToggleResearchRequest,
  selectedTickers,
  onToggleSelect,
  backtest,
  tickerDataMap,
  generatedAt,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  const { relaxationApplied, insufficientSignal } = minerviniResult
  const { visible: afterFundamentals, failed } = splitByFundamentalVerdict(minerviniResult.list, fundamentalsMap)
  const list = filterHiddenRiskFlagged(afterFundamentals, researchMap, hideRiskFlagged)

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        미너비니 SEPA 방법론 — 1단계 트렌드 템플릿(8조건) 통과 종목을 2단계 VCP(변동성 수축 패턴) 점수 순으로
        정렬했습니다.
      </p>

      <BacktestConfidence backtest={backtest} modeKey="minervini" />

      {relaxationApplied && (
        <div className="mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          조건 완화 적용됨({TREND_TEMPLATE_RELAXED_MIN_CONDITIONS}/{TREND_TEMPLATE.CONDITION_COUNT}) — 8조건 전부
          충족 종목이 부족해 조건을 완화했습니다.
        </div>
      )}

      {insufficientSignal && (
        <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
          <p>미너비니 기준 매수 신호가 충분치 않습니다. (조건 완화 후에도 5개 미만)</p>
          <p className="mt-1">미너비니 방법론에서는 조건 미충족 시 현금 보유가 원칙입니다.</p>
        </div>
      )}

      <div className="space-y-2 mb-1">
        {list.map((r) => (
          <SelectAndResearch
            key={r.ticker}
            ticker={r.ticker}
            selectedTickers={selectedTickers}
            onToggleSelect={onToggleSelect}
            researchRequests={researchRequests}
            onToggleResearchRequest={onToggleResearchRequest}
            fundamentalEvaluation={r.fundamentalEvaluation}
            tickerData={tickerDataMap?.get(r.ticker)}
            generatedAt={generatedAt}
            expandedEntryEvidence={expandedEntryEvidence}
            onToggleEntryEvidence={onToggleEntryEvidence}
            researchSection={
              <>
                <ResearchCheckBadge research={researchMap?.get(r.ticker)} />
                <ResearchSection research={researchMap?.get(r.ticker)} />
              </>
            }
          >
            <div className="flex-1">
              <p className="font-semibold text-sm flex items-center justify-between gap-1.5">
                <span>
                  {r.ticker} <span className="text-gray-500 font-normal">{r.name}</span>
                </span>
                <span className="text-sm font-bold">{r.score.toFixed(1)}점</span>
              </p>
              <p className="text-xs text-gray-500">{r.reasons}</p>
              <TrendTemplateChecklist templateChecks={r.templateChecks} />
            </div>
          </SelectAndResearch>
        ))}
        {list.length === 0 && !insufficientSignal && (
          <p className="text-sm text-gray-400 py-6 text-center">추천 가능한 종목이 없습니다.</p>
        )}
      </div>

      <FundamentalFailSection failed={failed} />

      <DesignValueNotice backtest={backtest} />
    </>
  )
}

function ConsensusCard({
  entry,
  researchMap,
  researchRequests,
  onToggleResearchRequest,
  selectedTickers,
  onToggleSelect,
  tickerDataMap,
  generatedAt,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  const pctTop = Math.round(100 - entry.consensusPercentile)
  const summaryLine =
    entry.grade === '★★'
      ? `추세추종 ${entry.trend.score.toFixed(1)}점 · 미너비니 ${entry.minervini.score.toFixed(1)}점 · 통합 상위 ${pctTop}%`
      : `${entry.singleModeLabel} ${(entry.trend ?? entry.minervini).score.toFixed(1)}점 · 통합 상위 ${pctTop}%`

  return (
    <SelectAndResearch
      ticker={entry.ticker}
      selectedTickers={selectedTickers}
      onToggleSelect={onToggleSelect}
      researchRequests={researchRequests}
      onToggleResearchRequest={onToggleResearchRequest}
      fundamentalEvaluation={entry.fundamentalEvaluation}
      tickerData={tickerDataMap?.get(entry.ticker)}
      generatedAt={generatedAt}
      expandedEntryEvidence={expandedEntryEvidence}
      onToggleEntryEvidence={onToggleEntryEvidence}
      researchSection={
        <>
          <ResearchCheckBadge research={researchMap?.get(entry.ticker)} />
          <ResearchSection research={researchMap?.get(entry.ticker)} />
        </>
      }
    >
      <div className="flex-1">
        <p className="font-semibold text-sm flex items-center gap-1.5">
          <span
            className={`px-1.5 py-0.5 rounded text-xs ${entry.grade === '★★' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}
          >
            {entry.grade}
          </span>
          {entry.ticker} <span className="text-gray-500 font-normal">{entry.name}</span>
        </p>
        <p className="text-xs text-gray-500">{summaryLine}</p>
      </div>
    </SelectAndResearch>
  )
}

function ConsensusModeView({
  consensusResult,
  researchMap,
  fundamentalsMap,
  hideRiskFlagged,
  researchRequests,
  onToggleResearchRequest,
  selectedTickers,
  onToggleSelect,
  backtest,
  tickerDataMap,
  generatedAt,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  const { trendInsufficientSignal, minerviniInsufficientSignal } = consensusResult
  const { visible: afterFundamentals, failed } = splitByFundamentalVerdict(consensusResult.list, fundamentalsMap)
  const list = filterHiddenRiskFlagged(afterFundamentals, researchMap, hideRiskFlagged)

  return (
    <>
      <p className="text-sm text-gray-500 mb-4">
        추세추종과 미너비니 두 관점이 모두 매수 신호를 준 종목(★★)을 우선하고, 한쪽 관점만 통과한 종목(★)도
        함께 보여줍니다.
      </p>

      <BacktestConfidence backtest={backtest} modeKey="consensus" />

      {trendInsufficientSignal && minerviniInsufficientSignal && (
        <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
          두 모드 모두 매수 신호가 충분치 않습니다.
        </div>
      )}

      <div className="space-y-2 mb-4">
        {list.map((entry) => (
          <ConsensusCard
            key={entry.ticker}
            entry={entry}
            researchMap={researchMap}
            researchRequests={researchRequests}
            onToggleResearchRequest={onToggleResearchRequest}
            selectedTickers={selectedTickers}
            onToggleSelect={onToggleSelect}
            tickerDataMap={tickerDataMap}
            generatedAt={generatedAt}
            expandedEntryEvidence={expandedEntryEvidence}
            onToggleEntryEvidence={onToggleEntryEvidence}
          />
        ))}
        {list.length === 0 && (
          <p className="text-sm text-gray-400 py-6 text-center">추천 가능한 종목이 없습니다.</p>
        )}
      </div>

      <FundamentalFailSection failed={failed} />

      <DesignValueNotice backtest={backtest} />
    </>
  )
}

export default function Recommend({
  generatedAt,
  recommendation,
  minerviniResult,
  consensusResult,
  researchMap,
  fundamentalsMap,
  hideRiskFlagged = false,
  onToggleHideRiskFlagged,
  recommendMode = 'trend',
  onModeChange,
  preset,
  onPresetChange,
  customParams,
  onCustomParamChange,
  onResetToDefault,
  researchRequests = [],
  onToggleResearchRequest,
  selectedTickers,
  onToggleSelect,
  onGoToSimulation,
  backtest,
  regimeInfo,
  tickerDataMap,
  expandedEntryEvidence,
  onToggleEntryEvidence,
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">추천 결과</h2>

      <RegimeBadge regimeInfo={regimeInfo} backtest={backtest} />

      {(recommendation?.regimeGated || minerviniResult?.regimeGated) && (
        <p className="mb-4 text-sm text-blue-700 bg-blue-50 rounded px-3 py-2">
          하락 국면에서는 완화 신호가 제외됩니다 (v11 · 백테스트 근거)
        </p>
      )}

      <ModeSegment recommendMode={recommendMode} onModeChange={onModeChange} />

      <label className="flex items-center gap-2 mb-4 text-sm text-gray-600">
        <input type="checkbox" checked={hideRiskFlagged} onChange={() => onToggleHideRiskFlagged?.()} />
        리스크 플래그 종목 숨기기
      </label>

      {recommendMode === 'trend' && (
        <TrendModeView
          generatedAt={generatedAt}
          recommendation={recommendation}
          researchMap={researchMap}
          fundamentalsMap={fundamentalsMap}
          hideRiskFlagged={hideRiskFlagged}
          preset={preset}
          onPresetChange={onPresetChange}
          customParams={customParams}
          onCustomParamChange={onCustomParamChange}
          onResetToDefault={onResetToDefault}
          researchRequests={researchRequests}
          onToggleResearchRequest={onToggleResearchRequest}
          selectedTickers={selectedTickers}
          onToggleSelect={onToggleSelect}
          backtest={backtest}
          tickerDataMap={tickerDataMap}
          expandedEntryEvidence={expandedEntryEvidence}
          onToggleEntryEvidence={onToggleEntryEvidence}
        />
      )}

      {recommendMode === 'minervini' && minerviniResult && (
        <MinerviniModeView
          minerviniResult={minerviniResult}
          researchMap={researchMap}
          fundamentalsMap={fundamentalsMap}
          hideRiskFlagged={hideRiskFlagged}
          researchRequests={researchRequests}
          onToggleResearchRequest={onToggleResearchRequest}
          selectedTickers={selectedTickers}
          onToggleSelect={onToggleSelect}
          backtest={backtest}
          tickerDataMap={tickerDataMap}
          generatedAt={generatedAt}
          expandedEntryEvidence={expandedEntryEvidence}
          onToggleEntryEvidence={onToggleEntryEvidence}
        />
      )}

      {recommendMode === 'consensus' && consensusResult && (
        <ConsensusModeView
          consensusResult={consensusResult}
          researchMap={researchMap}
          fundamentalsMap={fundamentalsMap}
          hideRiskFlagged={hideRiskFlagged}
          researchRequests={researchRequests}
          onToggleResearchRequest={onToggleResearchRequest}
          selectedTickers={selectedTickers}
          onToggleSelect={onToggleSelect}
          backtest={backtest}
          tickerDataMap={tickerDataMap}
          generatedAt={generatedAt}
          expandedEntryEvidence={expandedEntryEvidence}
          onToggleEntryEvidence={onToggleEntryEvidence}
        />
      )}

      <div className="flex items-center justify-between mt-4">
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
