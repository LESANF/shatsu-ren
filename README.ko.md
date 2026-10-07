# shatsu-ren (샤츠렌)

**브라우저는 바꿔 써도, 북마크는 함께.** · English: [README.md](./README.md)

선택한 북마크 폴더를 같은 Google 계정으로 로그인한 Chromium 계열 브라우저(Google Chrome, Aside)와 여러 컴퓨터 사이에서 자동으로 맞춰 주는 오픈소스(MIT) Manifest V3 확장입니다. 북마크는 계속 브라우저 기본 북마크 관리자에서 편집하고, 확장은 사용자가 명시적으로 연결한 폴더만 동기화합니다.

> **상태 (2026-09-29): 로컬 v1 구현 완료, 로컬 Supabase 스택에서 종단 검증 완료.** 공개 운영 서비스는 없고, Google 로그인은 구현됐지만 자격 증명이 없어 미검증이며, 스토어에 등록되지 않았습니다. 실제 검증 범위는 [docs/validation/RESULTS.md](./docs/validation/RESULTS.md)에 있습니다.

## 하는 일

- 연결 폴더 안의 북마크·폴더 추가 / 제목·URL 수정 / 이동 / 순서 변경 / 삭제 동기화. 빈 폴더와 순서 유지.
- 실시간: 한쪽 변경이 다른 쪽에 약 **0.3초**(로컬 스택 p95, 60회 실측) 안에 반영. 5분 주기 확인이 신호 유실을 복구.
- 최초 연결 시 미리보기(어느 방향으로 무엇이 가는지, 중복 후보는 둘 다 유지, 지원하지 않는 URL 제외, **삭제 0**)와 로컬 백업.
- 충돌(같은 항목 양쪽 수정, 삭제 vs 수정)은 조용히 덮어쓰지 않고 *내 변경 / 서버 변경 / 둘 다 보관* 을 고릅니다.
- 삭제는 한 개라도 보내는 쪽과 받는 쪽 모두에서 검토 후 진행. 삭제 보류 중에도 추가·수정은 계속 공유되며, 검토 뒤 내용이 바뀌면 다시 확인해야 합니다.
- 30일 휴지통 복원, 로컬 JSON 내보내기/가져오기, 폴더별 일시 정지, 아무것도 지우지 않는 연결 해제.
- 한국어·영어 UI, 밝은/어두운 테마, 키보드 조작.

## 하지 않는 일 (v1)

- 종단 간 암호화 없음: 서버(Supabase 프로젝트 운영자)가 제목·URL·폴더 구조를 읽을 수 있습니다.
- Google 로그인만. Firefox/Safari/모바일 미지원. AI 태그·링크 검사·새 탭 교체 없음.
- 연결 폴더 밖으로 옮긴 항목은 추측하지 않고 검토 목록에 올립니다.
- 닫혀 있거나 절전 중인 브라우저는 돌아온 뒤에 따라잡습니다.

## 설치 (개발 빌드)

요구 사항: Node ≥ 22, pnpm 12, Docker 호환 런타임(Docker Desktop 또는 colima), Supabase CLI.

```bash
git clone https://github.com/LESANF/shatsu-ren.git
cd shatsu-ren
pnpm setup
supabase start
pnpm --filter shatsu-ren-extension build:dev-auth
```

`apps/extension/.output/chrome-mv3-dev` 를 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램을 로드** 로 불러옵니다(Chrome·Aside 동일). Google Chrome 137+ 는 `--load-extension` 플래그를 무시하므로 자동 테스트는 Playwright Chromium 을 씁니다.

개발 빌드에는 로컬 Supabase 합성 계정용 **"로컬 테스트 로그인"** 이 있고 release 빌드에서는 제거됩니다. 상세: [docs/INSTALL.md](./docs/INSTALL.md).

## 릴리스 ZIP · 개인 Supabase 프로젝트

`pnpm zip` 으로 `apps/extension/.output/shatsu-ren-<버전>-chrome.zip` 과 `.sha256` 을 만듭니다. 빌드 시 `WXT_SUPABASE_URL`/`WXT_SUPABASE_ANON_KEY` 가 없으면 백엔드 없는 빌드이며, 사용자는 *설정 → 고급* 에서 개인 Supabase 프로젝트를 연결합니다. 절차: [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md). 운영·백업·복원: [docs/OPERATIONS.md](./docs/OPERATIONS.md).

## 동작 원리 (요약)

브라우저 프로필 하나가 장치 하나이고 Supabase 세션에 묶입니다. 계정당 보관함 하나, 연결 폴더당 collection 하나. 모든 변경은 `opId` 를 가진 멱등 명령으로 Postgres 함수가 보관함 잠금 아래에서 적용하고, commit 은 단조 증가 `seq` 를 받습니다. 클라이언트는 항목마다 base(마지막 합의)·local(브라우저)·remote(서버) 를 3-way 비교합니다. 서버는 본문 없는 `{type:"changed"}` 신호만 private Realtime 채널로 보내고, 실제 데이터는 commit 로그가 원본입니다. 삭제는 tombstone 이며 폴더 삭제는 subtree SHA-256 digest 로 검증합니다.

설계 전문: [docs/BLUEPRINT.md](./docs/BLUEPRINT.md), 결정 기록: [docs/DECISIONS.md](./docs/DECISIONS.md).

## 개발 명령

`pnpm typecheck` · `pnpm lint` · `pnpm test`(순수 로직) · `pnpm test:db`(pgTAP) · `pnpm --filter shatsu-ren-tests test:db`(실제 Auth/PostgREST/Realtime 통합) · `pnpm test:e2e`(Chromium ↔ Aside) · `pnpm build` · `pnpm zip`

## 검증 범위

macOS 26.6 · Playwright Chromium 153 · Aside 1.0.928.1 · Supabase CLI 2.118 로컬 스택에서 확인. Google Chrome 154 는 수동 로드만. Windows/Linux 미검증. 결과표·성능·호환성: `docs/validation/`.

## 기여·보안

[CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md). 실제 북마크나 토큰을 이슈에 올리지 마세요.

## 라이선스

MIT © 2026 LESANF. 이름과 향후 로고는 코드 라이선스와 별개입니다. 현재 아이콘은 스크립트로 만든 단색 임시 자산입니다.
