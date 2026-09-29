# 성능 (PERFORMANCE) — 2026-09-29 실측, 로컬 Supabase (동일 머신)

측정 환경: macOS 26.6.2, Playwright Chromium 153 (A) ↔ Aside 1.0.928.1 (B), Supabase 로컬 스택(colima), 확장 dev 빌드. 네트워크 왕복은 localhost 이므로 운영 환경(원격 Supabase)에서는 RPC 왕복만큼 늘어난다. 보장이 아니라 측정값이다.

## R01 — 단일 생성 전파 지연 (raw: `raw/r01-latency.json`)

측정 방법: 한쪽에서 `chrome.bookmarks.create` 호출 시각부터 상대 브라우저 `chrome.bookmarks.search` 에 같은 URL 이 연결 폴더 아래에 나타날 때까지(폴링 50 ms). 각 방향 30회.

| 방향 | n | p50 | p95 | max |
|---|---|---|---|---|
| A→B (Chromium→Aside) | 30 | 261 ms | 263 ms | 269 ms |
| B→A (Aside→Chromium) | 30 | 263 ms | 266 ms | 270 ms |

실시간 신호 유실 후 보조 경로 복구 횟수: 0 / 60. 목표(p95 3초 이하) 충족. 지연의 대부분은 확장의 이벤트 병합 대기(200 ms) + RPC 2회(apply, changes) 이다.

## P01 — 1,000 항목 (raw: `raw/p01-1k.json`)

__P01_PLACEHOLDER__

10,000 항목은 브라우저 실행으로 측정하지 않았다(청사진 목표 한도 `maxActiveNodes=10000` 은 SQL 에서 강제되며, 초과 시 `LIMIT_EXCEEDED`). 별도 작업으로 남긴다.

## P02 — 30분 유휴 후 즉시 전달 (raw: `raw/p02-idle.json`)

__P02_PLACEHOLDER__

## 서버 측 (tests/db)

- 장치당 분당 쓰기 120회 한도: 121번째 호출에서 `RATE_LIMITED` + `retryAfterSeconds` 확인.
- changes 페이지: `p_limit` 로 분할, `hasMore`/`nextCursor` 일관, 32 MiB 응답 한도는 코드 경로만 존재(실측 미수행).
