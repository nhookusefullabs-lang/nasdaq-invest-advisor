// backtest.json 스키마 검증 (PRD_Nasdaq9.md §7 v1 + prd-v9.1-diagnostics.md US-1 v2)
// research.json/fundamentals.json과 동일한 원칙: 신규 npm 의존성 없이 손으로 구현.
// 순수 검증 함수만 이 파일에 둔다 — 화면2(US-8)가 backtestLoader.js를 통해 브라우저
// 번들에 포함시키므로, node:fs를 쓰는 원자적 쓰기는 Node 전용 스크립트(scripts/validate-backtest.mjs)로
// 분리한다 (researchSchema.js/fundamentalsSchema.js가 이미 쓰는 구조와 동일).
//
// v2(US-1)는 strategies[]에 signalQuality("all"|"normal"|"relaxed") 차원을 추가한다 —
// v1 문서는 이 필드가 없으며, 하위 호환을 위해 v1에서는 검증하지 않는다(research.json
// v1→v2 riskFlags 패턴과 동일: 정규화는 로더에서, 검증은 버전별로 분기).

const SCHEMA_VERSION = 2
const SUPPORTED_SCHEMA_VERSIONS = [1, 2]
const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const SAMPLE_VALUES = ['in', 'out']
const BASIS_VALUES = ['top5', 'allSignals']
const SIGNAL_QUALITY_VALUES = ['all', 'normal', 'relaxed']
const FUNDAMENTAL_VERDICTS = ['pass', 'partial', 'fail']

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0
const isNullableString = (v) => v === null || typeof v === 'string'
const isNumber = (v) => typeof v === 'number' && !Number.isNaN(v)
const isNullableNumber = (v) => v === null || isNumber(v)
const isBoolean = (v) => typeof v === 'boolean'

function validateConfig(config, errors) {
  if (typeof config !== 'object' || config === null) {
    errors.push('config: 객체여야 합니다')
    return
  }
  if (!isNullableString(config.dataFrom)) errors.push('config.dataFrom: 문자열 또는 null이어야 합니다')
  if (!isNullableString(config.dataTo)) errors.push('config.dataTo: 문자열 또는 null이어야 합니다')
  if (!isNumber(config.stepDays)) errors.push('config.stepDays: 숫자여야 합니다')
  if (!Array.isArray(config.holdingDays) || !config.holdingDays.every(isNumber)) {
    errors.push('config.holdingDays: 숫자 배열이어야 합니다')
  }
  if (!isNumber(config.warmupDays)) errors.push('config.warmupDays: 숫자여야 합니다')
  if (!isNullableString(config.splitDate)) errors.push('config.splitDate: 문자열 또는 null이어야 합니다')
  if (!isNonEmptyString(config.benchmark)) errors.push('config.benchmark: 필수 문자열입니다')
  if (!isNumber(config.topN)) errors.push('config.topN: 숫자여야 합니다')
}

function validateByHoldingItem(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!isNumber(item.days)) errors.push(`${path}.days: 숫자여야 합니다`)
  if (!isNumber(item.signals)) errors.push(`${path}.signals: 숫자여야 합니다`)
  if (!isNullableNumber(item.winRate)) errors.push(`${path}.winRate: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.avgExcess)) errors.push(`${path}.avgExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.medianExcess)) errors.push(`${path}.medianExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.avgReturn)) errors.push(`${path}.avgReturn: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.mdd)) errors.push(`${path}.mdd: 숫자 또는 null이어야 합니다`)
}

function validateStrategy(strategy, path, errors, schemaVersion) {
  if (typeof strategy !== 'object' || strategy === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!STRATEGY_KEYS.includes(strategy.key)) errors.push(`${path}.key: ${STRATEGY_KEYS.join('/')} 중 하나여야 합니다`)
  if (!SAMPLE_VALUES.includes(strategy.sample)) errors.push(`${path}.sample: ${SAMPLE_VALUES.join('/')} 중 하나여야 합니다`)
  if (!BASIS_VALUES.includes(strategy.basis)) errors.push(`${path}.basis: ${BASIS_VALUES.join('/')} 중 하나여야 합니다`)
  if (!isNullableNumber(strategy.relaxedShare)) errors.push(`${path}.relaxedShare: 숫자 또는 null이어야 합니다`)

  // signalQuality(v2, US-1): v1 문서에는 없는 필드이므로 schemaVersion===2일 때만 검증한다.
  // v1은 하위 호환을 위해 존재 여부와 무관하게 검증하지 않음(backtestLoader가 "all"로 정규화).
  if (schemaVersion === 2 && !SIGNAL_QUALITY_VALUES.includes(strategy.signalQuality)) {
    errors.push(`${path}.signalQuality: ${SIGNAL_QUALITY_VALUES.join('/')} 중 하나여야 합니다`)
  }

  if (!Array.isArray(strategy.byHolding)) {
    errors.push(`${path}.byHolding: 배열이어야 합니다`)
  } else {
    strategy.byHolding.forEach((item, i) => validateByHoldingItem(item, `${path}.byHolding[${i}]`, errors))
  }
}

