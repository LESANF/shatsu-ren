# 인수 테스트 결과 (RESULTS) — 2026-09-29

실행 환경: macOS 26.6.2 · Supabase 로컬 스택(CLI 2.118, colima) · 확장 0.1.0 dev-auth 빌드 · A = Playwright Chromium 153, B = Aside 1.0.928.1 (각각 임시 프로필). 모든 데이터는 합성(`synthetic-*@example.com`, `example.com` URL).

상태 정의 — **통과**: 자동 테스트 또는 실제 실행으로 합격 조건 확인. **부분**: 합격 조건의 일부만 확인(무엇이 빠졌는지 명시). **미검증**: 코드 경로는 있으나 테스트하지 않음. **차단**: 외부 자격 증명·권한이 없어 실행 불가. **실패**: 실행했고 합격 조건 미달.

증거 경로 약어: `db` = `tests/db/rpc.test.ts`(실제 Auth 세션·PostgREST·Realtime, 24/24), `tap` = `supabase/tests/digest_and_grants.test.sql`(9/9), `unit` = `apps/extension/src/sync/*.test.ts`(23/23) + `packages/protocol`(5/5), `e2e-sync` = `tests/e2e/sync.test.ts`(13/13), `e2e-rec` = `tests/e2e/recovery.test.ts`, `e2e-p02` = `tests/e2e/p02-idle.test.ts`, `raw` = `docs/validation/raw/*.json`, `shots` = `docs/validation/screenshots/`.

