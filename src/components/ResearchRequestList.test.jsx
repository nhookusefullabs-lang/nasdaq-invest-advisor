// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResearchRequestList from './ResearchRequestList.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const noop = () => {}

describe('ResearchRequestList - default collapsed + empty state (US-11 회귀)', () => {
  it('starts collapsed', () => {
    render(<ResearchRequestList tickers={[]} onRemove={noop} onClearAll={noop} />)
    expect(screen.getByRole('button', { name: /리서치 요청 목록/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows no count badge when empty', () => {
    render(<ResearchRequestList tickers={[]} onRemove={noop} onClearAll={noop} />)
    expect(screen.queryByText(/개$/)).not.toBeInTheDocument()
  })

  it('shows an empty-state message when expanded with no tickers', async () => {
    const user = userEvent.setup()
    render(<ResearchRequestList tickers={[]} onRemove={noop} onClearAll={noop} />)
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    expect(screen.getByText(/담긴 종목이 없습니다/)).toBeInTheDocument()
  })
})

describe('ResearchRequestList - count badge + list (US-11)', () => {
  it('shows an accurate count badge', () => {
    render(<ResearchRequestList tickers={['AAPL', 'MSFT', 'AXON']} onRemove={noop} onClearAll={noop} />)
    expect(screen.getByText('3개')).toBeInTheDocument()
  })

  it('lists every ticker and removes one via its ✕ button', async () => {
    const user = userEvent.setup()
    let removed = null
    render(
      <ResearchRequestList
        tickers={['AAPL', 'MSFT']}
        onRemove={(t) => (removed = t)}
        onClearAll={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('MSFT')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'AAPL 리서치 요청 제거' }))
    expect(removed).toBe('AAPL')
  })

  it('calls onClearAll when "전체 비우기" is clicked', async () => {
    const user = userEvent.setup()
    let cleared = false
    render(
      <ResearchRequestList tickers={['AAPL']} onRemove={noop} onClearAll={() => (cleared = true)} />
    )
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    await user.click(screen.getByRole('button', { name: '전체 비우기' }))
    expect(cleared).toBe(true)
  })
})

describe('ResearchRequestList - copy to clipboard (US-11)', () => {
  it('copies a comma+space separated ticker string and shows "복사됨" feedback', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<ResearchRequestList tickers={['AAPL', 'MRNA', 'AXON']} onRemove={noop} onClearAll={noop} />)
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    await user.click(screen.getByRole('button', { name: '목록 복사' }))

    expect(writeText).toHaveBeenCalledWith('AAPL, MRNA, AXON')
    expect(await screen.findByText('복사됨')).toBeInTheDocument()
  })

  it('falls back to a selectable text field when the clipboard API is unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', {}) // no clipboard property at all

    render(<ResearchRequestList tickers={['AAPL', 'MRNA']} onRemove={noop} onClearAll={noop} />)
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    await user.click(screen.getByRole('button', { name: '목록 복사' }))

    const fallbackInput = await screen.findByLabelText('리서치 요청 목록 복사용 텍스트')
    expect(fallbackInput).toHaveValue('AAPL, MRNA')
  })
})
