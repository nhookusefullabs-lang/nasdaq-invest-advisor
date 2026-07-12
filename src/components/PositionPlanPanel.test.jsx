// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PositionPlanPanel from './PositionPlanPanel.jsx'

afterEach(() => cleanup())

function seriesFromCloses(closes) {
  const start = new Date('2024-01-02T00:00:00Z')
  return closes.map((close, i) => {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), high: close + 1, low: close - 1, close, volume: 1_000_000 }
  })
}

describe('PositionPlanPanel — graceful degradation', () => {
  it('renders nothing when tickerData has no series', () => {
    const { container } = render(<PositionPlanPanel ticker="AAPL" tickerData={null} position={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only input fields (no plan) when no entryPrice is set', () => {
    const tickerData = { series: seriesFromCloses(new Array(60).fill(100)) }
    render(<PositionPlanPanel ticker="AAPL" tickerData={tickerData} position={undefined} onChangeEntryPrice={() => {}} onChangeEntryDate={() => {}} />)
    expect(screen.getByLabelText('AAPL 체결가')).toBeInTheDocument()
    expect(screen.queryByText(/R-배수/)).not.toBeInTheDocument()
  })
})

describe('PositionPlanPanel — 청산 계획 산출', () => {
  it('체결가 입력 시 R-배수·손절 참고(검증 상태 동반)를 보여준다', () => {
    const tickerData = { series: seriesFromCloses(new Array(60).fill(108)) } // entryPrice=100, 현재108 → +8%
    render(
      <PositionPlanPanel
        ticker="AAPL"
        tickerData={tickerData}
        position={{ entryPrice: 100 }}
        onChangeEntryPrice={() => {}}
        onChangeEntryDate={() => {}}
      />
    )
    expect(screen.getByText(/R-배수/)).toBeInTheDocument()
    const stopLine = screen.getByText(/손절 참고: 고정/)
    expect(stopLine.textContent).toContain('열위')
  })

  it('R이 2.0 이상이면 브레이크이븐 알림을 보여준다', () => {
    const tickerData = { series: seriesFromCloses(new Array(60).fill(116)) } // entryPrice=100 → +16% → R=2.0
    render(
      <PositionPlanPanel ticker="AAPL" tickerData={tickerData} position={{ entryPrice: 100 }} onChangeEntryPrice={() => {}} onChangeEntryDate={() => {}} />
    )
    expect(screen.getByText(/손절선을 체결가로 상향 검토/)).toBeInTheDocument()
  })

  it('체결일 미입력 시 트레일링 참고는 "체결일 입력 시 제공" 상태를 보여준다', () => {
    const tickerData = { series: seriesFromCloses(new Array(60).fill(105)) }
    render(
      <PositionPlanPanel ticker="AAPL" tickerData={tickerData} position={{ entryPrice: 100 }} onChangeEntryPrice={() => {}} onChangeEntryDate={() => {}} />
    )
    expect(screen.getAllByText('체결일 입력 시 제공').length).toBeGreaterThan(0)
  })

  it('체결일 입력 시 트레일링 참고가가 계산된다', () => {
    const closes = [100, 130, 130, 120]
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']
    const tickerData = {
      series: dates.map((date, i) => ({ date, high: closes[i], low: closes[i], close: closes[i], volume: 1_000_000 })),
    }
    render(
      <PositionPlanPanel
        ticker="AAPL"
        tickerData={tickerData}
        position={{ entryPrice: 100, entryDate: '2024-01-01' }}
        onChangeEntryPrice={() => {}}
        onChangeEntryDate={() => {}}
      />
    )
    expect(screen.getByText(/트레일링 참고: 110\.50/)).toBeInTheDocument()
  })

  it('체결가 입력 변경 시 onChangeEntryPrice가 호출된다', async () => {
    const user = userEvent.setup()
    const onChangeEntryPrice = vi.fn()
    const tickerData = { series: seriesFromCloses(new Array(60).fill(100)) }
    render(
      <PositionPlanPanel ticker="AAPL" tickerData={tickerData} position={undefined} onChangeEntryPrice={onChangeEntryPrice} onChangeEntryDate={() => {}} />
    )
    await user.type(screen.getByLabelText('AAPL 체결가'), '9')
    expect(onChangeEntryPrice).toHaveBeenCalled()
  })
})

describe('PositionPlanPanel — 고정 안내 문구', () => {
  it('예약 주문 안내와 청산 면책 문구가 항상 표시된다', () => {
    const tickerData = { series: seriesFromCloses(new Array(60).fill(100)) }
    render(<PositionPlanPanel ticker="AAPL" tickerData={tickerData} position={undefined} onChangeEntryPrice={() => {}} onChangeEntryDate={() => {}} />)
    expect(screen.getByText(/빠른 방어는 증권사 예약 주문\(stop-loss\)으로/)).toBeInTheDocument()
    expect(screen.getByText('청산 참고 정보는 기계적 규칙의 산출값이며 매도 권유가 아닙니다')).toBeInTheDocument()
  })
})
