# shatsu-ren v1 — 실행 프롬프트 겸 제품·기술 청사진

문서 버전: 1.4 / 작성일: 2026-09-29 / 제품명: shatsu-ren(샤츠렌) / 구현 상태: 미구현

사용자 확정: 이름 shatsu-ren, 기존 레포 https://github.com/LESANF/shatsu-ren, MIT 라이선스, 같은 계정으로 연결하는 다중 브라우저·컴퓨터 동기화. 추가 방향: Google 로그인으로 브라우저 계정과 독립적으로 연결하고, 양쪽이 실행 중이면 변경을 곧바로 반영하는 실시간 동기화를 기본으로 한다. 그 외 기술·정책은 아래 추천안이다. 레포는 확인 당시 공개·빈 상태였으나 실행 시 다시 확인한다.

이 문서 전체를 하나의 작업 지시로 받아 실행하라. 문서를 요약하는 것으로 끝내지 말고, 아래 필수 범위를 구현하고 실제 검증하라. 사용자가 설계 검토만 요청한 상황에서는 구현하지 않는다. 상위 시스템 지침과 사용자의 이후 명시적 변경이 우선한다.

---

## 0. 실행 계약

### 0.1 목표

Chrome↔Aside, 여러 컴퓨터의 브라우저 프로필 사이에서 사용자가 선택한 북마크를 자동 동기화하는 오픈소스 제품을 만든다. 같은 계정 로그인으로 연결하며, 실제 작동하는 확장 ZIP, 재현 가능한 Supabase 백엔드, 소스 코드, 설명서, 테스트 증거를 제공한다.

### 0.2 실행 방식

1. 먼저 현재 작업 경로, 프로젝트 지침, 기존 파일, 인증·브라우저 도구를 확인한다. 다른 작업의 파일을 수정하지 않는다.
2. 0.4절에 따라 `/Users/lesa/Desktop/Repo/shatsu-ren`을 프로젝트 루트로 준비한 뒤 아래 기본값으로 로컬 구현을 시작한다. 기존 LESANF/shatsu-ren을 재사용하고 중복 레포를 만들지 않는다. 필요한 외부 자격 증명만 모아 묻고 이미 확정된 답은 다시 묻지 않는다.
3. 제품 구현 전에 `docs/IMPLEMENTATION_PLAN.md`와 `docs/DECISIONS.md`에 단계와 가정을 기록한다. 이 명세도 `docs/BLUEPRINT.md`로 보관한다.
4. 세로 단위로 구현한다. 브라우저 A의 실제 변경이 서버를 거쳐 B에 도달하는 흐름을 먼저 검증하고 UI를 확장한다.
5. 중간에 요약·계획만 제출하고 완료로 끝내지 않는다. 도구나 외부 권한 때문에 막히면 정확한 차단 원인과 남은 작업을 남긴다.
6. 범위를 줄이거나 다른 아키텍처로 바꿔야 하면 근거와 영향부터 제시한다. 테스트를 생략하고 통과했다고 하지 않는다.
7. Git 커밋, GitHub 생성·푸시·공개, 서버 외부 배포, 스토어 제출은 사용자의 해당 권한 범위 안에서만 한다. 가능하면 그 직전까지 준비한다.

### 0.3 확정 사항과 설계 기본값

| 항목 | 결정 | 상태 |
|---|---|---|
| 이름 | shatsu-ren / 샤츠렌 | 사용자 확정 |
| 레포 | LESANF/shatsu-ren | 사용자 지정, 기존 공개 레포 |
| 로컬 프로젝트 루트 | /Users/lesa/Desktop/Repo/shatsu-ren | 사용자가 지정한 Repo 아래 shatsu-ren, 부모 폴더 존재 확인 |
| 라이선스 | MIT | 사용자 확정, 저작권자 표기만 실행 시 확인 |
| 대상 | 데스크톱 Chrome·Aside, 여러 컴퓨터 | 사용자 요구 |
| 연결 | 같은 계정, 계정당 보관함 하나 | 사용자 요구를 구체화 |
| 백엔드 | Supabase Auth + PostgreSQL + DB RPC | 추천 기본값 |
| 로그인 | Google로 계속하기, 브라우저 프로필 계정과 독립 | 사용자 방향 반영 |
| UI | 한국어 기본·영어 지원 | 추천 기본값 |
| 아이콘·브랜드 색 | 나중에 결정, 기존 시안 채택 금지 | 사용자 요청으로 보류, 기능·화면 설계의 선행 조건 아님 |
| 원격 확인 | Realtime 알림 즉시 수신 + 누락 복구용 5분 확인 | 정상 온라인 상태 1~3초 목표, 실측 전 보장 없음 |
| 범위 | 사용자가 명시적으로 연결한 폴더 | 최초 미선택 |
| 보안 | HTTPS, 계정·세션·장치 검증 | E2EE는 v1 제외 |

유료 결제·운영 서비스 공개·스토어 제출이 이미 승인되었다고 확대 해석하지 않는다. 자격 증명이 없어도 로컬 Supabase와 합성 Auth 계정으로 인증 외의 동작을 구현·검증한다. 실제 Google 로그인 검증은 별도 필수 단계다.

### 0.4 프로젝트 위치와 기존 레포 준비

사용자가 말한 `repo`는 이 컴퓨터의 `/Users/lesa/Desktop/Repo`다. 제품 프로젝트는 그 아래 영문 폴더명 `shatsu-ren`으로 만든다. 절대 경로는 **`/Users/lesa/Desktop/Repo/shatsu-ren`**이다. 현재 청사진이 있는 `/Users/lesa/Documents/Playground/shatsu-ren-blueprint`는 설계 문서 보관 위치이며 제품 구현 위치가 아니다.

이 절의 준비 작업은 사용자가 실제 구현을 지시한 때 실행한다. 청사진 수정만 요청한 단계에서는 clone·프로젝트 생성·제품 코딩을 시작하지 않는다.

1. `/Users/lesa/Desktop/Repo`와 대상 경로의 존재 여부, 적용되는 AGENTS.md를 확인한다. 부모 Repo 자체에 git init을 실행하지 않는다.
2. 대상이 없으면 기존 `https://github.com/LESANF/shatsu-ren.git`을 **정확히 그 대상 경로로 clone**한다. clone이 프로젝트 폴더를 만들게 하며 `shatsu-ren/shatsu-ren`처럼 중첩시키지 않는다. 새 GitHub 레포를 생성하지 않는다.
3. 대상이 이미 있으면 파일·Git 상태·origin을 먼저 읽는다. origin이 LESANF/shatsu-ren인 checkout은 기존 작업을 보존하며 재사용한다. 다른 프로젝트이거나 정체를 확인할 수 없는 비어 있지 않은 폴더면 덮어쓰기·삭제·origin 교체 없이 경로 충돌만 보고한다.
4. 원격이 빈 레포여도 clone된 경로 안에서 scaffolding을 진행한다. 원격이 더 이상 비어 있지 않으면 기존 구조와 코드를 먼저 조사하고 반영한다. 과거의 빈 레포 확인을 현재 상태로 간주하지 않는다.
5. clone이 네트워크/인증 문제로 막힌 경우 실패 원인을 기록한다. 대상이 없거나 완전히 빈 경우에만 같은 경로에서 로컬 구현을 준비할 수 있다. 로컬 Git 저장소가 필요하면 대상 폴더 안에서만 초기화하고 지정 origin을 사용한다. 원격 조회가 가능해지면 이력을 확인·조정한 후에만 푸시하며 clone/원격 통합 완료라고 미리 보고하지 않는다.
6. 이후 문서의 상대 경로, 패키지 설치, 개발 서버, DB migration, 테스트, ZIP 빌드는 모두 이 프로젝트 루트를 기준으로 실행한다. 청사진 전체를 루트의 `docs/BLUEPRINT.md`로 복사한다. 원본 설계 문서는 삭제하지 않는다.
7. 시작 보고와 최종 결과에 실제 프로젝트 절대 경로를 표시한다. 다른 컴퓨터에서 경로가 존재하지 않는 경우에만 대응하는 Repo 경로를 확인하고, 현재 작업 폴더에 임의로 프로젝트를 만들지 않는다.

## 1. 제품 정의와 사용자의 실제 문제

사용자는 Chrome 북마크를 Aside로 한 번 가져온 뒤 양쪽 브라우저를 계속 쓰고 있다. 이미 비슷한 북마크가 양쪽에 존재하며, 이후 어느 쪽에서 추가하거나 수정해도 다른 쪽에 반영되기를 원한다.

제품의 중심 문장:

> 브라우저는 바꿔 써도, 북마크는 함께.

제품은 북마크 동기화 도구다. 별도 북마크 서비스로의 강제 이사, 새 탭 교체, AI 분류, 웹페이지 스크래핑을 기본 기능으로 만들지 않는다.

### 1.1 핵심 경험

1. 확장을 양쪽 브라우저에 설치한다.
2. 샤츠렌의 Google 로그인에서 같은 Google 계정을 선택한다. 계정당 보관함 하나를 자동으로 준비한다.
3. 동기화할 폴더를 고르고, 이미 있는 북마크의 병합 미리보기를 확인한다.
4. 이후 브라우저 기본 북마크 UI에서 평소대로 추가·수정·이동·삭제한다.
5. 확장 아이콘에서 연결 상태와 대기 건수를 보고, 문제가 있을 때만 상세 화면을 연다.

### 1.2 v1에 맞는 사용자

- 자신의 북마크를 여러 브라우저·컴퓨터에서 쓰는 개인.
- 서버 설치 없이 같은 계정으로 연결하고 싶은 일반 사용자.
- 자신의 Supabase 프로젝트에 데이터를 두려는 오픈소스 사용자.

일반 설치 흐름에서는 DB·서버 주소를 묻지 않는다. 고급 설정에서 개인 Supabase 프로젝트를 연결할 수 있다. 운영 백엔드가 없는 개발 빌드는 로컬 테스트 모드를 명시하고 존재하지 않는 공개 서비스가 운영 중이라고 안내하지 않는다.

## 2. 필수 범위와 제외 범위

### 2.1 v1 필수

- Manifest V3 확장, Chrome·Aside 지원 확인.
- 선택 폴더와 북마크바 연결, 하위 폴더·빈 폴더·순서 유지.
- 최초 병합 미리보기, 자동 백업, 복제된 북마크의 보수적 중복 매칭.
- 추가·제목/URL 수정·폴더 이동·순서 변경·삭제 동기화.
- 오프라인 변경 보관, 서버/브라우저 재시작 후 재개.
- 계정 로그인/로그아웃/삭제, 장치 등록/철회, 복구 가능한 충돌 처리.
- 삭제 보호와 휴지통 복구, 대량 변경 확인.
- 연결 설정, 상태 팝업, 변경 내역, 충돌, 복구, 장치, 설정 화면.
- 로컬 JSON 백업 내보내기/복원, 서버 DB 백업/복원 절차.
- Supabase SQL 마이그레이션·접근 제어·RPC, 로컬 개발 및 개인 프로젝트 설치 가이드.
- 한국어·영어 UI, 키보드 조작, 밝은/어두운 테마.
- CI, 라이선스, 기여/보안 문서, 익명화된 버그 리포트.

### 2.2 v1 제외 — 구현 완료 후에도 멋대로 추가하지 말 것

- 유료 플랜·결제, Google 이외 추가 로그인 제공자, 팀 협업 권한. 공용 서비스는 배포 준비까지 필수이며 실제 배포는 자격 증명과 사용자 권한 범위에 따른다.
- Firefox·Safari·모바일 지원을 보장하는 배포.
- E2EE, WebDAV·GitHub Gist·Google Drive 저장소 어댑터.
- CRDT, 분산 서버, 데이터베이스 교체 계층. WebSocket 실시간 연결은 v1 필수다.
- AI 태그, 추천, 링크 상태 크롤러, 외부 favicon 수집.
- 독립 웹 북마크 관리자, 새 탭 교체, 방문 기록·쿠키 동기화.
- 자동 스토어 제출, 실제 결제, 미승인 공개 배포.

제외 기능의 빈 메뉴나 작동하지 않는 버튼을 제품에 넣지 않는다.

## 3. 사실·가정·검증 구분

### 3.1 이미 관찰된 사실

2026-09-29T00:58:52.922Z, Aside에 설치한 작은 Manifest V3 확장에서 다음이 실제 통과했다.

| 동작 | 결과 |
|---|---|
| getTree·get 읽기 | 통과 |
| create | 통과 |
| update: 제목·URL | 통과 |
| move: 다른 폴더로 이동 | 통과 |
| remove | 통과 |
| onCreated·onChanged·onMoved·onRemoved | 통과 |
| 테스트용 임시 폴더 정리 | 통과 |

검사 확장 ID는 `emcchanbinieboedncgjfocecnfogckf`였다. 이후 제거했으므로 이 ID로 새 제품을 접근하거나 현재 설치되어 있다고 가정하지 않는다. 기존 결과는 출발 증거일 뿐 새 제품 테스트를 대신하지 않는다.

### 3.2 구현 초기에 검증해야 할 것

- Aside의 MV3 service worker 기동·휴면 후 이벤트 전달, WebSocket 연결·heartbeat·재접속.
- Aside의 identity.launchWebAuthFlow/getRedirectURL 및 실제 Google OAuth 왕복. 기본 bookmarks API 테스트가 이를 검증한 것은 아니다.
- `alarms`, `storage`, IndexedDB, 런타임 메시지, 선택적 host permission.
- `onChildrenReordered`, import 시작/종료 이벤트.
- 서로 다른 프로필과 서로 다른 브라우저에서 네트워크·권한 동작.
- 실제 릴리스 ZIP 설치 후의 알람 간격과 CSP.
- 현재 Chrome 및 Aside 정확한 버전. 브라우저 이름만 적고 호환성 검증 완료라 하지 않는다.

지원되지 않는 필수 기능이 발견되면 문서에 명시하고 해결한다. UA 문자열만 보고 지원 여부를 결정하지 않는다.

## 4. 아키텍처와 기술 선택

```text
Chrome 기본 북마크 ↔ MV3 worker ↔ IndexedDB
                           ↕ HTTPS
                 Supabase Auth + PostgreSQL RPC
                           ↕ HTTPS
Aside 기본 북마크  ↔ MV3 worker ↔ IndexedDB
                           ↕
                    팝업 / 설정 탭
```

| 부분 | 선택 | 이유 |
|---|---|---|
| 언어 | TypeScript strict | 확장·프로토콜 검증과 타입 공유 |
| 관리 | pnpm workspace, lockfile 하나 | 재현 가능한 설치 |
| 확장 | WXT, Manifest V3 | 개발·entrypoint·ZIP 빌드 관례 |
| UI | React + CSS 변수 | 팝업과 설정 화면의 컴포넌트 공유 |
| 인증 | Supabase Auth + Google OAuth + PKCE | 브라우저 계정과 독립된 Google 로그인 |
| 서버 데이터 | Supabase PostgreSQL | 계정 격리·트랜잭션·백업 |
| 동기화 API | PostgreSQL 함수 + PostgREST RPC | 별도 상시 API 서버 없이 원자적 명령 적용 |
| 변경 알림 | Supabase Realtime private Broadcast | 변경 직후 연결된 브라우저에 확인 신호 전송 |
| 로컬 상태 | IndexedDB, 작은 설정은 storage.local | journal·outbox·mapping 보존 |
| 검증 | Vitest + SQL 통합 테스트 + 실제 브라우저 | 규칙·권한·실제 API 모두 확인 |
| 운영 | 관리형 프로젝트 기본, 개인 프로젝트 선택 | 일반 사용자와 오픈소스 사용자를 함께 지원 |