| ID | 상태 | 증거 / 비고 |
|---|---|---|
| A01 | 통과 | db A01(같은 workspace·다른 device) · e2e-sync(두 브라우저 같은 계정) |
| A02 | 통과 | db A02: 타 계정 collection/node 참조 → NOT_FOUND/PARENT_NOT_FOUND, snapshot 에 제목 누출 없음, 타 장치 철회 불가 |
| A03 | 통과 | db A03 + tap: anon/authenticated 테이블·shatsu 스키마·내부 함수·admin RPC 접근 불가 (PGRST205/42501/permission denied) |
| A04 | 통과 | db A04: 철회 장치 JWT 로 읽기·쓰기·재등록 모두 DEVICE_REVOKED, 새 로그인은 새 장치 |
| A05 | __A05__ | e2e-rec: 서버 세션 삭제 → auth_required, 로컬 변경 보존, 재로그인 후 전송. 만료 토큰의 refresh 경로(SDK getSession)는 시간 경과 시뮬레이션 없이 미검증 |
| A06 | 통과 | e2e-sync A06/F07: 로그아웃→타 계정 로그인 시 binding/collection 없음, 이전 계정 데이터 미전송, 원래 계정 재로그인 시 복원 |
| A07 | 통과 | db A07: 재로그인(새 device) 후 같은 opId 재전송 → 동일 receipt, commit 1개 |
| A08 | 차단 | Google OAuth client 없음. 취소/잘못된 redirect/ code 없음 처리 코드는 `src/auth/session.ts`(loginWithGoogle) |
| A09 | 차단 | 위와 같음. 개발/릴리스 확장 ID 별 redirect 등록 절차는 `docs/INSTALL.md` §4 |
| B01 | 통과 | e2e-sync B01: 빈 서버 첫 연결, toServer=4/deletes=0/excluded=1, 로컬 트리 불변 |
| B02 | 통과 | e2e-sync B02: 기존 항목 1개 정확 매칭(matched=1), 나머지 수신(toLocal=3), 삭제 0, 이름 같아도 자동 연결 없음 |
| B03 | 미검증 | 매칭 키에 경로 제목 배열·종류·제목·URL 포함 (`src/sync/plan.ts` keyOf). 서버는 UUID 로만 정체성 판단 |
| B04 | 미검증 | 중복 이름 폴더 하위 매칭 제외(`ambiguousFolderPaths`), 경로는 배열 비교. 자동 테스트 없음 |
| B05 | 통과 | `commitPlan` 이 headSeq·로컬 fingerprint 재검증 → REPLAN. 구현 중 실제 REPLAN 발생·수정 이력(collection 생성 후 headSeq 갱신) |
| B06 | 부분 | db C14(묶음 재전송 중복 없음) + e2e-sync D03(재시작 후 재개). import 도중 강제 종료 자체는 재현하지 않음 |
| B07 | 미검증 | previewMerge 가 중첩 binding(NESTED_BINDING)·관리형(MANAGED)·최상위 거부. 자동 테스트 없음 |
| C01 | 통과 | e2e-sync R01/C01: 양방향 생성 60회, 제목/URL 수정 전파 |
| C02 | 통과 | e2e-sync C02: 폴더 이동·형제 순서 변경·빈 폴더 유지, 양쪽 트리 동일 |
| C03 | 통과 | e2e-sync C03: 양쪽 동시 수정 → 두 번째 장치 충돌, 덮어쓰기 없음, "내 변경 사용" 후 수렴 · db C03 |
| C04 | 통과 | e2e-sync C04: 원격 삭제 vs 로컬 미전송 수정 → 수정 보존·충돌, "수정본 보관" 시 새 항목으로 재업로드 |
| C05 | 통과 | db C05: tombstone ID create → DUPLICATE_ID · unit C05 · purge 후에도 DUPLICATE_ID |
| C06 | 통과 | db C06: anchor,Y,X |
| C07 | 통과 | db C07: ANCHOR_NOT_FOUND, 임의 배치 없음 |
| C08 | 통과 | db C08: CYCLE / 다른 collection parent → 거부, 부분 변경 없음(head_seq 불변) |
| C09 | 통과 | db C09 |
| C10 | 통과 | db C09/C10, A07 |
| C11 | 통과 | unit C11(base 일치 시 재전송 없음) · e2e-sync 전 구간에서 무한 왕복 없음(commit 수 = 편집 수) |
| C12 | 부분 | unit: reconcile 은 이벤트가 아닌 3-way 비교라 사용자 편집을 반향으로 버리지 않음. 원격 적용 도중 실제 동시 편집 e2e 는 없음 |
| C13 | 부분 | unit C13(moved_out 검토, 삭제 없음). 실제 브라우저 범위 밖 이동 e2e 없음 |
| C14 | 통과 | db C14 |
| D01 | __D01__ | e2e-rec D01: 'started' create journal 주입 → recovery_required + create_recovery 검토(후보 표시), 자동 mapping 없음, 후보 선택 후 재개 |
| D02 | 부분 | e2e-sync E03: 수신 대량 삭제가 서버 shadow(received)에는 반영되고 native 적용(applied)은 승인 전 없음. 저장/적용 사이 강제 종료 자체는 재현 안 함 |
| D03 | 통과 | e2e-sync D03: 자동 동기화 꺼진 채 편집 → 브라우저 재시작 → 재개 후 반영 |
| D04 | __D04__ | e2e-rec R03: 강제 종료 후 재기동 시 alarm 재확인·누락 delta 복구 |
| D05 | 부분 | db: CURSOR_EXPIRED 반환. 클라이언트 `rebuildFromSnapshot`(outbox/observed 보존) 은 코드 경로만 |
| D06 | 부분 | db D06: rotate_generations 후 이전 세대 명령 SERVER_GENERATION_CHANGED, 장치 재인증. 클라이언트 blocked→"서버 상태와 다시 비교" UI 는 미실행 |
| D07 | 미검증 | rpc.ts 가 응답 schema(zod) 검증·5xx 를 TransportError 로 분리, 삭제 경로는 shadow tombstone 만 사용. 실제 5xx 주입 없음 |
| D08 | 미검증 | StorageError → blocked(STORAGE_FAILED), 성공 표시 금지. 용량 부족 주입 없음 |
| E01 | 통과 | e2e-sync E01: 폴더 removeTree → 상대 하위 포함 삭제, 휴지통 itemCount=2 · unit E01 |
| E02 | 통과 | unit(원격 폴더 삭제 vs 로컬 미전송 자식 → 충돌 보류) + 엔진 remove 직전 자식 재확인(`applyLocal`) |
| E03 | 통과 | e2e-sync E03: 25개 삭제 → 발신 검토(전송 없음) → 승인 → 수신 검토(적용 없음) → 승인 → 적용 · unit 20%/5개 규칙 |
| E04 | 통과 | e2e-sync E04(복원 양쪽 재생성) · db E04(원래 부모 삭제 시 PARENT_NOT_FOUND → 선택 부모로 원자 복원) |
| E05 | 미검증 | importPreview: format/version/schema/크기 16 MiB/순환/깊이/개수 검사 후에만 importId 발급. 자동 테스트 없음 |
| E06 | 미검증 | 루트 소실 → binding root_missing(삭제 전파 없음), 재선택 UI. 확장 재설치·권한 철회 미실행 |
| E07 | 통과 | unit E07(검토, 원격 삭제 없음) · db F05(서버 INVALID_URL) |
| F01 | 미검증 | setBackend: https/127.0.0.1 검증, optional host permission 요청, auth settings 확인, 로그아웃·격리. 실제 두 번째 프로젝트 없음 |
| F02 | 부분 | edge function 실제 호출: 정상 삭제 시 auth.users/workspaces/devices cascade 0. Auth 삭제 도중 실패 재시도는 주입하지 않음(`account_deletion_begin` 은 같은 requestId 재진입 허용) |
| F03 | 통과 | edge function: confirmEmail 불일치 403, 무인증 401, 10분 전 세션 403 RECENT_LOGIN_REQUIRED, body 의 타인 ID 무시(uid 는 JWT 에서) |
| F04 | 통과 | release zip 검사: `sb_secret`/localhost URL 없음, host_permissions 빈 배열, dev 로그인 UI 미포함. `service_role` 문자열은 supabase-js SDK 상수 (D-016) |
| F05 | 부분 | db F05: javascript:/data:/file:/chrome: → INVALID_URL, 폴더 URL → INVALID_OPERATION, HTML 제목은 텍스트 저장. UI 렌더는 React 텍스트(코드), 악성 제목 화면 스크린샷 없음 |
| F06 | 부분 | `pnpm zip` 생성·checksum·manifest 확인. 백엔드 없는 빌드라 zip 설치 후 동기화 동작은 dev 빌드로만 확인 |
| F07 | 부분 | e2e-sync A06: 계정 전환 후 이전 계정 변경 미전송·미적용. "늦게 도착한 응답" 자체는 epoch 검사 코드만 |
| U01 | 통과 | shots: popup/app 밝음·어둠(Chromium·Aside). 16px 아이콘은 단색 임시 자산(교체 대상) |
| U02 | __U02__ | e2e-rec U02: 키보드만으로 설정 탐색·토글, 200% 확대에서 버튼 잘림 없음(`app-chromium-*-200pct.png`) |
| U03 | 부분 | offline 팝업 문구 확인(`popup-chromium-offline.png`), conflict/review/paused 상태는 getState 로 확인. recovery 문구 스크린샷 없음 |
| U04 | 통과 | 팝업은 열 때마다 worker 상태를 읽음(useWorkerState); e2e 스크린샷 시점 상태와 일치 |
| U05 | 통과 | e2e-sync B02: 원격 공유 폴더 선택 ↔ 로컬 폴더 구분, 이름 같아도 자동 연결 없음 |
| U06 | 부분 | e2e-sync: 방향별 수치 정확(B01/B02), 계획 변경 시 REPLAN. 백업 실패 시 적용 차단은 코드(`commitPlan` BACKUP_FAILED)만 |
| U07 | 부분 | 로그인·장치 등록·binding 은 영속. 미리보기 계획은 worker 메모리에만 있어 탭/worker 종료 시 다시 미리보기(중복 업로드 없음). 첫 적용 "일시 정지" 버튼은 v1 UI 에 없음(진행은 단일 실행) |
| U08 | __U08__ | e2e-rec U08 |
| U09 | __U09__ | e2e-rec U09 |
| U10 | 통과 | unit status.test.ts: 우선순위·worker 연결 전 checking·전부/일부 정지 |
| U11 | 부분 | e2e-sync E03: 승인 전 전파/적용 없음. Escape/뒤로 UI 조작은 ReviewDetail 코드(Escape → 목록) 만 |
| U12 | 부분 | 문구가 "이 브라우저는 최신 상태예요"로 범위 한정, 상대 적용 완료 주장 없음(popup 스크린샷). 상대 종료 시나리오 실행 없음 |
| U13 | 통과 | 임시 아이콘 스크립트 생성(`PLACEHOLDER_ICONS.md`), 기존 시안 미사용, 토큰은 중립 색 |
| P01 | __P01__ | e2e-rec P01 (raw/p01-1k.json). 10k 는 미측정 |
| P02 | __P02__ | e2e-p02 (raw/p02-idle.json) |
| R01 | 통과 | raw/r01-latency.json: A→B p50 261/p95 263 ms, B→A p50 263/p95 266 ms (각 30회), 목표 3 s 이내 |
| R02 | 부분 | 60회 중 신호 유실 0. 유실·중복·순서 역전 주입 테스트 없음(cursor 기반 수렴은 db 페이지 테스트) |
| R03 | __R03__ | e2e-rec R03 |
| R04 | 통과 | db R04: 타 계정 구독 거부, client 발행 미전달, 서버 알림 payload `{type:'changed'}` 만 |
| R05 | 부분 | db A04: 철회 즉시 모든 데이터 RPC 차단. 열린 채널의 즉시 종료는 미보장(SECURITY.md 에 문서화) |
| R06 | 미검증 | RealtimeLink backoff+jitter 재접속·주기 alarm 보조 경로(코드). 연결 한도 초과 주입 없음 |

