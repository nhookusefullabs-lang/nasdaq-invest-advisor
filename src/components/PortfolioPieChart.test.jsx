// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PortfolioPieChart from './PortfolioPieChart.jsx'

afterEach(() => cleanup())

function entry(ticker, pct, overrides = {}) {
  return { ticker, name: `${ticker} Inc.`, pct, color: '#2a78d6', isOther: false, ...overrides }
}

describe('PortfolioPieChart', () => {
  it('renders one slice per entry and a center count', () => {
    const { container } = render(
      <PortfolioPieChart entries={[entry('AAPL', 60), entry('MSFT', 40, { color: '#1baf7a' })]} />
    )
    expect(container.querySelectorAll('path').length).toBe(2)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /파이차트/ })).toBeInTheDocument()
  })

  it('always shows a ticker label on each slice, and adds the company name in a tooltip on hover', async () => {
    const user = userEvent.setup()
    const { container } = render(<PortfolioPieChart entries={[entry('AAPL', 60), entry('MSFT', 40)]} />)

    // ticker labels are direct-labeled on the chart at all times (no hover needed)
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()
    expect(screen.queryByText('60.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('AAPL Inc.')).not.toBeInTheDocument()

    const paths = container.querySelectorAll('path')
    await user.hover(paths[0])
    expect(screen.getByText('60.0%')).toBeInTheDocument()
    expect(screen.getAllByText('AAPL').length).toBe(2) // direct label + tooltip
    expect(screen.getByText('AAPL Inc.')).toBeInTheDocument()
  })

  it('folds isOther entries into a single combined slice', () => {
    const { container } = render(
      <PortfolioPieChart
        entries={[
          entry('AAPL', 50),
          entry('X1', 25, { isOther: true, color: '#9a988f' }),
          entry('X2', 25, { isOther: true, color: '#9a988f' }),
        ]}
      />
    )
    // 2 slices: AAPL + one combined "기타" slice for X1+X2
    expect(container.querySelectorAll('path').length).toBe(2)
  })
})
