import { describe, it, expect } from 'vitest'
import { computeResearchCheckState } from './researchCheck.js'

function makeResearch(overrides = {}) {
  return { ticker: 'AXON', sentiment: 'positive', riskFlags: [], stale: false, ...overrides }
}

describe('computeResearchCheckState - none (리서치 미실시)', () => {
  it('is "none" when research is undefined (research.json 부재/해당 티커 미리서치)', () => {
    expect(computeResearchCheckState(undefined)).toEqual({ state: 'none', flags: [] })
  })

  it('is "none" when research is null', () => {
    expect(computeResearchCheckState(null)).toEqual({ state: 'none', flags: [] })
  })
})

describe('computeResearchCheckState - ok (리서치 점검 ✓)', () => {
  it('is "ok" when riskFlags is empty and sentiment is positive', () => {
    expect(computeResearchCheckState(makeResearch({ sentiment: 'positive' })).state).toBe('ok')
  })

  it('is "ok" when riskFlags is empty and sentiment is neutral', () => {
    expect(computeResearchCheckState(makeResearch({ sentiment: 'neutral' })).state).toBe('ok')
  })

  it('is "ok" for a v1 document normalized to riskFlags:[] by researchLoader (하위 호환)', () => {
    const v1Normalized = { ticker: 'AXON', sentiment: 'positive', riskFlags: [], stale: false }
    expect(computeResearchCheckState(v1Normalized).state).toBe('ok')
  })
})

describe('computeResearchCheckState - flagged (⚠ 리스크 플래그)', () => {
  it('is "flagged" with the flags array when riskFlags is non-empty', () => {
    const flags = [{ type: 'litigation', description: '소송 진행 중' }]
    expect(computeResearchCheckState(makeResearch({ riskFlags: flags }))).toEqual({ state: 'flagged', flags })
  })

  it('is "flagged" with an empty flags array when sentiment is negative but riskFlags is empty (PRD 여집합 보정)', () => {
    expect(computeResearchCheckState(makeResearch({ sentiment: 'negative', riskFlags: [] }))).toEqual({
      state: 'flagged',
      flags: [],
    })
  })

  it('prioritizes riskFlags presence over sentiment when both indicate risk', () => {
    const flags = [{ type: 'guidance_cut', description: '가이던스 하향 조정' }]
    const result = computeResearchCheckState(makeResearch({ sentiment: 'negative', riskFlags: flags }))
    expect(result.state).toBe('flagged')
    expect(result.flags).toEqual(flags)
  })
})
