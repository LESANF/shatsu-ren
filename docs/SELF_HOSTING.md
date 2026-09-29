# 개인 Supabase 프로젝트 연결 (SELF_HOSTING)

일반 사용자는 공식 호스팅(아직 없음)에 로그인만 하면 된다. 오픈소스 사용자는 자신의 Supabase 프로젝트에 데이터를 둘 수 있다.

## 1. 프로젝트 준비

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성(Free 로 시작 가능. Free 는 자동 백업이 없고 비활성 시 일시 정지된다 — `OPERATIONS.md`).
2. 이 레포에서 migration 적용:
   ```bash
   supabase link --project-ref <ref>
   supabase db push            # supabase/migrations/*.sql
   supabase functions deploy delete-account
   ```
3. Authentication → Providers → Google 에 OAuth client id/secret 등록. Redirect URLs 에 확장 복귀 URL(`https://<확장ID>.chromiumapp.org/auth`) 추가. (`INSTALL.md` §4)
4. Realtime 은 기본 설정으로 충분하다. private channel 정책은 migration 이 `realtime.messages` 에 만든다.

## 2. 확장에서 연결

설정 → 고급 → **개인 Supabase 프로젝트 연결** 에 프로젝트 URL(`https://<ref>.supabase.co`)과 **공개 키**(anon / publishable) 입력 → 연결.

- https 만 허용(개발 예외 `http://127.0.0.1`). TLS 오류 무시 옵션은 없다.
- 연결 시 그 origin 에 대한 optional host permission 을 사용자 클릭으로 요청한다.
- 연결하면 로그아웃되고 새 온보딩(폴더 선택·미리보기)을 거친다. 로컬 데이터는 backend origin + 계정 + 보관함으로 격리된다.
- `service_role`/secret 키는 절대 확장에 넣지 않는다.

## 3. 검증 (깨끗한 프로젝트 재현성)

로컬에서는 `supabase start` → `pnpm test:db` → `pnpm --filter shatsu-ren-tests test:db` 로 같은 migration 이 빈 DB 에 적용되고 RPC 계약이 통과함을 확인했다(2026-09-29). 원격 프로젝트에 대한 실제 적용은 이 세션에서 실행하지 않았다(계정·프로젝트 없음).

## 4. 제한

- Supabase 전체 스택을 개인 VPS 에 설치하는 배포 패키지는 v1 범위가 아니다.
- 프로젝트 운영자는 북마크 제목·URL·폴더 구조를 읽을 수 있다(E2EE 없음).