매 poll마다 Edge Function을 호출하지 않는다. 일반 동기화는 RPC를 바로 사용하고, 계정 삭제처럼 관리자 키가 필요한 동작에만 작은 Edge Function을 둔다. service_role/secret key는 확장에 넣지 않는다.

새 ORM·Redis·메시지 브로커·DB 교체 계층은 만들지 않는다. IndexedDB 트랜잭션을 안전하게 쓰는 작은 래퍼는 허용한다. 의존성 버전은 구현 시 공식 문서와 호환성을 확인하고 lockfile로 고정한다.

### 4.1 DB의 동시성 경계

하나의 보관함 변경은 workspace 행의 FOR UPDATE 잠금으로 직렬화한다. 서로 다른 계정은 같은 전역 잠금을 기다리지 않는다. 한 보관함 10,000개 활성 항목, 장치 10개를 v1 지원 목표로 둔다. 실측 전 성능 보장으로 쓰지 않는다.

폴더 순서 변경은 O(형제 수) 배열 갱신을 허용한다. 대형 폴더에서 지연을 측정하고 실제 한계가 나타났을 때만 순서 키 모델을 검토한다. 하나의 계정이 하나의 보관함을 소유하며 협업 권한은 없다.

### 4.2 데이터 접근

민감 테이블 전체에 RLS를 켜고 anon/authenticated의 직접 테이블 접근을 회수한다. 필요한 공개 RPC만 authenticated에 EXECUTE를 부여한다. private schema 내부 함수에는 호출 권한을 부여하지 않는다.

SECURITY DEFINER 함수는 고정된 빈 search_path, schema-qualified 이름, auth.uid() 및 검증된 JWT session_id에서 유도한 소유권을 사용한다. RLS를 우회할 수 있으므로 함수 안의 계정·장치 검증을 생략할 수 없다. body의 userId/workspaceId를 권한 근거로 쓰지 않는다. 모든 조회 RPC에도 장치 철회 검사를 적용한다.

