# prd-research-agent.md — 리서치 서브에이전트 (Ralph 호환 태스크 문서)

> 원본 설계: `PRD_Nasdaq6.md` (v6). 이 문서는 Ralph 루프가 한 이터레이션에 스토리 하나씩
> 구현→검증→커밋하도록 변환한 실행용 문서다.
> 루프 규칙: 매 이터레이션마다 **미완료 스토리 중 가장 위의 것 하나만** 골라 구현하고,
> 승인 기준을 전부 통과하면 체크박스를 채우고 커밋한 뒤 이터레이션을 종료한다.

## 프로젝트 컨텍스트 (매 이터레이션 필독)

- 기존 시스템: React+Vite+Tailwind 정적 SPA (백엔드 없음), GitHub Pages 배포
- 데이터 패턴: `public/data/nasdaq100.json` 정적 스냅샷. 이번 작업은 두 번째 스냅샷
  `public/data/research.json`을 추가하는 것
- 기존 추천 로직: `src/lib/recommend.js` (2단계 스코어링 + 고득점 편입 `HIGH_SCORE_INCLUSION_THRESHOLD=70`)
- 테스트: vitest (기존 59개 통과 상태 유지 필수 — 깨뜨리면 해당 이터레이션 실패)
- 절대 원칙:
  - 기존 화면·로직의 동작 변경 금지 (추가만 허용)
  - `research.json`이 없어도 앱은 완전 정상 동작해야 함 (graceful degradation)
  - 리서치 산출물에 매수/매도 권유 표현 금지
- 품질 게이트 (모든 스토리 공통): `npm run test` 전체 통과 + `npm run build` 성공

---

## 유저 스토리 (우선순위 순 — 위에서부터 하나씩)

### US-1. 추천 풀 추출 CLI
- [x] **운영자로서, 현재 데이터 기준 추천 풀을 터미널에서 확인하고 싶다. 리서치 대상 선정의 출발점이 되도록.**

**구현:** `scripts/research/select-pool.mjs` (Node ESM)
- `public/data/nasdaq100.json` 로드 → `src/lib/recommend.js`와 **동일 기준**으로 추천 실행
  (로직 중복 구현 금지 — 기존 모듈을 import하거나, 불가하면 공용 위치로 추출 리팩터링)
- 출력: 상위 10개 + 고득점 편입 종목을 표 형태로 (티커/이름/점수/signalPassed/사유)
- 인자로 티커 목록을 받으면 (`node select-pool.mjs AAPL TSLA`) 유니버스 존재 여부 +
  dataSufficient 검증 결과를 출력 (관심 종목 사전 검증용)

**승인 기준:**
1. `node scripts/research/select-pool.mjs` 실행 시 추천 풀이 점수순으로 출력된다
2. 유니버스에 없는 티커 인자는 "거부 + 사유" 로 출력된다
3. 추천 결과가 웹 화면2의 추천 결과와 동일하다 (동일 모듈 사용 확인)
4. vitest 테스트 1개 이상 추가 (풀 추출 함수 단위)

---

### US-2. research.json 스키마 검증기 + 샘플 픽스처
- [x] **개발자로서, research.json의 구조 오류를 자동으로 잡아내고 싶다. 서브에이전트 산출물의 품질 보증을 위해.**

**구현:** `scripts/research/validate-research.mjs` + `src/lib/researchSchema.js`(공용) + 테스트 픽스처
- PRD v6 §4.2 스키마(버전 1) 그대로: `schemaVersion, researchedAt, basedOnDataOf, items[], skipped[]`
- item 필수: `ticker, sentiment(3값 enum), summary, catalysts[], risks[], sources[](≥1), origin(2값 enum)`
- `institutionalActivity`·`analystView`는 nullable, `signalPassed`는 origin=userRequested일 때 생략 가능
- source 항목: `title, url, date` 필수 + `operatorProvided`(boolean, 기본 false — 운영자 수동 제공 콘텐츠 표시)
- 원자적 쓰기 헬퍼: 임시 파일에 쓰고 검증 통과 시에만 `research.json`으로 rename
- 유효/무효 샘플 픽스처 각 1개 (`fixtures/research.valid.json`, `research.invalid.json`)

**승인 기준:**
1. 유효 픽스처는 통과, 무효 픽스처(출처 0개, 잘못된 sentiment 등 3케이스 이상)는 실패한다
2. 검증 실패 시 기존 research.json이 훼손되지 않는다 (원자적 쓰기 테스트)
3. vitest 테스트 5개 이상 추가

---

### US-3. 서브에이전트 실행 프롬프트 문서 (AutoResearch 운영 매뉴얼)
- [x] **운영자로서, Claude Code에서 일관된 절차로 리서치를 실행하고 싶다.**

**구현:** `.claude/commands/research.md` (Claude Code 커스텀 커맨드)
- 절차를 명문화: ① US-1 CLI로 풀 제시 → ② 운영자 대화형 선택 + 관심 종목 입력(검증)
  → ③ 종목별 리서치 — 계층 A 자동 조회 (EDGAR 13F → Dataroma → Macrotrends → TipRanks →
  Zacks → Motley Fool → 초이스스탁US → 일반 뉴스 검색, 종목당 검색 3~5회 상한)
  → ④ 계층 B 확인 요청 — VIC/Seeking Alpha/IBD50에 대해 운영자에게 열람·요약 입력을 요청하고,
  입력이 없으면 계층 A 결과만으로 완결 → ⑤ US-2 검증기로 원자적 저장 → ⑥ 결과 요약 보고
