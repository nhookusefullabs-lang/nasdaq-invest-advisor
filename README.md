# nasdaq-invest-advisor

나스닥100 기술적 지표 기반 종목 추천 SPA. 백엔드 없이 정적 JSON 스냅샷(`public/data/`)만으로
동작하며 GitHub Pages에 배포된다. 추세추종(RSI·MACD·골든크로스)과 미너비니 SEPA(트렌드
템플릿+VCP) 두 모드를 병행하고, 통합 뷰에서 컨센서스 등급(★★/★)으로 정렬한다. 여기에
펀더멘털 허들(Pass/Partial/Fail)과 리서치 점검 배지가 소프트 게이트로 얹힌다.

## 개발

```
npm install
npm run dev      # 로컬 개발 서버
npm run test     # vitest 전체 스위트
npm run build    # 프로덕션 빌드 (dist/)
```

## 운영 절차 (주 1회, 토요일 권장)

1. **데이터 수집 — 단일 스크립트**
   ```
   python scripts/collect_data.py
   ```
   `public/data/nasdaq100.json`(3년치 가격, 약 756거래일)과 `public/data/fundamentals.json`
   (분기 재무 파생값)을 같은 실행에서 함께 생성한다 — 두 파일을 별도로 실행할 필요 없음.
   둘 다 임시 파일(`.tmp`)에 먼저 쓰고 교체하는 원자적 쓰기이므로, 도중 실패해도 기존
   파일은 훼손되지 않는다.

2. **파일 크기 확인**
   스크립트 자체가 저장 직후 `nasdaq100.json` 크기를 로그로 출력하고, 10MB를 넘으면
   `[WARN]`을 남긴다. 콘솔 로그를 확인하거나, 필요하면 직접 검증한다:
   ```
   node scripts/research/validate-research.mjs public/data/research.json
   node scripts/research/validate-fundamentals.mjs public/data/fundamentals.json
   node scripts/validate-backtest.mjs public/data/backtest.json
   ```

3. **리서치 세션 (선택)**
   `/research` 슬래시 커맨드로 추천 풀 종목의 정성적 리서치를 갱신한다
   (`.claude/commands/research.md` 참고). 중대 리스크(실적 발표 임박·소송·규제·가이던스
   하향)를 발견하면 `research.json`을 스키마 v2(`riskFlags`)로 저장한다 — 리스크 플래그를
   전혀 쓰지 않는 세션은 기존대로 v1로 저장해도 무방하다(하위 호환).

4. **백테스트 재실행 (권장: 분기 1회 + 파라미터를 변경했을 때마다)**
   ```
   node scripts/backtest.mjs
   ```
   `public/data/nasdaq100.json`/`fundamentals.json`을 그대로 읽어 `public/data/backtest.json`을
   갱신한다(원자적 쓰기 — 검증 실패 시 기존 파일 보존). 매주 하는 단순 가격 재수집만으로는
   신뢰도 표시(화면2)의 성과 구간이 갱신되지 않으므로, 데이터가 크게 갱신됐거나 아래
   "백테스트 & 파라미터 조정 워크플로"로 상수를 조정했을 때 반드시 재실행한다.

5. **검증**
   ```
   npm run test
   npm run build
   ```
   전체 테스트 통과와 빌드 성공을 확인한 뒤에만 다음 단계로 진행한다.

6. **커밋 · 배포**
   변경된 `public/data/*.json`과 코드를 커밋·푸시한다. GitHub Actions
   (`deploy.yml`, `update-nasdaq-data.yml`)가 배포를 처리한다 — 이 저장소의 어떤 스크립트도
   실데이터 수집을 자동 실행하지 않으므로, 1~6단계는 항상 운영자가 별도 세션에서 수동으로
   수행한다.

## 백테스트 & 파라미터 조정 워크플로 (PRD_Nasdaq9.md §4.4)

