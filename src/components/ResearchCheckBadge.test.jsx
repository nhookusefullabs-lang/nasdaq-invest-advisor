// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResearchCheckBadge from './ResearchCheckBadge.jsx'

afterEach(() => cleanup())

describe('ResearchCheckBadge - 3상태 배지 (US-12)', () => {
  it('shows "리서치 미실시" when research is undefined', () => {
    render(<ResearchCheckBadge research={undefined} />)
    expect(screen.getByText('리서치 미실시')).toBeInTheDocument()
  })

  it('shows "리서치 점검 ✓" when riskFlags is empty and sentiment is not negative (v1 데이터 하위 호환 포함)', () => {
    render(<ResearchCheckBadge research={{ sentiment: 'positive', riskFlags: [] }} />)
    expect(screen.getByText('리서치 점검 ✓')).toBeInTheDocument()
  })

  it('shows "⚠ 리스크 플래그 n건" when riskFlags is non-empty', () => {
    render(
      <ResearchCheckBadge
        research={{
          sentiment: 'neutral',
          riskFlags: [
            { type: 'earnings_imminent', description: '실적 발표 임박' },
            { type: 'litigation', description: '소송 진행 중' },
          ],
        }}
      />
    )
    expect(screen.getByText('⚠ 리스크 플래그 2건')).toBeInTheDocument()
  })
})

describe('ResearchCheckBadge - 리스크 플래그 상세 (펼치면 type·description)', () => {
  it('starts collapsed, hiding the flag details', () => {
    render(
      <ResearchCheckBadge
        research={{ sentiment: 'neutral', riskFlags: [{ type: 'litigation', description: '소송 진행 중' }] }}
      />
    )
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('소송 진행 중')).not.toBeInTheDocument()
  })

  it('shows each flag type label and description when expanded', async () => {
    const user = userEvent.setup()
    render(
      <ResearchCheckBadge
        research={{ sentiment: 'neutral', riskFlags: [{ type: 'guidance_cut', description: '가이던스 하향 조정' }] }}
      />
    )
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('가이던스 하향')).toBeInTheDocument()
    expect(screen.getByText(/가이던스 하향 조정/)).toBeInTheDocument()
  })
})
