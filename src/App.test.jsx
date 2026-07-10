// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

const dataPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/data/nasdaq100.json'
)
const REAL_DATA = JSON.parse(readFileSync(dataPath, 'utf-8'))

const researchPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/data/research.json'
)
const REAL_RESEARCH = JSON.parse(readFileSync(researchPath, 'utf-8'))

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

describe('App - real research.json integration (v6 smoke test)', () => {
  beforeEach(() => {
    globalThis.localStorage = makeMemoryStorage()
    globalThis.fetch = vi.fn((url) => {
      const body = String(url).includes('research.json') ? REAL_RESEARCH : REAL_DATA
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
  })

  it('renders real AI research content (sources included) on the Recommend screen for a researched ticker', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())

    const axonResearch = REAL_RESEARCH.items.find((i) => i.ticker === 'AXON')
    expect(axonResearch).toBeDefined()

    const axonCard = screen.getByText('AXON').closest('.border')
    expect(within(axonCard).getByText('AI 리서치')).toBeInTheDocument()

    await user.click(within(axonCard).getByRole('button', { name: /펼치기/ }))

    // real fetched source titles/links should render, not fixture placeholders
    expect(within(axonCard).getByRole('link', { name: /Axon Enterprise \(AXON\) Institutional Ownership 2026/ })).toHaveAttribute(
      'href',
      expect.stringContaining('marketbeat.com')
    )
    // research.json's basedOnDataOf (2026-07-08) predates the 12-month-recollected dataset's
    // generatedAt (2026-07-09, PRD_Nasdaq7 US-1) — this is a genuine mismatch, so the v6
    // staleness warning (US-4) is expected to appear here (both the header badge and the
    // expanded body warning), not absent.
    expect(within(axonCard).getAllByText(/이전 데이터 기준/).length).toBeGreaterThan(0)
  })
})

describe('App - preset switching recomputes the recommendation (real nasdaq100.json, v7 US-9)', () => {
  beforeEach(() => {
    globalThis.localStorage = makeMemoryStorage()
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REAL_DATA) }))
  })

  it('switching the preset segment changes the rendered recommend list', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: '기본형' })).toHaveAttribute('aria-pressed', 'true')
    const defaultReasons = screen.getAllByText(/RSI \d+/).map((el) => el.textContent)

    await user.click(screen.getByRole('button', { name: '보수형' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '보수형' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('더 강한 신호만 통과시킵니다')).toBeInTheDocument()

    // conservative (RSI>=55, threshold 80) is strictly stricter than default (RSI>=50, threshold 70)
    // on this real dataset, so the recomputed reason list must differ from the default one.
    const conservativeReasons = screen.getAllByText(/RSI \d+/).map((el) => el.textContent)
    expect(conservativeReasons).not.toEqual(defaultReasons)
  })
})

describe('App - advanced settings panel (real nasdaq100.json, v7 US-10)', () => {
  beforeEach(() => {
    globalThis.localStorage = makeMemoryStorage()
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REAL_DATA) }))
  })

  it('adjusting a custom param switches to "사용자 설정", and clicking a preset overwrites it back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    const rsiInput = screen.getByLabelText('RSI 하한')
    expect(rsiInput).toHaveValue(50) // 기본형 값에서 시작

    fireEvent.change(rsiInput, { target: { value: '60' } })

    // adjusting a param switches the segment to "사용자 설정"
    await waitFor(() => expect(screen.getByText('사용자 설정')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '기본형' })).toHaveAttribute('aria-pressed', 'false')

    // clicking a preset overwrites the custom value back to that preset's own value
    await user.click(screen.getByRole('button', { name: '공격형' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '공격형' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByText('사용자 설정')).not.toBeInTheDocument()
    expect(screen.getByLabelText('RSI 하한')).toHaveValue(45) // 공격형의 RSI 하한
  })

  it('the "기본형으로 초기화" button resets preset and all custom params back to default', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /이 조건으로 추천 보기/ }))
    await waitFor(() => expect(screen.getByText('추천 결과')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    fireEvent.change(screen.getByLabelText('RSI 하한'), { target: { value: '65' } })
    await waitFor(() => expect(screen.getByText('사용자 설정')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '기본형으로 초기화' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '기본형' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByLabelText('RSI 하한')).toHaveValue(50)
  })
})

describe('App - research request list end-to-end (real nasdaq100.json, v7 US-11)', () => {
  beforeEach(() => {
    globalThis.localStorage = makeMemoryStorage()
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(REAL_DATA) }))
  })

  it('toggling a ticker on Home appears in the global list, survives a fresh mount, and drops delisted tickers', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: '리서치 요청' })[0])
    const firstTicker = REAL_DATA.tickers[0].ticker

    // request list panel is global (visible above the current screen), not screen-scoped
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    expect(screen.getByText('1개')).toBeInTheDocument()
    expect(screen.getAllByText(firstTicker).length).toBeGreaterThan(0)

    unmount()
    render(<App />)
    await waitFor(() => expect(screen.getByText('종목 검색')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /리서치 요청 목록/ }))
    expect(screen.getByText('1개')).toBeInTheDocument()
  })
})