function validateFundamentalAxis(axis, errors) {
  if (axis === null || axis === undefined) return
  if (typeof axis !== 'object') {
    errors.push('fundamentalAxis: 객체 또는 null이어야 합니다')
    return
  }
  if (!isNonEmptyString(axis.note)) errors.push('fundamentalAxis.note: 필수 문자열입니다')
  if (!isNullableString(axis.coveredFrom)) errors.push('fundamentalAxis.coveredFrom: 문자열 또는 null이어야 합니다')
  if (!Array.isArray(axis.byVerdict)) {
    errors.push('fundamentalAxis.byVerdict: 배열이어야 합니다')
  } else {
    axis.byVerdict.forEach((item, i) => {
      const path = `fundamentalAxis.byVerdict[${i}]`
      if (typeof item !== 'object' || item === null) {
        errors.push(`${path}: 객체여야 합니다`)
        return
      }
      if (!FUNDAMENTAL_VERDICTS.includes(item.verdict)) errors.push(`${path}.verdict: ${FUNDAMENTAL_VERDICTS.join('/')} 중 하나여야 합니다`)
      if (!Array.isArray(item.byHolding)) {
        errors.push(`${path}.byHolding: 배열이어야 합니다`)
      } else {
        item.byHolding.forEach((h, j) => validateByHoldingItem(h, `${path}.byHolding[${j}]`, errors))
      }
    })
  }
}

function validateVariant(variant, path, errors) {
  if (typeof variant !== 'object' || variant === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(variant.name)) errors.push(`${path}.name: 필수 문자열입니다`)
  if (!isBoolean(variant.adopted)) errors.push(`${path}.adopted: boolean이어야 합니다`)
  if (typeof variant.outVsBaseline !== 'object' || variant.outVsBaseline === null) {
    errors.push(`${path}.outVsBaseline: 객체여야 합니다`)
  } else {
    if (!isNullableNumber(variant.outVsBaseline.avgExcessDelta)) errors.push(`${path}.outVsBaseline.avgExcessDelta: 숫자 또는 null이어야 합니다`)
    if (!isNullableNumber(variant.outVsBaseline.winRateDelta)) errors.push(`${path}.outVsBaseline.winRateDelta: 숫자 또는 null이어야 합니다`)
  }
  if (!isNonEmptyString(variant.note) && variant.note !== '') errors.push(`${path}.note: 문자열이어야 합니다`)
}

/** backtest.json(버전 1 또는 2) 구조를 검증한다. 반환: { valid, errors } */
export function validateBacktest(data) {
  const errors = []

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['data: 객체여야 합니다'] }
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion)) {
    errors.push(`schemaVersion: ${SUPPORTED_SCHEMA_VERSIONS.join(' 또는 ')}이어야 합니다 (받은 값: ${data.schemaVersion})`)
  }
  if (!isNonEmptyString(data.generatedAt)) errors.push('generatedAt: 필수 문자열입니다')

  validateConfig(data.config, errors)

  if (!Array.isArray(data.strategies)) {
    errors.push('strategies: 배열이어야 합니다')
  } else {
    data.strategies.forEach((s, i) => validateStrategy(s, `strategies[${i}]`, errors, data.schemaVersion))
  }

  validateFundamentalAxis(data.fundamentalAxis, errors)

  if (data.variants !== undefined) {
    if (!Array.isArray(data.variants)) {
      errors.push('variants: 배열이어야 합니다')
    } else {
      data.variants.forEach((v, i) => validateVariant(v, `variants[${i}]`, errors))
    }
  }

  return { valid: errors.length === 0, errors }
}

export { SCHEMA_VERSION as BACKTEST_SCHEMA_VERSION, STRATEGY_KEYS as BACKTEST_STRATEGY_KEYS, SIGNAL_QUALITY_VALUES as BACKTEST_SIGNAL_QUALITY_VALUES }
