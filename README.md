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
