// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExitSignalBadge from './ExitSignalBadge.jsx'

afterEach(() => cleanup())

function dateAt(i) {
  const start = new Date('2023-01-02T00:00:00Z')
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}

function seriesFromCloses(closes) {
  return closes.map((close, i) => ({ date: dateAt(i), high: close, low: close, close, volume: 1_000_000 }))
}

describe('ExitSignalBadge — graceful degradation', () => {
  it('renders nothing when tickerData has no series', () => {
    const { container } = render(<ExitSignalBadge tickerData={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ExitSignalBadge — 매도 신호 표시', () => {
  it('신호가 없으면 "매도 신호 없음"을 보여준다', () => {
    // 완만한 상승 + SMA50 위 유지 — 어떤 신호도 트리거되지 않음
    const closes = Array.from({ length: 70 }, (_, i) => 100 + 0.1 * i)
    render(<ExitSignalBadge tickerData={{ series: seriesFromCloses(closes) }} />)
    expect(screen.getByText('매도 신호 없음')).toBeInTheDocument()
  })

  it('신호가 트리거되면 배지 개수와 근거를 펼침에서 보여준다', async () => {
    const user = userEvent.setup()
    const closes = new Array(50).fill(100)
    closes.push(90) // 급락 — SMA50 이탈(X1) + 데드크로스(X2) 동시 트리거
    render(<ExitSignalBadge tickerData={{ series: seriesFromCloses(closes) }} />)
    const summary = screen.getByText((_, el) => el.tagName === 'SUMMARY' && el.textContent.includes('매도 신호'))
    expect(summary.textContent).toContain('2건')
    await user.click(summary)
    expect(screen.getByText(/50일선 이탈/)).toBeInTheDocument()
  })
})
