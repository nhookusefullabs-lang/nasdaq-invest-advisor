#!/usr/bin/env node
// US-1 (prd-research-agent.md): 추천 풀을 터미널에서 확인하는 CLI.
// 인자 없이 실행 → 현재 데이터 기준 추천 풀(상위 10 + 고득점 편입)을 표로 출력.
// 티커 인자 실행 → 나스닥100 유니버스 소속 + dataSufficient 여부를 검증해 승인/거부 + 사유 출력.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDataset } from '../../src/lib/buildDataset.js'
import { recommend } from '../../src/lib/recommend.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_PATH = path.resolve(__dirname, '../../public/data/nasdaq100.json')

export function loadDataset(dataPath = DEFAULT_DATA_PATH) {
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8'))
  return buildDataset(raw)
}

/** dataset.tickers(deriveTickerData+applyLeadingSectorFlags 완료본)에서 추천 풀을 추출한다. */
export function getPool(dataset) {
  return recommend(dataset.tickers)
}

function padCols(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const fmtRow = (cols) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  return [fmtRow(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmtRow)]
}

export function formatPoolTable({ list, level, relaxationApplied, insufficientSignal }) {
  if (list.length === 0) return '추천 풀이 비어 있습니다 (매수 신호 부족).'

  const rows = list.map((r) => [r.ticker, r.name, r.score.toFixed(1), r.signalPassed ? 'O' : 'X', r.reasons])
  const lines = padCols(['티커', '이름', '점수', '신호통과', '사유'], rows)

  const meta = [
    `기준 레벨: ${level}${relaxationApplied ? ' (완화 적용됨)' : ''}`,
    insufficientSignal ? '⚠ 매수 신호 통과 종목이 5개 미만입니다 (고득점 편입 포함 결과 표시 중).' : null,
  ].filter(Boolean)

  return [...lines, '', ...meta].join('\n')
}

/** 관심 종목 티커가 나스닥100 유니버스에 존재하고 dataSufficient한지 검증한다. */
export function validateTickers(tickerArgs, dataset) {
  const byTicker = new Map(dataset.tickers.map((t) => [t.ticker, t]))
  return tickerArgs.map((rawTicker) => {
    const ticker = rawTicker.toUpperCase()
    const t = byTicker.get(ticker)
    if (!t) return { ticker, accepted: false, reason: '나스닥100 유니버스에 없는 티커' }
    if (!t.dataSufficient) return { ticker, accepted: false, reason: t.insufficientReason ?? '데이터 부족' }
    return { ticker, accepted: true, reason: null }
  })
}

export function formatValidationTable(results) {
  const rows = results.map((r) => [r.ticker, r.accepted ? '승인' : '거부', r.reason ?? '-'])
  return padCols(['티커', '판정', '사유'], rows).join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const dataset = loadDataset()

  if (args.length === 0) {
    console.log(`데이터 기준일: ${dataset.generatedAt}\n`)
    console.log(formatPoolTable(getPool(dataset)))
    return
  }

  console.log(formatValidationTable(validateTickers(args, dataset)))
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMainModule) main()
