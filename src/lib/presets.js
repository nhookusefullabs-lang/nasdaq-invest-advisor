// 추천 프리셋 3종 (PRD_Nasdaq7 §3 Must-7, US-8) — recommend()에 주입하는 설정 객체.
// 2단계 배점(이격도60/거래량30/섹터10)은 프리셋 대상이 아니며 recommend.js에 고정돼 있다.

export const PRESET_KEYS = ['conservative', 'default', 'aggressive']

export const PRESETS = {
  conservative: {
    label: '보수형',
    description: '더 강한 신호만 통과시킵니다',
    rsiMin: 55,
    goldenCrossWindow: 3,
    goldenCrossRelaxedWindow: 6, // "완화 폴백: 동일 로직 유지 (창 2배 → RSI만)"
    highScoreThreshold: 80,
  },
  default: {
    label: '기본형',
    description: 'v5 현행 기준입니다',
    rsiMin: 50,
    goldenCrossWindow: 5,
    goldenCrossRelaxedWindow: 10,
    highScoreThreshold: 70,
  },
  aggressive: {
    label: '공격형',
    description: '더 많은 종목을 느슨한 기준으로 통과시킵니다',
    rsiMin: 45,
    goldenCrossWindow: 10,
    goldenCrossRelaxedWindow: 20,
    highScoreThreshold: 60,
  },
}

export const DEFAULT_PRESET_KEY = 'default'