`src/lib/recommend.js`(추세추종)·`minervini.js`·`consensus.js`·`fundamentals.js`가 쓰는
배점·기준값(`src/lib/constants/v8.js`)은 미너비니 원전과 설계 판단에 근거한 **설계값**이며,
과거에 실제로 유효했는지는 `scripts/backtest.mjs`로 실측해야 한다. 아래 5단계는 반드시
순서대로, 사람이 직접 판단하며 진행한다 — **스크립트가 상수를 자동으로 바꾸는 일은 없다.**

```
[1] node scripts/backtest.mjs 실행 → public/data/backtest.json의 In/Out 요약표 확인
[2] In-Sample(전반 50%) 근거로 조정안 수립 — 한 번에 소수 항목만, 세밀 격자 탐색 금지
    (예: "VCP 변동성 수축 배점 25→30")
[3] src/lib/constants/v8.js 수정 + 파일 상단 changelog 주석에 기록
    (날짜 · 변경 전후 값 · 근거가 된 backtest.json/리포트 경로)
[4] node scripts/backtest.mjs 재실행 → Out-of-Sample(후반 50%)에서 조정 전 대비
    악화가 없는지 확인 (승률·초과수익 모두 이상이어야 함)
[5] npm run test && npm run build → 통과 확인 후 커밋 (변경된 backtest.json 포함)
```

- **Out-of-Sample에서 악화되면 [3]의 변경을 되돌리고, 되돌린 사실도 changelog 주석에
  남긴다** (실패 기록도 자산 — 같은 조정을 다시 시도하지 않도록).
- **자동 파라미터 최적화(그리드서치·유전 알고리즘 등)는 금지한다.** `scripts/lib/variants.mjs`의
  후보 변형(A/B/C)도 `backtest.json`의 `variants[]`에 Out-of-Sample 델타만 기록할 뿐
  `adopted`는 항상 `false`로 남는다 — 변형을 실제로 채택해 `src/`에 반영할지는 위 5단계와
  동일하게 사람이 [2]~[3] 단계를 거쳐 판단한다.
- 화면2(추천 결과)의 신뢰도 표시는 **Out-of-Sample 결과만** 사용하며, `backtest.json`이
  없으면 해당 영역 전체가 조용히 사라진다(graceful degradation) — 위 4단계를 건너뛰어도
  앱은 정상 동작하지만 신뢰도 표시만 나타나지 않는다.

## v9.1 진단 실행 가이드 (prd-v9.1-diagnostics.md)

v9.1은 **측정 릴리스**다 — 운영 주기·파라미터·추천 로직은 아무것도 바꾸지 않는다. 아래는
세 가지 검증 가설(완화 신호 오염 / 청산 규칙 개선 여지 / 신호 신선도 프리미엄)을 실측하기
위한 실행 절차와, 그 결과를 사람이 판단하는 기준표다. **판정은 항상 운영자 몫이며, 이
저장소의 어떤 스크립트도 판정 결과를 코드나 상수에 자동 반영하지 않는다.**

### ① 공식 실행 (화면 표시용, step=5)

```
node scripts/backtest.mjs
```

위 "백테스트 & 파라미터 조정 워크플로"의 통상 실행과 동일하다. `public/data/backtest.json`을
갱신하며, 화면2 신뢰도 표시는 **항상 이 step=5 산출물만** 읽는다.

### ② 실험 실행 (신선도 해상도↑, step=1)

```
node scripts/backtest.mjs --step=1 --out=<임시 경로>
```

평가일을 매일 단위로 좁혀 신호 신선도 코호트(가설 ③)의 표본을 촘촘하게 만든다. 연산량이
step=5 대비 약 5배이므로 완주까지 수 분 걸릴 수 있다. **`--out`을 반드시 지정** —
지정하지 않으면 공식 파일(`public/data/backtest.json`) 보호를 위해 스크립트가 즉시 거부한다
(step≠5인데 `--out` 누락 시 exit 1). 이 실행 결과는 화면에 반영되지 않으며, 콘솔 요약과
산출된 임시 JSON을 사람이 직접 읽고 판단하는 용도다.

### ③ 세 가설 판정 기준표

