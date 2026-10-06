# shatsu-ren (샤츠렌)

**브라우저는 바꿔 써도, 북마크는 함께.**

크롬·어사이드(Aside) 같은 Chromium 계열 브라우저 사이에서, 그리고 여러 컴퓨터 사이에서 북마크 폴더를 자동으로 맞춰 주는 Manifest V3 확장 프로그램입니다. Google 계정으로 로그인하고, 서버는 Supabase(무료 플랜)를 씁니다.

북마크는 계속 브라우저 기본 북마크 관리자(북마크바, `⌘⇧O`)에서 평소처럼 편집합니다. 확장은 **사용자가 "서버 북마크"로 올리거나 받은 폴더만** 동기화하고, 그 밖의 북마크는 건드리지 않습니다.

> **현재 상태 (2026-10-06, v0.1.4)**
> - 개인 사용 단계입니다. 스토어에는 올리지 않았고, 압축을 푼 폴더를 직접 로드해서 씁니다.
> - 클라우드 Supabase 무료 프로젝트(서울 리전, Google 로그인만 허용)에서 크롬과 어사이드 사이의 실제 동기화를 확인했습니다.
> - 자동 테스트는 로컬 Supabase와 실제 브라우저(Playwright Chromium, Aside)로 돌립니다. 결과는 [검증 현황](#검증-현황)에 있습니다.

---

## 목차

1. [핵심 개념: 서버 북마크](#핵심-개념-서버-북마크)
2. [사용법](#사용법)
3. [동기화는 언제, 어떻게 일어나나](#동기화는-언제-어떻게-일어나나)
4. [충돌·삭제·복구](#충돌삭제복구)
5. [설정](#설정)
6. [하지 않는 일과 한계](#하지-않는-일과-한계)
7. [설치](#설치)
8. [개발](#개발)
9. [구조](#구조)
10. [보안과 개인정보](#보안과-개인정보)
11. [비용](#비용)
12. [검증 현황](#검증-현황)
13. [문서](#문서)

---

## 핵심 개념: 서버 북마크

**서버 북마크**(코드에서는 `collection`)는 이름이 붙은 북마크 묶음 하나입니다. 계정 하나에 여러 개를 둘 수 있습니다.

| 동작 | 설명 |
|---|---|
| **올리기** | 이 브라우저의 아무 폴더나 골라 **이름을 붙여** 서버에 올립니다(예: "테스트1"). 이름은 계정 안에서 겹칠 수 없습니다. 앞뒤 공백과 대소문자는 무시해서 비교하고, 겹치면 `DUPLICATE_TITLE`로 거부합니다. |
| **받기** | 다른 브라우저에서 그 서버 북마크를 골라 받으면, **북마크바 맨 앞**에 같은 이름의 폴더가 생기고 연결됩니다. 북마크바 맨 위에 이미 같은 이름의 연결 안 된 폴더가 있으면 새로 만들지 않고 그 폴더에 합칩니다. |
| **연결(동기화)** | 연결된 폴더는 그때부터 **양방향 자동 동기화**됩니다. 추가·수정·이동·순서 변경·삭제가 모두 따라갑니다. |

### 올릴 때의 선택지: "이 브라우저에도 북마크바 맨 앞에 동기화 폴더 만들기"

- **켬 (기본값):** 고른 폴더를 **복사**해 북마크바 맨 앞에 새 동기화 폴더를 만들고, 그 복사본을 연결합니다. 원래 폴더는 그대로 두고 연결하지 않습니다. 모든 브라우저가 "북마크바 맨 앞의 같은 이름 폴더"를 기준으로 맞춰지므로 헷갈리지 않습니다.
- **끔:** 고른 폴더 자체를 그 자리에서 연결합니다.

### 한 브라우저에서 같은 서버 북마크는 한 번만

이미 이 브라우저에 연결된 서버 북마크는 다시 받을 수 없습니다(`ALREADY_BOUND`). 같은 폴더가 둘 생기는 것을 막기 위해서입니다.

---

## 사용법

### 처음 쓰는 브라우저 (예: 크롬)

1. 확장 아이콘을 누르고 **Google로 로그인**합니다. 샤츠렌 계정은 Google 계정과 1:1이며, 처음 로그인하면 자동으로 가입됩니다.
2. **올리기·받기 → "이 브라우저의 폴더 올리기"** 탭으로 갑니다.
3. 폴더 트리에서 올릴 폴더를 고르고 이름을 입력합니다. 이름이 겹치면 입력 칸에서 바로 알려 줍니다.
4. 미리보기에서 무엇이 어디로 가는지 확인하고 적용합니다. 적용하기 전에 로컬 백업을 자동으로 남깁니다.

### 다른 브라우저 (예: 어사이드, 다른 맥북)

1. 같은 Google 계정으로 로그인합니다.
2. **올리기·받기 → "서버에서 받기"** 탭에서 서버 북마크 목록을 봅니다. 목록에는 만든 브라우저, 만든 시각, 항목 수가 같이 나옵니다.
3. **[받기]**를 누르면 북마크바 맨 앞에 같은 이름의 폴더가 생기고 연결됩니다.

### 서버 북마크 관리 (올리기·받기 → "서버에서 받기" 목록)

| 버튼 | 동작 |
|---|---|
| **이름 바꾸기** | 서버 이름을 바꿉니다. 연결된 각 브라우저의 폴더는 **예전 이름 그대로일 때만** 새 이름으로 따라 바뀝니다. 직접 다른 이름을 붙여 둔 폴더는 그대로 둡니다. |
| **삭제** | 서버에서 그 서버 북마크를 통째로 지웁니다. 모든 브라우저에서 **연결만 끊기고, 각 브라우저의 폴더와 북마크는 그대로 남습니다.** 서버 쪽은 휴지통 항목까지 같이 지워져 되돌릴 수 없습니다. |

### 폴더 화면 (연결된 폴더별)

| 버튼 | 동작 |
|---|---|
| **일시 정지 / 재개** | 그 폴더만 동기화를 멈추거나 다시 켭니다. |
| **연결 해제** | 연결만 끊습니다. 북마크는 지우지 않습니다. 브라우저에서 폴더를 먼저 지웠어도 해제할 수 있습니다. |
| **서버 버전으로 되돌리기** | 로컬 폴더를 백업한 뒤 지우고, 같은 자리에 서버 내용을 다시 받습니다. 아직 올라가지 않은 로컬 변경은 사라집니다(백업에는 남음). |

### 팝업

- 현재 상태를 보여 줍니다(최신 / 보낼 변경 n개 / 확인할 변경 / 오프라인 / 재로그인 필요 등).
- 최근 변경 5개를 보여 줍니다.
- **"서버와 비교해 갱신"** 버튼으로 바로 동기화합니다. 바뀐 게 없으면 "서버 북마크와 같아요 · 갱신할 변경 없음"이라고 나옵니다.

---

## 동기화는 언제, 어떻게 일어나나

| 계기 | 언제 | 서버 비용 |
|---|---|---|
| **북마크 이벤트** | 연결된 폴더에서 추가·수정·이동·삭제가 일어나면 200ms 뒤 실행(여러 이벤트를 묶음) | 바뀐 것만 전송 |
| **실시간(Realtime)** | 다른 브라우저가 서버에 반영하면 비공개 채널 `workspace:<id>`로 `{type:"changed"}` 신호가 옴 → 받아서 갱신. 로컬에서 약 0.3초(p95) | 신호만 오고 내용은 RPC로 가져옴 |
| **실시간 연결 점검** | 5분마다 소켓이 살아 있는지만 확인하고, 끊겼으면 다시 구독한 뒤 한 번 따라잡기 | 끊겼을 때만 호출 |
| **주기 확인** | 기본 **4시간**(설정에서 5분 / 30분 / 4시간) | 4시간에 한 번 |
| **수동** | 팝업의 "서버와 비교해 갱신" | 누를 때만 |
| **브라우저 시작** | 확장이 깨어날 때 한 번 | 한 번 |

- **브라우저가 꺼져 있거나 컴퓨터가 잠들어 있으면 아무것도 돌지 않습니다.** 다시 켜지면 서버의 변경 기록(commit log)을 이어서 받아 따라잡습니다. 변경 기록은 30일 보관이 원칙이고, 보관 범위를 벗어날 만큼 오래 꺼져 있었으면 전체 스냅샷으로 다시 맞춥니다. 30일 지난 기록·휴지통을 지우는 `shatsu.purge_expired()`는 아직 자동 예약(cron)하지 않아서 지금은 쌓이기만 합니다([docs/OPERATIONS.md](./docs/OPERATIONS.md)).
- MV3 백그라운드(service worker)는 브라우저가 쉬면 잠들 수 있습니다. 잠든 동안 실시간 신호를 놓쳐도 다음 5분 점검 때 깨어나 따라잡습니다. 그래서 최악에는 몇 분 늦게 도착할 수 있습니다.

### 맞추는 원리 (3-way)

브라우저는 항목마다 **마지막으로 서로 합의한 상태(base)**를 기억합니다. 이것을 **지금 브라우저 상태(local)**, **서버 상태(shadow)**와 비교합니다.

| local | server | 결과 |
|---|---|---|
| 바뀜 | 그대로 | 서버로 보냄 |
| 그대로 | 바뀜 | 브라우저에 적용 |
| 바뀜 | 바뀜(다르게) | **충돌** — 조용히 덮어쓰지 않고 사용자에게 물음 |
| 바뀜 | 바뀜(같게) | 합의로 기록 |

- 모든 변경은 고유한 `opId`를 가진 **작업(operation)**으로 서버에 갑니다. 서버(Postgres 함수)는 계정별 잠금 아래 하나씩 적용하고, 커밋마다 순번 `seq`를 매깁니다. 같은 작업을 다시 보내도 결과가 같아서(멱등), 네트워크가 끊겼다가 재시도해도 중복되지 않습니다.
- 원격 변경을 브라우저에 적용하기 전에는 journal을 먼저 기록합니다. 그래서 적용 도중 브라우저가 꺼져도 다음 실행에서 이어서 처리하거나 복구 상태로 표시합니다.
- 원격 변경을 적용하는 몇 초 사이에 사용자가 같은 항목을 고쳤으면, 덮어쓰지 않고 건너뛴 뒤 다음 실행에서 다시 판단합니다.
- **연결된 폴더 A에서 연결된 폴더 B로 옮기면** A에서는 삭제로, B에서는 새 항목으로 처리합니다. 다른 브라우저에서도 옮겨질 뿐 중복되지 않습니다. 연결되지 않은 곳으로 옮기면 "범위 밖 이동"으로 따로 확인합니다.

---

## 충돌·삭제·복구

### 삭제

- **삭제는 추가와 똑같이, 확인 없이 따라갑니다.** 여러 개를 한꺼번에 지워도 마찬가지이고, 보내는 쪽과 받는 쪽 모두 같습니다.
- 지운 것은 **서버 휴지통에 30일** 남아서 되살릴 수 있습니다(설정 → 휴지통).
- 받는 쪽에서 원격 삭제를 적용하기 전에는 로컬 백업을 한 번 남깁니다(실행당 1회).
- 예외가 하나 있습니다. **폴더를 지우는 사이, 다른 브라우저가 그 폴더 안 항목을 고치거나 새로 넣었는데 아직 이쪽에 반영되지 않았다면** 그 변경까지 조용히 지우지 않습니다. 이때는 충돌로 묻습니다("여기서 삭제한 항목을 다른 브라우저에서 수정했어요").
- 서버는 폴더를 지울 때 그 아래 전체의 SHA-256 digest를 검사합니다. 그래서 동시에 안쪽이 바뀌었으면 삭제가 거부되고, 다시 판단하게 됩니다.

### 충돌 종류와 선택지

| 종류 | 선택지 |
|---|---|
| 같은 항목을 양쪽에서 다르게 수정 | 내 변경 / 서버 변경 / 둘 다 보관 |
| 여기서 수정, 다른 곳에서 삭제 | 수정본 살리기 / 삭제 따르기 |
| 여기서 삭제, 다른 곳에서 수정 | 내 삭제 유지 / 서버 것 되살리기 |
| 폴더 순서를 양쪽에서 다르게 바꿈 | 내 순서 / 서버 순서 |

충돌이 열린 항목(과 그 아래)은 결정할 때까지 보류됩니다. 나머지 항목은 계속 동기화됩니다.

### 복구 수단

| 수단 | 범위 |
|---|---|
| 서버 휴지통 | 삭제된 항목·폴더, 30일 |
| 로컬 백업 | 최초 연결, 원격 삭제 적용, 연결 해제, 되돌리기 직전에 자동 생성. 최근 5개(최대 100MB) |
| JSON 내보내기·가져오기 | 수동 |
| 서버 버전으로 되돌리기 | 연결 폴더를 서버 내용으로 다시 받기 |

---

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| 자동 동기화 | 켬 | 끄면 수동 갱신만 합니다 |
| 실시간 연결 | 켬 | 끄면 주기 확인과 수동 갱신만 합니다 |
| 주기 확인 간격 | 4시간 | 5분 / 30분 / 4시간 |
| 언어 | 자동 | 한국어 / English |
| 테마 | 자동 | 밝게 / 어둡게 |
| 기기 이름 | 브라우저 이름 | 변경 내역과 "만든 브라우저" 표시에 쓰입니다 |

v0.1.3 이하에서 설정을 한 번이라도 저장했다면 예전 기본값 5분이 저장되어 있습니다. 설정 화면에서 4시간으로 바꾸세요.

또한 장치 목록에서 다른 브라우저의 접근을 끊을 수 있습니다(철회). 철회된 장치는 바로 읽기와 쓰기가 막힙니다.

---

## 하지 않는 일과 한계

- **종단 간 암호화(E2EE)는 없습니다.** 서버(Supabase 프로젝트 운영자)는 제목, URL, 폴더 구조를 볼 수 있습니다. 다른 회원은 볼 수 없습니다. 모든 데이터는 계정별로 분리되고, RPC가 매번 본인 계정인지 확인합니다.
- 로그인은 Google만 지원합니다. Firefox, Safari, 모바일은 지원하지 않습니다.
- 동기화 대상 URL은 `http`·`https`만입니다. `javascript:`, `chrome://`, `file://` 등은 로컬에만 두고 올리지 않습니다.
- 서버 한도는 계정당 서버 북마크 50개, 살아 있는 항목 1만 개, 폴더 깊이 32, 제목 4KB, URL 16KB, 장치당 쓰기 분당 120회입니다. **한도를 넘는 항목은 그 항목만 올리지 않고 보류하며, 나머지 동기화는 계속됩니다.**
- 연결 폴더 자체(루트)의 이름은 동기화하지 않습니다. 서버 이름을 바꾸려면 "이름 바꾸기"를 쓰세요.
- 관리형(정책으로 잠긴) 폴더는 연결할 수 없습니다. 이미 연결된 폴더 안에 다른 연결을 중첩할 수도 없습니다.
- 공개 서비스용 장치(악용 한도, 약관·동의, 개인정보처리방침 URL, 스토어 심사, 구독 결제)는 개인 사용 단계라 보류했습니다.

---

## 설치

### A. 배포 빌드 사용 (클라우드 서버, 권장)

빌드는 비공개 저장소 [LESANF/shatsu-ren-builds](https://github.com/LESANF/shatsu-ren-builds/releases)의 릴리스에 있습니다.

1. 최신 릴리스에서 `cloud.zip`을 받아 원하는 곳에 압축을 풉니다. 이 폴더는 지우지 마세요. 확장이 이 폴더를 계속 참조합니다.
2. 확장 관리 화면을 엽니다.
   - 크롬: `chrome://extensions`
   - 어사이드: 주소창에 `chrome://extensions` 입력(또는 메뉴 → 확장 프로그램)
3. 오른쪽 위 **개발자 모드**를 켭니다. 압축 해제 확장은 개발자 모드에서만 로드할 수 있습니다.
4. **압축해제된 확장 프로그램을 로드**를 눌러 그 폴더를 고릅니다.
5. 업데이트할 때는 새 zip을 같은 폴더에 덮어쓰고 확장 카드의 **새로고침(↻)**을 누릅니다. 로그인과 연결은 유지됩니다.

압축 해제 확장을 쓰는 데 비용은 들지 않습니다. Chrome 웹 스토어에 공개 등록하려면 개발자 등록비 1회 5달러가 듭니다(아직 하지 않음).

### B. 직접 빌드

준비물: Node 22 이상, pnpm 12.

```bash
git clone https://github.com/LESANF/shatsu-ren.git   # 비공개 저장소
cd shatsu-ren
pnpm setup                                          # = pnpm install --frozen-lockfile

# 클라우드 서버용 빌드 (URL·publishable 키는 공개해도 되는 값)
cd apps/extension
WXT_SUPABASE_URL=https://<project-ref>.supabase.co \
WXT_SUPABASE_ANON_KEY=<publishable key> \
pnpm exec wxt build
# → apps/extension/.output/chrome-mv3   (저장소 루트의 build-cloud/ 로 복사해 두고 쓰는 중, git 제외)
```

`WXT_SUPABASE_*` 없이 빌드하면 서버가 들어가지 않은 빌드가 됩니다. 이 경우 **설정 → 고급**에서 자기 Supabase 프로젝트를 연결할 수 있습니다([docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md)).

### C. 자기 Supabase 프로젝트 만들기

1. Supabase에서 새 프로젝트를 만듭니다(Free 플랜이면 충분).
2. `supabase/migrations/` 아래 SQL을 **파일 이름 순서대로** 적용합니다. CLI의 `supabase db push`를 쓰거나 대시보드 SQL Editor에 붙여 넣으면 됩니다.

   | 파일 | 내용 |
   |---|---|
   | `20260929000000_shatsu_core.sql` | 스키마, 테이블, RPC, 권한 |
   | `20260930000000_server_safety.sql` | 입력 검증, 깊이 제한, 철회된 세션 차단 |
   | `20261001000000_collection_meta.sql` | 만든 장치·시각, 이름 중복 금지 |
   | `20261006000000_delete_collection.sql` | 서버 북마크 삭제 RPC |

3. Authentication → Providers에서 **Google만 켜고**, Email과 Anonymous는 끕니다. Google OAuth 클라이언트의 승인된 리디렉션 URI에는 `https://<project-ref>.supabase.co/auth/v1/callback`을 넣습니다. 확장의 리디렉션 URL(`https://<extension-id>.chromiumapp.org/`)은 Supabase Auth → URL Configuration의 Redirect URLs에 추가합니다.
4. 계정 삭제를 쓰려면 Edge Function `supabase/functions/delete-account`를 배포합니다.

**비밀값 취급**
- service_role(secret) 키, DB 비밀번호, Google client secret은 확장, 저장소, 채팅, 스크린샷 어디에도 넣지 않습니다.
- 로컬 개발용 Google 자격 증명은 git에서 제외된 `supabase/.env`에만 둡니다.
- 확장에 들어가는 것은 Project URL과 publishable 키뿐입니다.

---

## 개발

### 로컬 서버 띄우기 (테스트할 때만)

```bash
colima start --cpu 4 --memory 6      # 또는 Docker Desktop
supabase start                       # 로컬 Auth + Postgres + Realtime, migrations 자동 적용
# ... 테스트 ...
supabase stop --no-backup && colima stop   # 로컬 데이터 버림
```

개발용 빌드는 로컬 서버(`http://127.0.0.1:54321`, `.env.development`)를 바라봅니다. 합성 계정용 **"로컬 테스트 로그인"**(이메일+비밀번호) 폼이 들어가며, 배포 빌드에서는 빠집니다.

```bash
pnpm --filter shatsu-ren-extension build:dev-auth   # → apps/extension/.output/chrome-mv3-dev
```

### 명령

| 명령 | 내용 |
|---|---|
| `pnpm typecheck` | TypeScript strict |
| `pnpm lint` | prettier 검사 |
| `pnpm test` | 순수 로직 테스트: 프로토콜 digest 벡터, 3-way reconcile, 상태 계산, 감사 회귀 |
| `pnpm test:db` | pgTAP: digest 벡터, 함수 권한 |
| `pnpm --filter shatsu-ren-tests test:db` | 실제 Auth 세션·PostgREST·Realtime으로 RPC 통합 테스트 |
| `pnpm --filter shatsu-ren-tests exec vitest run --dir audit` | 서버 안전성·브라우저 감사 시나리오 |
| `pnpm test:e2e` | Playwright Chromium ↔ 실제 Aside 종단 테스트(로컬 서버, dev-auth 빌드 필요) |
| `pnpm build` / `pnpm zip` | 배포 빌드 / 릴리스 ZIP |

### E2E 테스트 참고

- Google Chrome 137 이상은 `--load-extension`을 무시합니다. 그래서 자동 테스트는 **Playwright Chromium**과 **실제 Aside 바이너리**(`/Applications/Aside.app/Contents/MacOS/Aside`)를 임시 프로필로 띄워서 합니다.
- Aside에는 내장 확장이 여럿 있고, 그 worker도 이름이 `background.js`입니다. 그래서 manifest 이름 `shatsu-ren`으로 우리 worker를 찾습니다.
- 루트 package script 이름을 `install`로 지으면 pnpm lifecycle과 겹쳐 무한 재귀합니다. 그래서 `setup`으로 지었습니다.

---

## 구조

```
apps/extension/            WXT 0.21 + React 19 (MV3)
  entrypoints/             background(worker), popup, app(전체 화면 설정)
  src/service.ts           worker 요청 처리: 상태, 올리기/받기, 연결 관리, 충돌·검토, 휴지통, 백업
  src/sync/engine.ts       동기화 실행 단위: pull → per-folder 3-way → 전송 → 적용 → 영수증 처리
  src/sync/reconcile.ts    순수 3-way 비교 (단위 테스트 대상)
  src/sync/plan.ts         최초 연결 미리보기 계획
  src/sync/realtime.ts     비공개 Realtime 채널, 재접속 backoff
  src/sync/rpc.ts          public.sync_* RPC 클라이언트 (zod 검증)
  src/storage/db.ts        IndexedDB (backend·사용자·workspace 별로 분리)
  src/ui/                  화면 (Onboarding, Folders, Settings, Conflict, Review, History …)
  src/locales/             ko / en
packages/protocol/         타입, zod 스키마, subtree digest, 한도, 테스트 벡터
supabase/
  migrations/              스키마·RPC (위 표)
  tests/                   pgTAP
  functions/delete-account Edge Function
tests/                     RPC 통합, 감사, 브라우저 E2E (Playwright)
docs/                      설계·결정·보고·검증 자료
```

### 서버 데이터 모델 (`shatsu` 스키마, 직접 접근 불가)

| 테이블 | 내용 |
|---|---|
| `workspaces` | 계정당 1개. `head_seq`, `generation_id` |
| `collections` | 서버 북마크. 이름(계정 안에서 유일), 루트 노드, 만든 장치·시각 |
| `devices` | 브라우저 프로필 = Supabase 로그인 세션 1개. 철회 시각 |
| `nodes` | 폴더·북마크. revision, 삭제 표시(tombstone) |
| `folder_orders` | 폴더별 자식 순서와 revision |
| `commits` | 변경 기록(`seq`). 다른 브라우저가 이어서 받는 원본 |
| `operation_receipts` | `opId`별 결과(멱등 재시도) |
| `trash_payloads` | 삭제된 하위 트리, 30일 보관 |

클라이언트는 `public.sync_*` RPC만 부를 수 있습니다. 모두 `SECURITY DEFINER`와 `search_path=''`로 정의했고, `authenticated`에게만 실행 권한을 줍니다.

`sync_register_device`, `sync_info`, `sync_devices`, `sync_revoke_device`, `sync_snapshot`, `sync_changes`, `sync_apply_operation(s)`, `sync_trash`, `sync_delete_collection`

---

## 보안과 개인정보

- **회원 분리:** 모든 테이블에 RLS를 켜고 직접 접근 정책은 두지 않았습니다(= 직접 접근 불가). RPC는 매 호출마다 `auth.uid()` → 내 workspace, 살아 있는 세션, 철회되지 않은 장치인지 확인합니다. 다른 회원의 북마크는 읽을 수도 쓸 수도 없습니다.
- **Realtime:** 비공개 채널이고, 구독 권한은 `shatsu_can_subscribe`가 같은 방식으로 판정합니다. 신호에는 내용이 없습니다(`{type:"changed"}`).
- **입력 검증:** 작업 종류별 필수 필드와 UUID 형식, 한도, 깊이를 서버에서 다시 검사합니다(`validate_operation`).
- **암호화:** 전송 구간은 TLS이고, 저장은 Supabase(AWS) 기본 디스크 암호화입니다. 앱 수준 암호화(E2EE)는 하지 않으므로, 운영자는 내용을 볼 수 있습니다.
- **브라우저 안:** IndexedDB와 `chrome.storage.local`에는 로그인 세션과 동기화 상태가 저장됩니다. 로그아웃하면 정리됩니다.
- 취약점 보고: [SECURITY.md](./SECURITY.md)

---

## 비용

| 항목 | 비용 |
|---|---|
| 압축 해제 확장으로 쓰기 | 무료 |
| Supabase Free | 무료. DB 500MB, 동시 Realtime 200, 월 Realtime 메시지 200만 수준. 개인 사용은 넉넉함. 1주일 동안 요청이 없으면 일시 정지될 수 있음 |
| Chrome 웹 스토어 등록 | 개발자 등록 1회 5달러 (안 함) |
| 공개 서비스 운영 시 | Supabase Pro 월 25달러부터 (안 함) |

수치는 작성 시점 기준이니, 결정하기 전에 Supabase와 Chrome 웹 스토어 공식 가격표를 확인하세요.

---

## 검증 현황

2026-10-06 기준, 로컬 Supabase와 실제 브라우저(Playwright Chromium 153, Aside)에서 확인했습니다.

| 묶음 | 결과 |
|---|---|
| 단위 테스트 (reconcile, 상태, 감사 회귀) | 47 / 47 |
| DB: RPC 통합 + pgTAP | 24 / 24 + 9 / 9 |
| 감사 시나리오 (서버 안전성, 브라우저) | 70 / 70 |
| 브라우저 E2E (올리기·받기·되돌리기, 폴더 간 이동·이름 바꾸기·삭제, 양방향 동기화, 충돌, 복구 등) | 23 / 24 |
| P02 31분 유휴 뒤 즉시 전달 | **미확정.** 유휴 중 Aside worker가 종료되어 테스트 하네스의 핸들이 사라짐(테스트 쪽 한계). 이때 제품은 다음 5분 점검 때 따라잡음 |
| 클라우드 (Chrome ↔ Aside, 실제 Google 로그인) | 올리기·받기·양방향 추가/삭제를 사용자가 직접 확인. v0.1.4의 이름 바꾸기·삭제는 서버 함수만 적용했고, 화면에서 직접 눌러 보는 확인은 아직 |

검증하지 않은 것: Windows/Linux, Google Chrome 자동 테스트(수동 로드만), 대량(수천 개) 실측.

---

## 문서

| 문서 | 내용 |
|---|---|
| [docs/REPORT.md](./docs/REPORT.md) | 구현 보고, 발견·수정한 결함 목록, 남은 이슈 |
| [docs/validation/SERVICE-AUDIT-2026-09-30.md](./docs/validation/SERVICE-AUDIT-2026-09-30.md) | 서비스 전수 감사 |
| [docs/validation/RESULTS.md](./docs/validation/RESULTS.md) | 73개 인수 시나리오 통과·실패·차단과 증거 |
| [docs/BLUEPRINT.md](./docs/BLUEPRINT.md) | 원래 설계 청사진 (이후 정책 변경은 DECISIONS·REPORT 참고) |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 결정과 이탈 기록 |
| [docs/INSTALL.md](./docs/INSTALL.md) · [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md) · [docs/OPERATIONS.md](./docs/OPERATIONS.md) | 설치, 자체 서버, 운영 |

---

## English (short)

shatsu-ren is a personal-use MV3 extension that keeps named bookmark folders ("server bookmarks") in two-way sync across Chromium browsers (Chrome, Aside) and computers, using Google sign-in and a Supabase backend.

- **Upload:** pick a folder and give it a unique name.
- **Download:** in another browser, the same folder appears at the front of the bookmarks bar.
- **Sync:** additions, edits, moves, reorders and deletions then follow automatically. Deletions are recoverable from a 30-day server trash. Concurrent conflicting edits are never resolved silently.
- **Triggers:** realtime signal, a local 5-minute socket check, a poll every 4 hours by default, and a manual button.
- **Not included:** no end-to-end encryption; the server operator can read titles and URLs.

## 라이선스

MIT © 2026 LESANF. 이름과 앞으로 만들 로고는 코드 라이선스에 포함되지 않습니다. 지금 아이콘은 `apps/extension/scripts/make-placeholder-icons.mjs`로 만든 임시 단색 아이콘입니다.