공개 API key는 프로젝트 식별용이고 보안 비밀이 아니다. 계정 간 격리는 JWT 검증·SQL 권한·RLS·함수 검증으로 보장한다. [함수 보안](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 5. 데이터의 소유권과 불변 조건

### 5.1 객체

- **Workspace(보관함)**: 한 계정이 소유하고 그 계정의 장치들이 공유하는 북마크 데이터 집합.
- **Collection(연결 폴더)**: 보관함 안의 논리적 동기화 루트. 예: `개인 북마크바`.
- **Device(장치)**: 컴퓨터가 아니라 확장 설치가 속한 브라우저 프로필 하나. 같은 컴퓨터의 Chrome과 Aside도 서로 다른 deviceId.
- **Node(항목)**: 북마크 또는 사용자 폴더. 전역 UUID를 가진다.
- **Binding(연결)**: Collection과 해당 프로필의 로컬 폴더 ID 사이의 관계.
- **Mapping**: 전역 nodeId와 로컬 bookmarkId의 대응.
- **Operation(명령)**: 한 번의 의도된 변경. 재전송해도 같은 opId를 쓴다.
- **Commit(확정 변경)**: 서버가 트랜잭션으로 승인한 변경. 보관함 내 단조 증가 seq.
- **Tombstone(삭제 기록)**: 항목이 삭제되었다는 전역 기록. 오래 꺼진 장치의 부활을 막는다.

### 5.2 절대 규칙

1. 브라우저의 bookmarkId를 전역 ID로 사용하지 않는다.
2. 북마크 제목·URL·폴더 경로는 항목 정체성이 아니다. 최초 매칭 이후에는 UUID를 따른다.
3. 수정 시각이 늦다는 이유로 다른 변경을 조용히 덮어쓰지 않는다.
4. 서버가 돌려준 빈 목록, 네트워크 실패, 파싱 실패를 전체 삭제로 해석하지 않는다.
5. 로컬 폴더가 없어지거나 mapping이 사라졌다고 원격을 비우지 않는다.
6. 원격 삭제는 알려진 전역 항목과 검증된 mapping에만 적용한다.
7. 브라우저가 고정한 루트·관리형 폴더 자체를 생성·이동·삭제하지 않는다.
8. URL이 같아도 다른 폴더 또는 다른 제목의 북마크는 독립 항목이다.
9. 확장 제거·연결 해제는 북마크 또는 서버 보관함의 삭제가 아니다.
10. 한 브라우저 API 호출 성공과 로컬 DB 기록은 원자적이지 않다. 이 틈을 journal과 명시적 복구로 처리한다.
11. 동기화로 생긴 이벤트를 사용자 변경으로 재전송해서 무한 왕복시키지 않는다.
12. 실패·충돌·미적용 원격 변경이 있는 상태를 `동기화 완료`로 표시하지 않는다.

## 6. 폴더 선택과 최초 병합

### 6.1 루트 선택

- 최초에는 아무 폴더도 선택하지 않는다. 전체 북마크 권한과 실제 동기화 범위를 구분해 설명한다.
- 사용자는 기존 북마크바 또는 사용자 폴더를 선택하거나 새 `shatsu-ren` 폴더를 만들 수 있다.
- 하나의 Collection은 장치마다 하나의 로컬 폴더에 연결한다. 장치마다 폴더 이름은 달라도 된다.
- 한 장치에서 부모와 그 자손 폴더를 각각 연결하는 중첩 binding은 금지한다.
- 관리형/읽기 전용 폴더는 제외 사유를 표시한다.
- 고정 루트는 표시 이름이나 숫자 ID로 단정하지 않는다. 현재 트리를 탐색하고 사용자가 선택한 ID를 저장한다. `folderType`은 제공되는 경우만 참고한다.
- 연결 루트가 사라지면 `연결 폴더 없음`으로 일시 정지하고 다시 선택하게 한다.

### 6.2 첫 장치

빈 서버 보관함에 선택 범위의 스냅샷을 가져온다. 기존 로컬 항목을 삭제하거나 복제하지 않고 UUID mapping을 붙인다. 첫 등록도 변경 수·제외 수·백업 다운로드를 먼저 보여 준다.

### 6.3 두 번째 장치

`서버 내용 + 이 브라우저 내용`을 합치는 비파괴 병합이 기본이다.

자동 매칭은 다음을 모두 만족하는 유일한 후보에 한정한다.

- 연결 루트 아래 상대 폴더 경로의 각 제목이 정확히 같다.
- 종류, 북마크 제목, 저장된 URL 문자열이 정확히 같다.
- 양쪽에서 후보가 각각 하나뿐이다.

경로 문자열을 `/`로 이어 비교하지 말고 제목 배열로 비교한다. 폴더명에 `/`가 들어갈 수 있다. 빈 폴더도 매칭 대상이다. 중복 이름 폴더가 있어서 경로가 모호하면 그 하위까지 자동 매칭하지 않는다.

같은 URL이라는 이유로 쿼리·fragment·말미 slash·대소문자를 지워 합치지 않는다. 일반 정규화가 로그인 링크·앵커·서버 라우팅 의미를 바꿀 수 있다.

매칭 불확실 항목은 둘 다 유지하고 `중복 후보`로 안내한다. 사용자 선택 없이 기존 것을 삭제하지 않는다. 양쪽 기존 형제 순서가 다르면 서버 순서를 기본안으로 미리 보여 주고, 로컬에만 있는 항목은 원래 상대 순서를 유지하여 끝에 추가한다. 이 초기 정책을 사용자에게 숨기지 않는다.

### 6.4 미리보기 계약

화면에는 추가/수정/이동/중복 후보/제외/삭제 수, 어느 방향으로 무엇이 적용되는지, 백업 위치를 표시한다. 최초 병합의 삭제 수는 0이다. `이 브라우저 → 서버 덮어쓰기` 같은 전체 파괴 모드는 v1에 없다.

미리보기는 server seq와 로컬 범위 fingerprint에 묶는다. 확정 전에 어느 쪽이 달라졌으면 다시 계산하고 재확인한다. 이름이 같은 폴더를 무조건 합치는 등 적용 때 다른 규칙을 쓰지 않는다.

## 7. 서버 데이터 모델

최종 SQL은 구현하면서 만들되 다음 의미와 제약을 보존한다.

| 테이블 | 핵심 필드·제약 |
|---|---|
| workspaces | id, ownerUserId UNIQUE → auth.users, protocolVersion, generationId, headSeq, createdAt |
| collections | id, workspaceId, title, rootNodeId |
| devices | id, workspaceId, userId, authSessionId UNIQUE, label, revokedAt, lastSeenAt |
| nodes | id, workspaceId, collectionId, kind, parentId, title, url, revision, deletedAt |
| folder_orders | parentId, orderedChildIds, revision |
| commits | workspaceId + seq, sourceDeviceId, opId, kind, payload, serverTime |
| operation_receipts | workspaceId + opId UNIQUE, sourceDeviceId, requestHash, exactResult |
| trash_payloads | deletionId, workspaceId, deleted subtree snapshot, expiresAt |

node revision은 서버만 증가시킨다. DB 컬럼은 snake_case, 프로토콜 필드는 camelCase로 두고 경계에서 명시적으로 변환한다.

- UUID는 클라이언트가 생성해도 되지만 서버가 형식과 workspace 소유권을 검증한다.
- 살아 있는 북마크는 URL이 있고 자식이 없다. 살아 있는 폴더의 URL은 null이다.
- parent는 같은 collection의 살아 있는 폴더 또는 논리적 root다.
- 순환, 중복 ID, 다른 보관함 ID 참조, 자식 중복·누락을 트랜잭션 전에 거부한다.
- 살아 있는 모든 직접 자식은 해당 folder_orders에 정확히 한 번 존재한다.
- seq는 보관함 내 commit 단위 증가다. 장치 시계는 충돌 승자나 commit 순서를 정하지 않는다.
- 부모의 자식 목록 변화는 folder_orders.revision을 올린다. 형제 위치가 밀렸다는 이유로 모든 node revision을 올리지 않는다.
- 삭제는 node를 제거하지 않고 tombstone으로 표시한다. 원래 payload는 30일간 휴지통에서 복원할 수 있다.
- 30일 후 휴지통 본문과 tombstone의 제목·URL·기존 경로 등 복구용 개인정보는 정리하되 ID·마지막 revision·삭제 상태는 보존한다. 오래된 장치가 그 ID를 새 항목처럼 부활시키지 못하게 한다.
- operation receipt는 v1에서 자동 만료하지 않는다. receipt는 제목·URL이 없는 최소 결과(opId, seq, 결과 코드, 관련 ID/revision)만 저장한다. 상세 충돌 내용은 권한 검증된 최신 조회로 가져오며 만료된 과거 본문을 receipt에서 복원하지 않는다. 저장 공간 한도를 넘으면 쓰기를 명시적으로 거부하며 임의 삭제하지 않는다.
- commit 로그는 기본 30일 보관한다. 만료된 cursor는 snapshot 재동기화로 처리한다.

## 8. 동기화 프로토콜

### 8.1 RPC 계약

Supabase SDK가 보내는 access JWT를 검증한다. 아래 이름의 POST /rest/v1/rpc/<함수명>으로 계약을 구현한다. 자동 생성 REST 테이블 API로 직접 데이터 변경을 허용하지 않는다.

| RPC | 의미 |
|---|---|
| sync_register_device | 검증된 계정·세션으로 장치 등록, 계정 보관함 idempotent 생성 |
| sync_info | protocolVersion, generationId, 공개 한도 |
| sync_create_collection | 논리 루트 생성, opId로 중복 방지 |
| sync_devices | 자신의 장치 목록 |
| sync_revoke_device | 자신의 장치 철회 |
| sync_snapshot | 일관된 nodes·orders·headSeq·generationId |
| sync_changes | afterSeq 이후 완전한 commit 페이지 |
| sync_apply_operation | 명령 하나 원자적 적용, receipt 반환 |
| sync_apply_operations | 최초 import 등 최대 100개/2 MiB 묶음 제출, 명령별 receipt |
| sync_trash | 자신의 삭제 묶음·만료 시각 |

restore는 별도 우회 경로 없이 sync_apply_operation의 명령이다. collection 생성도 workspace 잠금·seq·commit·receipt 규칙을 따른다. 이름 변경은 같은 방식의 collection patch 명령으로 처리한다. collection 자체 영구 삭제는 v1 UI에서 제공하지 않는다.

결과는 `{ok:true,data:...}` 또는 `{ok:false,error:{code,...}}` 판별 union이다. 도메인 충돌은 RPC가 HTTP 200으로 반환해도 ok:false를 처리해야 한다. HTTP 상태만 보고 성공이라 판정하지 않는다. 인증·rate limit·통신 실패는 transport 오류로 별도 처리한다.

서버 함수 내부에서 검증 실패 결과를 반환할 때 부분 변경이 남지 않게 한다. 모든 검증을 쓰기 전에 끝내거나, 예외가 발생한 하위 블록을 rollback한 뒤 명시 오류를 반환한다. receipt와 변경은 같은 트랜잭션이다.

묶음 제출은 단일 명령과 같은 내부 실행 함수를 사용한다. 명령마다 opId·receipt를 유지하고 입력 순서로 적용한다. 도메인 충돌을 만나면 그 명령의 terminal 결과까지 기록하고 뒤 명령은 not_attempted로 반환한다. 이미 성공한 앞 명령은 유지된다. 예기치 않은 DB 예외는 RPC 전체를 rollback한다. 응답 유실 시 동일 묶음을 재전송해도 receipt로 중복 적용을 막는다. 요청 단위 제한과 별도로 묶음의 항목 수·bytes·총 node 한도를 검사한다.

### 8.2 명령 envelope

```json
{
  "protocolVersion": 1,
  "generationId": "server-generation-uuid",
  "opId": "operation-uuid",
  "collectionId": "collection-uuid",
  "kind": "patch",
  "nodeId": "node-uuid",
  "baseRevision": 12,
  "patch": { "title": "바꾼 제목" }
}
```

deviceId는 검증된 JWT의 session_id에 연결된 장치 행에서, workspaceId는 auth.uid()의 소유 보관함에서 정한다. body 값을 권한 근거로 신뢰하지 않는다. 사용자 URL과 제목은 문서 예시와 실제 테스트에서 example.com 등의 합성 데이터로 제한한다.

### 8.3 명령 종류

- `create`: client가 정한 새 nodeId, kind, parentId, title, url, afterId. parent가 살아 있고 anchor가 같은 부모인지 확인.
- `patch`: nodeId, baseRevision, title와/또는 url. 종류 변경 금지.
- `move`: nodeId, baseRevision, parentId, afterId. 자손으로 이동·다른 collection으로 이동 금지.
- `reorder`: parentId, baseOrderRevision, orderedChildIds. 현재 자식 집합과 정확히 같아야 함.
- `deleteSubtree`: nodeId, baseRevision, expectedSubtreeDigest. 동시 추가·수정·이동까지 검사한 뒤 전체 soft delete.
- `restore`: deletionId, 선택한 복원 부모, 현재 관련 revision/digest. 삭제된 조상·이름 충돌을 처리하고 전체를 검증.

`afterId = null`은 맨 앞을 뜻한다. anchor가 사라졌거나 다른 부모로 이동했으면 임의 위치로 넣지 않고 충돌로 반환한다. 같은 anchor에 동시에 추가한 항목은 서버가 승인한 commit 순서대로 적용되며 모든 장치에서 같은 결과가 되어야 한다.

v1에서는 collection 간 이동을 자동 해석하지 않는다. 경계를 넘긴 로컬 항목은 `범위 밖으로 이동됨`으로 보류하고 원격 유지/원격 삭제/다른 연결로 복사를 명시적으로 선택하게 한다. collection 내부의 일반 이동과 구분한다.

### 8.4 원자성·멱등성

서버 트랜잭션 하나에서 검증 → node/order 변경 → seq 증가 → commit 저장 → receipt 저장을 끝낸다. 중간 실패는 전부 rollback한다.

같은 workspaceId+opId+동일 requestHash 재요청은 처음 결과를 반환한다. 동일 계정의 재로그인으로 deviceId가 바뀌어도 이미 승인한 명령은 다시 적용하지 않는다. 최초 sourceDeviceId는 감사 정보로 보존한다. 같은 opId에 다른 body가 오면 `OP_ID_REUSED`다. 응답 유실 후 재시도했다고 새 항목이나 새 commit이 생겨서는 안 된다.

실패 응답을 영구 receipt로 기록하는지 여부도 명세한다: 인증·한도·일시 오류는 receipt를 만들지 않는다. revision 충돌은 동일 opId로 재시도해도 동일 충돌을 반환하는 terminal receipt를 남긴다. 충돌 해결은 새 opId다.

### 8.5 충돌 규칙

- baseRevision이 현재와 같으면 검증 후 적용한다.
- 다르면 충돌 코드·관련 ID/revision을 반환한다. 원격 current를 별도 조회하고 로컬 proposed와 함께 클라이언트에 충돌로 저장한다. v1은 서로 다른 필드라도 같은 node를 동시 수정했으면 보수적으로 충돌을 표시한다.
- 명령의 의도된 결과가 이미 현재와 정확히 같다면 명확한 no-op receipt로 승인할 수 있다. 동일성 판정이 애매한 move/delete는 추정 승인하지 않는다.
- 삭제 대 수정은 삭제가 자동 승리하지 않는다. tombstone과 로컬 미전송 내용을 충돌 화면에서 모두 확인 가능해야 한다.
- `내 변경 사용`은 현재 revision을 다시 읽어 사용자가 고른 변경만 새 opId로 제출한다. 사이에 또 변경되면 다시 충돌한다.
- `다른 장치 변경 사용`은 선택한 로컬 변경을 버리되 복구 내역에 보관한다.
- 북마크의 `둘 다 보관`은 하나를 새 UUID로 복사한다. 폴더 전체 복제는 v1 충돌 버튼으로 제공하지 않는다. 폴더는 원격/로컬 선택 또는 JSON 내보내기로 처리한다.

### 8.6 snapshot·cursor

snapshot의 nodes/orders와 headSeq는 동일 MVCC snapshot에서 나온다. DB 함수 한 번 호출이 자동으로 여러 SELECT의 snapshot 일관성을 보장한다고 가정하지 않는다. 단일 SQL statement에서 JSON을 구성하거나 workspace 잠금과 명시된 일관성 전략을 사용한다. 다운로드 중 변경이 생겨도 snapshot 뒤 changes로 연결되어야 한다.

changes는 commit을 쪼개서 페이지를 나누지 않는다. 응답은 `commits`, `nextCursor`, `hasMore`, `headSeq`, `generationId`를 가진다. 마지막 페이지가 아닐 때 임의로 headSeq로 cursor를 뛰어넘지 않는다.

클라이언트에는 `receivedSeq`와 `appliedSeq`를 구분한다. IndexedDB에 전체 commit을 저장한 뒤 receivedSeq를 올리고, 실제 브라우저 적용과 journal 완료 후에만 appliedSeq를 올린다. 충돌 때문에 보류된 적용을 완료로 세지 않는다.

cursor가 로그 보관 범위보다 오래되면 `CURSOR_EXPIRED`와 snapshot 재요청 안내를 반환한다. 새 snapshot으로 shadow를 재구성하되 outbox·local intent·삭제 tombstone을 보존한다. 전역 ID가 서버에서 사라졌다면 자동 새 ID 생성 대신 복구 상태로 둔다.

서버 DB 복원 시 generationId를 새로 발급한다. 이전 generation 명령은 `SERVER_GENERATION_CHANGED`로 거절하고 클라이언트가 비교·복구하기 전에는 쓰기를 멈춘다. 되돌아간 seq를 새 변경으로 오인하지 않는다.

### 8.7 구현에서 명확히 할 세부 규칙

- commit payload는 바뀐 node의 최종 값 또는 tombstone, 영향 받은 폴더의 최종 orderedChildIds/revision을 담는다. node patch만 보내고 순서를 클라이언트가 제각각 추측하게 하지 않는다.
- 논리 root는 collection 생성과 함께 만들어지고 브라우저 고정 루트에 대응한다. 일반 node 명령으로 수정·이동·삭제하지 않는다.
- 같은 anchor 뒤에 X 다음 Y가 승인되면 매번 anchor 바로 뒤에 삽입하므로 결과는 anchor,Y,X다. 최신 승인 순으로 anchor에 가까워지는 규칙을 명시하고 모든 클라이언트는 서버의 최종 순서를 따른다.
- digest 입력은 ID순 정렬한 고정 순서 tuple 배열(nodeId, revision, parentId, deleted 여부)과 parentId순 정렬한 order tuple(parentId, orderRevision, orderedChildIds)이다. UTF-8 JSON의 공백·null·숫자 표현까지 protocol에 고정하고 SQL/TS 공통 test vector를 제공한다. requestHash도 키 순서가 고정된 canonical 표현을 사용한다.
- changes의 commit은 분할하지 않는다. 한 commit/응답의 비압축 한도는 32 MiB다. 이를 넘길 변경은 적용 전에 거부한다. snapshot과 delta의 generation·headSeq·스키마를 모두 검사한다.
- appliedSeq는 연속해서 적용이 끝난 마지막 seq다. 뒤의 독립 commit을 먼저 처리하더라도 미해결 앞 seq를 건너뛰지 않는다. 연결하지 않은 collection의 commit은 shadow만 갱신하고 native 적용 불필요로 완료할 수 있다.
- 로컬 intent에는 사용자가 편집하기 전 base revision/값을 보존한다. shadow를 최신으로 갱신했다고 그 intent의 base를 바꾸지 않는다. base/local/remote 비교로 변경을 판단한다.
- generation 검사는 receipt 조회보다 먼저 한다. 서버가 복원된 뒤 과거 receipt만 믿고 성공 상태로 넘어가지 않는다.

## 9. 확장 로컬 상태와 MV3 실행

### 9.1 IndexedDB에 보존할 것

| store | 내용 |
|---|---|
| bindings | collection·local root 대응, 활성/정지 상태 |
| mappings | globalId↔localId, workspace·collection scope |
| shadow | 서버에서 확정된 node/order/revision |
| observed | 마지막으로 확인한 로컬 범위 상태 |
| local_intents | 아직 확정되지 않은 사용자의 목표 변경 |
| outbox | opId, body, 단계, 재시도 시간, 의존 항목 |
| inbox | 받은 commit과 적용 상태 |
| apply_journal | API 호출 전/후 상태·예상 fingerprint·결과 localId |
| conflicts | base/local/remote, 영향 범위, 해결 상태 |
| backups | 최초 병합·대량 변경 직전 로컬 snapshot |

설정·Supabase 세션은 storage.local에 두고 지원 시 접근 수준을 TRUSTED_CONTEXTS로 제한한다. 웹페이지 localStorage와 chrome.storage.sync를 동기화 데이터 저장소로 쓰지 않는다. 콘텐츠 스크립트는 v1에 없다.

### 9.2 실행 신호

- 북마크 변경 이벤트: 즉시 durable dirty/local intent 기록 후 실행 시도.
- 브라우저 시작/worker 재기동: 미완료 journal·outbox 복구, alarm 존재 확인.
- Realtime 알림: 변경 신호를 받으면 같은 동기화 실행기를 즉시 호출한다.
- 정기 alarm: 5분마다 누락 변경 확인과 끊긴 실시간 연결 복구. 일상적인 반영 지연은 이 주기로 결정하지 않는다.
- 사용자 `지금 동기화`: 같은 실행기를 호출한다. 별도 알고리즘을 만들지 않는다.
- 온라인 복귀: 환경에서 받을 수 있는 신호를 활용하되 정기 alarm만으로도 회복할 수 있어야 한다.

service worker가 계속 살아 있다고 가정하지 않는다. 짧은 debounce가 있더라도 데이터는 먼저 기록한다. 긴 작업은 항목 수와 실행 시간을 기준으로 chunk 처리하고 checkpoint를 남긴다. 임시 전역 변수·setInterval·열린 popup에만 재개 책임을 두지 않는다.

worker 안의 단일 실행 queue로 동일 프로필의 중복 실행을 막는다. worker 재시작 후에는 영속 journal 상태에서 이어간다. 만료되지 않는 영속 `isSyncing=true` 플래그는 금지한다.

### 9.3 한 번의 동기화

1. 연결 권한·인증·generation을 확인한다.
2. 미완료 apply journal부터 복구한다.
3. 로컬 범위를 재조회하여 이벤트 유실을 보완하고 local intent를 보존한다.
4. changes를 받아 서버 shadow를 갱신한다. 로컬 미전송 변경에 곧바로 덮어쓰지 않는다.
5. 로컬 intent와 shadow를 비교해 충돌을 분리한다. 변경 없는 항목을 다시 전송하지 않는다.
6. outbox 의존 순서대로 제출한다. 생성 부모 → 자식, 이동 목적지 존재 확인, 삭제 subtree 검증.
7. ack/commit을 durable 저장하고 remote 변경을 journal로 브라우저에 적용한다.
8. 최종 로컬 상태·순서를 확인하고 pending·conflict·cursor를 갱신한다.
9. 유효한 잔여 변경이 있으면 다시 실행한다. 반복 횟수 한도를 넘어가면 alarm으로 이어간다.

동일 node의 in-flight 명령 body/opId는 바꾸지 않는다. 그동안 생긴 후속 편집은 별도 local intent로 남기고 ack 이후 새 baseRevision으로 생성한다. 다른 장치 변경이 끼었으면 blind rebase하지 않고 충돌을 만든다.

### 9.4 이벤트 반향과 강제 종료

원격 API 적용 전에 대상·기존 상태·예상 결과를 journal에 기록한다. 이벤트가 해당 변경의 실제 결과와 일치할 때만 반향으로 소비한다. `동기화 중 모든 이벤트 무시`는 사용자의 동시 편집을 잃으므로 금지한다.

update/move/delete는 재시작 시 실제 상태를 읽어 이미 적용됐는지 판단한다. 다른 사용자 변화가 끼었으면 충돌로 멈춘다.

create API가 성공한 직후 mapping 기록 전에 worker가 죽으면 정확히 한 번 생성을 일반적으로 보장할 수 없다. ID를 안전하게 확인할 근거가 없으면 **자동 재생성하지 않고 해당 collection을 `복구 필요`로 정지**한다. 사용자에게 후보 선택/새 복사/취소를 보여 준다. 제목·URL만 같은 항목에 무조건 mapping을 붙이지 않는다. 이 제한과 복구 UX를 문서와 테스트에 포함한다.

`onRemoved`의 폴더 삭제 이벤트는 자손별 이벤트가 모두 온다고 가정하지 않는다. 보존된 observed subtree를 이용한다. import 중에는 dirty 상태를 남기고 종료 후 일괄 비교한다. import 완료 이벤트를 놓쳐도 다음 reconciliation으로 회복한다.

### 9.5 실시간 동기화

1. bookmarks 이벤트를 durable 기록하고 짧은 병합 대기(목표 100~300 ms) 후 RPC로 보낸다.
2. 서버 commit과 같은 트랜잭션에서 private Broadcast 발행을 시도한다. payload는 고정된 changed 신호만 넣고 제목·URL·node·seq·개수는 넣지 않는다. 실제 확정 데이터는 commit 로그가 원본이다.
3. 연결된 다른 장치가 신호를 받으면 sync_changes(after receivedSeq)를 바로 호출한다.
4. 기존 검증·충돌·journal 절차로 실제 북마크에 적용한다. 실시간을 위해 데이터 보호 규칙을 생략하지 않는다.

단일 명령이면 한 번, import batch면 RPC 끝에 한 번 신호를 보낸다. 같은 시간에 여러 신호를 받아도 단일 queue에서 합친다. 자기 변경 알림도 harmless 재확인으로 처리한다. Broadcast에 실패하거나 신호가 유실돼도 승인된 북마크 변경을 잃지 않는다. 발행 실패는 진단으로 남기고 주기 확인/재접속 시 commit 로그로 복구한다. [DB Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

브라우저 프로필당 worker 소유 WebSocket 하나와 private workspace channel 하나만 둔다. 팝업·설정은 별도 연결을 만들지 않는다. 가입/재가입 완료 후 즉시 changes를 조회해 subscribe 전후의 틈을 메운다. SDK heartbeat가 실제로 worker에서 송수신되는지 관찰하고 idle timeout보다 짧은 주기를 사용한다. worker가 계속 살아 있다는 가정은 여전히 금지한다.

Chrome 116+에서는 WebSocket 메시지 송수신이 worker 유휴 타이머를 갱신한다. Aside에 같은 동작이 있다고 추정하지 말고 실제로 장시간 확인한다. 강제 종료·절전·네트워크 변경 때는 재접속 후 cursor로 따라잡는다. 단절 시 UI는 “실시간 연결 재시도 중”을 보여 주고 5분 확인을 보조로 유지한다. [Chrome worker 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

Realtime 정책은 workspace 소유자·유효 세션·활성 장치만 private channel을 구독하도록 한다. 인증된 모든 사용자에게 허용하는 예제 정책은 금지한다. client Broadcast 발행은 허용하지 않는다. Supabase 토큰 갱신 시 Realtime에도 새 JWT를 전달하고 로그아웃/계정 전환/전역 자동 동기화 중지 때 channel과 socket을 닫는다. 폴더 일부만 정지한 경우의 연결 수명은 16.8절을 따른다.

Broadcast 채널 권한은 연결 동안 캐시되므로 장치 철회만으로 열린 채널이 즉시 끊긴다고 보장하지 않는다. 그래서 알림에는 북마크 본문과 식별자를 넣지 않으며, 실제 데이터 RPC는 매번 철회를 확인한다. 이미 열린 채널은 JWT 만료/권한 재평가 전까지 변경 발생 시점을 알 수 있다는 제한을 문서화한다. 새 구독과 모든 북마크 조회·수정은 즉시 차단한다. [Realtime 권한](https://supabase.com/docs/guides/realtime/authorization)

서버만 구독 확인을 바탕으로 브라우저 native 적용 성공을 단정하지 않는다. 정상 네트워크·양쪽 실행·구독 정상·충돌 없는 단일 편집에서 end-to-end 1~3초를 개발 목표로 측정한다. 브라우저 종료/OS 절전/오프라인에서는 다시 실행·연결한 후 적용한다.

## 10. 삭제·복구·동기화 범위 보호

### 10.1 삭제

node 삭제는 server tombstone을 만들고, 다른 장치에서는 알려진 해당 항목만 제거한다. 폴더 subtreeDigest는 node ID·revision·부모 관계·자식 순서를 안정된 방식으로 직렬화해 SHA-256으로 구한다. digest 규칙은 protocol 명세 한 곳에서 정의하고 SQL·TypeScript 구현을 공통 test vector로 검증한다.

원격 폴더 삭제를 적용하기 직전에 로컬 자식 목록을 확인한다. 서버가 모르는 새 항목 또는 미전송 수정이 있으면 삭제를 보류한다. 원격 삭제를 이유로 로컬 미전송 항목까지 removeTree로 지우지 않는다.

### 10.2 대량 변경 보호

한 번의 계획에서 삭제가 20개 이상이거나, 범위의 20% 이상이면서 최소 5개인 경우 `검토 필요`로 멈춘다. 최초 병합·루트 교체·대규모 복원도 확인 대상이다. node 수는 폴더와 북마크를 모두 센다.

이미 사용자가 로컬에서 지운 항목은 서버 전송만 보류한다. 임의로 다시 살리지 않는다. `삭제 동기화`, `기존 상태 복구`, `내보내기`를 선택하게 한다.

사용자가 승인한 특정 operation 묶음은 자기 장치에서 다시 같은 확인을 요구하지 않는다. 다른 장치는 그 삭제를 받기 전 범위와 자기 미전송 변경을 검사한다. 대량 삭제 승인 정책은 기본적으로 수신 장치에서도 미리보기 후 확인이다. 무조건 자동 전체 삭제 모드는 없다.

### 10.3 복구

- 휴지통에서 최근 30일 삭제 묶음을 복원한다.
- 살아 있는 이전 부모가 있으면 그곳, 없으면 사용자가 선택한 폴더로 복원한다.
- 아직 tombstone인 원래 ID를 유지하여 복원 revision을 올린다. 이미 살아 있는 ID를 덮어쓰지 않는다.
- 부분 복원은 v1에 제공하지 않고 삭제 묶음 단위로 처리한다.
- JSON 복원은 먼저 schema·크기·순환·중복 ID를 검사하고 적용 미리보기를 제공한다.
- 외부 백업 가져오기는 기본 새 UUID로 병합한다. 현재 보관함 전체를 조용히 되감지 않는다.
- 백업 파일에는 access/refresh token·OAuth code/verifier·내부 secret을 넣지 않는다. 제목·URL이 포함되는 개인 데이터임을 내보내기 화면에서 알린다.

연결 해제 시 로컬 북마크 유지가 기본이다. 미전송 변경은 내보내기/보존/명시적 폐기 중 선택하게 한다. extension 제거가 로컬 설정을 지울 수 있다는 안내를 제공한다.

## 11. 계정·장치·운영 모델

### 11.1 Google 로그인

Chrome 자체 로그인, Aside 자체 로그인, 샤츠렌 로그인은 별개다. 양쪽 확장에서 “Google로 계속하기”를 누르고 같은 Google 계정을 고르면 같은 샤츠렌 보관함을 사용한다. 브라우저 프로필 계정을 자동으로 신뢰하거나 Aside 계정과 이메일 문자열만 비교해 연결하지 않는다. 서버 계정의 기준은 Supabase auth.uid()와 검증된 Google identity다.

기본 흐름: 버튼 클릭 → Google 계정 선택/동의 → Supabase callback → 확장 복귀 → PKCE code 교환 → 샤츠렌 세션 → 장치 등록 → 폴더 선택.

Supabase SDK flowType:pkce와 signInWithOAuth(provider:google, skipBrowserRedirect:true)를 사용한다. worker가 identity.launchWebAuthFlow(interactive:true)에 인증 URL을 전달하고 반환 URL의 code를 exchangeCodeForSession으로 교환한다. Chrome 프로필에 종속되는 getAuthToken 방식은 기본으로 삼지 않는다. Google 로그인창은 사용자 버튼 동작에서만 띄운다.

Chrome/Aside가 생성한 getRedirectURL 값과 실제 확장 ID를 각각 기록해 Supabase redirect allowlist에 정확히 등록한다. Google OAuth client의 callback은 Supabase Auth callback이다. 두 종류의 redirect URL을 혼동하지 않는다. 개발·스토어 빌드의 확장 ID 차이도 검증한다. client secret은 Supabase 설정에만 둔다. [Google 연동](https://supabase.com/docs/guides/auth/social-login/auth-google), [확장 identity](https://developer.chrome.com/docs/extensions/reference/api/identity)

PKCE verifier와 진행 중 로그인 상태는 trusted storage에 잠시 보존하고 worker 재기동을 처리한다. 한 프로필에서 로그인 시도 하나만 활성화하며 콜백의 origin/path·진행 중 시도·만료를 확인한다. SDK가 관리하는 OAuth state를 임의로 덮어쓰지 않는다. 실패·취소·재생된 code는 로그인 완료로 처리하지 않는다. access/refresh token을 URL에 직접 실어 전달하지 않는다. [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)

Google Cloud 프로젝트의 OAuth 동의 화면·기본 identity scope·client ID/secret·테스트 사용자·공개 상태·필요한 브랜드 검증을 설정한다. 로그인에 필요한 openid/email/profile만 사용하고 Gmail 메일함·Drive·Chrome 북마크 서버 권한을 요청하지 않는다. Google은 본인 확인용이며 북마크 저장소는 Supabase다. 로그인용 provider token을 Gmail API 호출에 재사용하지 않는다.

v1 로그인은 Google 하나로 둔다. 이메일 OTP·SMTP는 필수 기능/비용에서 제거한다. Aside에서 이 OAuth 경로가 차단되면 이메일 인증으로 몰래 대체하지 않는다. 실제 원인을 기록하고 일반 브라우저 탭 기반 OAuth 복귀 방식 등 대안을 검토한 뒤 양쪽 Google 로그인 검증을 완료한다. 해결 전에는 Aside 인증 지원 완료라고 보고하지 않는다.

### 11.2 세션과 장치

worker가 유일한 Auth client와 token refresh 책임을 가진다. 팝업/설정은 runtime message로 로그인·상태를 요청한다. 여러 UI의 독립 refresh로 토큰이 경합하지 않게 한다. custom storage adapter로 세션을 저장하고 worker 기동 때 만료를 확인한다. 짧은 수명의 worker에서 타이머만 믿지 않는다.

장치는 프로필 하나이며 검증된 JWT의 session_id에 묶는다. sync_register_device는 같은 세션이면 같은 등록 결과를 반환한다. 다른 계정의 장치 ID를 빼앗거나 이미 철회한 세션으로 재등록할 수 없다. 표시 이름은 권한과 무관하다.

모든 RPC는 auth.uid(), 실제 유효한 auth.sessions 행, 일치하는 장치와 revokedAt을 검사한다. JWT 문자열이 아직 유효해도 철회된 장치는 데이터 조회·변경을 거부한다. 세션 존재 여부 확인은 전용 좁은 권한의 내부 함수에 둔다. Supabase 세션/JWT가 즉시 함께 무효화된다고 가정하지 않는다. [세션과 JWT](https://supabase.com/docs/guides/auth/sessions)

초기 sync_register_device만 기존 장치 존재를 요구하지 않는다. 대신 검증된 계정·실제 세션·기존 철회 기록을 검사하고 최초 등록을 수행한다. 공개 호출 가능한 함수라는 이유로 bootstrap 예외를 다른 RPC까지 넓히지 않는다.

다른 장치 철회는 해당 계정만 할 수 있다. 철회 후 북마크는 그 브라우저에 남고 동기화만 중지된다. 해당 사용자가 Google 로그인을 다시 완료하면 새 세션·새 장치 등록으로 연결할 수 있다. 자동으로 철회 기록을 지워 재활성화하지 않는다.

### 11.3 로그아웃·계정 전환

모든 로컬 데이터 키는 backend origin + auth user ID + workspace ID로 격리한다. 계정 A의 outbox·mapping·backup을 계정 B에 절대 전송하지 않는다.

로그아웃·계정/백엔드 변경 때 실행 epoch를 바꾸고 진행 중 요청을 취소한다. 취소가 늦어 이전 응답이 도착해도 epoch와 scope가 다르면 현재 계정 상태·북마크에 적용하지 않는다. 서버에 이미 승인된 이전 계정의 변경은 그 계정의 다음 재로그인에서 확인한다.

로그아웃 시 즉시 동기화를 멈추고 이 장치의 서버 등록 철회와 해당 세션 signOut(local scope)을 시도한다. 오프라인이면 서버 철회 미완료를 명시하고 다른 장치에서 철회할 수 있게 한다. 로컬 토큰은 제거한다. 미전송 변경은 계정별로 보존하거나 사용자가 내보낸 후 명시적으로 폐기할 수 있다. 기본 북마크는 삭제하지 않는다.

같은 계정 재로그인은 서버 상태와 대기 의도를 비교한 뒤 재개한다. 다른 계정/다른 backend는 새로운 폴더 선택·병합 미리보기를 거친다. 같은 로컬 폴더를 재사용하면 기존 북마크가 새 계정에 업로드될 수 있음을 확인 화면에서 설명한다.

### 11.4 계정 삭제

설정 하단에 데이터 내보내기와 계정 삭제를 제공한다. 서버에서 최근 5분 이내 새 Google 로그인으로 생성된 세션인지 확인하고 삭제 대상을 확인받는다. 기존 refresh로 바뀐 JWT iat만으로 최근 재인증을 판단하지 않는다. 기존 계정과 재로그인 계정이 같아야 하며 실제 세션 생성 시각·인증 방식은 서버에서 확인한다. Google의 기존 로그인 세션으로 인증될 수 있으므로 매번 비밀번호/MFA 재입력을 강제한다고 안내하지 않는다.

관리자 자격 증명을 가진 작은 Edge Function이 인증된 본인 계정만 삭제한다. 먼저 workspace를 deleting 상태로 잠그고 모든 장치를 차단한다. 이후 Auth 사용자와 연관 데이터를 삭제하며, 중간 실패는 같은 요청으로 재시도 가능해야 한다. 다른 accountId를 body로 받아 삭제하지 않는다. 브라우저에 남은 북마크는 유지한다. 백업의 최종 소거 시점은 보존 정책과 함께 명시한다.

삭제 endpoint의 재시도 경로는 일반 sync RPC의 장치 차단과 구별한다. 같은 본인의 검증된 최근 재인증과 삭제 요청 ID로 deleting 작업만 재개할 수 있고 북마크 조회·쓰기 권한을 다시 주지 않는다. Auth 사용자 삭제 후 재시도가 불가능해지는 문제는 DB 연관 행의 ON DELETE CASCADE와 작업 순서로 해결하고 중간 실패를 테스트한다.

### 11.5 백엔드와 host permission

공식 빌드는 운영 프로젝트 URL과 public publishable key를 빌드 설정에 둔다. 운영 프로젝트가 없으면 개발 빌드라고 표시한다. 설정의 고급 영역에서 개인 Supabase URL과 공개 키를 입력할 수 있다. URL/TLS 검증 후 임시 연결 설정으로 로그인·장치 등록하고, 동기화 활성화 전에 응답 schema·protocol을 검증한다. 인증 전 private sync_info를 읽을 수 있다고 가정하지 않는다.

기본 빌드는 필요한 공식 origin만 접근한다. 개인 프로젝트 연결은 사용자 클릭 시 그 origin의 optional host permission을 요청한다. 넓은 optional 선언이 필요해도 실제 부여 범위는 선택한 origin으로 제한한다. 개발 HTTP 예외는 127.0.0.1만 허용하고 별도 개발 manifest로 격리한다.

SDK transport를 포함해 다른 origin으로 redirect될 때 인증 헤더가 전달되지 않게 검증한다. Chrome match pattern의 포트 제약과 별개로 앱은 정확한 origin/port를 저장·검사한다. TLS 오류 무시 옵션은 없다. 백엔드 변경은 로그아웃·로컬 상태 격리·새 온보딩을 거친다.

## 12. 보안·개인정보·운영 한도

### 12.1 분명히 공개할 개인정보 사실

- v1 서버는 북마크 제목·URL·폴더 구조를 읽을 수 있다. E2EE·zero-knowledge라는 표현은 금지한다.
- 공식 서비스 운영 주체·저장 지역·연락처를 개인정보 문서에 공개한다. 개인 프로젝트 사용자는 자신의 운영 정책을 따른다. 오픈소스 MIT와 무료 호스팅 영구 제공은 별개다.
- analytics·광고·외부 favicon 요청·방문 기록 수집은 없다.
- 북마크 주소를 서버가 fetch하지 않는다. 링크 상태 검사도 없다.
- URL은 secret을 포함할 수 있다. 로그·오류 추적·스크린샷·지원 파일에서 기본 마스킹한다.
- 오래된 서버 백업은 삭제된 북마크를 포함할 수 있다. 복원·폐기 정책은 운영자 문서에 명시한다.

### 12.2 입력·출력 경계

- 클라이언트 schema와 SQL 경계 검증으로 요청·응답을 검증한다. TypeScript 타입만 믿지 않는다.
- SQL은 매개변수 바인딩과 schema-qualified 참조를 사용한다. 동적 SQL이 필요하면 식별자·값을 구분하고 엄격히 검증한다.
- bookmark title·URL은 React 텍스트로 표시한다. innerHTML로 렌더링하지 않는다.
- v1 동기화 URL은 http/https만 허용한다. `javascript:`, `data:`, `file:`, 브라우저 내부 URL은 원래 브라우저에 남겨 두고 제외 건수를 표시한다. 알려진 항목이 제외 URL로 바뀌면 자동 삭제 대신 검토 상태로 둔다.
- 허용 URL도 서버가 실행/열지 않는다. 사용자 클릭 시에만 브라우저에서 연다.
- runtime 메시지는 종류·payload·sender를 검증한다. 외부 메시지 수신·web accessible 비밀 페이지는 만들지 않는다.
- CSP로 원격 코드·eval·인라인 실행을 금지한다. 원격 서버 응답은 데이터로만 사용한다.

### 12.3 한도 기본값

| 항목 | 기본 한도와 처리 |
|---|---|
| 활성 node | 보관함당 10,000; LIMIT_EXCEEDED, 기존 데이터 유지 |
| folder depth | 32; 초과 항목 제외/거부와 원인 표시 |
| title | UTF-8 4 KiB |
| URL | UTF-8 16 KiB |
| operation body | 2 MiB; 대규모 reorder 포함 실측 |
| snapshot | 최대 32 MiB 비압축, 초과 명시 오류 |
| 변경 RPC | 장치당 분당 120회, DB에서 원자적 제한; RATE_LIMITED+retryAfterSeconds |
| 조회 RPC | bounded page/응답 크기; 운영 게이트웨이·프로젝트 사용량 제한 확인 |
| OAuth | Supabase/Google 로그인 제한, 중복 로그인 시도 차단 |
| 실시간 | 프로필당 socket 1개, 재접속 backoff+jitter, 공급자 연결·메시지 한도 관찰 |
| 로컬 백업 | 최근 5개, 총 100 MiB; 초과 시 export 안내 |
| 서버 DB | 운영자 지정 용량 한도, 디스크 부족 시 쓰기 실패를 정확히 알림 |

로그는 method·route template·status·duration·requestId·에러 코드 중심이다. Authorization, OAuth code/verifier, refresh token, title, URL, folder path, 전체 body를 기록하지 않는다. 버그 리포트 export에도 동일 기준을 적용한다.

한도는 목표 workload와 함께 측정하고 필요하면 `docs/DECISIONS.md`에 근거를 적어 조정한다. 조용한 truncation은 금지한다.

## 13. 오류 분류와 재시도

| 상황 | 동작 | 사용자 문구 예 |
|---|---|---|
| 오프라인·HTTP 5xx | outbox 유지, 1→2→5→15분 backoff+jitter | 연결되면 자동으로 다시 시도해요 |
| HTTP 401 | worker에서 세션 갱신 한 번, 실패하면 재로그인 | 다시 로그인해 주세요 |
| DEVICE_REVOKED / SESSION_INVALID | 재등록·자동 재시도 중지, 로컬 변경 보존 | 이 장치의 연결이 해제됐어요 |
| FORBIDDEN | 접근 중단, 계정·대상 확인 | 이 데이터에 접근할 수 없어요 |
| REVISION_CONFLICT | 관련 의도와 원격 상태 저장·보류 | 같은 북마크가 양쪽에서 변경됐어요 |
| CURSOR_EXPIRED | snapshot 재구성, intent 유지 | 오래된 변경 내역을 다시 확인하고 있어요 |
| LIMIT_EXCEEDED / HTTP 413 | 반복 재시도 금지, 데이터 유지 | 동기화할 항목이 지원 한도를 넘었어요 |
| HTTP 429 / RATE_LIMITED | Retry-After 또는 retryAfterSeconds 존중 | 잠시 후 다시 동기화해요 |
| 버전·generation 불일치 | 쓰기 정지, 비교·복구 | 서버와 확장 상태를 확인해 주세요 |
| 로컬 저장 실패 | 성공 표시 금지, 변경 작업 정지 | 변경 기록을 저장하지 못했어요 |
| 브라우저 권한 철회 | 해당 collection 정지 | 북마크 접근 권한이 필요해요 |
| 루트/mapping 유실 | 삭제 전파 금지, 복구 상태 | 연결 폴더를 다시 확인해 주세요 |
| 불확실한 create journal | 해당 collection 정지 | 중단된 작업을 확인해야 해요 |

도메인 오류 코드와 HTTP 상태를 혼동하지 않는다. DB RPC의 ok:false를 성공 처리하지 않는다. 네트워크 타임아웃 기본 15초이며 작업 크기는 worker 수명과 실측에 맞춰 조정한다. retry 시각은 영속화하고 worker 재기동 때 초기화하지 않는다.

정상 성공 문구는 `이 브라우저는 최신 상태예요`다. 연결된 각 활성 collection에 outbox·미적용 inbox·충돌·차단 journal이 없고 로컬 상태가 마지막 서버 확인 상태와 같을 때만 표시한다. 일부 폴더가 정지된 경우 17.2절처럼 범위를 명시한다. `마지막 서버 확인` 시각을 같이 보여 주며 다른 꺼진 장치까지 최신이라는 뜻으로 쓰지 않는다.

## 14. 백엔드 선택과 비용 방향

### 14.1 권장 결론

**관리형 Supabase로 시작한다.** 사용자는 확장에 로그인만 하고, 개발자는 Auth·PostgreSQL·마이그레이션을 관리한다. 별도 상시 Node 서버는 필요하지 않다. 서버 기능은 필요하지만 VM을 직접 운영할 필요는 없다.

북마크 JSON 하나를 계정별로 덮어쓰는 구현은 작지만, 두 장치가 동시에 편집하면 먼저 저장한 변경이 사라질 수 있다. 데이터 크기보다 변경의 순서·충돌·오프라인 삭제·재전송을 일관되게 처리하는 것이 핵심이다. 그래서 원본 데이터와 변경 명령·버전·복구 기록을 함께 저장한다.

| 방안 | 장점 | 이 프로젝트의 판단 |
|---|---|---|
| Supabase Auth + Postgres RPC | 로그인·SQL 트랜잭션·접근 제어를 한곳에서 관리 | 기본안 |
| 직접 API 서버 + DB + 인증 | 운영·성능 선택 폭이 넓음 | 현재 규모에서 직접 관리할 부분이 많음 |
| Cloudflare Workers + DB + 별도 인증 | 작은 사용량에서 비용 경쟁력 가능 | 인증·트랜잭션 설계를 추가로 통합해야 하므로 보류 |
| Firebase | 인증·데이터 클라이언트 생태계 | 읽기 패턴과 계층형 충돌 모델 검증이 별도로 필요 |
| Drive/WebDAV JSON 파일 | 사용자의 저장소 활용 | 서비스 계정 경험과 동시 편집 해결이 별개라 v1 제외 |
| chrome.storage.sync | Chrome 확장 설정 동기화에 편리 | Chrome/Aside를 아우르는 자체 계정 백엔드가 아님 |

이는 최소 청구액만의 비교가 아니라 첫 공개 버전까지의 구현·운영 부담을 포함한 선택이다. [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [Firebase 요금](https://firebase.google.com/pricing)

### 14.2 가격 기준과 예산

2026-09-29 확인 기준 Supabase Free는 DB 500 MB·egress 5 GB이며 자동 DB 백업이 포함되지 않고 비활성 프로젝트 일시 정지가 있다. Pro는 월 $25부터, DB 8 GB·egress 250 GB·일일 백업 7일 보관이 포함된다. 이 문서가 특정 사용자 수에서 그 요금만 나온다고 보장하지 않는다. [공식 요금](https://supabase.com/pricing)

- 개인 개발·소규모 검증: 무료 프로젝트 또는 로컬 개발부터 시작.
- 공개 운영: 월 $25 수준의 DB/인증 기본비 + Realtime 초과 사용량 + 필요 도메인 등을 예산안으로 제시.
- Google 로그인만 쓰는 v1에서는 인증 메일용 SMTP를 필수로 구매하지 않는다. OAuth 공개 설정·브랜드 검증·필요 도메인은 별도로 준비한다.
- 원격 프로젝트를 한 개 더 만들거나 compute를 키우면 청구 구조가 달라질 수 있다. 무료 MAU 숫자를 북마크 서비스의 수용 사용자 수로 해석하지 않는다.
- 결제 직전 가격·포함량·spend cap 적용 범위를 재확인한다. 모든 부가 비용이 cap으로 차단된다고 가정하지 않는다.

### 14.3 직접 계산하는 사용량

아래는 실측이 아닌 설계 추정치다. decimal MB/GB를 쓴다.

계정당 북마크 1,000개 × 평균 500 bytes → 원본 약 0.5 MB. DB row·index 등으로 3배를 가정하면 약 1.5 MB/계정이며 변경 이력·인증 데이터·백업은 별도다.

실시간에서는 저장량 외에 **동시에 켜진 브라우저 프로필 수와 메시지 수**를 봐야 한다. 계정 100명이 Chrome·Aside를 모두 켜면 약 200개 연결이다. 전체 가입자 수와 동시 접속 수는 다르다.

| 추정 항목 | 예시 가정 | 계산 |
|---|---|---|
| 동시 연결 | 동시 활동 100계정 × 2프로필 | 200 sockets |
| 변경 알림 전달 | 100계정 × 하루 20변경 × 2수신 프로필 × 30일 | 월 120,000회 전달 |
| 보조 조회 | 100계정 × 2프로필 × 8시간 × 60/5 × 30일 | 월 576,000 RPC |
| 보조 조회 응답 | 1 KB 가정 | 월 약 0.576 GB |
| socket 유지 | 25초 heartbeat를 가정할 때 프로필당 하루 8시간 | 하루 1,152 왕복, 실제 SDK 설정 확인 |

메시지 전달 수는 공급자의 청구 메시지 수와 동일하다고 가정하지 않는다. 송신·수신 fan-out·heartbeat·재연결·초기 구독 비용의 집계 방식은 실제 미터와 대조한다. 별도의 폴더별 채널이나 UI별 socket을 만들지 않는다.

확인 기준 Realtime 동시 연결 기본 한도는 Free 200, Pro 500이며 프로젝트 설정·spend cap에 따라 달라진다. 따라서 작은 개인 이용은 가볍게 시작할 수 있지만 “북마크 JSON이 작으니 많은 사용자도 무조건 무료”라고 결론내리지 않는다. [Realtime 한도](https://supabase.com/docs/guides/realtime/limits)

전체 snapshot은 첫 연결·복구 때만 사용하고 평소에는 작은 알림과 delta RPC를 사용한다. 전체 JSON을 매번 전송하면 한 계정·두 프로필·하루8시간·5분 간격만으로도 0.5 MB × 5,760회 = 월2.88 GB가 된다.

### 14.4 비용과 즉시성의 균형

- 기본 UX는 실시간 자동 동기화다. 비용 때문에 임의로 5분 지연 방식으로 되돌리지 않는다.
- 5분 확인은 알림 유실·연결 장애·worker 재기동을 복구하는 보조 경로다.
- batch마다 작은 changed 알림 한 번, 수신 측에서는 겹친 알림을 합쳐 delta를 조회한다.
- 변경 없는 조회는 commit/receipt를 만들지 않는다. lastSeenAt도 15분 단위 등으로 묶는다.
- 자동 동기화를 끄거나 로그아웃하면 socket을 닫는다. 켜져 있는 동안은 유휴 연결의 자원 비용을 측정한다.
- 프로젝트별 DB 크기·응답 bytes·동시 socket·메시지량·재접속률·지연을 관찰한다. 북마크 본문을 운영 지표로 수집하지 않는다.
- 사용 한도 70% 경고, 85% 운영 검토, 90% 새 대규모 import 제한을 운영 지침으로 둔다. 기존 데이터를 임의 삭제하지 않는다.
- Realtime 한도 때문에 연결이 거절되면 상태를 알리고 backoff로 복구한다. 주기 확인으로 데이터는 따라잡되 “실시간 정상”으로 표시하지 않는다.

## 15. 이름·브랜드·아이콘

### 15.1 확정된 방향

제품명은 **shatsu-ren**, 한국어 표기는 **샤츠렌**이다. 레포·패키지·빌드 파일은 shatsu-ren을 사용한다. 사용자가 제시한 “북마크를 렌즈로 찍어 담는다”는 이미지를 브랜드 이야기로 삼는다.

이를 정확한 일본어 어원이라고 단정하는 설명은 만들지 않는다. 사용자에게 이름을 다시 고르게 하거나 임의로 철자를 바꾸지 않는다. 상표·스토어 중복 확인은 배포 전 별도로 한다.

짧은 소개 초안: “어느 브라우저에서든, 담아 둔 북마크 그대로.”
영문 설명 초안: “Your bookmarks, across browsers.”
UI에서는 실제 기능인 로그인·연결·동기화를 명확히 말한다. 카메라 접근이나 스크린샷 저장 기능으로 오해시키지 않는다.

### 15.2 아이콘·색상 보류 계약

사용자가 아이콘 결정을 나중으로 미뤘다. 기존 단색·입체·민트 카툰 시안과 제안된 대체 색상은 모두 미채택이며 구현 기준으로 사용하지 않는다. 새 아이콘 생성이나 색상 선택 질문을 기능·화면 설계의 선행 단계로 두지 않는다.

브랜드 방향 기록은 “카툰 느낌의 사진기 안에 책이 잘 보이는 형태”까지만 남긴다. 형태도 최종 승인된 것은 아니다. 사용자가 다시 아이콘 작업을 요청하면 이 기록에서 재개한다.

향후 로컬 구현에서는 화면 헤더에 shatsu-ren 텍스트를 사용한다. manifest에 필요한 아이콘은 라이선스가 확인된 단순한 단색 임시 자산으로 넣고 교체 위치를 한곳으로 모은다. 임시 자산을 최종 브랜드라고 소개하거나 기존 생성 이미지로 자동 대체하지 않는다. 아이콘 결정은 로컬 기능 검증을 막지 않으며, 공개 스토어 자산 확정은 별도 남은 단계로 기록한다.

최종 아이콘을 만들 때는 편집 가능한 원본, 16/32/48/128 px 출력, 밝고 어두운 툴바에서 식별성을 확인한다. 상태는 별도 badge와 문구로 나타내며 로고를 계속 회전시키지 않는다. 공개용 스크린샷에는 합성 북마크만 넣는다.

## 16. 화면·흐름·문구 명세

### 16.1 전체 구성

툴바 팝업은 상태 확인과 빠른 동작, 전체 설정 탭은 연결·내역·문제 해결을 담당한다. 새 탭 페이지를 대체하지 않는다. 북마크 편집은 기존 브라우저 UI를 계속 쓴다.

전체 탭의 주요 탐색은 개요 / 연결 폴더 / 변경 내역 / 복구 / 설정이다. 충돌·대량 삭제·복구 필요 작업은 개요의 `확인할 변경` 목록에서 상세 화면으로 진입한다. 장치 관리는 설정 안에서 제공하고 개요의 연결 브라우저 요약에서도 바로 연다. 항목이 없을 때 빈 충돌 메뉴를 상시 노출하지 않는다. 로그인 이전에는 온보딩만 보여 준다. 별도 랜딩 웹앱은 만들지 않는다.

사용자에게는 장치 대신 `연결된 브라우저`를 기본 용어로 사용한다. 기술적으로는 브라우저 프로필 하나가 장치 하나라는 설명을 설정에 둔다. 내 Google 계정, 이 브라우저의 폴더, 계정에 저장된 공유 폴더를 구별한다. UUID·collection·cursor·RPC는 진단 화면 외의 제품 문구에 노출하지 않는다.

### 16.2 온보딩

| 단계 | 표시·동작 | 다음으로 진행하는 조건 |
|---|---|---|
| 시작 | 무엇이 동기화되는지, 서버가 내용을 읽을 수 있음, 개인정보 링크 | 로그인 시작 |
| Google 로그인 | Google로 계속하기, 계정 선택/동의, 취소/실패 처리 | 실제 PKCE 교환·계정 확인 성공 |
| 브라우저 등록 | 로그인 완료 화면에서 자동 제안 이름 수정 가능, 별도 필수 입력 화면 없음 | 서버 장치 등록 완료 |
| 폴더 | 로컬 트리 선택, 기존 원격 연결 폴더 선택/새 연결 | 읽기 가능하고 중첩 없음 |
| 미리보기 | 양방향 추가·중복·제외·순서 변화, 삭제 0, 백업 | 최신 fingerprint에 대한 사용자 확인 |
| 첫 적용 | 실제 완료 수/전체 수, 안전한 일시 정지 | journal·queue 상태 검사 통과 |
| 완료 | 이 브라우저의 적용 결과, 연결된 폴더, 다른 브라우저 연결 방법 | 팝업/개요로 이동 |

자동 장치 이름에 실제 머신 이름을 읽으려고 추가 권한을 요구하지 않는다. 브라우저와 사용자 입력으로 충분하다. 인증 중 팝업을 닫아도 전체 탭에서 다시 진행할 수 있다. 로그인 취소 시 기존 북마크는 그대로 두고 재시도할 수 있게 한다.

최초 병합은 planId·원격 seq·로컬 fingerprint·안정된 UUID 집합을 저장한다. 큰 import는 순서대로 작은 명령을 적용하고 중단 지점부터 재개한다. 도중 원격 충돌이 나면 완료된 항목을 롤백하는 척하지 말고 남은 계획을 새로 계산한다. 최초 등록 성공 여부가 불확실할 때 새 UUID로 일괄 재업로드하지 않는다.

사용자에게 보이는 진행 단계는 `로그인 → 폴더 연결 → 변경 확인 → 연결 완료` 네 단계다. 브라우저 등록과 적용 작업은 그 안에서 처리한다. 온보딩은 전체 확장 탭에서 진행하고 팝업의 `연결 시작`/`이어서 연결`은 같은 탭을 열거나 재사용한다. 페이지를 닫거나 다시 열어도 서버 결과와 저장된 진행 상태에서 복원한다.

#### 첫 번째 브라우저와 추가 브라우저

- 첫 연결: `어떤 폴더를 함께 사용할까요?` 아래 로컬 트리를 표시한다. 폴더 선택 후 공유 이름을 제안하고 사용자가 수정할 수 있다. 다음 버튼은 적어도 하나의 유효한 선택이 있어야 활성화된다.
- 추가 연결: 먼저 계정에 이미 연결된 공유 폴더를 보여 주고, 각 행에서 `이 브라우저의 폴더 선택` 또는 `새 폴더에 받기`를 고른다. 이름이 같다는 이유로 자동 선택하지 않는다. 로컬 폴더를 새 공유 폴더로 추가하는 행동은 따로 표시한다.
- 어느 경우든 현재 Google 계정 이메일을 상단에 보여 준다. `계정 바꾸기`는 11.3절 격리를 따른다. 같은 이메일의 브라우저 프로필을 자동 로그인으로 간주하지 않는다.
- 새 수신 폴더는 사용자가 선택한 쓰기 가능한 부모 아래에 만든다. 미리보기 단계에서는 실제 폴더를 생성하지 않는다. 동명 폴더가 있으면 기존 폴더를 몰래 재사용하지 말고 다른 이름을 제안한다.
- 첫 브라우저 완료 화면에는 `다른 브라우저에도 확장을 설치하고 같은 Google 계정으로 로그인하세요`를 표시한다. 다른 브라우저 설치·로그인이 관찰되지 않았다면 연결 완료로 꾸미지 않는다.

#### 변경 확인 화면

```text
변경 내용을 확인하세요                 [계정 이메일]
공유 폴더: 개인 북마크 / 이 브라우저: 북마크바

이 브라우저에 추가                       12개
계정에 추가하고 연결된 브라우저로 보내기    8개
이미 같은 항목으로 연결                  240개
두 항목을 모두 유지할 중복 후보             3쌍
동기화에서 제외                           2개
삭제                                    0개

[순서 변경 보기]  [항목별 내용 보기]
백업: 이 브라우저에 저장됨  [백업 다운로드]

[뒤로]                         [확인하고 연결]
```

숫자는 설명용 합성 예시다. 실제 화면은 계획 결과만 표시한다. 북마크와 폴더를 합친 수에는 `항목`을 쓰고 펼치면 두 종류의 개수를 구분한다. 중복 후보 쌍은 항목 합계에 다시 더하지 않는다. 계정에 추가된 내용은 연결된 다른 브라우저의 실행·네트워크·검토 상태에 따라 나중에 적용될 수 있다.

`항목별 내용`은 적용 방향·현재 경로·예정 경로·제목을 보여 준다. 긴 URL은 상세에서 확인한다. 순서가 바뀌는 폴더는 전후 목록을 제공한다. 중복 후보는 유지 이유만 설명하며 이 단계에 새 중복 정리 도구를 추가하지 않는다. 제외 항목도 이유와 함께 로컬에 남는다고 설명한다.

자동 백업 저장이 실패하면 적용 버튼을 비활성화하고 재시도·내보내기 경로를 제공한다. 파일 다운로드 버튼을 눌렀다는 이유만으로 백업 성공으로 간주하지 않는다. 사용자의 적용 확인 전에는 북마크 변경과 서버 항목 업로드를 시작하지 않는다. 로그인과 브라우저 등록은 이미 완료될 수 있다.

미리보기 이후 변경이 감지되면 `북마크가 바뀌어 내용을 다시 확인해야 해요`를 표시하고 계획을 갱신한다. 이전 승인으로 갱신된 계획을 실행하지 않는다. 진행 중에는 실제 완료/전체 수를 표시하고 전체 수가 미정이면 단계만 표시한다. `일시 정지`는 진행 중 명령의 결과를 기록한 안전 지점에서 멈추며 `취소하면 모두 원래대로 돌아감`을 약속하지 않는다.

### 16.3 팝업

폭 약 360 px, 내용에 따른 높이 최대 약 560 px를 목표로 실제 Chromium 팝업에서 확인한다.

```text
shatsu-ren                         [설정]
이 브라우저는 최신 상태예요
마지막 서버 확인 · 방금

실시간 연결 중 · 연결 폴더 2개
보낼 변경 0개 · 적용 대기 0개

[지금 확인]
최근 변경                         [모두 보기]
Aside · 북마크 1개 추가              1분 전
```

- 주 행동 하나: 정상일 때 지금 확인, 검토가 있으면 변경 검토. `지금 확인`도 동일 동기화 실행기를 실행하므로 대기 변경이 있으면 전송·적용한다. 자동 동기화를 위해 매번 눌러야 하는 버튼처럼 안내하지 않는다.
- 로그인되지 않았으면 로그인 버튼과 간단한 설명.
- 실패 시 해당 오류와 재시도 또는 설정 열기를 표시. 일반적인 “알 수 없는 오류”만 남기지 않는다.
- 버튼을 누른 즉시 중복 요청을 막되 worker 진행 상태를 받아 갱신한다.
- 마지막 확인 시각은 실제 데이터 기반이다. 임의 성공 카운터·가짜 아바타·연결되지 않은 장치 이름을 채우지 않는다.
- 최근 변경은 최대 3개를 간단한 행으로 표시한다. 기록이 없으면 `연결 후 변경 내역이 여기에 표시돼요` 한 문장만 사용한다. 큰 성공 일러스트나 같은 정보를 반복하는 카드를 넣지 않는다.
- 계정 이메일과 연결된 브라우저 목록은 설정에서 확인한다. 팝업 공간을 프로필 카드로 채우지 않는다.
- 보낼 변경·적용 대기는 엔진의 작업 수다. 충돌·검토 건수를 별도로 표시하고 합산 총계를 중복 계산하지 않는다. 전송 대기 0만으로 성공 상태가 되지 않는다.
- 정상 표시의 범위는 이 브라우저와 마지막으로 확인한 서버 상태다. 다른 브라우저의 실제 반영 확인 기능은 v1에 없으므로 `모든 기기 최신`이라는 문구를 쓰지 않는다.

### 16.4 개요와 연결 폴더

개요 상단에 계정, 이 브라우저 상태, 마지막 서버 확인, 지금 확인을 둔다. 확인할 변경이 있으면 바로 아래에 사유·영향 폴더·다음 행동을 보여 준다. 이후 연결 폴더 목록과 최근 변경 최대 5개를 보여 준다. 통계 차트는 v1에 필요하지 않다.

연결 폴더 행은 원격 이름 / 로컬 경로 / 활성 항목 수 / 상태 / 관리 메뉴를 표시한다. 연결 추가, 일시 정지, 재개, 로컬 폴더 다시 선택, 연결 해제를 제공한다. 연결 해제는 서버/로컬 북마크 삭제와 분리한다.

재연결은 6절의 미리보기를 사용한다. 하위 폴더를 새 연결로 추가하려는 경우 겹치는 기존 연결 이름을 설명한다. 폴더 트리에는 관리형·지원 불가 항목의 이유를 표시한다.

공유 폴더 이름과 로컬 폴더 이름은 따로 표시한다. 공유 이름을 고쳐도 브라우저 폴더를 몰래 개명하지 않는다. 연결 해제 확인은 `이 브라우저의 연결 해제`라고 쓰고 로컬 북마크와 계정의 공유 데이터가 유지됨을 설명한다. 연결 해제는 다른 브라우저의 연결을 끊지 않는다.

### 16.5 변경 내역

시간·장치·동작·항목을 보여 주고 기간/장치/동작 필터를 제공한다. 대형 작업은 한 묶음으로 표시하고 펼쳐서 볼 수 있다. 페이지네이션 또는 더 보기로 읽으며 무한히 모든 로그를 한 번에 불러오지 않는다.

내역에서 보이는 제목·URL은 해당 계정의 권한으로 읽은 데이터만 사용한다. 서버에 저장되는 변경 로그에는 북마크 데이터가 포함됨을 보존 정책에 적는다. 만료된 본문은 “내용 보존 기간이 지났어요”로 표시한다.

### 16.6 충돌

행에는 이유·발생한 장치·항목·미해결 상태를 보여 준다. 상세 화면은 내 변경 / 서버 변경의 제목·URL·폴더를 비교한다. 달라진 필드만 강조하고 전체 URL 복사는 명시적 버튼으로 한다.

선택지는 내 변경 사용 / 서버 변경 사용 / 둘 다 보관(북마크만)이다. 삭제 대 수정에서는 저장할 수정 내용을 먼저 보여 준다. 대량 충돌을 한 번에 덮어쓰기하는 버튼은 v1에 없다. 처리 중 새 revision을 만나면 재확인한다.

선택 전 `이 선택으로 무엇이 바뀌는지`를 한 문장으로 표시한다. 예: `이 브라우저에서 수정한 제목을 계정에 저장하고 다른 브라우저에도 보내요`. 삭제 충돌은 `삭제 유지`/`수정한 북마크 보관`처럼 결과를 명시한다. `나중에`는 미해결 상태를 유지하며 승인으로 취급하지 않는다. 영향을 받지 않는 폴더는 동기화를 계속하고, 동일 항목·부모·순서에 의존하는 작업은 함께 보류한다.

대량 삭제 검토는 발신과 수신을 구분한다. 발신 화면은 `이 브라우저에서는 이미 삭제됐어요. 다른 브라우저에도 삭제를 보낼까요?`, 수신 화면은 `다른 브라우저에서 삭제한 항목을 여기에서도 삭제할까요?`라고 설명한다. 전자는 10.2절의 삭제 전송/로컬 복구 선택을, 후자는 적용/보류와 백업 내보내기를 제공한다. 미전송 수정이 섞였다면 먼저 충돌을 해결한다. 닫기·뒤로·Escape는 승인하지 않고 보류한다.

### 16.7 복구

탭은 휴지통 / 이 브라우저 백업이다. 삭제 묶음은 항목 수·삭제 시각·복구 가능 기한을 표시한다. 복구 위치 선택 후 추가·이동·덮어쓰기 여부를 미리 보여 준다.

로컬 JSON 가져오기에는 파일 버전·항목 수·지원하지 않는 URL·용량 초과를 검증한다. 기본은 새로운 UUID로 추가하며 기존 보관함을 덮어쓰지 않는다. 파일을 파싱했다는 이유로 즉시 실제 북마크를 변경하지 않는다.

### 16.8 장치와 설정

장치: 이름·브라우저 정보·최근 서버 활동·현재 장치·철회. 최근 활동이 온라인 접속 보장이라는 문구는 쓰지 않는다. 다른 장치를 철회하면 그 장치에 남은 북마크는 삭제되지 않는다고 설명한다.

설정: 자동 동기화·실시간 연결 상태·언어·테마·개인정보·내보내기·로그아웃. 고급 접기 영역에 개인 Supabase 프로젝트 연결과 익명화된 진단 내보내기. 계정 삭제는 하단의 구별된 영역에 배치한다.

자동 동기화는 첫 연결 완료 후 기본 켜짐이다. `자동 동기화 끄기`는 미전송 기록을 남기되 push·Realtime 연결·보조 조회를 멈춘다. `지금 한 번 동기화`는 명시적 1회 실행이며 설정을 다시 켜지 않는다. 자동 재개 때 누락 이벤트를 재조정한다.

#### 일시 정지·재개 동작

전역 자동 동기화 끄기는 이 브라우저에만 적용된다. 다른 브라우저는 계속 동작한다. 로컬 변경 기록·안전한 복구 기록은 계속 보존한다. 이미 전송한 명령은 취소가 보장되지 않으므로 결과 확인이 끝날 때까지 `일시 정지 중`으로 표시하고 새 명령을 시작하지 않는다.

폴더별 일시 정지는 전역 자동 동기화와 별개다. 해당 폴더의 전송과 native 적용만 중지하고 공유 서버 변경을 읽거나 보관하는 것은 가능하다. 다른 활성 폴더가 있으면 socket을 유지한다. `지금 확인`/`지금 한 번 동기화`는 폴더별 정지를 우회하지 않는다. 폴더의 `재개`로만 다시 적용 대상에 포함한다. 모든 폴더가 정지된 경우 자동 socket·보조 조회를 멈춘다.

재개 시 현재 트리·서버 변경·남아 있는 로컬 의도를 비교한다. 일시 정지 중 양쪽에서 수정된 항목은 일반 충돌 규칙을 따른다. 정지는 백업이나 연결 해제를 대신하지 않는다.

#### 로그아웃·오류에서 빠져나오기

- 미전송 변경이 없으면 로그아웃은 바로 처리하고 기본 북마크를 유지한다. 대기가 있으면 기본 선택 `이 계정의 대기 변경을 보관하고 로그아웃`과 내보내기/명시적 폐기를 제공한다.
- 네트워크 실패는 로컬 인터넷 단절과 서버 응답 실패를 구분할 근거가 있을 때만 구체화한다. 그 외에는 `서버에 연결하지 못했어요`로 표시한다. 자동 재시도 시각과 마지막 성공 시각을 분리한다.
- 실시간 알림만 끊기고 RPC가 동작하면 `실시간 연결 재시도 중 · 주기적으로 확인하고 있어요`로 표시한다. 양쪽 모두 실패하면 주기 동기화가 정상이라고 안내하지 않는다.
- 진단 상세는 오류 코드·시각·요청 ID를 펼쳐 보여 준다. 첫 화면에는 이유와 가능한 행동 하나를 우선한다. 내보낸 진단에 실제 URL이나 로그인 토큰을 포함하지 않는다.

## 17. 디자인 시스템·상태·접근성

### 17.1 시각 기준

차분한 도구형 UI. 현재는 정보 구조·문구·상태를 설계하며 시각 디자인 승인을 주장하지 않는다. 아이콘과 브랜드 색은 나중에 결정한다. 아래는 기능 검토를 위한 중립적인 임시 토큰이다. 기존 생성 팝업이나 민트 아이콘에서 색을 가져오지 않는다. 사진 갤러리·큰 히어로·글래스 배경을 확장 설정에 넣지 않는다.

| 토큰 | 밝은 테마 초안 | 어두운 테마 초안 |
|---|---|---|
| background | #F7F8FA | #10151D |
| surface | #FFFFFF | #19222D |
| text | #162331 | #EDF2F7 |
| muted | #526171 | #A8B5C4 |
| border | #D4DCE5 | #3A495B |
| accent | #303030 | #E8E8E8 |
| danger | #B42336 | #FF909E |
| warning | #8A5300 | #F4C879 |

이는 시작 토큰이며 실제 대비 검사 후 조정한다. 색을 화면마다 하드코딩하지 않는다. 간격 4/8/12/16/24/32 px, 컨트롤 높이 36~40 px, 주요 탭 버튼 40 px 이상, radius 8/12 px. 시스템 sans-serif를 써 한글 fallback과 오프라인 표시를 확보한다. 외부 폰트를 자동 다운로드하지 않는다.

설정 탭 최대 본문 폭 약 1080 px, 사이드바 약 192 px. 좁은 폭에서는 탭 탐색이 상단으로 바뀌고 표는 의미 있는 카드로 줄인다. 200% 확대에서 핵심 버튼이 잘리지 않게 한다.

### 17.2 단일 상태 모델

계정 상태와 동기화 상태를 분리한다. 로그인됐다고 동기화 성공이 아니다.

| 동기화 상태 | 표시 | 행동 |
|---|---|---|
| unconfigured | 연결할 폴더를 선택해 주세요 | 폴더 연결 |
| idle | 이 브라우저는 최신 상태예요 + 마지막 서버 확인 시각 | 지금 확인 |
| syncing | 변경사항을 확인/적용하고 있어요 | 진행 상태 |
| pending | 보낼 변경 N개 · 적용 대기 M개 | 지금 확인 |
| offline | 오프라인 · 변경사항 보관 중 | 연결 후 재시도 |
| reconnecting | 실시간 연결 재시도 중 · 주기 확인으로 동기화 | 재연결/지금 확인 |
| paused | 자동 동기화 일시 정지 | 재개 |
| review_required | 확인할 변경 N개 | 검토 |
| conflict | 충돌 N개 | 해결 |
| recovery_required | 중단된 작업 확인 필요 | 복구 |
| auth_required | 다시 로그인해 주세요 | 로그인 |
| blocked | 권한·버전·용량 등 구체 원인 | 해당 해결 동작 |

계정 인증, 연결 상태, 실행 상태, 폴더별 문제 목록을 별도로 유지하고 이 표의 대표 표시를 유도한다. 단일 enum을 저장하며 이전 오류를 덮어쓰지 않는다. 대표 상태의 우선순위는 auth_required → blocked → recovery_required → conflict → review_required → unconfigured → paused → offline → reconnecting → syncing → pending → idle이다. unconfigured는 연결 폴더가 전혀 없을 때만, paused는 전체 정지/자동 동기화 꺼짐일 때만 사용한다. 폴더 일부가 정지됐으면 `연결 2개 · 1개 정지`처럼 별도로 표시한다.

여러 상태가 공존하면 개요에서 각각 원인을 보이고 팝업은 가장 시급한 하나와 나머지 건수를 표시한다. 전역 자동 동기화가 꺼진 상태에서 사용자가 1회 실행 중이면 `이번 변경 동기화 중 · 자동 동기화 꺼짐`으로 표시한다. 명시적 실행 중에도 인증·차단·복구·충돌은 우선한다. worker와 연결되기 전에는 저장된 성공 상태를 현재 성공으로 표시하지 않고 `상태 확인 중`을 사용한다.

정상 성공 표시에는 모든 활성 연결의 대기/충돌/미적용/차단 작업이 없고 최신 서버 확인 결과와 로컬 상태가 일치해야 한다. socket 연결 성공이나 인증 성공만으로 idle로 바꾸지 않는다. 일부 폴더가 정지된 상태에서는 `활성 폴더는 최신 상태예요 · 1개 정지`로 범위를 명시한다.

### 17.3 접근성과 움직임

- 키보드로 로그인부터 충돌 해결까지 가능해야 한다. focus ring과 dialog focus 복귀를 제공한다.
- 폴더 트리는 검증된 tree semantics 또는 단순한 펼침 목록으로 구현하고 임의의 불완전한 ARIA tree를 만들지 않는다.
- 색만으로 성공/오류를 구별하지 않고 아이콘·문구를 함께 쓴다. 일반 텍스트 대비 4.5:1을 목표로 검증한다.
- 긴 제목은 줄임 처리해도 상세/접근성 이름으로 전체를 확인할 수 있다. URL을 깨는 자동 줄바꿈을 피한다.
- 상태 변화는 필요한 경우에만 aria-live로 알리고 매 poll마다 읽어 주지 않는다.
- 숫자·시간은 locale에 맞추되 디버깅 정보는 정확한 UTC 시각을 제공한다.
- 120~180 ms 정도의 작은 전환만 사용하며 reduced-motion에서는 제거한다. 동기화 중 무한 장식 애니메이션은 없다.
- 성공은 toast만으로 표현하지 않고 상태 화면에 남긴다. 파괴적 행동은 toast 한 번으로 승인하지 않는다.

## 18. 레포 구조·개발 규칙

기존 레포를 읽고 구조가 생겼다면 존중한다. 빈 레포일 때 아래로 시작한다.

```text
apps/extension/
  entrypoints/         background, popup, options
  src/auth/            worker 소유 인증·메시지
  src/sync/            queue, reconciliation, journal, browser adapter
  src/storage/         IndexedDB schema·migration
  src/ui/              공용 컴포넌트·화면·tokens
  src/locales/         ko, en
  public/icons/
packages/protocol/     runtime schema, canonicalization, error code, test vectors
supabase/
  config.toml
  migrations/
  tests/
  functions/delete-account/
tests/                 실제 브라우저 시나리오·합성 fixture
docs/                  설계·설치·운영·검증 결과
.github/workflows/     CI
README.md / README.ko.md / LICENSE / CONTRIBUTING.md / SECURITY.md
```

테스트 파일은 코드 가까이에 둘 수 있다. 이 구조의 빈 디렉터리나 파일을 먼저 전부 생성하지 않는다. 실제 책임이 있을 때 만든다. API backend 추상화 계층, 미래 adapter, 미구현 provider 목록을 넣지 않는다.

핵심 타입은 구별 가능한 union으로 명령·상태·결과를 표현한다. 입력은 runtime 검증하고 오류는 명시적으로 처리한다. 테스트 통과를 위해 타입/린트 오류를 숨기지 않는다. SQL과 TS의 canonical subtree digest는 공유 test vector로 같은 결과를 검증한다.

제공할 명령: install, dev, typecheck, lint, test, test:db, test:e2e, build, zip. 실제 package scripts와 README 예제가 일치해야 한다. 이름만 있고 no-op인 검증 명령은 금지한다.

필수 권한은 bookmarks, storage, alarms, identity 및 정확한 backend host다. identity는 OAuth 창과 확장 복귀에만 사용한다. downloads가 필요하지 않으면 사용자 클릭의 Blob 다운로드로 내보낸다. identity.email, history, cookies, broad tabs, content script 권한을 관성적으로 추가하지 않는다. 사용 라이브러리가 넣은 최종 manifest도 검토한다.

## 19. 오픈소스·배포물

MIT LICENSE 원문에 실제 저작권자 표기를 넣는다. LESANF가 표기명인지 구현 시 확인하고 가짜 이름으로 공개하지 않는다. 종속 라이브러리·아이콘·폰트 라이선스를 확인한다. 브랜드 권리와 MIT 코드 사용 권리는 별도로 설명할 수 있다.

영문 README를 기본으로 한국어 안내를 연결한다. 포함할 내용:
- 무엇을 동기화하는지, 지원 브라우저와 검증 버전.
- 개발 빌드 설치 / 릴리스 ZIP 설치 / 스토어 링크가 생겼을 때의 설치.
- Google 로그인·최초 병합·실시간 연결·누락 복구·오프라인 동작.
- 삭제/충돌/복구 정책과 E2EE 미지원.
- 공식 호스팅과 개인 Supabase 프로젝트 연결 방법.
- 로컬 개발·테스트·빌드·기여·보안 제보.
- 실제 합성 데이터 스크린샷, 알려진 제한, 호환성 표.

CONTRIBUTING은 작은 변경의 검증 기준·데이터 유실 버그 재현법·민감 데이터 제거를 설명한다. SECURITY는 개인 북마크·토큰을 공개 이슈에 올리지 말고 실제로 준비된 비공개 연락 경로를 안내한다. 존재하지 않는 이메일을 만들어 쓰지 않는다.

GitHub CI는 lockfile 설치, typecheck/lint, 순수 로직 테스트, 로컬 DB migration·권한 테스트, extension build를 수행한다. 가능한 Chromium 실제 테스트를 포함하되 Aside 수동 검증과 동일시하지 않는다. 공급자 실제 서비스 credential을 PR 테스트에 노출하지 않는다.

릴리스에는 버전이 있는 확장 ZIP, checksum, changelog, 지원 브라우저 버전, 업그레이드/백업 안내가 필요하다. 스토어 소개·권한 사유·개인정보 정책 초안을 준비하되 실제 제출은 별도 사용자 권한과 개발자 계정이 필요하다.

## 20. 운영·백업·개인 프로젝트 설치

### 20.1 로컬부터 운영까지

1. 로컬 Supabase를 시작하고 migration을 빈 DB에 적용한다.
2. 개발용 Google OAuth client·Supabase Google provider·정확한 callback을 설정하고 두 독립 브라우저 프로필에 같은 Google 계정으로 로그인한다.
3. 합성 데이터로 실제 동기화·실패 복구를 확인한다.
4. 운영 프로젝트가 준비되면 동일 migration을 적용하고 Google OAuth 공개 설정·Auth/redirect URL·Realtime 정책/한도를 설정한다.
5. public key만 넣은 운영 빌드를 만들고 두 브라우저 Google 로그인·실시간 동기화를 다시 확인한다.
6. 개인 프로젝트 설치 가이드를 깨끗한 별도 프로젝트에 적용해 재현성을 검증한다.

개인 Supabase 프로젝트 연결은 v1 필수다. Supabase 전체 스택을 개인 VPS에 설치하는 별도 배포 패키지는 v1 필수가 아니며 지원한다고 주장하지 않는다.

### 20.2 백업과 복원

- 로컬 백업은 병합·대량 변경 전에 만들고 다운로드 가능하게 한다. 브라우저 확장 제거 시 함께 사라질 수 있다.
- 운영 DB 백업은 공급자 기능과 별도 복원 훈련으로 확인한다. Free의 자동 백업 부재를 문서화한다.
- 백업은 접근 제한된 저장소에 보관하고 서비스 token·사용자 데이터 노출을 막는다.
- DB 복원은 요청을 먼저 중지하고 복원 후 모든 workspace의 generationId를 바꾼 다음 서비스 재개한다.
- 이전 세션 복원으로 철회된 장치가 살아날 위험을 다룬다. 복원 시 모든 장치를 재인증 상태로 전환하고 오래된 세션을 다시 허용하지 않는 절차를 검증한다.
- 클라이언트는 generation 변경을 감지하면 자동 쓰기를 멈추고 로컬·서버 차이 미리보기로 복구한다.
- migration 전 snapshot, 실패 시 rollback/forward-fix 방법, protocolVersion 호환 범위를 기록한다.
- snapshot generation 변경 전에 쓰기 트래픽을 다시 열지 않는다. “DB만 복원했으니 끝”으로 운영 절차를 끝내지 않는다.

### 20.3 보존·삭제

기본 보존: 변경 로그와 휴지통 본문 30일, 로컬 백업 최근 5개/100 MiB. 최소 tombstone과 북마크 본문 없는 receipt는 계정 유지 동안 남긴다. ID·활동 시각도 계정 관련 정보이므로 접근을 제한하고 계정 삭제 시 제거한다. 운영 백업은 실제 플랜·운영 정책의 기간 후 소거되며 즉시 모든 과거 사본에서 지워진다고 안내하지 않는다.

만료 정리는 운영용 SQL 작업으로 제공하고 scheduler 실행·실패 알림을 검증한다. 로컬 개발에서도 같은 함수를 수동 호출해 테스트할 수 있어야 한다. 정리 작업 실패가 동기화 데이터의 즉시 삭제로 이어지지 않는다.

## 21. 구현 순서와 단계별 증거

| 단계 | 구현 | 통과 증거 |
|---|---|---|
| 1 | 기존 레포 조사·실행 계획·WXT 최소 확장·로컬 Supabase | 빈 환경에서 빌드·설치, 실제 Aside API/lifecycle 체크 |
| 2 | Google 로그인·계정/장치·RLS/RPC/Realtime 권한 | 두 계정 격리, 두 브라우저 OAuth 복귀, 철회 차단 |
| 3 | canonical tree·순서·명령·receipt·트랜잭션 | 동시 명령/중복/rollback 통합 테스트 |
| 4 | 한 폴더 변경과 Realtime 알림 종단 흐름 | 팝업을 닫은 Chrome↔Aside에서 즉시 반영 실측 |
| 5 | journal·오프라인·재시작·충돌·generation | 강제 종료와 재전송 뒤 데이터 보존 |
| 6 | 최초 병합·복수 collection·삭제 보호·복구 | 기존 중복 북마크 시나리오, 삭제 0인 첫 병합 |
| 7 | 전체 UI·교체 가능한 임시 아이콘·한국어/영어·접근성 | 실제 팝업/탭 스크린샷·키보드 검증, 브랜드는 보류 상태로 기록 |
| 8 | 계정 삭제·개인 backend·운영 문서·CI·ZIP | 깨끗한 설치·migration·빌드·배포 준비 |
| 9 | 인수 테스트·공개 준비 보고 | 22절 결과표, 미검증 항목 구분, 재현 가능한 산출물 |

한 단계 실패를 다음 화면 목업으로 감추지 않는다. UI와 엔진에 서로 다른 동기화 알고리즘을 만들지 않는다. 모든 화면의 상태는 실제 엔진에서 읽는다. 커밋 권한이 있다면 검증된 작은 단위로 남기고, 외부 푸시/공개는 세션의 승인 범위를 따른다.

## 22. 인수 테스트

모든 테스트는 개인 북마크가 아닌 합성 폴더에서 수행한다. 각 항목에 통과/실패/차단, 실행 환경, 증거 경로, 날짜를 기록한다. 단순 unit test 통과를 실제 브라우저 통과로 대신하지 않는다.

| ID | 시나리오 | 합격 조건 |
|---|---|---|
| A01 | 자체 브라우저 계정이 다른 양쪽에서 같은 Google 로그인 | 같은 workspace, 다른 device/session |
| A02 | 다른 계정 ID를 RPC 인자로 위조 | 조회·변경 모두 차단, 정보 누출 없음 |
| A03 | anon/direct REST로 테이블 접근 | 민감 데이터 조회·DML 불가 |
| A04 | 기존 JWT로 철회 장치 요청·재등록 | 읽기/쓰기/재등록 모두 차단 |
| A05 | 토큰 만료 후 worker 재기동 | 갱신 또는 명확한 재로그인, outbox 보존 |
| A06 | 계정 A에서 로그아웃 후 B 로그인 | A의 mapping·outbox·백업 전송 없음 |
| A07 | 동일 계정 재로그인 후 응답 유실 op 재전송 | device가 바뀌어도 commit 한 번 |
| A08 | OAuth 취소·잘못된 redirect·만료/재사용 code | 실제 인증 결과와 일치, 가짜 로그인 없음 |
| A09 | 개발/릴리스 확장 ID, worker 종료 중 OAuth, 중복 로그인 | 정확한 복귀·PKCE 격리 또는 안전한 재시도 |
| B01 | 빈 서버 첫 연결 | 원래 로컬 항목 복제·삭제 없이 등록 |
| B02 | Chrome에서 가져온 동일 트리로 Aside 연결 | 유일한 정확 매칭 유지, 첫 병합 삭제 0 |
| B03 | 같은 URL 다른 제목/경로 | 독립 항목 유지 |
| B04 | 중복 폴더명·슬래시 포함 제목 | 모호한 경로 자동 병합 없음 |
| B05 | 미리보기 후 로컬/서버 변경 | 기존 미리보기 그대로 적용하지 않음 |
| B06 | import 중 worker 종료·재개 | 안정된 UUID와 opId, 중복 생성 없음 |
| B07 | 중첩 binding·관리형 루트 선택 | 사유 표시하며 거부 |
| C01 | 양방향 생성·제목/URL 수정 | 상대 브라우저에 같은 의미와 순서 |
| C02 | 폴더 이동·자식 순서 변경·빈 폴더 | 양쪽 canonical tree 일치 |
| C03 | 두 장치 같은 node 동시 수정 | 데이터 조용한 덮어쓰기 없이 충돌 |
| C04 | 원격 삭제와 로컬 미전송 수정 | 수정 내용 보존, 사용자 결정 |
| C05 | 오래 꺼진 장치가 삭제 항목을 다시 전송 | tombstone으로 부활 차단 |
| C06 | 서로 같은 anchor에 동시 생성 | 서버 결과가 모든 장치에서 동일 |
| C07 | anchor 이동·소실 후 move 제출 | 명시적 충돌, 임의 배치 없음 |
| C08 | 순환 이동·다른 계정/collection parent 참조 | 거부, 부분 변경 없음 |
| C09 | 동일 opId 동일/다른 body 재전송 | 같은 결과 / OP_ID_REUSED |
| C10 | 서버 commit 후 응답 유실 | 재시도 시 commit·node 추가 없음 |
| C11 | 원격 적용이 다시 이벤트를 발생 | 변경 없는 재전송·무한 왕복 없음 |
| C12 | 원격 적용 도중 사용자가 다른 항목 편집 | 사용자 변경을 반향으로 버리지 않음 |
| C13 | 연결 범위 밖·다른 collection으로 이동 | 정책대로 검토, 조용한 삭제 없음 |
| C14 | import 묶음 중간 충돌·응답 유실 | 앞 성공 유지, 뒤 not_attempted, 재시도 중복 없음 |
| D01 | create 성공 직후 mapping 저장 전 worker 종료 | 자동 중복 생성 없이 복구 필요 |
| D02 | inbox 저장/브라우저 적용 사이 종료 | received/applied cursor 구분·재개 |
| D03 | 오프라인 편집 후 브라우저 재시작 | 의도 유지 후 안전하게 반영 |
| D04 | alarm 누락·worker 휴면·재시작 | alarm 재확인, 누락 이벤트 reconciliation |
| D05 | 로그 만료 cursor | snapshot + offline intent 재조정 |
| D06 | DB 복원으로 seq 감소·generation 변경 | 이전 세대 쓰기 차단·미리보기 복구 |
| D07 | 서버 5xx/잘못된 JSON/빈 오류 응답 | 북마크 전체 삭제 없음 |
| D08 | IndexedDB 저장 실패·용량 부족 | 성공 표시 없음, 위험한 작업 정지 |
| E01 | 폴더 삭제 이벤트 하나만 수신 | observed subtree로 정확한 삭제 의도 |
| E02 | 원격 폴더 삭제 직전 로컬 새 자식 | 미전송 자식 보존, 삭제 검토 |
| E03 | 삭제 20개 또는 20%·최소5개 | 발신·수신 보호와 미리보기 |
| E04 | 휴지통 복원, 기존 부모도 삭제됨 | 유효한 부모 선택·원자적 복원 |
| E05 | 백업 import 잘못된 schema·대형 파일 | 실제 변경 전 거부·사유 표시 |
| E06 | 루트 삭제·권한 철회·확장 재설치 | 원격 전체 삭제 없이 재연결 |
| E07 | node URL이 지원 불가 scheme으로 변경 | 로컬 보존·검토, 원격 자동 삭제 없음 |
| F01 | 개인 backend 변경 | 계정/queue 격리, host 권한 제한 |
| F02 | 계정 삭제 도중 Auth/DB 실패 | deleting 상태 유지, 재시도 가능 |
| F03 | 계정 삭제 endpoint에 타인 ID·오래된 인증 | 삭제 거부 |
| F04 | build/ZIP/로그/진단파일 검사 | OAuth secret·verifier·토큰·북마크 본문 유출 없음 |
| F05 | 악성 제목·HTML·javascript URL | 코드 실행 없음, 제외 정책 적용 |
| F06 | 최종 release ZIP 두 브라우저 설치 | dev 빌드와 동일 필수 동작 |
| F07 | 계정 전환 후 이전 요청이 늦게 도착 | 새 계정·native 상태에 응답 적용 없음 |
| U01 | 밝은/어두운 테마, 16 px 아이콘 | 대비·형태·상태 구분 가능 |
| U02 | 키보드·200% 확대·긴 한국어/영어 | 핵심 흐름 완료, 잘린 행동 없음 |
| U03 | offline/conflict/recovery/paused 상태 | 정확한 문구·행동, 잘못된 성공 표시 없음 |
| U04 | 팝업을 닫고 다시 열기 | 실제 진행 상태 유지 |
| U05 | 같은 계정으로 첫 연결/추가 브라우저 연결 | 원격 폴더 선택과 로컬 경로가 구분됨, 같은 이름으로 자동 연결 없음 |
| U06 | 미리보기 표시·백업 실패·계획 변경 | 방향별 정확한 수, 실패 시 적용 차단, 새 계획은 재확인 |
| U07 | 온보딩 중 탭 닫기·로그인 취소·첫 적용 정지 | 저장된 단계로 재개, 중복 업로드·가짜 롤백 없음 |
| U08 | 전역 자동 동기화 끄기 후 1회 실행 | 대기 보존, 1회 동기화 뒤 꺼짐 유지, 다른 브라우저 설정 불변 |
| U09 | 폴더 일부 정지 후 지금 확인·재개 | 정지 폴더 native 적용 없음, 다른 폴더 진행, 재개 시 충돌 검토 |
| U10 | 두 종류 이상 문제·worker 상태 조회 지연 | 우선순위와 전체 문제 보존, 이전 성공 화면 오표시 없음 |
| U11 | 대량 삭제 발신/수신 상세에서 뒤로·Escape | 방향과 이미 삭제된 범위 명확, 승인 없이 삭제 전파/적용 없음 |
| U12 | 상대 브라우저 종료·이 브라우저 서버 확인 성공 | 이 브라우저 범위만 최신 표시, 상대 적용 완료 주장 없음 |
| U13 | 아이콘 미확정 상태에서 기능 구현 | 임시 자산 교체 가능, 미채택 시안/색을 확정 디자인으로 사용하지 않음 |
| P01 | 1k/10k 합성 항목 snapshot·순서 변경 | 시간/메모리/응답 bytes 기록, UI 응답 가능 |
| P02 | 팝업을 닫고 idle 상태 30분 이상 관찰 | socket 하나 유지·유휴 뒤 편집도 즉시 전달·쓰기 폭주 없음 |
| R01 | 정상 연결에서 양방향 단일 편집 각 30회 | 실제 북마크 반영 p50/p95 기록, p95 3초 이하 목표 |
| R02 | signal 유실·중복·순서 역전·batch import | cursor로 수렴, 알림별 중복 쓰기 없음 |
| R03 | 절전/네트워크 전환/worker 강제 종료 | 재접속 즉시 누락 delta 복구, 전역 상태 의존 없음 |
| R04 | 다른 계정의 private channel 구독·client 발행 | 권한 거부, 북마크 본문 Broadcast 없음 |
| R05 | 열린 channel의 장치 철회·계정 전환·JWT 갱신 | 실제 데이터 접근 즉시 차단·이전 계정 적용 없음 |
| R06 | 연결 한도 초과·Realtime 장애 | backoff+주기 복구, 실시간 정상 표시 없음 |

동시성·DB 권한·복구 테스트는 실제 실패를 유발한다. 성공 경로만 모킹한 테스트로 대체하지 않는다. 브라우저 강제 종료 지점을 주입할 수 있는 테스트 전용 hook은 production 빌드에서 제거되거나 접근 불가능해야 한다.

## 23. 성능·호환성 검증과 알려진 한계

지원은 브라우저 이름만으로 선언하지 않고 OS/Chrome/Aside/확장/백엔드 버전으로 기록한다. 최소 확인 대상은 사용자의 macOS Chrome·Aside다. Windows/Linux를 실제 실행하지 않았으면 “미검증”으로 표시한다.

성능 기준은 측정용 목표다: 정상 네트워크·양쪽 브라우저 실행·Realtime 구독 정상인 단일 편집은 상대 북마크 실제 반영까지 1~3초, 각 방향 30회에서 p95 3초 이하를 목표로 검증한다. 실패하면 구간별 지연을 기록하고 개선하며 목표 달성이라 쓰지 않는다. OS 절전·브라우저 종료·연결 장애는 복귀 후 재개한다. 10k 첫 병합은 별도 작업으로 진행률·정지·재개를 제공한다.

Chrome 내장 북마크 동기화와 이 확장은 같은 데이터를 동시에 바꿀 수 있다. 사용자의 Chrome 동기화를 자동으로 끄지 않는다. 두 Chrome 프로필의 내장 sync를 함께 켠 조합에서 반향·중복을 시험하고, 검증 전에는 이 조합의 완전 지원을 보장하지 않는다. 첫 안내에 동시 사용 시 중복 후보가 발생할 수 있는 이유와 연결 범위 축소 방법을 적는다.

v1 제한: E2EE 없음, 닫힌/절전 브라우저는 복귀 후 동기화, cross-collection move 수동 검토, 애매한 create crash 복구 필요, 협업·모바일·Firefox·Safari 미지원. 이 제한은 실패를 감추기 위한 목록이 아니라 제품 설명과 실제 UI가 일치해야 하는 계약이다.

## 24. 완료 조건·증거 산출물

다음을 모두 만족해야 로컬 v1 구현 완료라고 보고한다.

1. 빈 환경에서 문서대로 설치·migration·빌드·ZIP 생성이 가능하다.
2. Chrome과 Aside에서 같은 Google 계정으로 로그인하고 실제 양방향 실시간 동기화가 확인된다. R01 지연 목표의 실측 결과를 포함한다.
3. 계정 격리·철회·오프라인·충돌·삭제·복구·worker 종료 테스트의 필수 항목이 통과한다.
4. 최종 UI가 실제 엔진·인증·DB에 연결되어 있으며 빈 버튼이나 성공 흉내가 없다.
5. 한글/영문 문서·MIT·운영/백업/개인 backend 가이드가 있다.
6. 릴리스 ZIP과 합성 데이터 스크린샷, 테스트 결과표를 제공한다.
7. 실제 실행한 명령과 결과, 실패 수정 내역, 남은 외부 차단을 기록한다.

증거 기본 경로: docs/validation/RESULTS.md, docs/validation/COMPATIBILITY.md, docs/validation/PERFORMANCE.md, docs/validation/screenshots/. 토큰이나 실제 북마크를 증거 파일에 넣지 않는다.

로컬 구현 완료와 운영 배포 완료를 따로 보고한다. 공개 서비스 운영 완료는 실제 Google OAuth 공개 설정·운영 로그인·Realtime·백업·배포 smoke test가 추가로 필요하다. 스토어 등록 완료는 실제 제출·심사 결과가 있어야 한다. 외부 단계가 막혔다면 해당 단계를 미완료로 적고 전체 성공으로 묶지 않는다.

## 25. 한 번의 프롬프트로 실행하는 방법과 중단 기준

실행 에이전트는 이 문서를 자기 작업 계획의 기준으로 삼고 구현을 계속한다. 컨텍스트가 줄면 현재 단계·변경 파일·검증 결과·남은 작업을 docs/IMPLEMENTATION_PLAN.md에 남겨 이어간다. 대화가 길다는 이유로 구현을 축소하지 않는다.

시작할 때 확인할 것: 0.4절의 `/Users/lesa/Desktop/Repo/shatsu-ren` 경로, 기존 레포의 실제 내용, 로컬 checkout, 프로젝트 지침, 설치된 런타임/브라우저, 로컬 Supabase 실행 가능 여부. 이름·MIT·계정 필요 여부·이 컴퓨터의 정상적인 프로젝트 경로는 다시 묻지 않는다.

외부 정보가 없을 때:
- Supabase 운영 key 없음 → 로컬 Supabase로 구현·검증, 운영 key를 발명하지 않음.
- Google OAuth 자격 증명 없음 → 합성 Auth 계정으로 로컬 DB/동기화 테스트를 진행하되 Google 로그인은 미검증으로 표시한다. 실제 Google 인증 완료를 주장하거나 이메일 OTP로 제품을 대체하지 않는다.
- GitHub 권한 없음 → 로컬 결과·patch·ZIP까지 완성, 원격 업로드 완료 주장 금지.
- 실제 브라우저 설치 조작 필요 → 설치할 정확한 산출물 경로와 조작을 최소한으로 안내.
- 결제/공개 배포 승인 필요 → 완성된 결과·배포 대상·실제 비용을 먼저 제시.
- 로고·브랜드 색 보류 → 15절의 교체 가능한 임시 자산으로 로컬 기능 구현·검증을 진행하고 아이콘 질문/생성을 반복하지 않는다. 최종 브랜드와 스토어 자산 승인은 미완료로 구분한다.

브라우저 실제 테스트가 불가능하면 mock을 대신 통과시켜 완료라고 하지 않는다. 가능한 독립 검증을 모두 끝내고 필요한 사용자 동작/외부 변경을 정확히 하나의 차단 목록으로 남긴다.

최종 답은 산출물 링크, 실제 검증 범위, 남은 외부 단계, 실행 방법만 간결하게 전달한다. 배포되지 않은 URL을 서비스 주소로 제시하지 않는다.

## 26. 참고 자료와 스킬 적용

설계 근거는 2026-09-29 기준이며 구현 시 변경 가능성이 있는 API·정책·요금을 다시 확인한다.

- [기존 shatsu-ren 레포](https://github.com/LESANF/shatsu-ren): 사용자 지정 공개 레포, 확인 당시 비어 있음.
- [Chrome bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks): 루트·이벤트·북마크 조작.
- [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): 휴면·중단을 고려한 영속 상태.
- [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms): 주기·지연·재기동 검증.
- [권한 선언](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [선택적 권한](https://developer.chrome.com/docs/extensions/reference/api/permissions).
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage): 설정 저장소 제한.
- [확장 배포](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions).
- [WXT](https://wxt.dev/guide/introduction.html): 확장 프로젝트와 빌드.
- [Supabase Auth](https://supabase.com/docs/guides/auth), [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [세션](https://supabase.com/docs/guides/auth/sessions).
- [확장 identity API](https://developer.chrome.com/docs/extensions/reference/api/identity), [Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [Realtime 권한](https://supabase.com/docs/guides/realtime/authorization), [Realtime 한도](https://supabase.com/docs/guides/realtime/limits).
- [DB 함수](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [백업](https://supabase.com/docs/guides/platform/backups), [요금](https://supabase.com/pricing).
- [MIT 원문](https://opensource.org/license/mit).

전용 북마크 동기화 스킬이 이미 설치됐다고 가정하지 않는다. 확인된 관련 선택지는 GoogleChrome의 [modern-web-guidance / Chrome Extensions](https://developer.chrome.com/docs/extensions/ai/build-with-ai)이며 설치는 별도 상태다. 사용할 수 있다면 공식 확장 지침을 참고한다.

현재 환경의 frontend·emil-design-eng는 UI 구현, imagegen은 필요할 때 아이콘 탐색, visual-qa는 실제 화면 검증, aside-browser는 Aside 조작에 관련 있다. 실행 환경에 해당 스킬이 실제로 제공되는지 확인하고 사용할 때 SKILL.md를 읽는다. 모든 스킬을 무조건 설치하거나 동시에 실행하지 않는다.