- 규칙 명시: 매수/매도 권유 표현 금지, 13F는 기준 분기 명시, 애널리스트 등급은 수집 시점 명시,
  **로그인 계정 정보를 절대 받지 않고 로그인 벽 우회 자동화 금지**, 운영자 제공 내용은
  `operatorProvided: true`로 기록, 소스 실패는 종목 실패가 아님, 출처 없는 항목은 skipped 처리,
  유료·회원 콘텐츠 원문 복사 금지(재서술만), 1회 세션 최대 15종목
- 이 스토리는 코드가 아니라 **문서 산출물** — 루프는 문서 존재와 내용 완결성으로 판정

**승인 기준:**
1. `.claude/commands/research.md`가 존재하고 위 6단계 절차와 9개 규칙이 모두 포함된다
2. PRD_Nasdaq6.md §4.1/§4.2/§4.4와 모순되는 내용이 없다

---

### US-4. SPA 리서치 로더 (graceful degradation)
- [x] **사용자로서, research.json이 있으면 리서치를 보고, 없어도 앱이 평소처럼 동작하길 원한다.**

**구현:** `src/lib/researchLoader.js` + App 데이터 로드 흐름에 통합
- `public/data/research.json` fetch — 404/파싱실패/스키마 불일치 시 `null` 반환 (에러 UI 없음)
- 로드 성공 시 티커→item 맵 제공, `basedOnDataOf !== generatedAt`이면 `stale: true` 플래그
- 유니버스에 없는 티커의 리서치 항목은 조용히 무시

**승인 기준:**
1. research.json 없이 `npm run build` + 전 화면 정상 동작 (기존 테스트 59개 유지)
2. stale 판정 로직 vitest 테스트 포함 (일치/불일치/파일없음 3케이스)

---

### US-5. ResearchSection 공용 컴포넌트
- [x] **사용자로서, 종목 카드에서 AI 리서치 요약을 접었다 펼치며 보고 싶다.**

**구현:** `src/components/ResearchSection.jsx`
- 접힘(기본): 센티먼트 배지(positive=빨강/negative=파랑/neutral=회색, 기존 미니차트 색 관례 일치) + summary 첫 문장
- 펼침: 전체 summary, 촉매/리스크 목록, institutionalActivity(있을 때), 출처 링크(새 탭), researchedAt
- `origin: "userRequested"`면 "관심 종목 리서치" 배지 추가
- `stale: true`면 "이 리서치는 이전 데이터 기준입니다" 경고 문구
- 하단 고정 문구: "AI가 수집한 참고 정보이며 투자 판단의 근거가 아닙니다"

**승인 기준:**
1. 유효 픽스처 데이터로 렌더링 테스트 통과 (접힘/펼침/배지/경고 4케이스 이상)
2. 해당 티커의 리서치가 없으면 아무것도 렌더링하지 않는다 (null 반환)

---

### US-6. 화면2(추천 결과) 통합
- [x] **사용자로서, 추천 종목 카드에서 바로 리서치 요약을 보고 싶다.**

**구현:** 추천 카드 컴포넌트에 `ResearchSection` 삽입 (해당 티커가 리서치 맵에 있을 때만)

**승인 기준:**
1. 픽스처 주입 시 추천 카드에 리서치 섹션이 표시된다
2. research.json 부재 시 화면2가 v5와 시각적으로 동일하다
3. 기존 화면2 테스트 전부 유지

---

### US-7. 화면3(시뮬레이션) 통합
- [x] **사용자로서, 직접 추가한 관심 종목의 리서치도 시뮬레이션 화면에서 확인하고 싶다.**

**구현:** 시뮬레이션 종목 카드에 `ResearchSection` 삽입 (미니차트 아래 배치)

**승인 기준:**
1. `origin: "userRequested"` 픽스처 항목이 "관심 종목 리서치" 배지와 함께 표시된다
2. 리서치 없는 종목 카드는 v5와 동일하게 렌더링된다
3. 기존 시뮬레이션 테스트 전부 유지

---

## Out of Scope (루프가 손대면 안 되는 것)
- 실제 리서치 실행 (research.json 실데이터 생성) — 이건 US-3 문서에 따라 **운영자가 별도 세션에서** 수행
- 포트폴리오 화면(화면4) 통합
- 기존 추천 로직·지표 계산·localStorage 스키마 변경
- GitHub Actions 자동화
- 새 npm 의존성 추가 (필요 시 이터레이션 중단하고 사유 기록)

## 진행 기록 규칙
- 각 이터레이션 종료 시 `progress.txt`에 추가: 완료 스토리 / 변경 파일 / 테스트 수 변화 / 다음 스토리에 남기는 메모
- 스토리 승인 기준을 하나라도 못 채우면 체크하지 말고, 막힌 지점을 progress.txt에 기록 후 종료