| 가설 | 측정 위치 | 판정 기준 | 기준 충족 시 다음 행동 |
|---|---|---|---|
| ① 완화 신호 오염 — In 구간 추세추종 붕괴가 완화 폴백 신호 탓인가 | 콘솔의 "추세추종 신호 품질 비교" 표 (In/Out × normal/relaxed, 20거래일) 또는 `backtest.json`의 `strategies[].signalQuality` | In 구간에서 relaxed의 초과수익이 normal보다 **유의미하게 나쁨** | "완화 신호 top5 제외" 개선안을 **별도 스토리/PRD**로 후속 검토 (이 루프는 여기서 반영하지 않음) |
| ② 청산 규칙 개선 여지 — 손절·트레일링이 60일 엣지를 지키며 MDD를 줄이는가 | `backtest.json`의 `variants[]` 중 `exit_stop8_time60`/`exit_stop8_trail15`의 `outDetail`/`outVsBaseline` | 60일 `avgExcess` 보존(현행 대비 **−1%p 이내**) **그리고** MDD가 현행 대비 **3%p 이상** 개선 | 손절/트레일링 청산 규칙의 **채택**을 검토(= `src/`에 반영할지 결정) — 이 루프는 측정만, 채택 결정은 운영자가 별도로 수행 |
| ③ 신호 신선도 프리미엄 — 신선한 신호가 지연된 신호보다 실제로 나은가 | 콘솔의 "신호 신선도 코호트" 표 또는 `backtest.json`의 `freshnessCohorts[]` (Out 구간, allSignals, 20거래일) | 신선 코호트(0d/1-2d)와 지연 코호트(3d+/5d+)의 20일 초과수익 차이가 왕복 거래비용 가정(**0.3%**)의 **3배(0.9%p)**를 넘음 | 매일 운영 전환(수집 주기·자동화 변경)을 **별도 PRD**로 검토 — GitHub Actions 스케줄 변경은 이 저장소의 Out-of-Scope 원칙상 이 루프에서 직접 수행하지 않는다 |

세 판정 모두 코드가 자동으로 내리지 않는다 — `variants[].adopted`는 항상 `false`로 남고,
완화 신호 제외·매일 운영 전환은 이 저장소의 어떤 파일도 자동 적용하지 않는다. 위 표는
운영자가 콘솔 출력 또는 `backtest.json`을 직접 읽고 판단할 때 참고하는 체크리스트일 뿐이다.

## v10 분기 재검증 절차 (PRD_Nasdaq10.md §4.6/US-14)

v10부터는 국면·진입/청산 엔진·NGX 파일럿까지 측정 대상이 늘어, **분기 첫 주 토요일**에
아래 절차를 정기 실행한다(가격 자동 갱신은 기존과 동일하게 매주 진행 — 이 절차는 그중
"분기 1회"만 해당하는 부분).

1. **양 유니버스 데이터 재수집**
   ```
   python scripts/collect_data.py --universe=ndx
   python scripts/collect_data.py --universe=ngx --ngx-source=<QQQJ 보유종목 CSV 경로>
   ```
   NGX는 `public/data/ngx100.json` + `fundamentals_ngx.json`을 생성한다(나스닥100과 동일
   스키마·가드레일). **QQQJ 티커 소스 갱신**: Invesco NASDAQ Next Gen 100 ETF(QQQJ)의
   최신 보유종목 공시 CSV를 내려받아 `--ngx-source`로 지정한다 — 이 저장소는 CSV를
   자동으로 내려받지 않으므로, 운영자가 매 분기 최신 파일로 교체해야 한다.

2. **양 유니버스 백테스트 재실행**
   ```
   node scripts/backtest.mjs --universe=ndx
   node scripts/backtest.mjs --universe=ngx
   ```
   각각 `public/data/backtest.json`/`backtest_ngx.json`을 갱신한다. `--universe=ngx` 실행
   시 콘솔에 나스닥100 vs NGX ★★ 컨센서스 비교 요약이 함께 출력된다(§7 판정 재료).
   `backtest_ngx.json`은 UI가 참조하지 않는 측정 전용 파일이다.

