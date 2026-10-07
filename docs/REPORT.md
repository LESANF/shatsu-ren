# shatsu-ren v1 구현 보고서 (2026-09-29)

프로젝트: `/Users/lesa/Desktop/Repo/shatsu-ren` (origin LESANF/shatsu-ren, 로컬 커밋 `e4db118`, 푸시 안 함)
코드 규모: TS/TSX/SQL 약 12,800줄. 상세 문서: README / docs/INSTALL / SELF_HOSTING / OPERATIONS / validation/RESULTS·PERFORMANCE·COMPATIBILITY.

## 1. 한 줄 결론

로컬 v1 은 **구현 완료·실제 브라우저 검증 완료**. 운영 배포·Google 로그인·스토어는 자격 증명이 없어 **미완료**(외부 차단).

## 2. 구현한 기능

| 영역 | 내용 |
|---|---|
| 백엔드 (Supabase) | `shatsu` 스키마 8개 테이블, RLS·직접 접근 차단, 공개 RPC 9개(장치 등록/정보/장치 목록·철회/snapshot/changes/명령 1건·묶음/휴지통), 명령 8종(create/patch/move/reorder/deleteSubtree/restore/createCollection/patchCollection), opId receipt 멱등성, revision·order revision 충돌, subtree SHA-256 digest 삭제 검증, tombstone·30일 휴지통, 장치당 분당 120회 rate limit, private Realtime `changed` 신호, generation 회전, purge 작업, 계정 삭제 Edge Function(최근 5분 재로그인 검사) |
| 확장 엔진 | 3-way reconcile(base/local/remote), 단일 실행 queue, journal(불확실한 create 는 복구 필요로 정지), outbox 묶음 전송·receipt 반영, snapshot 재구성(CURSOR_EXPIRED), Realtime 재접속 backoff, 5분 alarm 보조 확인, retry backoff(1/2/5/15분+jitter), 오프라인 보관, 대량 삭제 발신/수신 검토, 범위 밖 이동 검토, 지원 불가 URL 제외, 로컬 백업(최근 5개/100 MiB) |
| 최초 병합 | 경로 제목 배열·종류·제목·URL 정확·유일 매칭, 모호 폴더 하위 제외, 중복 후보 둘 다 유지, 삭제 0 불변, headSeq·fingerprint 재검증(REPLAN) |
| UI | 팝업(상태·대기 건수·최근 변경 3), 온보딩 4단계(로그인→폴더 연결→변경 확인→완료; 첫/추가 브라우저 구분), 개요·연결 폴더·변경 내역(필터·더 보기)·복구(휴지통/백업/JSON 가져오기)·설정(자동 동기화·언어·테마·장치·개인 Supabase·진단·계정 삭제), 충돌 상세(내 변경/서버 변경/둘 다), 검토 상세 5종, ko/en, 밝음/어둠, 키보드·focus |
| 산출물 | WXT MV3 빌드(dev/release), release ZIP+sha256, CI 워크플로, MIT, README(en/ko), CONTRIBUTING, SECURITY, 개인정보 페이지, 임시 단색 아이콘(교체 위치 한곳) |

## 3. 검증 결과 요약

| 스위트 | 결과 |
|---|---|
| protocol 단위 (digest vector, schema) | 5/5 |
| 확장 단위 (reconcile 19, 상태 우선순위 4) | 23/23 |
| pgTAP (SQL digest = TS digest, 권한) | 9/9 |
| RPC 통합 (실제 Auth 세션·PostgREST·Realtime) | 24/24 |
| 브라우저 스모크 (Chromium, Aside) | 2/2 |
| 브라우저 동기화 시나리오 (Chromium ↔ Aside) | 13/13 |
| 브라우저 복구 시나리오 | 5/8 통과 후 수정, 재실행 중 |
| P02 30분 유휴 | 1차 실패(유휴 후 즉시 전달 안 됨) → 소켓 상태 검사 추가 후 재실행 중 |
| 계정 삭제 Edge Function (curl) | 4/4 (403/401/403/200) |

실측 성능: 단일 생성 전파 A→B p50 261 ms / p95 263 ms, B→A p50 263 ms / p95 266 ms (각 30회, 로컬 스택), 실시간 신호 유실 0/60.
73개 인수 시나리오 판정표: `docs/validation/RESULTS.md`.

## 4. 발견·수정한 결함 (이슈 리포트)

