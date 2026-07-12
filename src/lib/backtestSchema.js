// backtest.json 스키마 검증 (PRD_Nasdaq9.md §7 v1 + prd-v9.1-diagnostics.md US-1 v2)
// research.json/fundamentals.json과 동일한 원칙: 신규 npm 의존성 없이 손으로 구현.
// 순수 검증 함수만 이 파일에 둔다 — 화면2(US-8)가 backtestLoader.js를 통해 브라우저
// 번들에 포함시키므로, node:fs를 쓰는 원자적 쓰기는 Node 전용 스크립트(scripts/validate-backtest.mjs)로
// 분리한다 (researchSchema.js/fundamentalsSchema.js가 이미 쓰는 구조와 동일).
//
// v2(US-1)는 strategies[]에 signalQuality("all"|"normal"|"relaxed") 차원을 추가한다 —
// v1 문서는 이 필드가 없으며, 하위 호환을 위해 v1에서는 검증하지 않는다(research.json
// v1→v2 riskFlags 패턴과 동일: 정규화는 로더에서, 검증은 버전별로 분기).

const SCHEMA_VERSION = 3
const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3]
const STRATEGY_KEYS = ['trend', 'minervini', 'consensus_2star', 'consensus_1star']
const SAMPLE_VALUES = ['in', 'out']
const BASIS_VALUES = ['top5', 'allSignals']
const SIGNAL_QUALITY_VALUES = ['all', 'normal', 'relaxed']
const FUNDAMENTAL_VERDICTS = ['pass', 'partial', 'fail']
// freshnessCohorts(v9.1 US-4): 이벤트 정의가 모드별로만 있어(PRD) trend/minervini만 대상.
const FRESHNESS_STRATEGY_KEYS = ['trend', 'minervini']
const FRESHNESS_COHORT_VALUES = ['0d', '1-2d', '3-4d', '5d+', 'no_recent_breakout']
// regimeAxis(v10 US-7): 시장 국면 3상태 — regime.js의 히스테리시스 코드와 동일.
const REGIME_VALUES = ['up', 'neutral', 'down']

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

  // overlapFactor(v9.1 US-3): 선택 필드 — 없으면(구 버전 산출물) 화면이 유효 표본 주석만 생략한다.
  if (config.overlapFactor !== undefined) {
    if (typeof config.overlapFactor !== 'object' || config.overlapFactor === null) {
      errors.push('config.overlapFactor: 객체여야 합니다')
    } else if (!Object.values(config.overlapFactor).every(isNumber)) {
      errors.push('config.overlapFactor: 값이 전부 숫자여야 합니다')
    }
  }
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

  // outDetail(v9.1 US-2, 변형 D 전용): 선택 필드 — 있으면만 검증(경로 의존 청산의
  // 실현 보유일수·손절 도달률까지 담는다. 다른 변형은 이 필드를 쓰지 않는다).
  if (variant.outDetail !== undefined) {
    if (typeof variant.outDetail !== 'object' || variant.outDetail === null) {
      errors.push(`${path}.outDetail: 객체여야 합니다`)
    } else {
      const d = variant.outDetail
      if (!isNumber(d.signals)) errors.push(`${path}.outDetail.signals: 숫자여야 합니다`)
      if (!isNullableNumber(d.winRate)) errors.push(`${path}.outDetail.winRate: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.avgExcess)) errors.push(`${path}.outDetail.avgExcess: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.medianExcess)) errors.push(`${path}.outDetail.medianExcess: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.avgReturn)) errors.push(`${path}.outDetail.avgReturn: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.mdd)) errors.push(`${path}.outDetail.mdd: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.avgHoldingDays)) errors.push(`${path}.outDetail.avgHoldingDays: 숫자 또는 null이어야 합니다`)
      if (!isNullableNumber(d.stopHitRate)) errors.push(`${path}.outDetail.stopHitRate: 숫자 또는 null이어야 합니다`)
    }
  }
}

// freshnessCohorts(v9.1 US-4): { key, cohort, sample, byHolding[] } — byHolding 항목 구조는
// strategy와 동일(validateByHoldingItem 재사용). 선택 필드 — 없으면(구버전 산출물) 검증 생략,
// 로더가 undefined 그대로 통과시켜 화면이 신선도 UI를 렌더링하지 않는다(graceful degradation).
function validateFreshnessCohort(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!FRESHNESS_STRATEGY_KEYS.includes(item.key)) errors.push(`${path}.key: ${FRESHNESS_STRATEGY_KEYS.join('/')} 중 하나여야 합니다`)
  if (!SAMPLE_VALUES.includes(item.sample)) errors.push(`${path}.sample: ${SAMPLE_VALUES.join('/')} 중 하나여야 합니다`)
  if (!FRESHNESS_COHORT_VALUES.includes(item.cohort)) errors.push(`${path}.cohort: ${FRESHNESS_COHORT_VALUES.join('/')} 중 하나여야 합니다`)
  if (!Array.isArray(item.byHolding)) {
    errors.push(`${path}.byHolding: 배열이어야 합니다`)
  } else {
    item.byHolding.forEach((h, i) => validateByHoldingItem(h, `${path}.byHolding[${i}]`, errors))
  }
}

// regimeAxis(v10 US-7): { strategyKey, sample, regime, byHolding[] } — byHolding 항목 구조는
// strategy와 동일(validateByHoldingItem 재사용). 선택 필드 — 없으면(v1/v2 산출물) 검증 생략,
// 로더가 undefined 그대로 통과시켜 화면이 국면 배지를 렌더링하지 않는다(graceful degradation).
function validateRegimeAxisItem(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!STRATEGY_KEYS.includes(item.strategyKey)) errors.push(`${path}.strategyKey: ${STRATEGY_KEYS.join('/')} 중 하나여야 합니다`)
  if (!SAMPLE_VALUES.includes(item.sample)) errors.push(`${path}.sample: ${SAMPLE_VALUES.join('/')} 중 하나여야 합니다`)
  if (!REGIME_VALUES.includes(item.regime)) errors.push(`${path}.regime: ${REGIME_VALUES.join('/')} 중 하나여야 합니다`)
  if (!Array.isArray(item.byHolding)) {
    errors.push(`${path}.byHolding: 배열이어야 합니다`)
  } else {
    item.byHolding.forEach((h, i) => validateByHoldingItem(h, `${path}.byHolding[${i}]`, errors))
  }
}

function validateEntryPerformanceSummary(summary, path, errors) {
  if (typeof summary !== 'object' || summary === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!isNumber(summary.signals)) errors.push(`${path}.signals: 숫자여야 합니다`)
  if (!isNullableNumber(summary.winRate)) errors.push(`${path}.winRate: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(summary.avgExcess)) errors.push(`${path}.avgExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(summary.medianExcess)) errors.push(`${path}.medianExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(summary.avgReturn)) errors.push(`${path}.avgReturn: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(summary.mdd)) errors.push(`${path}.mdd: 숫자 또는 null이어야 합니다`)
}

// entryVariants(v10 US-8): { name, signals, fillRate, byHolding:[{days,conditional,opportunity}] } —
// 선택 필드(freshnessCohorts/regimeAxis와 동일한 하위 호환 패턴).
function validateEntryVariant(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(item.name)) errors.push(`${path}.name: 필수 문자열입니다`)
  if (!isNumber(item.signals)) errors.push(`${path}.signals: 숫자여야 합니다`)
  if (!isNullableNumber(item.fillRate)) errors.push(`${path}.fillRate: 숫자 또는 null이어야 합니다`)
  if (!Array.isArray(item.byHolding)) {
    errors.push(`${path}.byHolding: 배열이어야 합니다`)
  } else {
    item.byHolding.forEach((h, i) => {
      const p = `${path}.byHolding[${i}]`
      if (typeof h !== 'object' || h === null) {
        errors.push(`${p}: 객체여야 합니다`)
        return
      }
      if (!isNumber(h.days)) errors.push(`${p}.days: 숫자여야 합니다`)
      validateEntryPerformanceSummary(h.conditional, `${p}.conditional`, errors)
      validateEntryPerformanceSummary(h.opportunity, `${p}.opportunity`, errors)
    })
  }
}

// combos(v10 US-9): { name, adopted, signals, fillRate, winRate, avgExcess, medianExcess,
// avgReturn, mdd, avgHoldingDays } — 선택 필드(하위 호환 패턴 동일).
function validateCombo(item, path, errors) {
  if (typeof item !== 'object' || item === null) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (!isNonEmptyString(item.name)) errors.push(`${path}.name: 필수 문자열입니다`)
  if (!isBoolean(item.adopted)) errors.push(`${path}.adopted: boolean이어야 합니다`)
  if (!isNumber(item.signals)) errors.push(`${path}.signals: 숫자여야 합니다`)
  if (!isNullableNumber(item.fillRate)) errors.push(`${path}.fillRate: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.winRate)) errors.push(`${path}.winRate: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.avgExcess)) errors.push(`${path}.avgExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.medianExcess)) errors.push(`${path}.medianExcess: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.avgReturn)) errors.push(`${path}.avgReturn: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.mdd)) errors.push(`${path}.mdd: 숫자 또는 null이어야 합니다`)
  if (!isNullableNumber(item.avgHoldingDays)) errors.push(`${path}.avgHoldingDays: 숫자 또는 null이어야 합니다`)
}

