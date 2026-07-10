// research.json 스키마 검증 (PRD_Nasdaq6.md §4.2, 버전 1)
// 의존성 없이 손으로 구현 — ajv 등 신규 npm 의존성 추가는 US-2 범위 밖 (prd-research-agent.md Out of Scope).

const SENTIMENT_VALUES = ['positive', 'neutral', 'negative']
const ORIGIN_VALUES = ['recommended', 'userRequested']
const SCHEMA_VERSION = 1

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
const isNullableString = (v) => v === null || typeof v === 'string'
const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')

function validateSource(source, path, errors) {
  if (typeof source !== 'object' || source === null) {
    errors.push(`${path}: source는 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(source.title)) errors.push(`${path}.title: 필수 문자열입니다`)
  if (!isNonEmptyString(source.url)) errors.push(`${path}.url: 필수 문자열입니다`)
  if (!isNonEmptyString(source.date)) errors.push(`${path}.date: 필수 문자열입니다`)
  if (source.operatorProvided !== undefined && typeof source.operatorProvided !== 'boolean') {
    errors.push(`${path}.operatorProvided: boolean이어야 합니다`)
  }
}

function validateItem(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: item은 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(item.ticker)) errors.push(`${path}.ticker: 필수 문자열입니다`)
  if (!SENTIMENT_VALUES.includes(item.sentiment)) {
    errors.push(`${path}.sentiment: ${SENTIMENT_VALUES.join('/')} 중 하나여야 합니다`)
  }
  if (!isNonEmptyString(item.summary)) errors.push(`${path}.summary: 필수 문자열입니다`)
  if (!isStringArray(item.catalysts)) errors.push(`${path}.catalysts: 문자열 배열이어야 합니다`)
  if (!isStringArray(item.risks)) errors.push(`${path}.risks: 문자열 배열이어야 합니다`)

  if (item.institutionalActivity !== undefined && !isNullableString(item.institutionalActivity)) {
    errors.push(`${path}.institutionalActivity: 문자열 또는 null이어야 합니다`)
  }
  if (item.analystView !== undefined && !isNullableString(item.analystView)) {
    errors.push(`${path}.analystView: 문자열 또는 null이어야 합니다`)
  }

  if (!ORIGIN_VALUES.includes(item.origin)) {
    errors.push(`${path}.origin: ${ORIGIN_VALUES.join('/')} 중 하나여야 합니다`)
  }
  // signalPassed는 origin=userRequested일 때만 생략 가능 (PRD §4.2, US-2)
  if (item.origin === 'recommended' && typeof item.signalPassed !== 'boolean') {
    errors.push(`${path}.signalPassed: origin이 recommended이면 boolean 필수입니다`)
  }
  if (item.signalPassed !== undefined && typeof item.signalPassed !== 'boolean') {
    errors.push(`${path}.signalPassed: boolean이어야 합니다`)
  }

  if (!Array.isArray(item.sources) || item.sources.length < 1) {
    errors.push(`${path}.sources: 최소 1개 필요합니다`)
  } else {
    item.sources.forEach((s, i) => validateSource(s, `${path}.sources[${i}]`, errors))
  }
}

function validateSkipped(skipped, path, errors) {
  if (typeof skipped !== 'object' || skipped === null) {
    errors.push(`${path}: skipped 항목은 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(skipped.ticker)) errors.push(`${path}.ticker: 필수 문자열입니다`)
  if (!isNonEmptyString(skipped.reason)) errors.push(`${path}.reason: 필수 문자열입니다`)
}

/** research.json(버전 1) 구조를 검증한다. 반환: { valid, errors } */
export function validateResearch(data) {
  const errors = []

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['data: 객체여야 합니다'] }
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion: ${SCHEMA_VERSION}이어야 합니다 (받은 값: ${data.schemaVersion})`)
  }
  if (!isNonEmptyString(data.researchedAt)) errors.push('researchedAt: 필수 문자열입니다')
  if (!isNonEmptyString(data.basedOnDataOf)) errors.push('basedOnDataOf: 필수 문자열입니다')

  if (!Array.isArray(data.items)) {
    errors.push('items: 배열이어야 합니다')
  } else {
    data.items.forEach((item, i) => validateItem(item, `items[${i}]`, errors))
  }

  if (data.skipped !== undefined) {
    if (!Array.isArray(data.skipped)) {
      errors.push('skipped: 배열이어야 합니다')
    } else {
      data.skipped.forEach((s, i) => validateSkipped(s, `skipped[${i}]`, errors))
    }
  }

  return { valid: errors.length === 0, errors }
}

export { SCHEMA_VERSION as RESEARCH_SCHEMA_VERSION }
