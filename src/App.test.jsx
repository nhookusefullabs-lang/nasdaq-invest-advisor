// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { render, screen, within, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

const dataPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/data/nasdaq100.json'
)
const REAL_DATA = JSON.parse(readFileSync(dataPath, 'utf-8'))

function makeMemoryStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  globalThis.localStorage = makeMemoryStorage()
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(REAL_DATA) })
  )
})

afterEach(() => {
  cleanup()
})

describe('App end-to-end flow (real nasdaq100.json)', () => {
  it('walks through Home -> Recommend -> Simulation -> Portfolio', async () => {
    const user = userEvent.setup()
    render(<App />)

    // 1. Home/Search screen loads with data
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    expect(screen.getByText(/개 종목 표시 중/)).toBeInTheDocument()

    // 2. Go to Recommend screen
    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)

    // select up to 3 tickers (or as many as available) for portfolio testing
    const selectCount = Math.min(3, checkboxes.length)
    for (let i = 0; i < selectCount; i++) {
      await user.click(checkboxes[i])
    }

    // 3. Go to Simulation screen
    await user.click(screen.getByRole('button', { name: /선택 종목 시뮬레이션 보기/ }))
    await waitFor(() => expect(screen.getByText('과거 3개월 시뮬레이션')).toBeInTheDocument())
    expect(screen.getAllByText(/기간 최고가/).length).toBe(selectCount)
    // each selected ticker shows 1/3/6-month price sparklines
    expect(screen.getAllByText('1개월').length).toBe(selectCount)
    expect(screen.getAllByText('3개월').length).toBe(selectCount)
    expect(screen.getAllByText('6개월').length).toBe(selectCount)

    // 4. Go to Portfolio screen
    await user.click(screen.getByRole('button', { name: /포트폴리오 구성 보기/ }))
    await waitFor(() => expect(screen.getByText(/포트폴리오 구성/)).toBeInTheDocument())

    expect(screen.getByText('종합 예상 수익률 (가중 평균)')).toBeInTheDocument()
    expect(screen.getByText('가중 평균 변동성 (상관관계 미반영)')).toBeInTheDocument()

    // Data-as-of date + disclaimer present
    expect(screen.getByText(new RegExp(`데이터 기준일: ${REAL_DATA.generatedAt}`))).toBeInTheDocument()
    expect(screen.getByText(/투자 참고용이며/)).toBeInTheDocument()
  })

  it('persists selected tickers and screen across a fresh App mount (localStorage)', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    unmount()

    render(<App />)
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())
    const restoredCheckboxes = screen.getAllByRole('checkbox')
    expect(restoredCheckboxes[0]).toBeChecked()
  })

  it('shows all 100 tickers with filters off by default (§4.1 initial state)', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    expect(screen.getByText(`${REAL_DATA.tickers.length}개 종목 표시 중`)).toBeInTheDocument()
  })

  it('allows manually adding and removing tickers directly on the Simulation screen, without going through Recommend', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())

    // Simulation tab is reachable with zero prior selection
    await user.click(screen.getByRole('button', { name: '3. 시뮬레이션' }))
    await waitFor(() => expect(screen.getByText('과거 3개월 시뮬레이션')).toBeInTheDocument())
    expect(screen.getByText('선택된 종목이 없습니다.')).toBeInTheDocument()

    // manually add a ticker via the picker's search box
    await user.type(screen.getByPlaceholderText(/티커 또는 종목명 검색/), 'AAPL')
    await user.click(await screen.findByRole('button', { name: '+ 추가' }))

    await waitFor(() => expect(screen.getAllByText(/기간 최고가/).length).toBe(1))

    // remove it again from the Simulation screen itself
    await user.click(screen.getByRole('button', { name: 'AAPL 제거' }))
    await waitFor(() => expect(screen.getByText('선택된 종목이 없습니다.')).toBeInTheDocument())
  })

  it('allows manually building a portfolio directly on the Portfolio screen, including manual weights and any ticker count', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '4. 포트폴리오' }))
    await waitFor(() => expect(screen.getByText(/포트폴리오 구성/)).toBeInTheDocument())
    expect(screen.getByText('선택된 종목이 없습니다.')).toBeInTheDocument()

    // add just 2 tickers (outside the old 3-5 restriction) and confirm it still builds
    const tickersToAdd = REAL_DATA.tickers.slice(0, 2).map((t) => t.ticker)
    for (const ticker of tickersToAdd) {
      await user.clear(screen.getByPlaceholderText(/티커 또는 종목명 검색/))
      await user.type(screen.getByPlaceholderText(/티커 또는 종목명 검색/), ticker)
      await user.click(await screen.findByRole('button', { name: '+ 추가' }))
    }

    await waitFor(() =>
      expect(screen.getByText('종합 예상 수익률 (가중 평균)')).toBeInTheDocument()
    )

    // default: 100 / n equal split (2 tickers -> 50/50)
    const [firstTicker, secondTicker] = tickersToAdd
    const firstWeightInput = screen.getByLabelText(`${firstTicker} 가중치`)
    const secondWeightInput = screen.getByLabelText(`${secondTicker} 가중치`)
    expect(firstWeightInput).toHaveValue(50)
    expect(secondWeightInput).toHaveValue(50)

    // adjusting one ticker's weight auto-rebalances the rest so the total stays 100
    await user.clear(firstWeightInput)
    await user.type(firstWeightInput, '70')

    await waitFor(() => expect(firstWeightInput).toHaveValue(70))
    expect(secondWeightInput).toHaveValue(30)

    // "균등 배분으로 초기화" resets back to an equal split
    await user.click(screen.getByRole('button', { name: '균등 배분으로 초기화' }))
    await waitFor(() => expect(firstWeightInput).toHaveValue(50))
    expect(secondWeightInput).toHaveValue(50)

    // skew again, then add a 3rd ticker — composition changes reset everyone to a fresh 100/n split
    await user.clear(firstWeightInput)
    await user.type(firstWeightInput, '80')
    await waitFor(() => expect(secondWeightInput).toHaveValue(20))

    const thirdTicker = REAL_DATA.tickers[2].ticker
    await user.clear(screen.getByPlaceholderText(/티커 또는 종목명 검색/))
    await user.type(screen.getByPlaceholderText(/티커 또는 종목명 검색/), thirdTicker)
    await user.click(await screen.findByRole('button', { name: '+ 추가' }))

    const thirdWeightInput = screen.getByLabelText(`${thirdTicker} 가중치`)
    await waitFor(() => expect(firstWeightInput).toHaveValue(33.3))
    expect(secondWeightInput).toHaveValue(33.3)
    expect(thirdWeightInput).toHaveValue(33.3)
  })
})