3. **표시 갱신 확인**
   화면2 국면 배지·검증 상태 라벨은 `backtest.json`을 그대로 읽으므로 재실행만으로
   자동 갱신된다. 별도 코드 수정 불필요.

4. **판정 기준 재대조 (PRD_Nasdaq10.md §7 그대로)**

   | 대상 | 채택/판정 기준 |
   |---|---|
   | NGX 유니버스 노출 (v11) | ★★ 컨센서스 In/Out 모두 나스닥100 대비 우위 + Pass 표본 ≥50 + Out 표본 ≥100 |
   | 진입 변형 채택 | Out에서 기회비용 포함 초과수익이 entry_close 이상 + 체결률 ≥ 60% + 표본 ≥100 |
   | 청산 변형/조합 채택 | Out에서 60일 초과수익 −1%p 이내 보존 + MDD 3%p 이상 개선 (기존 기준 유지) |
   | 국면 소프트 정책 채택 | 해당 국면 Out 표본 ≥50에서 초과수익·승률 모두 현행 이상 |
   | 상태 필터 변형(actionable_only_top5) 채택 | 전 구간 Out 표본 ≥100에서 초과수익·승률 모두 현행 이상 + 상태별 분해로 제외 상태의 열위 확인 |
   | 모든 채택 | 운영자 승인 + changelog 기록. 스크립트 자동 적용 금지 |

   `backtest.json`의 `entryVariants[]`/`combos[]`/`regimeAxis[]`/`stateAxis[]`와
   `backtest_ngx.json`의 대응 필드를 위 표와 대조해 판단한다. 채택 시
   `src/lib/constants/{entry,exit,regime,verification}.js` 값을 changelog 주석과 함께
   수정하고(위 "백테스트 & 파라미터 조정 워크플로"와 동일한 5단계), `adopted`는 여전히
   자동 반영되지 않으므로 화면 검증 상태 라벨(`constants/verification.js`)도 직접 갱신한다.

5. **progress 기록**
   판정 결과와 채택/보류 사유를 `progress.txt`에 남긴다.

## PRD_Nasdaq10 §8 성공 기준 점검

- [x] NGX 3년 데이터가 가드레일·예외 처리와 함께 수집되고, 동일 프로토콜 백테스트가 backtest_ngx.json을 산출한다 — 코드 완비, 실데이터 수집·실행은 위 분기 절차에서 운영자가 수행(합성 픽스처로 완주 검증됨)
- [x] 국면 지표가 히스테리시스로 3상태를 판정하고, 전 축의 국면별 분해가 backtest.json v3에 포함되며, In/Out 역전이 국면 라벨로 재해석된다
- [x] 화면2에 국면 배지·조건부 성과·진입 상태·가격 세트·매도 신호 배지가 검증 상태 표기와 함께 렌더링된다
- [x] 진입 변형 4종의 체결률·기회비용 포함 성과와 조합 실험 결과가 산출된다 (entry_pivot_confirm2 포함)
- [x] 화면 3·4에서 체결가 입력 → R-배수·손절/트레일링/브레이크이븐/이익 보호가 동작하고 localStorage v4로 유지된다
- [x] 검증 열위 규칙(−8% 손절)이 열위 상태로 정직하게 표기된다 (권장처럼 보이지 않음)
- [x] NGX·국면·진입/청산 관련 신규 파일 부재 시 각 기능만 비표시되고 앱은 v9.1과 동일하게 동작한다 (기존 테스트 전체 통과 — App/Recommend 43개 무수정 통과로 확인)
- [x] 분기 재검증 절차가 README에 명문화된다 (본 절)

미충족 항목 없음. 남은 것은 전부 운영자가 별도 세션에서 수행하는 실행 작업뿐이다
(실데이터 재수집 3종, 양 유니버스 백테스트 실행, §7 판정 기준표 대조·채택 결정).

