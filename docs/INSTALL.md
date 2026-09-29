# 설치·개발 환경 (INSTALL)

## 1. 로컬 개발 환경

| 도구 | 확인된 버전 (2026-09-29) |
|---|---|
| macOS | 26.6.2 |
| Node / pnpm | 24.21.0 / 12.6.0 |
| Docker 런타임 | colima 0.x + docker CLI (brew). Docker Desktop 도 가능 |
| Supabase CLI | 2.118.0 (`brew install supabase/tap/supabase`) |
| psql | libpq 17 (`brew install libpq`, 테스트 헬퍼가 `/opt/homebrew/opt/libpq/bin/psql` 사용) |
| Chromium | Playwright 1.63 번들 (Chrome 153) |
| Aside | 1.0.928.1 (`/Applications/Aside.app`) |

```bash
pnpm setup                       # 의존성 (lockfile 고정)
colima start --cpu 4 --memory 6  # Docker Desktop 이 없을 때
supabase start                   # 첫 실행은 이미지 다운로드로 수 분
pnpm --filter shatsu-ren-protocol test
pnpm --filter shatsu-ren-extension test
pnpm test:db                                   # pgTAP
pnpm --filter shatsu-ren-tests test:db         # RPC 통합
```

`supabase start` 가 출력하는 `API_URL`·`ANON_KEY` 를 `apps/extension/.env.development` 에 둔다(예시는 `.env.example`). 로컬 키는 공개된 데모 키이며 비밀이 아니다.

## 2. 확장 빌드 종류

| 명령 | 출력 | 백엔드 | 로컬 테스트 로그인 |
|---|---|---|---|
| `pnpm --filter shatsu-ren-extension build:dev-auth` | `.output/chrome-mv3-dev` | `.env.development` 의 로컬 Supabase | 포함 (`SHATSU_DEV_AUTH=1`) |
| `pnpm build` | `.output/chrome-mv3` | `WXT_SUPABASE_URL`/`WXT_SUPABASE_ANON_KEY` 환경변수, 없으면 없음 | 제거 |
| `pnpm zip` | `.output/shatsu-ren-<ver>-chrome.zip` + `.sha256` | 위와 같음 | 제거 |

## 3. 브라우저에 로드

1. `chrome://extensions` (Aside 도 같은 주소) → 개발자 모드 켜기 → **압축해제된 확장 프로그램을 로드** → 빌드 폴더 선택.
2. 툴바 아이콘(단색 임시 아이콘) 클릭 → 팝업 → **연결 시작** → 전체 탭 온보딩.
3. 개발 빌드: **로컬 테스트 로그인** 에 합성 이메일(`synthetic-*@example.com`)과 임의 비밀번호를 넣으면 로컬 Supabase 에 계정이 만들어진다. 두 번째 브라우저에서 같은 이메일/비밀번호로 로그인하면 같은 보관함이다.
4. 폴더 선택 → 변경 확인 → 확인하고 연결.

Google Chrome 137 이상은 `--load-extension` 명령행 플래그를 무시한다(2026-09-29 Chrome 154 에서 확인). 수동 로드는 된다. 자동 E2E 는 Playwright Chromium 을 쓴다.

## 4. Google 로그인 (미검증 — 자격 증명 필요)

1. Google Cloud OAuth 동의 화면·웹 클라이언트 생성. 허용 redirect = Supabase Auth callback `https://<project>.supabase.co/auth/v1/callback` (로컬: `http://127.0.0.1:54321/auth/v1/callback`).
2. Supabase Google provider 에 client id/secret 등록. 로컬은 `SHATSU_GOOGLE_CLIENT_ID`/`SHATSU_GOOGLE_CLIENT_SECRET` 환경변수 + `supabase/config.toml` 의 `[auth.external.google] enabled = true`.
3. 확장이 쓰는 복귀 URL 은 `chrome.identity.getRedirectURL('auth')` = `https://<확장ID>.chromiumapp.org/auth`. 각 브라우저·빌드(개발/스토어)의 확장 ID 마다 Supabase **Redirect URLs** 에 등록한다(로컬 config 는 `https://*.chromiumapp.org/*` 허용).
4. 흐름: `signInWithOAuth(google, skipBrowserRedirect)` → `identity.launchWebAuthFlow` → `exchangeCodeForSession(code)` (`apps/extension/src/auth/session.ts`). Aside 에서의 실제 왕복은 검증되지 않았다.

## 5. E2E

```bash
pnpm --filter shatsu-ren-extension build:dev-auth
pnpm --filter shatsu-ren-tests exec playwright install chromium   # 최초 1회
pnpm test:e2e            # e2e/smoke, sync, recovery (각각 Chromium+Aside 실제 실행, 임시 프로필)
P02_IDLE_MIN=31 pnpm --filter shatsu-ren-tests exec vitest run --dir e2e p02-idle   # 장시간 유휴
```

테스트는 사용자 실제 브라우저 프로필을 건드리지 않고(`user-data-dir` 임시), 합성 계정·`example.com` 북마크만 쓴다.
