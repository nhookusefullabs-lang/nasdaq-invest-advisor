// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdvancedSettingsPanel from './AdvancedSettingsPanel.jsx'

afterEach(() => cleanup())

const DEFAULT_PARAMS = { rsiMin: 50, goldenCrossWindow: 5, highScoreThreshold: 70 }
const noop = () => {}

describe('AdvancedSettingsPanel - default collapsed (US-10 회귀)', () => {
  it('starts collapsed, hiding the inputs until expanded', () => {
    render(<AdvancedSettingsPanel customParams={DEFAULT_PARAMS} onParamChange={noop} onResetToDefault={noop} />)
    expect(screen.getByRole('button', { name: /고급 설정/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('RSI 하한')).not.toBeInTheDocument()
  })

  it('does not affect the page for users who never open it (no visible inputs, no crash)', () => {
    const { container } = render(
      <AdvancedSettingsPanel customParams={DEFAULT_PARAMS} onParamChange={noop} onResetToDefault={noop} />
    )
    expect(container.querySelectorAll('input').length).toBe(0)
  })
})

describe('AdvancedSettingsPanel - range enforcement (US-10)', () => {
  it('clamps RSI 하한 to [30, 70]', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <AdvancedSettingsPanel
        customParams={DEFAULT_PARAMS}
        onParamChange={(k, v) => (latest = [k, v])}
        onResetToDefault={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    const rsiInput = screen.getByLabelText('RSI 하한')

    fireEvent.change(rsiInput, { target: { value: '999' } })
    expect(latest).toEqual(['rsiMin', 70])

    fireEvent.change(rsiInput, { target: { value: '1' } })
    expect(latest).toEqual(['rsiMin', 30])
  })

  it('clamps 골든크로스 창 to [1, 20]', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <AdvancedSettingsPanel
        customParams={DEFAULT_PARAMS}
        onParamChange={(k, v) => (latest = [k, v])}
        onResetToDefault={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    const input = screen.getByLabelText('골든크로스 창(거래일)')

    fireEvent.change(input, { target: { value: '999' } })
    expect(latest).toEqual(['goldenCrossWindow', 20])

    fireEvent.change(input, { target: { value: '0' } })
    expect(latest).toEqual(['goldenCrossWindow', 1])
  })

  it('clamps 고득점 편입 임계 to [50, 95]', async () => {
    const user = userEvent.setup()
    let latest = null
    render(
      <AdvancedSettingsPanel
        customParams={DEFAULT_PARAMS}
        onParamChange={(k, v) => (latest = [k, v])}
        onResetToDefault={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    const input = screen.getByLabelText('고득점 편입 임계')

    fireEvent.change(input, { target: { value: '999' } })
    expect(latest).toEqual(['highScoreThreshold', 95])

    fireEvent.change(input, { target: { value: '1' } })
    expect(latest).toEqual(['highScoreThreshold', 50])
  })
})

describe('AdvancedSettingsPanel - reset button (US-10)', () => {
  it('calls onResetToDefault when clicked', async () => {
    const user = userEvent.setup()
    let called = false
    render(
      <AdvancedSettingsPanel
        customParams={{ rsiMin: 55, goldenCrossWindow: 3, highScoreThreshold: 80 }}
        onParamChange={noop}
        onResetToDefault={() => {
          called = true
        }}
      />
    )
    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    await user.click(screen.getByRole('button', { name: '기본형으로 초기화' }))
    expect(called).toBe(true)
  })

  it('shows a "기본형 X → 현재 Y" hint only for params that differ from default', async () => {
    const user = userEvent.setup()
    render(
      <AdvancedSettingsPanel
        customParams={{ rsiMin: 55, goldenCrossWindow: 5, highScoreThreshold: 70 }}
        onParamChange={noop}
        onResetToDefault={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /고급 설정/ }))
    expect(screen.getByText('기본형 50 → 현재 55')).toBeInTheDocument()
    expect(screen.queryByText(/기본형 5 →/)).not.toBeInTheDocument()
    expect(screen.queryByText(/기본형 70 →/)).not.toBeInTheDocument()
  })
})
