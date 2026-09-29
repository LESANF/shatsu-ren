// 계정 삭제 Edge Function. 인증된 본인 계정만, 최근 5분 이내 새 로그인 세션일 때만 삭제한다.
// 순서: (1) workspace deleting 잠금 + 모든 장치 차단 (2) Auth 사용자 삭제 (DB 행은 ON DELETE CASCADE).
// 중간 실패는 같은 requestId 로 재시도 가능. 다른 사용자 ID 를 body 로 받지 않는다.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: { code: 'INVALID_OPERATION' } }, 405);
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser(jwt);
  const user = userData?.user;
  if (!user) return json({ ok: false, error: { code: 'UNAUTHENTICATED' } }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    requestId?: string;
    confirmEmail?: string;
  };
  if (!body.requestId || !UUID.test(body.requestId))
    return json({ ok: false, error: { code: 'INVALID_OPERATION' } }, 400);
  if (!user.email || body.confirmEmail !== user.email)
    return json({ ok: false, error: { code: 'FORBIDDEN', message: 'confirmEmail mismatch' } }, 403);

  let sessionId: string | null = null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    /* fallthrough */
  }
  if (!sessionId) return json({ ok: false, error: { code: 'SESSION_INVALID' } }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // 실제 세션 생성 시각으로 최근 재인증 판정 (refresh 로 바뀐 iat 은 쓰지 않음)
  const { data: createdAt } = await admin.rpc('account_session_created_at', {
    p_session_id: sessionId,
  });
  if (!createdAt || Date.now() - Date.parse(createdAt as string) > RECENT_MS) {
    return json({ ok: false, error: { code: 'FORBIDDEN', message: 'RECENT_LOGIN_REQUIRED' } }, 403);
  }

  const begin = await admin.rpc('account_deletion_begin', {
    p_user_id: user.id,
    p_request_id: body.requestId,
  });
  if (begin.error)
    return json({ ok: false, error: { code: 'INTERNAL', message: begin.error.message } }, 500);
  const beginRes = begin.data as { ok: boolean; error?: { code: string } };
  if (!beginRes.ok) return json(beginRes, 409);

  const del = await admin.auth.admin.deleteUser(user.id);
  if (del.error) {
    // workspace 는 deleting 으로 남고 장치는 차단됨 → 같은 requestId 로 재시도
    return json(
      {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'auth delete failed; retry with same requestId',
          retryable: true,
        },
      },
      500,
    );
  }
  return json({ ok: true, data: { deleted: true, requestId: body.requestId } });
});
