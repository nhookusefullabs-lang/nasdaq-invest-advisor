import { useState } from 'react'

export default function HomeSearch({
  searchQuery,
  onSearchQueryChange,
  filters,
  onFiltersChange,
  filteredTickers,
  week52ExcludedCount = 0,
  onGoToRecommend,
}) {
  const update = (patch) => onFiltersChange({ ...filters, ...patch })

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">종목 검색</h2>

      <input
        type="text"
        placeholder="티커 또는 종목명 검색 (예: AAPL, Apple)"
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 mb-6"
      />

      <div className="space-y-3 mb-6">
        <FilterGroup title="모멘텀" activeCount={[filters.rsiState !== 'off', filters.stochasticState !== 'off'].filter(Boolean).length}>
          <FilterCard title="과열/과매도 (RSI 14)">
            <select
              value={filters.rsiState}
              onChange={(e) => update({ rsiState: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="overheated">과열 (RSI 70 이상)</option>
              <option value="oversold">과매도 (RSI 30 이하)</option>
            </select>
          </FilterCard>

          <FilterCard title="스토캐스틱">
            <select
              value={filters.stochasticState}
              onChange={(e) => update({ stochasticState: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="oversold">과매도 구간 (%K 20 이하)</option>
              <option value="overbought">과매수 구간 (%K 80 이상)</option>
            </select>
          </FilterCard>
        </FilterGroup>

        <FilterGroup
          title="추세·가격 위치"
          activeCount={[filters.disparityMin != null, filters.bollingerState !== 'off', filters.week52State !== 'off'].filter(Boolean).length}
        >
          <FilterCard title="이평선 이격도">
            <ToggleWithNumber
              enabled={filters.disparityMin != null}
              value={filters.disparityMin ?? 5}
              suffix="% 이상"
              onToggle={(on) => update({ disparityMin: on ? 5 : null })}
              onValueChange={(v) => update({ disparityMin: v })}
            />
          </FilterCard>

          <FilterCard title="볼린저밴드">
            <select
              value={filters.bollingerState}
              onChange={(e) => update({ bollingerState: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="lowerProximity">하단 밴드 근접</option>
              <option value="upperBreakout">상단 밴드 돌파</option>
            </select>
          </FilterCard>

          <FilterCard title="52주 신고가/신저가">
            <select
              value={filters.week52State}
              onChange={(e) => update({ week52State: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="nearHigh">52주 신고가 근접</option>
              <option value="nearLow">52주 신저가 근접</option>
            </select>
            {filters.week52State !== 'off' && week52ExcludedCount > 0 && (
              <p className="text-xs text-gray-400 mt-1">데이터 12개월 미만 종목 {week52ExcludedCount}개 제외됨</p>
            )}
          </FilterCard>
        </FilterGroup>

        <FilterGroup
          title="거래량"
          activeCount={[filters.volumeTrendMin != null, filters.obvState !== 'off'].filter(Boolean).length}
        >
          <FilterCard title="거래량 증가">
            <ToggleWithNumber
              enabled={filters.volumeTrendMin != null}
              value={filters.volumeTrendMin ?? 20}
              suffix="% 이상 증가"
              onToggle={(on) => update({ volumeTrendMin: on ? 20 : null })}
              onValueChange={(v) => update({ volumeTrendMin: v })}
            />
          </FilterCard>

          <FilterCard title="OBV 거래량 흐름">
            <select
              value={filters.obvState}
              onChange={(e) => update({ obvState: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="rising">상승 추세 (매집 신호)</option>
              <option value="falling">하락 추세 (분산 신호)</option>
            </select>
          </FilterCard>
        </FilterGroup>

        <FilterGroup title="변동성" activeCount={filters.atrState !== 'off' ? 1 : 0}>
          <FilterCard title="ATR 변동성">
            <select
              value={filters.atrState}
              onChange={(e) => update({ atrState: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="off">전체 (필터 꺼짐)</option>
              <option value="low">저변동성 (유니버스 하위 30%)</option>
              <option value="high">고변동성 (유니버스 상위 30%)</option>
            </select>
          </FilterCard>
        </FilterGroup>

        <FilterGroup title="시장 구조" activeCount={filters.leadingSectorOnly ? 1 : 0}>
          <FilterCard title="주도주 섹터">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.leadingSectorOnly}
                onChange={(e) => update({ leadingSectorOnly: e.target.checked })}
              />
              주도 섹터(상위 3개)만 보기
            </label>
          </FilterCard>
        </FilterGroup>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600">{filteredTickers.length}개 종목 표시 중</p>
        <button
          type="button"
          onClick={onGoToRecommend}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700"
        >
          이 조건으로 추천 보기 →
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto border border-gray-200 rounded divide-y">
        {filteredTickers.map((t) => (
          <div key={t.ticker} className="px-3 py-2 flex items-center justify-between text-sm">
            <div>
              <span className="font-semibold">{t.ticker}</span>{' '}
              <span className="text-gray-500">{t.name}</span>
              <span className="text-gray-400"> · {t.sector}</span>
            </div>
            <div className="flex gap-1">
              {t.isLeadingSector && <Badge color="blue">주도섹터</Badge>}
              {t.indicators.rsi14 >= 70 && <Badge color="red">과열</Badge>}
              {t.indicators.rsi14 <= 30 && <Badge color="green">과매도</Badge>}
            </div>
          </div>
        ))}
        {filteredTickers.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-400">조건에 맞는 종목이 없습니다.</p>
        )}
      </div>
    </div>
  )
}

function FilterGroup({ title, activeCount, children }) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="border border-gray-200 rounded">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{title}</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{activeCount}개 적용 중</span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {expanded && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">{children}</div>}
    </div>
  )
}

function FilterCard({ title, children }) {
  return (
    <div className="border border-gray-200 rounded p-3">
      <p className="text-sm font-semibold mb-2">{title}</p>
      {children}
    </div>
  )
}

function ToggleWithNumber({ enabled, value, suffix, onToggle, onValueChange }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      <input
        type="number"
        disabled={!enabled}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="w-16 border border-gray-300 rounded px-1 py-0.5 disabled:bg-gray-100"
      />
      <span className={enabled ? '' : 'text-gray-400'}>{suffix}</span>
    </div>
  )
}

function Badge({ color, children }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
    green: 'bg-green-100 text-green-700',
  }
  return <span className={`px-1.5 py-0.5 rounded text-xs ${colors[color]}`}>{children}</span>
}