| # | 심각도 | 증상 | 원인 | 조치 |
|---|---|---|---|---|
| 1 | 높음 | 최초 업로드 후 서버·상대 브라우저의 형제 순서가 뒤집힘 | 같은 실행에서 만들어지는 형제를 anchor 로 쓰지 않아 모든 create 가 맨 앞 삽입 | anchor 규칙 수정 (`reconcile.ts`) |
| 2 | 높음 | 추가 브라우저 병합 후 폴더 순서가 서버와 영구 불일치 | 아직 로컬에 없는 원격 자식이 있는 폴더의 순서를 "합의"로 기록 | 원격 자식 mapping 완료 전까지 순서 판단 보류 |
| 3 | 중간 | 최초 연결 시 항상 REPLAN | 공유 폴더 생성이 headSeq 를 올려 계획 검증 실패 | 생성 후 계획 headSeq 갱신 |
| 4 | 중간 | 자동 동기화 off→on 후 "실시간 연결 재시도 중" 고정 | 채널 재구독 실패 시 재시도 없음 | backoff 재접속 + 끊긴 채널 재생성 |
| 5 | 중간 | 오프라인 편집이 "보낼 변경 0"으로 표시 | pull 실패 시 reconcile 을 건너뜀 | 오프라인에도 reconcile 실행, 전송만 건너뜀 |
| 6 | 중간 | 서버 세션 무효화 후에도 팝업이 "최신 상태" | 엔진 결과(SESSION_INVALID)를 상태 계산에 반영 안 함 | lastError 코드로 auth_required 판정 |
| 7 | 낮음 | Chromium 재기동 직후 연결 폴더가 "없음"으로 고정될 수 있음 | 기동 직후 getSubTree 일시 실패 시 복구 경로 없음 | 재시도 1회 + 루트 재발견 시 자동 재개 |
| 8 | 낮음 | 변경 내역에 상대 브라우저 이름 빈칸 | 장치 목록 캐시 전 표시 | 지연 조회 |
| 10 | 높음 | 30분 유휴 후 첫 편집이 즉시 전달되지 않음 (P02) | 유휴 중 Realtime 소켓 단절 시 채널 state 가 joined 로 남아 재구독 안 함 | alarm 마다 `isConnected()` 검사·재구독 (재검증 중) |
| 9 | 낮음 | `pnpm install` 무한 재귀 | 루트 script 이름 `install` 이 lifecycle 과 충돌 | `setup` 으로 변경 |

## 5. 미해결 이슈·알려진 한계

| 구분 | 내용 |
|---|---|
| 외부 차단 | Google OAuth client 는 사용자가 생성해 로컬 Supabase 에 연결, Google Chrome 실제 로그인 성공(A08 부분 통과). Aside 왕복 미실행(A09). 운영 Supabase 프로젝트 없음 → 운영 배포·백업 훈련·원격 지연 미측정. 스토어 개발자 계정·최종 아이콘 없음. GitHub 푸시 미실행 |
| 환경 | Google Chrome 154 는 `--load-extension` 을 무시해 자동 테스트 불가 → 수동 로드 절차만 제공. Windows/Linux 미검증 |
| 미검증 코드 경로 | B03/B04(매칭 세부), B07(중첩·관리형 거부), D07(5xx/잘못된 JSON), D08(저장 실패), E05(JSON 가져오기 검증), E06(루트 삭제·재설치), F01(개인 backend 실프로젝트), R06(Realtime 한도) |
| 설계 단순화 | 순서 충돌은 서버 우선(충돌 UI 없음). 미리보기 계획은 worker 메모리에만(탭 닫으면 다시 미리보기). 첫 적용 "일시 정지" 버튼 없음. 범위 밖 이동 "다른 연결로 복사"는 별도 버튼 없이 자연 업로드 |
| 보안 문서화 | 열린 Realtime 채널은 JWT 재평가 전까지 철회 장치가 "변경 발생 사실"만 알 수 있음(본문 없음). 데이터 RPC 는 매 호출 철회 검사 |

## 6. 다음 단계 (권장 순서)

1. Google OAuth client 발급 → `docs/INSTALL.md` §4 → Chrome·Aside 실제 로그인 검증.
2. 운영 Supabase 프로젝트(Free 로 시작 가능, 공개 서비스는 Pro 월 $25 부터) → `supabase db push` → 운영 빌드 → 원격 R01 재측정.
3. Google Chrome 에 수동 로드 후 Aside 와 실제 동기화 확인(사용자 조작 5분).
4. 미검증 경로에 자동 테스트 추가, 아이콘·브랜드 확정, 스토어 자산.
