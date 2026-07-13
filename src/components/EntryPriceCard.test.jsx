// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntryPriceCard from './EntryPriceCard.jsx'
import { PIVOT_LOOKBACK } from '../lib/constants/entry.js'

afterEach(() => cleanup())

function dateAt(i) {
  const start = new Date('2023-01-02T00:00:00Z')
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + i)
  return d.toISOString().slice(0, 10)
}

function seriesFromCloses(closes, volumes = null) {
  return closes.map((close, i) => ({
    date: dateAt(i),
    high: close,
    low: close,
    close,
    volume: volumes ? volumes[i] : 1_000_000,
  }))
}

describe('EntryPriceCard — graceful degradation (US-13 AC4)', () => {
  it('renders nothing when tickerData has no series', () => {
    const { container } = render(<EntryPriceCard tickerData={null} generatedAt="2026-01-01" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('EntryPriceCard — 진입 상태 4종 카드 렌더링 (US-13 AC2)', () => {
  it('산정불가: 데이터 63거래일 미만이면 산정불가 배지만 표시한다', () => {
    const tickerData = { series: seriesFromCloses(new Array(PIVOT_LOOKBACK).fill(100)) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('피벗 산정 불가')).toBeInTheDocument()
  })

  it('상태0(원거리): 배지와 트리거·거리 문구를 보여준다', () => {
    const closes = new Array(69).fill(100)
    closes.push(80) // P*0.90=90 미만 -> 상태0
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('눌림목 가설 재검증 중 — 최근 검증에서 성과가 재현되지 않았습니다')).toBeInTheDocument()
    expect(screen.getByText(/트리거 100\.30/)).toBeInTheDocument()
  })

  it('상태1(돌파 대기): 배지와 트리거를 보여준다', () => {
    const tickerData = { series: seriesFromCloses(new Array(70).fill(100)) } // 완전 평평 -> P=100=closeT -> 상태1
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('돌파 대기')).toBeInTheDocument()
    expect(screen.getByText(/트리거 100\.30/)).toBeInTheDocument()
  })

  it('상태2(매수 유효): 피벗·유효상단·손절 참고를 보여준다', () => {
    const closes = new Array(90).fill(100)
    closes.push(105) // 오늘이 곧 돌파일, U=105 이내 -> 상태2
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('매수 유효 구간')).toBeInTheDocument()
    expect(screen.getByText(/유효 상단 105\.00/)).toBeInTheDocument()
  })

  it('상태2: 돌파 당일(경과 0일)이면 "돌파 직후 — 가짜 돌파 위험 구간" 문구를 보여준다', () => {
    const closes = new Array(90).fill(100)
    closes.push(101) // 오늘=돌파일 -> daysSinceBreakout=0 -> earlyBreakout
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('돌파 직후 — 가짜 돌파 위험 구간')).toBeInTheDocument()
  })

  it('상태3(확장): 가격이 제시되지 않고 사유만 표시한다', () => {
    const closes = new Array(90).fill(100)
    for (let i = 90; i < 131; i++) closes.push(150 + (i - 90)) // 장기 상승, 교차 21일 밖 -> 저항선 소멸(상태3)
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    expect(screen.getByText('확장 — 추격 금지')).toBeInTheDocument()
    expect(screen.getByText(/저항선 소멸/)).toBeInTheDocument()
    // 가격 미제시 확인: 트리거/피벗/유효상단 숫자 문구가 전혀 없어야 한다
    expect(screen.queryByText(/트리거/)).not.toBeInTheDocument()
    expect(screen.queryByText(/유효 상단/)).not.toBeInTheDocument()
  })
})

describe('EntryPriceCard — 검증 상태 표기 (US-13 AC3: 분리 렌더 불가)', () => {
  it('고정 −8% 손절 참고가와 "열위" 라벨이 같은 문단에 항상 함께 렌더링된다', () => {
    const closes = new Array(90).fill(100)
    closes.push(105)
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    const stopLine = screen.getByText(/손절 참고: 고정/)
    expect(stopLine.textContent).toContain('열위')
    expect(stopLine.textContent).toContain('단일 상승 국면 Out 실측')
  })

  it('상태1의 손절 참고에도 "열위" 라벨이 동반된다', () => {
    const tickerData = { series: seriesFromCloses(new Array(70).fill(100)) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    const stopLine = screen.getByText(/손절 참고 92\.28/)
    expect(stopLine.textContent).toContain('열위')
  })
})

describe('EntryPriceCard — 거래량 배지 승격 (v11 US-12 승인 기준 1: 양면 라벨 분리 렌더 불가)', () => {
  it('거래량 동반 돌파(체결 거래량 ≥1.5×50일평균)면 "확인 ✓" 배지와 양면 라벨이 같은 문단에 함께 렌더링된다', () => {
    const closes = new Array(90).fill(100)
    closes.push(105) // 오늘이 곧 돌파일 -> 상태2
    const volumes = new Array(90).fill(1_000_000)
    volumes.push(2_000_000) // 돌파일 거래량 스파이크(1.5배 이상) -> volumeOK
    const tickerData = { series: seriesFromCloses(closes, volumes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    const volumeLine = screen.getByText(/거래량 동반 돌파 확인/).closest('p')
    expect(volumeLine.textContent).toContain('✓')
    expect(volumeLine.textContent).toContain('조건부 품질 우위')
    expect(volumeLine.textContent).toContain('기회비용')
  })

  it('거래량 미동반(평탄 거래량)이면 "⚠ 미확인" 배지와 동일한 양면 라벨이 함께 렌더링된다', () => {
    const closes = new Array(90).fill(100)
    closes.push(105)
    const tickerData = { series: seriesFromCloses(closes) } // 기본 평탄 거래량 -> volumeOK=false
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    const volumeLine = screen.getByText(/거래량 동반 돌파 확인/).closest('p')
    expect(volumeLine.textContent).toContain('⚠ 미확인')
    expect(volumeLine.textContent).toContain('조건부 품질 우위')
    expect(volumeLine.textContent).toContain('기회비용')
  })
})

describe('EntryPriceCard — 상태0 눌림목 후보 안내 (v11 US-12 승인 기준 3)', () => {
  it('상태0에서 재개 트리거가(직전 10거래일 최고 종가)와 "측정중" 라벨이 함께 렌더링된다', () => {
    const closes = new Array(69).fill(100)
    closes.push(80) // 상태0
    const tickerData = { series: seriesFromCloses(closes) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" />)
    const triggerLine = screen.getByText(/재개 트리거가/)
    expect(triggerLine.textContent).toContain('측정중')
  })
})

describe('EntryPriceCard — 산출 근거 펼침 + 기준일/면책 고지', () => {
  it('기본은 접힌 상태이며, 클릭하면 산출 근거가 펼쳐진다', async () => {
    const user = userEvent.setup()
    const closes = new Array(90).fill(100)
    closes.push(105)
    const tickerData = { series: seriesFromCloses(closes) }
    let expanded = false
    const { rerender } = render(
      <EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" expanded={expanded} onToggleExpanded={() => (expanded = true)} />
    )
    expect(screen.queryByText(/산정 기간 63거래일/)).not.toBeInTheDocument()
    await user.click(screen.getByText('산출 근거 펼치기'))
    rerender(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-01" expanded={expanded} />)
    expect(screen.getByText(/산정 기간 63거래일/)).toBeInTheDocument()
  })

  it('기준일과 면책 고정 문구가 항상 표시된다', () => {
    const tickerData = { series: seriesFromCloses(new Array(70).fill(100)) }
    render(<EntryPriceCard tickerData={tickerData} generatedAt="2026-01-09" />)
    expect(screen.getByText(/피벗 기준일 2026-01-09/)).toBeInTheDocument()
    expect(screen.getByText(/진입 참고 가격은 과거 가격 구조에서 기계적으로 산출된 값이며 매수 권유가 아닙니다/)).toBeInTheDocument()
  })
})
