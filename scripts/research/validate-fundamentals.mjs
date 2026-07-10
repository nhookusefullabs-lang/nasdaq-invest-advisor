#!/usr/bin/env node
// US-2/US-11 (prd-v8-dual-mode_1.md): fundamentals.json 스키마(버전 1) 검증 CLI + 원자적 쓰기 헬퍼.
// validateFundamentals 자체는 src/lib/fundamentalsSchema.js에 있다(브라우저 번들에도 포함되므로
// 순수 함수만). node:fs를 쓰는 원자적 쓰기는 validate-research.mjs와 동일하게 이 Node 전용
// 스크립트에 둔다.
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateFundamentals } from '../../src/lib/fundamentalsSchema.js'

export { validateFundamentals }

/**
 * data를 검증한 뒤 통과할 때만 targetPath에 원자적으로 쓴다.
 * 임시 파일(targetPath + '.tmp')에 먼저 쓰고 rename하므로, 검증 실패나 쓰기 도중 오류가 나도
 * 기존 targetPath 파일은 훼손되지 않는다.
 * 반환: { ok: true } | { ok: false, errors: string[] }
 */
export function atomicWriteFundamentals(targetPath, data) {
  const { valid, errors } = validateFundamentals(data)
  if (!valid) return { ok: false, errors }

  const tmpPath = `${targetPath}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2))
    renameSync(tmpPath, targetPath)
    return { ok: true }
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath)
  }
}

function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('사용법: node validate-fundamentals.mjs <fundamentals.json 경로>')
    process.exitCode = 1
    return
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  const { valid, errors } = validateFundamentals(data)

  if (valid) {
    console.log(`✓ ${filePath}: 스키마 검증 통과 (tickers ${data.tickers.length}개, excluded ${data.excluded?.length ?? 0}개)`)
    return
  }

  console.error(`✗ ${filePath}: 스키마 검증 실패`)
  errors.forEach((e) => console.error(`  - ${e}`))
  process.exitCode = 1
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