## v11 해석 지침 (PRD_Nasdaq11.md §4.1/§5, US-13)

v11부터 데이터 수집 기점이 2021-01-01(약 5.5년)로 확장되어 2022년 약세장 전체가 평가
범위에 들어온다. 이 변화가 기존 In/Out 반반 분할의 해석을 바꾼다 — **분할 자체의 의미가
약해지고, 국면(regime) 축이 1차 해석 틀이 된다.**

- **국면 축이 1차, In/Out 분할은 보조**: v9~v10까지는 "In에서 잘 되던 것이 Out에서도
  유지되는가"가 핵심 질문이었다. 5.5년 데이터에서는 In 구간(전반 50%)과 Out 구간(후반
  50%)이 서로 다른 국면 구성(상승/하락 비율)을 갖게 되므로, In→Out 성과 역전이 "일반화
  실패"가 아니라 "국면 구성이 달라졌을 뿐"일 수 있다. 그래서 v11의 모든 신규 축
  (`regimeAxis`/`stateRegimeAxis`/`pullbackAxis`/`hurdleIntersection`의 국면 차원,
  `exit_regime_conditional`)은 항상 국면으로 먼저 나눠서 읽고, In/Out 차이는 그 다음
  참고 자료로만 쓴다.
- **"측정 지속"이 정상 판정값**: 눌림목 3종·청산 A/C/E/F·허들 교집합 모두 PRD §5의
  판정 기준표(아래)가 요구하는 표본 크기(대개 ≥50)에 못 미치면 "채택 보류"나 "실패"가
  아니라 **"측정 지속"**이 올바른 판정이다 — 이중 조건화(★★∩허들, 국면×상태 등)로
  표본이 자연히 얇아지는 구조이므로, 표본 부족을 채택 실패로 오독하지 않는다.
- **2022 구간 생존 편향 주의**: 5.5년 데이터의 유니버스 구성 종목은 **현재 시점 기준**
  이다 — 2022년 약세장 당시 실제로 지수에 있었지만 이후 편입 해제된 종목은 빠져 있고,
  약세장을 버텨내고 지금까지 남은 종목만 반영된다. 따라서 하락 국면 성과는 실제보다
  낙관적으로 나타날 수 있다 — 국면 간 **상대 비교**(상승 vs 하락의 방향성) 용도로만
  해석하고, 하락 국면의 절대 수익률 자체를 액면 그대로 믿지 않는다.

**판정 기준표 (PRD_Nasdaq11.md §5 그대로, 결과 확인 전 선커밋):**

| 대상 | 판정 기준 |
|---|---|
| 눌림목 변형 채택 검토 | 상승 국면 Out에서 중앙값 양수 + allSignals 표본 ≥50 **그리고** 중립·하락 국면에서 명백한 열위 아님(중앙값 −5%p 이내). 3종 세트 중 우월형 특정. 표본 미달 시 "측정 지속" |
| 청산 A 채택 검토 | 중립·하락 국면 표본 ≥50에서 MDD −5%p 이상 개선 + 상승 국면 비용 −1%p 이내 |
| 청산 C 채택 검토 | 결합된 진입 유형 기준, Out 초과수익 −1%p 이내 보존 + 발동률 <40% (정상 호흡 오인 방지) + MDD 개선 |
| 청산 E 채택 검토 | Out 중앙값·승률 모두 개선 + 평균 초과수익 −3%p 이내 보존 |
| 청산 F (지평) | 90/120일이 60일 대비 초과수익 우위 + 겹침 보정 유효 표본 명기 시 기준선 교체 검토 |
| NGX 허들 교집합 | ★★∩Partial+ 의 Out 중앙값 양수 + 표본 ≥50 → v12에서 조건부 노출 재판정 / 30~49건이면 "고무적 — 측정 지속". **판정 시 NDX 교집합과 병기 대조** (개선 폭이 NGX에서 더 큰지 — 가설의 방향 확인) |
| NDX 허들 교집합 (비교 기준) | 교집합이 NDX ★★ 대비 중앙값·승률 모두 우수 + 표본 ≥50이면 "허들 게이트 강화"를 v12 변형 후보로 등록 |
| 모든 채택 | 운영자 승인 + changelog. 자동 적용 금지 |

