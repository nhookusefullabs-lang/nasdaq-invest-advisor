import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { atomicWriteResearch } from './validate-research.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, 'fixtures')
const loadFixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'))

let dir
let target

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'research-atomic-'))
  target = path.join(dir, 'research.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('atomicWriteResearch', () => {
  it('writes the file when the data is valid', () => {
    const result = atomicWriteResearch(target, loadFixture('research.valid.json'))
    expect(result.ok).toBe(true)
    expect(existsSync(target)).toBe(true)
    expect(JSON.parse(readFileSync(target, 'utf-8')).items.length).toBe(2)
  })

  it('does not create the file when the data is invalid', () => {
    const result = atomicWriteResearch(target, loadFixture('research.invalid.json'))
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(existsSync(target)).toBe(false)
  })

  it('leaves an existing valid file untouched when a subsequent write is invalid', () => {
    atomicWriteResearch(target, loadFixture('research.valid.json'))
    const before = readFileSync(target, 'utf-8')

    const result = atomicWriteResearch(target, loadFixture('research.invalid.json'))

    expect(result.ok).toBe(false)
    expect(readFileSync(target, 'utf-8')).toBe(before)
  })

  it('does not leave a .tmp file behind after a successful write', () => {
    atomicWriteResearch(target, loadFixture('research.valid.json'))
    expect(existsSync(`${target}.tmp`)).toBe(false)
  })
})
