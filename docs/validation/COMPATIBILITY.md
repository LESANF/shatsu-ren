# 호환성 (COMPATIBILITY) — 2026-09-29 실측

| 항목 | 값 | 확인 방법 |
|---|---|---|
| OS | macOS 26.6.2 (Darwin 25.6.0) | `sw_vers` |
| Aside | 1.0.928.1 (`at.studio.AsideBrowser`, UA Chrome/153.0.0.0) | Info.plist, E2E UA 기록 |
| Chromium (자동 테스트) | Playwright 1.63 번들 Chromium 153.0.8010.12 | `playwright install chromium` |
| Google Chrome | 154.0.8037.58 — **자동 로드 불가**, 수동 로드 절차만 제공 | `--load-extension` 으로 실행 시 확장 worker 미기동(내장 component 확장만 보임) |
| Supabase | CLI 2.118.0 · postgres 17.6.1.171 · Realtime/PostgREST 로컬 이미지 | `supabase start` |
| Node / pnpm | 24.21.0 / 12.6.0 | |
| 확장 | shatsu-ren 0.1.0, MV3, WXT 0.21.4, supabase-js 2.117.2 | manifest |
| Windows / Linux | 미검증 | — |

## Aside 에서 확인된 MV3 동작 (청사진 3.2)

| 항목 | 결과 | 근거 |
|---|---|---|
| service worker 기동·메시지 | 통과 | e2e/smoke |
| bookmarks getTree/getSubTree/create/update/move/remove/removeTree/search | 통과 | e2e/sync (Aside 측 B) |
| onCreated/onChanged/onMoved/onRemoved 이벤트 → 동기화 트리거 | 통과 | e2e/sync (B→A 전파 30회) |
| onChildrenReordered | 등록됨(존재 시). 별도 검증 없음 — 순서 변경은 onMoved 로 관찰됨 | background.ts |
| alarms (5분 주기, retry) | 등록·재기동 후 존재 확인 | e2e/recovery R03 |
| storage.local (세션·설정) | 통과 | 재시작 후 로그인 유지 (e2e/sync D03) |
| IndexedDB (scoped DB) | 통과 | 재시작 후 binding 유지 |
| WebSocket(Realtime) 구독·수신 | 통과 | 실시간 전파 p95 0.27s; 30분 유휴 결과는 PERFORMANCE.md |
| identity.launchWebAuthFlow / Google OAuth 왕복 | **미검증** | Google OAuth 자격 증명 없음 |
| import 시작/종료 이벤트 | onImportEnded 등록만, 미검증 | |
| 릴리스 ZIP 설치 | ZIP 생성·manifest·secret 검사 통과. 백엔드 없는 빌드라 동기화 동작은 dev 빌드로만 확인 | F04/F06 |

## Google Chrome 수동 로드 절차

1. `pnpm --filter shatsu-ren-extension build:dev-auth`
2. Chrome `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `apps/extension/.output/chrome-mv3-dev`
3. 팝업 → 연결 시작 → 로컬 테스트 로그인. 이 절차는 사용자 조작이 필요해 이 세션에서 자동 실행하지 않았다.

Chrome 내장 북마크 동기화(Google 계정 sync)와의 동시 사용은 검증하지 않았다. 두 Chrome 프로필이 내장 sync 를 켠 조합에서 반향·중복 후보가 생길 수 있으므로 연결 범위를 좁히기를 권한다.