**운영 절차 (v11 실데이터 순서)**: 위 "v10 분기 재검증 절차"의 1~2단계(양 유니버스
데이터 재수집 → 양 유니버스 백테스트 재실행)를 5.5년 데이터 기준으로 그대로 수행한 뒤,
아래 순서를 이어서 따른다.

1. 데이터 수집: `python scripts/collect_data.py --universe=ndx`(2021-01-01 기점) +
   `--universe=ngx` — 5.5년치, 양 유니버스
2. step=5 공식 백테스트 실행 ×2: `node scripts/backtest.mjs --universe=ndx` +
   `--universe=ngx` — `backtest.json`/`backtest_ngx.json`에 `hurdleIntersection`/
   `pullbackAxis`/`climaxPartial`/`regimeAxis` 등 v11 전 축이 함께 갱신된다
3. 교집합·눌림목·청산 비교표 확인: 위 판정 기준표를 `hurdleIntersection[]`(NDX vs NGX
   병기 대조)/`pullbackAxis[]`/`variants[]`(exit_regime_conditional/exit_structural)/
   `climaxPartial`/`variants[]`(exit_stop8_time60·90·120일 지평)와 직접 대조
4. 해석 세션: 국면 축을 1차 틀로 삼아 판정 → progress.txt에 판정 결과(채택/보류/측정
   지속)와 근거 기록

## PRD_Nasdaq11 §8 성공 기준 점검

- [~] 5.5년 데이터가 양 유니버스에서 수집되고 2022 구간이 평가 범위에 포함된다 — 코드·픽스처(5.5y 합성 데이터, 상승·하락 국면 모두 등장 확인됨) 완비, **실데이터 재수집은 위 운영 절차에서 운영자가 수행**(Out of Scope: "실데이터 수집·실행은 운영자 별도")
- [x] 눌림목 3종 세트가 체결률·두 벌 성과·국면 분해와 함께 산출된다 (관찰 조건 P1~P4의 경계 테스트 포함) — US-5/US-6, `pullbackAxis[]`
- [x] 청산 A·C·E·F가 선커밋 기준 대조 재료(발동률·MDD·중앙값 포함)와 함께 기록된다 — adopted 전부 false — US-7(A)/US-8(C)/US-9(E)/US-2(F)
- [x] 부분 포지션 수익률이 손계산 픽스처와 일치한다 — US-3 인프라 + US-9 exit_climax_partial 픽스처 검증
- [x] stateRegimeAxis·모드별 entryVariants·NGX 교집합 축이 schemaVersion 4로 발행되고 로더가 v1~v3 하위 호환된다 — US-4(stateRegimeAxis/entryVariants 모드 분해)/US-10(hurdleIntersection), backtestSchema.js가 v1~v4 전부 지원(선택 필드 패턴)
- [x] relax_off가 하락 국면에서만 작동하고(다른 국면 신호 불변 테스트), changelog와 화면 안내가 존재한다 — US-11
- [x] 거래량 확인 배지가 양면 정직 라벨과 함께 1급 정보로 표시된다 — US-12
- [x] 기존 테스트 전체 통과 — relax_off 분기 외 추천 결과 불변 — 789개 전체 통과, recommend-default-baseline.json은 `regimeGated:false` 필드 1개만 추가(실질 회귀 없음, US-11에서 실데이터로 직접 확인)

미충족 항목 없음(1건 부분 충족 — 실데이터 재수집은 애초에 이 루프의 범위 밖). 남은 것은
운영자가 위 "v11 실데이터 순서"를 실제로 실행하고, 그 결과를 판정 기준표와 대조해
채택/보류를 결정하는 일뿐이다.

## v11.1 수리 릴리스 재실행 절차 (prd-v11.1-repairs.md)

