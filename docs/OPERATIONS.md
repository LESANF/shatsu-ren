# 운영·백업·복원 (OPERATIONS)

## 보존 기본값

| 데이터 | 보존 | 정리 |
|---|---|---|
| commit 로그 | 30일 | `shatsu.purge_expired()` |
| 휴지통 본문(trash_payloads.payload, root_title) | 30일 | 같은 함수. tombstone 의 제목·URL 도 지우고 ID·삭제 상태·revision 은 유지 |
| operation_receipts | 계정 유지 동안 (본문 없음) | 계정 삭제 시 cascade |
| rate_limits | 10분 | 같은 함수 |
| 로컬 백업(IndexedDB) | 최근 5개 / 100 MiB | 확장이 자동 정리 |

`purge_expired` 는 pg_cron 이 있으면 migration 이 매일 03:17 에 스케줄한다(`cron.schedule('shatsu-purge-expired', …)`). 로컬/수동 실행: `select shatsu.purge_expired();` (postgres 또는 service_role). 실패해도 동기화 데이터는 즉시 삭제되지 않는다.

## 백업

- Supabase Pro 는 일일 백업(7일). Free 는 자동 백업이 없으므로 `supabase db dump` 로 별도 보관한다.
- 백업에는 삭제된 북마크(휴지통)와 사용자 데이터가 들어 있다. 접근 제한된 저장소에 두고 토큰을 포함하지 않는다.

## DB 복원 절차 (필수 순서)

1. 쓰기 트래픽 중지(확장은 `WORKSPACE_DELETING`/오류로 대기·백오프).
2. DB 복원.
3. **모든 workspace 의 generation 갱신 + 모든 장치 재인증**: `select shatsu.rotate_generations();`
   - 이전 세대 명령은 `SERVER_GENERATION_CHANGED` 로 거절되고 확장은 자동 쓰기를 멈춘다. 사용자는 개요의 "서버 상태와 다시 비교" 로 snapshot 을 재구성한다(미전송 변경 보존).
   - 철회됐던 장치가 복원으로 되살아나지 않도록 모든 장치를 revoked 로 만들고 재로그인시킨다.
4. 서비스 재개.

## 계정 삭제

Edge Function `delete-account`: 최근 5분 이내 생성된 세션인지 서버가 확인(`auth.sessions.created_at`) → `account_deletion_begin` 으로 workspace 를 deleting 잠금·모든 장치 차단 → `auth.admin.deleteUser` (DB 행은 cascade). 중간 실패는 같은 `requestId` 로 재시도 가능하며 재시도가 북마크 접근 권한을 되살리지 않는다.

## 한도·관찰

RPC 한도는 `shatsu.limits()` 한 곳(활성 node 10,000/보관함, 깊이 32, 제목 4 KiB, URL 16 KiB, 명령 2 MiB, 묶음 100, 응답 32 MiB, 장치당 분당 쓰기 120). 초과는 `LIMIT_EXCEEDED`/`RATE_LIMITED` 로 명시하고 기존 데이터는 유지한다.

관찰 지표: DB 크기, 응답 bytes, 동시 Realtime 연결, 메시지 수, 재접속률. 북마크 본문은 지표로 수집하지 않는다. 사용 한도 70% 경고 / 85% 검토 / 90% 대규모 import 제한.

## 비용 (2026-09-29 확인, 보장 아님)

Supabase Free: DB 500 MB, egress 5 GB, 자동 백업 없음, 비활성 일시 정지. Pro: 월 $25 부터, DB 8 GB, egress 250 GB, 백업 7일. Realtime 동시 연결 기본 한도 Free 200 / Pro 500. 자세한 추정은 `BLUEPRINT.md` §14.