## 집계

__SUMMARY__

## 실행한 명령과 결과 (요약)

| 명령 | 결과 |
|---|---|
| `pnpm --filter shatsu-ren-protocol test` | 5 통과 |
| `pnpm --filter shatsu-ren-extension test` | 23 통과 (reconcile 19 + status 4) |
| `supabase test db` | 9 통과 (digest vector SQL=TS, grants) |
| `pnpm --filter shatsu-ren-tests test:db` | 24 통과 |
| `vitest run --dir e2e smoke` | 2 통과 (Chromium, Aside) |
| `vitest run --dir e2e sync` | 13 통과 |
| `vitest run --dir e2e recovery` | __REC__ |
| `vitest run --dir e2e p02-idle` | __P02SHORT__ |
| `pnpm build` / `pnpm zip` | `apps/extension/.output/shatsu-ren-0.1.0-chrome.zip` + `.sha256` |
| delete-account edge function (curl) | 403/401/403/200 (위 F02/F03) |

## 구현 중 발견·수정한 결함

1. 루트 `package.json` 의 `install` script 가 pnpm lifecycle 과 재귀 → `setup` 으로 변경.
2. 최초 업로드 시 같은 실행에서 생성되는 형제를 anchor 로 쓰지 않아 서버 순서가 뒤집힘 → anchor 규칙 수정(D-011 근처, reconcile.prevSyncedSibling).
3. 추가 브라우저 병합에서 아직 로컬에 없는 원격 자식이 있는 폴더의 순서를 합의 처리해 이후 정렬 누락 → 원격 자식이 모두 mapping 될 때까지 순서 판단 보류.
4. 공유 폴더 생성이 headSeq 를 올려 계획 REPLAN → 생성 후 계획 headSeq 갱신.
5. Realtime 채널 재구독 실패 시 재시도 없음 → backoff 재접속·ensureRealtime 재생성.
6. 오프라인에서 pull 실패 시 outbox 미기록 → 오프라인에도 reconcile 실행(D-012).
7. 변경 내역의 상대 장치 이름 미표시 → 장치 목록 지연 조회.

## 남은 외부 차단 목록

1. Google OAuth client(동의 화면·client id/secret) — A08/A09, 실제 Google 로그인 검증.
2. 운영 Supabase 프로젝트(유료 여부 결정) — 운영 배포·Realtime 한도·백업 훈련.
3. Google Chrome 154 에서의 수동 "압축해제된 확장 로드" 확인(사용자 조작).
4. 스토어 제출(개발자 계정·심사) 및 최종 아이콘·브랜드 자산.
5. GitHub 푸시(로컬 커밋만 준비, 사용자 승인 후).
