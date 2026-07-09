// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PriceSparkline from './PriceSparkline.jsx'

afterEach(() => cleanup())

describe('PriceSparkline', () => {
  it('renders a positive change in red with an upward-reading line', () => {
    const points = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 105 },
      { date: '2026-01-03', close: 110 },
    ]
    const { container } = render(<PriceSparkline label="1개월" points={points} />)
    expect(screen.getByText('+10.0%')).toBeInTheDocument()
    expect(screen.getByText('+10.0%')).toHaveClass('text-red-600')
    expect(container.querySelector('polyline')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /1개월/ })).toBeInTheDocument()
  })

  it('renders a negative change in blue', () => {
    const points = [
      { date: '2026-01-01', close: 100 },
      { date: '2026-01-02', close: 90 },
    ]
    render(<PriceSparkline label="3개월" points={points} />)
    expect(screen.getByText('-10.0%')).toBeInTheDocument()
    expect(screen.getByText('-10.0%')).toHaveClass('text-blue-600')
  })

  it('shows a fallback message instead of a chart when there are fewer than 2 points', () => {
    render(<PriceSparkline label="6개월" points={[{ date: '2026-01-01', close: 100 }]} />)
    expect(screen.getByText('데이터 부족')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
