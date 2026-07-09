import { describe, it, expect } from 'vitest'
import { assignPortfolioColors, CATEGORICAL_COLORS, OTHER_COLOR, MAX_COLORED_SLICES } from './portfolioColors.js'

describe('assignPortfolioColors', () => {
  it('assigns each ticker its own dedicated hue when count is within the 8-slot budget', () => {
    const tickers = ['AAPL', 'MSFT', 'NVDA']
    const colors = assignPortfolioColors(tickers)
    tickers.forEach((t, i) => {
      expect(colors.get(t)).toEqual({ color: CATEGORICAL_COLORS[i], isOther: false })
    })
  })

  it('uses all 8 dedicated hues when exactly at the budget', () => {
    const tickers = Array.from({ length: MAX_COLORED_SLICES }, (_, i) => `T${i}`)
    const colors = assignPortfolioColors(tickers)
    tickers.forEach((t, i) => {
      expect(colors.get(t)).toEqual({ color: CATEGORICAL_COLORS[i], isOther: false })
    })
  })

  it('folds everything from the 8th ticker onward into a shared "기타" gray once over budget', () => {
    const tickers = Array.from({ length: 10 }, (_, i) => `T${i}`)
    const colors = assignPortfolioColors(tickers)
    for (let i = 0; i < MAX_COLORED_SLICES - 1; i++) {
      expect(colors.get(`T${i}`)).toEqual({ color: CATEGORICAL_COLORS[i], isOther: false })
    }
    expect(colors.get('T7')).toEqual({ color: OTHER_COLOR, isOther: true })
    expect(colors.get('T8')).toEqual({ color: OTHER_COLOR, isOther: true })
    expect(colors.get('T9')).toEqual({ color: OTHER_COLOR, isOther: true })
  })
})
