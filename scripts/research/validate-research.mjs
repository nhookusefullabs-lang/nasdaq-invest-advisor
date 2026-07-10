#!/usr/bin/env node
// US-2 (prd-research-agent.md): research.json 스키마(버전 1) 검증 CLI + 원자적 쓰기 헬퍼.
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateResearch } from '../../src/lib/researchSchema.js'

export { validateResearch }

/**
 * data를 검증한 뒤 통과할 때만 targetPath에 원자적으로 쓴다.
 * 임시 파일(targetPath + '.tmp')에 먼저 쓰고 rename하므로, 검증 실패나 쓰기 도중 오류가 나도
 * 기존 targetPath 파일은 훼손되지 않는다.
 * 반환: { ok: true } | { ok: false, errors: string[] }
 */
export function atomicWriteResearch(targetPath, data) {
  const { valid, errors } = validateResearch(data)
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
    console.error('사용법: node validate-research.mjs <research.json 경로>')
    process.exitCode = 1
    return
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  const { valid, errors } = validateResearch(data)

  if (valid) {
    console.log(`✓ ${filePath}: 스키마 검증 통과 (items ${data.items.length}개, skipped ${data.skipped?.length ?? 0}개)`)
    return
  }

  console.error(`✗ ${filePath}: 스키마 검증 실패`)
  errors.forEach((e) => console.error(`  - ${e}`))
  process.exitCode = 1
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
