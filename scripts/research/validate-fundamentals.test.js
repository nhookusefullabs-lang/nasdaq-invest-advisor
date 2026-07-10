import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { atomicWriteFundamentals } from './validate-fundamentals.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../src/lib/__fixtures__')
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'))

let dir
let target

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fundamentals-atomic-'))
  target = path.join(dir, 'fundamentals.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('atomicWriteFundamentals', () => {
  it('writes the file when the data is valid', () => {
    const result = atomicWriteFundamentals(target, loadFixture('fundamentals.valid.json'))
    expect(result.ok).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  it('does not create the file when the data is invalid', () => {
    const result = atomicWriteFundamentals(target, loadFixture('fundamentals.invalid.json'))
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(existsSync(target)).toBe(false)
  })

  it('leaves an existing valid file untouched when a subsequent write is invalid (원자적 쓰기)', () => {
    atomicWriteFundamentals(target, loadFixture('fundamentals.valid.json'))
    const before = readFileSync(target, 'utf-8')

    const result = atomicWriteFundamentals(target, loadFixture('fundamentals.invalid.json'))

    expect(result.ok).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe(before)
  })

  it('does not leave a .tmp file behind after a successful write', () => {
    atomicWriteFundamentals(target, loadFixture('fundamentals.valid.json'))
    expect(existsSync(`${target}.tmp`)).toBe(false)
  })
})
