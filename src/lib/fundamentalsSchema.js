// fundamentals.json 스키마 검증 (PRD_Nasdaq8 §7, US-2, 버전 1)
// research.json(v6 researchSchema.js)과 동일한 원칙: 신규 npm 의존성 없이 손으로 구현.
// 순수 검증 함수만 이 파일에 둔다 — App.jsx가 fundamentalsLoader.js를 통해 이 파일을
// 브라우저 번들에 포함시키므로(US-11), node:fs를 쓰는 원자적 쓰기(atomicWriteFundamentals)는
// Node 전용 스크립트(scripts/research/validate-fundamentals.mjs)로 분리했다
// (researchSchema.js/validate-research.mjs가 이미 쓰던 구조와 동일하게 맞춤).

const SCHEMA_VERSION = 1
const MISSING_CODES = ['F1', 'F2', 'F3', 'F4', 'F5']

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
const isNullableNumber = (v) => v === null || typeof v === 'number'
const isNullableBoolean = (v) => v === null || typeof v === 'boolean'

function validateQuarter(q, path, errors) {
  if (typeof q !== 'object' || q === null) {
    errors.push(`${path}: 분기 항목은 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(q.period)) errors.push(`${path}.period: 필수 문자열입니다`)
  if (!isNullableNumber(q.eps)) errors.push(`${path}.eps: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(q.revenue)) errors.push(`${path}.revenue: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(q.operatingMargin)) errors.push(`${path}.operatingMargin: 숫자 또는 null이어야 합니다`)
}

function validateTicker(t, path, errors) {
  if (typeof t !== 'object' || t === null) {
    errors.push(`${path}: 종목 항목은 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(t.ticker)) errors.push(`${path}.ticker: 필수 문자열입니다`)
  if (!isNullableNumber(t.epsGrowthQoQ_yoy)) errors.push(`${path}.epsGrowthQoQ_yoy: 숫자 또는 null이어야 합니다`)
  if (!isNullableBoolean(t.epsAccelerating)) errors.push(`${path}.epsAccelerating: boolean 또는 null이어야 합니다`)
  if (!isNullableNumber(t.revenueGrowthQoQ_yoy)) errors.push(`${path}.revenueGrowthQoQ_yoy: 숫자 또는 null이어야 합니다`)
  if (!isNullableBoolean(t.marginImproving)) errors.push(`${path}.marginImproving: boolean 또는 null이어야 합니다`)
  if (!isNullableNumber(t.roe)) errors.push(`${path}.roe: 숫자 또는 null이어야 합니다`)

  if (!Array.isArray(t.quarters)) {
    errors.push(`${path}.quarters: 배열이어야 합니다`)
  } else {
    t.quarters.forEach((q, i) => validateQuarter(q, `${path}.quarters[${i}]`, errors))
  }

  if (!Array.isArray(t.missing)) {
    errors.push(`${path}.missing: 배열이어야 합니다`)
  } else {
    t.missing.forEach((code, i) => {
      if (!MISSING_CODES.includes(code)) {
        errors.push(`${path}.missing[${i}]: ${MISSING_CODES.join('/')} 중 하나여야 합니다 (받은 값: ${code})`)
      }
    })
  }
}

function validateExcluded(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: excluded 항목은 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(item.ticker)) errors.push(`${path}.ticker: 필수 문자열입니다`)
  if (!isNonEmptyString(item.reason)) errors.push(`${path}.reason: 필수 문자열입니다`)
}

/** fundamentals.json(버전 1) 구조를 검증한다. 반환: { valid, errors } */
export function validateFundamentals(data) {
  const errors = []

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['data: 객체여야 합니다'] }
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion: ${SCHEMA_VERSION}이어야 합니다 (받은 값: ${data.schemaVersion})`)
  }
  if (!isNonEmptyString(data.generatedAt)) errors.push('generatedAt: 필수 문자열입니다')

  if (!Array.isArray(data.tickers)) {
    errors.push('tickers: 배열이어야 합니다')
  } else {
    data.tickers.forEach((t, i) => validateTicker(t, `tickers[${i}]`, errors))
  }

  if (data.excluded !== undefined) {
    if (!Array.isArray(data.excluded)) {
      errors.push('excluded: 배열이어야 합니다')
    } else {
      data.excluded.forEach((item, i) => validateExcluded(item, `excluded[${i}]`, errors))
    }
  }

  return { valid: errors.length === 0, errors }
}

export { SCHEMA_VERSION as FUNDAMENTALS_SCHEMA_VERSION, MISSING_CODES }
