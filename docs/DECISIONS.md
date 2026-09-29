# DECISIONS

구현 중 내린 결정과 가정. 날짜는 절대 날짜(KST)로 적는다.

| # | 날짜 | 결정 | 근거 / 영향 |
|---|---|---|---|
| D-001 | 2026-09-29 | 프로젝트 루트 `/Users/lesa/Desktop/Repo/shatsu-ren`, origin `LESANF/shatsu-ren`(clone 시점 빈 레포) | 청사진 0.4절. 부모 Repo에 git init 하지 않음 |
| D-002 | 2026-09-29 | 로컬 백엔드는 Supabase CLI + colima(docker) 로 실행 | 이 머신에 Docker Desktop/Postgres 없음. brew 로 colima·docker·supabase·libpq 설치(무료·오픈소스). 실패 시 SQL 검증은 별도 Postgres 로 대체 |
| D-003 | 2026-09-29 | Google OAuth 자격 증명 없음 → **개발 빌드 한정 로컬 테스트 로그인**(이메일+비밀번호, 로컬 Supabase Auth 합성 계정) 추가. `SHATSU_DEV_AUTH=1` 빌드에서만 컴파일되고 release zip 에서는 코드·버튼이 제거됨 | 청사진 25절 "합성 Auth 계정으로 로컬 DB/동기화 테스트". 제품 로그인은 Google 하나이며 OTP/비밀번호 로그인을 제품 기능으로 제공하지 않음 |
| D-004 | 2026-09-29 | 스택: pnpm workspace, TypeScript strict, WXT 0.21 + React 19, @supabase/supabase-js 2.x, idb, zod(런타임 schema), vitest, playwright | 청사진 4절 기본값. 새 ORM·상태관리 라이브러리 없음 |
| D-005 | 2026-09-29 | DB 스키마: 데이터 테이블은 `shatsu` 스키마(anon/authenticated 접근 회수), 공개 RPC 만 `public.sync_*` 로 노출, 내부 함수는 `shatsu.*` | 청사진 4.2절. PostgREST 는 public 만 expose |
| D-006 | 2026-09-29 | 논리 root node 는 collections.root_node_id 로 두고 nodes 테이블에 kind='root' 로 저장 | 순서 저장(folder_orders)을 root 에도 동일 적용하기 위함 |
| D-007 | 2026-09-29 | Realtime: DB 트리거가 아니라 RPC 함수 끝에서 `realtime.send()` 로 private channel `workspace:<id>` 에 `{type:'changed'}` 발행. 실패는 무시(WARNING) | 청사진 9.5절. 본문·seq 를 넣지 않음 |
| D-008 | 2026-09-29 | 임시 아이콘: 단색 사각형 안 흰 원(스크립트 생성 PNG). `apps/extension/public/icons/` 한 곳에서 교체 | 청사진 15.2절. 기존 시안 미채택 |
| D-009 | 2026-09-29 | Aside 자동화: Playwright `launchPersistentContext` 로 Aside 실행 파일을 별도 프로필로 실행하고 `--load-extension` 사용. 사용자 실제 Aside 프로필은 건드리지 않음 | 합성 데이터 원칙(22절) |
| D-010 | 2026-09-29 | LICENSE 저작권자 표기는 `LESANF` (GitHub 계정명, gh auth 확인). 실명 표기 원하면 교체 | 청사진 19절 |
| D-011 | 2026-09-29 | 자동 브라우저 테스트의 "Chrome" 측은 Playwright Chromium(153)으로 대체 | Google Chrome 154 브랜드 빌드가 `--load-extension` 플래그를 무시함을 실측(확장 worker 미기동). 실제 Chrome 은 수동 "압축해제된 확장 로드"로만 확인 가능 → RESULTS 에 구분 기록 |
| D-012 | 2026-09-29 | 오프라인일 때도 reconcile 을 실행해 outbox(로컬 intent)를 기록하고 전송만 건너뜀 | 청사진 9.2 "이벤트 즉시 durable intent". 초기 구현은 pull 실패 시 바로 종료해 대기 건수가 0 으로 보였음(E2E 에서 발견) |
| D-013 | 2026-09-29 | 순서 충돌(양쪽 모두 재정렬)은 충돌 레코드 없이 서버 순서 우선 | 청사진 6.3 초기 정책과 일관. 별도 충돌 UI 는 v1 제외 (ponytail) |
| D-014 | 2026-09-29 | intent 와 outbox 를 하나의 store(outbox)로 통합, "node 당 미완료 op 하나" 규칙 | 청사진 9.1 의 local_intents/outbox 분리 대신. base 는 observed 에 보존해 3-way 비교 유지 |
| D-015 | 2026-09-29 | 범위 밖 이동 `moved_out` 검토의 "다른 연결로 복사"는 별도 버튼 없이, 옮긴 폴더가 다른 연결 범위면 그 연결의 새 항목으로 자연 업로드 | 명시 선택지는 계정 유지 / 계정 삭제 두 가지 |
| D-016 | 2026-09-29 | release zip 에 `loginDev` 메시지 분기 문자열은 남지만 `DEV_AUTH=false` 로 즉시 FORBIDDEN 반환, UI 버튼은 렌더 안 됨. supabase-js 라이브러리 자체의 `signInWithPassword`/`service_role` 문자열은 SDK 코드 | F04 검사 결과 기록 |