v11 실데이터 검증(2026-07)에서 측정 인프라 결함·공백 4건이 확인돼(눌림목 표본 고사
원인 불명 / exit_structural 발동 0% / exit_climax_partial 미배선 / 청산 변형 국면별
분해 부재) v11.1이 이를 전부 수리했다. **조건·상수는 하나도 바뀌지 않았다** — 이미
NDX/NGX에 있는 실데이터(`nasdaq100.json`/`ngx100.json`)로 백테스트만 다시 실행하면
아래 4가지가 backtest.json에 새로 나타난다(재수집 불필요):

1. `node scripts/backtest.mjs --universe=ndx` + `--universe=ngx` 재실행 (step=5 공식,
   데이터 재수집 없이 이미 있는 파일 그대로 사용)
2. 콘솔에 "눌림목 관찰 조건(P1~P4) 퍼널" 표가 국면 3종과 함께 출력되는지 확인 (US-1) —
   실데이터에서는 병목이 P2(피벗 대비 −10~−25%)에 있음을 확인할 수 있다(구조적 협소함,
   조건 변경 없음 — progress.txt Iteration 1 참고)
3. `backtest.json`의 `variants[]`에서 `exit_structural` 항목의 `outDetail.stopHitRate`가
   0보다 큰지 확인 (US-2) — 수리 전 상시 0%였던 것이 실측 70%대로 나타난다(발동률 자체는
   README 위쪽 "청산 C 채택 검토" 판정 기준 <40%를 벗어나므로 그대로 채택 근거는 아님)
4. `variants[]`에 `exit_climax_partial` 항목이 존재하고 `climaxPartial` 단일 객체와
   signals·avgExcess가 일치하는지 확인 (US-3)
5. `exit_structural` 등 청산 변형·조합 항목에 `regimeDetail`(국면 3종 + 기준선 병기)이
   존재하는지 확인 (US-4) — 청산 A의 "중립·하락 국면 MDD −5%p 이상 개선" 같은 판정
   기준을 이 필드에서 바로 대조할 수 있다(스크래치 스크립트 불필요)

이 5가지가 전부 확인되면 수리는 정상 반영된 것이다. 이어서 README 상단의 "v11 실데이터
순서"/"v11 해석 지침" 판정 기준표를 이번에 갱신된 수치(특히 exit_structural 실측
발동률, 청산 A의 regimeDetail)로 다시 대조해 채택/보류를 재판정한다 — 이는 v11.1
루프의 범위 밖(Out of Scope: "채택 결정... 실데이터 실행은 운영자 별도")이라 운영자가
별도 해석 세션에서 진행한다.

### prd-v11.1-repairs.md 수리 4건 요약 (원인·조치)

| 문제 | 원인 | 조치 |
|---|---|---|
| 눌림목 표본 고사 | 버그 없음 — trend/top5 신호(모멘텀 강세)와 눌림 관찰 조건(피벗 대비 −10~−25%)이 정의상 거의 배타적인 모집단(스펙 수준 협소함) | `pullbackFunnel`로 P1→∩P2→∩P3→∩P4 단계별 통과 수 진단 추가, 조건은 변경하지 않음 |
| exit_structural 발동 0% | `evaluateExitVariants()`가 entryType을 넘긴 적이 없어 안전 기본값(손절 미가동) 경로로만 빠짐 | `entryType:'breakout'` 명시(entry_close와 동일 가정) |
| exit_climax_partial 미배선 | 계산 자체는 존재했으나 `climaxPartial` 단일 객체에만 있고 다른 청산 후보들의 공용 채널인 `variants[]`엔 없었음 | `climaxPartialVariant`를 `variants[]`에 추가 등록(기존 `climaxPartial`은 유지) |
| 청산 변형 국면별 분해 부재 | 처음부터 미구현 | `buildRegimeDetail()`로 청산 변형·조합 전체에 국면별 성과+기준선 병기 |

자세한 과정은 progress.txt의 "v11.1 수리 릴리스" 섹션(Iteration 1~5)을 참고.
