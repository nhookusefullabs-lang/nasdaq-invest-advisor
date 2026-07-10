// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeSearch from './HomeSearch.jsx'
import { DEFAULT_FILTER_STATE } from '../lib/filters.js'

afterEach(() => cleanup())

function makeTicker(ticker, overrides = {}) {
  return {
    ticker,
    name: `${ticker} Inc.`,
    sector: 'Technology',
    isLeadingSector: false,
    indicators: { rsi14: 50 },
    ...overrides,
  }
}

const noop = () => {}

describe('HomeSearch - filter groups (US-7)', () => {
  it('renders the 5 PRD_Nasdaq7 §4.2 group headers', () => {
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={DEFAULT_FILTER_STATE}
        onFiltersChange={noop}
        filteredTickers={[]}
        onGoToRecommend={noop}
      />
    )
    ;['모멘텀', '추세·가격 위치', '거래량', '변동성', '시장 구조'].forEach((title) => {
      expect(screen.getByText(title)).toBeInTheDocument()
    })
  })

  it('shows no active-count badges when every filter is off (regression baseline)', () => {
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={DEFAULT_FILTER_STATE}
        onFiltersChange={noop}
        filteredTickers={[]}
        onGoToRecommend={noop}
      />
    )
    expect(screen.queryByText(/개 적용 중/)).not.toBeInTheDocument()
  })

  it('shows an accurate active-count badge per group when filters are on', () => {
    const filters = { ...DEFAULT_FILTER_STATE, rsiState: 'overheated', stochasticState: 'oversold', leadingSectorOnly: true }
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={filters}
        onFiltersChange={noop}
        filteredTickers={[]}
        onGoToRecommend={noop}
      />
    )
    // 모멘텀 그룹: rsiState + stochasticState 모두 켜짐 -> 2개 적용 중
    expect(screen.getByText('2개 적용 중')).toBeInTheDocument()
    // 시장 구조 그룹: leadingSectorOnly만 켜짐 -> 1개 적용 중
    expect(screen.getByText('1개 적용 중')).toBeInTheDocument()
  })

  it('calls onFiltersChange with the new bollingerState when the select changes', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={DEFAULT_FILTER_STATE}
        onFiltersChange={(f) => {
          latest = f
        }}
        filteredTickers={[]}
        onGoToRecommend={noop}
      />
    )
    const bollingerCard = screen.getByText('볼린저밴드').closest('div')
    await user.selectOptions(within(bollingerCard).getByRole('combobox'), 'lowerProximity')
    expect(latest.bollingerState).toBe('lowerProximity')
  })

  it('shows the "12개월 미만 제외" notice only when week52State is active and a count is passed', () => {
    const filters = { ...DEFAULT_FILTER_STATE, week52State: 'nearHigh' }
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={filters}
        onFiltersChange={noop}
        filteredTickers={[]}
        week52ExcludedCount={7}
        onGoToRecommend={noop}
      />
    )
    expect(screen.getByText(/데이터 12개월 미만 종목 7개 제외됨/)).toBeInTheDocument()
  })

  it('does not show the notice when week52State is off, even if a count is passed', () => {
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={DEFAULT_FILTER_STATE}
        onFiltersChange={noop}
        filteredTickers={[]}
        week52ExcludedCount={7}
        onGoToRecommend={noop}
      />
    )
    expect(screen.queryByText(/제외됨/)).not.toBeInTheDocument()
  })

  it('renders the ticker list unchanged from v5 when filters are default (regression)', () => {
    render(
      <HomeSearch
        searchQuery=""
        onSearchQueryChange={noop}
        filters={DEFAULT_FILTER_STATE}
        onFiltersChange={noop}
        filteredTickers={[makeTicker('AAPL'), makeTicker('MSFT')]}
        onGoToRecommend={noop}
      />
    )
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.getByText('2개 종목 표시 중')).toBeInTheDocument()
  })
})
