import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateResearch } from './researchSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../scripts/research/fixtures')
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'))

function validItem(overrides = {}) {
  return {
    ticker: 'AAPL',
    sentiment: 'positive',
    summary: '요약',
    catalysts: [],
    risks: [],
    sources: [{ title: '기사', url: 'https://example.com', date: '2026-07-09' }],
    signalPassed: true,
    origin: 'recommended',
    ...overrides,
  }
}

function validDoc(items) {
  return { schemaVersion: 1, researchedAt: '2026-07-11', basedOnDataOf: '2026-07-08', items, skipped: [] }
}

describe('validateResearch - fixtures', () => {
  it('passes the valid fixture', () => {
    const { valid, errors } = validateResearch(loadFixture('research.valid.json'))
    expect(valid).toBe(true)
    expect(errors).toEqual([])
  })

  it('fails the invalid fixture (bad sentiment, empty summary, no sources)', () => {
    const { valid, errors } = validateResearch(loadFixture('research.invalid.json'))
    expect(valid).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('validateResearch - individual failure cases', () => {
  it('rejects an item with zero sources', () => {
    const { valid, errors } = validateResearch(validDoc([validItem({ sources: [] })]))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('sources'))).toBe(true)
  })

  it('rejects an invalid sentiment enum value', () => {
    const { valid, errors } = validateResearch(validDoc([validItem({ sentiment: 'very-positive' })]))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('sentiment'))).toBe(true)
  })

  it('rejects an invalid origin value', () => {
    const { valid, errors } = validateResearch(validDoc([validItem({ origin: 'other' })]))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('origin'))).toBe(true)
  })

  it('rejects a recommended item missing signalPassed', () => {
    const item = validItem()
    delete item.signalPassed
    const { valid, errors } = validateResearch(validDoc([item]))
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('signalPassed'))).toBe(true)
  })

  it('allows a userRequested item to omit signalPassed', () => {
    const item = validItem({ origin: 'userRequested' })
    delete item.signalPassed
    const { valid } = validateResearch(validDoc([item]))
    expect(valid).toBe(true)
  })

  it('rejects a wrong schemaVersion', () => {
    const doc = { ...validDoc([validItem()]), schemaVersion: 2 }
    const { valid, errors } = validateResearch(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('schemaVersion'))).toBe(true)
  })

  it('rejects a skipped entry missing a reason', () => {
    const doc = { ...validDoc([validItem()]), skipped: [{ ticker: 'ZZZZ' }] }
    const { valid, errors } = validateResearch(doc)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('reason'))).toBe(true)
  })

  it('accepts null institutionalActivity/analystView', () => {
    const item = validItem({ institutionalActivity: null, analystView: null })
    const { valid } = validateResearch(validDoc([item]))
    expect(valid).toBe(true)
  })
})
