// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { render, screen, within, waitFor } from '@testing-library/react'
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

    // 4. Go to Portfolio screen
    await user.click(screen.getByRole('button', { name: /포트폴리오 구성 보기/ }))
    await waitFor(() => expect(screen.getByText(/포트폴리오 구성/)).toBeInTheDocument())

    if (selectCount === 3) {
      expect(screen.getByText('종합 예상 수익률 (균등 비중)')).toBeInTheDocument()
      expect(screen.getByText('평균 개별 변동성 (상관관계 미반영)')).toBeInTheDocument()
    } else {
      expect(screen.getByText(/포트폴리오는 3~5개 종목을 선택해야/)).toBeInTheDocument()
    }

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
})