/** backtest.json(버전 1, 2 또는 3) 구조를 검증한다. 반환: { valid, errors } */
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

  if (data.freshnessCohorts !== undefined) {
    if (!Array.isArray(data.freshnessCohorts)) {
      errors.push('freshnessCohorts: 배열이어야 합니다')
    } else {
      data.freshnessCohorts.forEach((f, i) => validateFreshnessCohort(f, `freshnessCohorts[${i}]`, errors))
    }
  }

  if (data.regimeAxis !== undefined) {
    if (!Array.isArray(data.regimeAxis)) {
      errors.push('regimeAxis: 배열이어야 합니다')
    } else {
      data.regimeAxis.forEach((r, i) => validateRegimeAxisItem(r, `regimeAxis[${i}]`, errors))
    }
  }

  if (data.entryVariants !== undefined) {
    if (!Array.isArray(data.entryVariants)) {
      errors.push('entryVariants: 배열이어야 합니다')
    } else {
      data.entryVariants.forEach((v, i) => validateEntryVariant(v, `entryVariants[${i}]`, errors))
    }
  }

  if (data.combos !== undefined) {
    if (!Array.isArray(data.combos)) {
      errors.push('combos: 배열이어야 합니다')
    } else {
      data.combos.forEach((c, i) => validateCombo(c, `combos[${i}]`, errors))
    }
  }

  return { valid: errors.length === 0, errors }
}

export {
  SCHEMA_VERSION as BACKTEST_SCHEMA_VERSION,
  STRATEGY_KEYS as BACKTEST_STRATEGY_KEYS,
  SIGNAL_QUALITY_VALUES as BACKTEST_SIGNAL_QUALITY_VALUES,
  REGIME_VALUES as BACKTEST_REGIME_VALUES,
}
