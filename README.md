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
   `public/data/nasdaq100.json`(2년치 가격, 약 504거래일)과 `public/data/fundamentals.json`
   (분기 재무 파생값)을 같은 실행에서 함께 생성한다 — 두 파일을 별도로 실행할 필요 없음.
   둘 다 임시 파일(`.tmp`)에 먼저 쓰고 교체하는 원자적 쓰기이므로, 도중 실패해도 기존
   파일은 훼손되지 않는다.

2. **파일 크기 확인**
   스크립트 자체가 저장 직후 `nasdaq100.json` 크기를 로그로 출력하고, 10MB를 넘으면
   `[WARN]`을 남긴다. 콘솔 로그를 확인하거나, 필요하면 직접 검증한다:
   ```
   node scripts/research/validate-research.mjs public/data/research.json
   node scripts/research/validate-fundamentals.mjs public/data/fundamentals.json
   ```

3. **리서치 세션 (선택)**
   `/research` 슬래시 커맨드로 추천 풀 종목의 정성적 리서치를 갱신한다
   (`.claude/commands/research.md` 참고). 중대 리스크(실적 발표 임박·소송·규제·가이던스
   하향)를 발견하면 `research.json`을 스키마 v2(`riskFlags`)로 저장한다 — 리스크 플래그를
   전혀 쓰지 않는 세션은 기존대로 v1로 저장해도 무방하다(하위 호환).

4. **검증**
   ```
   npm run test
   npm run build
   ```
   전체 테스트 통과와 빌드 성공을 확인한 뒤에만 다음 단계로 진행한다.

5. **커밋 · 배포**
   변경된 `public/data/*.json`과 코드를 커밋·푸시한다. GitHub Actions
   (`deploy.yml`, `update-nasdaq-data.yml`)가 배포를 처리한다 — 이 저장소의 어떤 스크립트도
   실데이터 수집을 자동 실행하지 않으므로, 1~5단계는 항상 운영자가 별도 세션에서 수동으로
   수행한다.
