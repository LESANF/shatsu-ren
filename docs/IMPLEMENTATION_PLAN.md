# IMPLEMENTATION_PLAN

기준 문서: `docs/BLUEPRINT.md` (v1.4). 이 파일은 진행 상태 체크포인트다. 컨텍스트가 줄어도 여기서 이어간다.

프로젝트 루트: `/Users/lesa/Desktop/Repo/shatsu-ren`  (origin: https://github.com/LESANF/shatsu-ren, clone 시점 2026-09-29 빈 레포)

## 환경 (2026-09-29 확인)

- macOS 26.6.2, Node 24.21.0, pnpm 12.6.0, git 2.55, gh(LESANF 로그인)
- Google Chrome 154.0.8037.58, Aside 1.0.928.1 (Chromium 계열, `at.studio.AsideBrowser`), Aside CLI 1.26
- Docker/Postgres/Supabase CLI: 없음 → brew 로 colima·docker·supabase·libpq 설치 (D-002)
- Google OAuth client / 운영 Supabase key / 스토어 개발자 계정: 없음 (외부 차단 항목)

## 단계 (청사진 21절)

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 레포 조사·계획·WXT 최소 확장·로컬 Supabase | 완료 |
| 2 | 인증·장치·RLS/RPC/Realtime 권한 | SQL 완료. tests/db/rpc.test.ts 24/24 (실제 Auth 세션·PostgREST·Realtime). Google OAuth 는 자격 증명 없음 → 미검증 |
| 3 | canonical tree·명령·receipt·트랜잭션 SQL + 통합 테스트 | 완료 (migrations/20260929000000_shatsu_core.sql, pgTAP 9/9 + vitest 24/24) |
| 4 | 단일 폴더 변경 + Realtime 종단 흐름 (Chrome↔Aside) | 완료 — Chromium↔Aside 실측 p95 0.27 s (tests/e2e/sync.test.ts, raw/r01-latency.json). Google Chrome 은 수동 로드만 |
| 5 | journal·오프라인·재시작·충돌·generation | 완료(로컬) — C03/C04/D03/D01/R03/A05 e2e, D06 db. 세부는 RESULTS.md |
| 6 | 최초 병합·복수 collection·삭제 보호·복구 | 완료 — B01/B02/E01/E03/E04 e2e |
| 7 | 전체 UI·임시 아이콘·ko/en·접근성 | 완료 — 팝업/개요/폴더/내역/복구/설정/충돌/검토, 스크린샷 docs/validation/screenshots, 키보드·200% U02 |
| 8 | 계정 삭제·개인 backend·문서·CI·ZIP | 완료(로컬) — delete-account edge function 실호출, README/INSTALL/SELF_HOSTING/OPERATIONS, ci.yml, zip+sha256. 개인 backend 실프로젝트 미검증 |
| 9 | 인수 테스트 결과표·보고 | docs/validation/RESULTS.md (73개), COMPATIBILITY.md, PERFORMANCE.md |

## 변경 파일 / 체크포인트 로그

- 2026-09-29 15:23 clone 완료, docs/BLUEPRINT.md 복사, DECISIONS.md 시작.
- 2026-09-29 15:45 supabase start 성공(로컬), migration 1개 적용. `pnpm --filter shatsu-ren-tests test:db` 24 통과, `supabase test db` 9 통과.
  - 확인된 사실: postgres role 로 auth.sessions 조회 가능(session_valid), realtime.send 존재, Node 24 에서 supabase-js Realtime private channel 동작.
  - 주의: root package.json 의 script 이름 `install` 은 pnpm lifecycle 과 충돌해 무한 재귀 → `setup` 으로 변경.
- 2026-09-29 16:00~17:30 확장 엔진(3-way reconcile)·UI·E2E 하네스 구현. e2e/sync 13/13, 발견 결함 7건 수정(RESULTS.md).
- 2026-09-29 17:30~ recovery/p02 e2e, 문서, zip. 남은 외부 차단: Google OAuth, 운영 Supabase, Chrome 수동 로드, 스토어, GitHub 푸시.

## 이어서 할 일 (다음 세션)

1. Google OAuth 자격 증명 확보 → `docs/INSTALL.md` §4 → Chrome·Aside 양쪽 실제 로그인 검증 (A08/A09).
2. 운영 Supabase 프로젝트 생성·migration push·edge function deploy → 운영 빌드(`WXT_SUPABASE_URL` 주입) → 원격 R01 재측정.
3. RESULTS.md 의 미검증 항목(B03/B04/B07/D07/D08/E05/E06/F01/R06)에 자동 테스트 추가.
4. 아이콘·브랜드 확정 후 `apps/extension/public/icons/*.png` 교체, 스토어 자산.
