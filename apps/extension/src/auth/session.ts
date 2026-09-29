import {
  createClient,
  type Session,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js';
import { DEV_AUTH, type BackendConfig } from '../config';

/**
 * worker 가 유일한 Auth client 를 소유한다. 세션은 chrome.storage.local(backend origin 별 키) 에 저장.
 * 팝업/설정은 runtime message 로만 로그인·상태를 요청한다.
 */
const storageFor = (origin: string): SupportedStorage => {
  const k = (key: string) => `sb:${origin}:${key}`;
  return {
    async getItem(key) {
      const v = (await chrome.storage.local.get(k(key)))[k(key)];
      return typeof v === 'string' ? v : null;
    },
    async setItem(key, value) {
      await chrome.storage.local.set({ [k(key)]: value });
    },
    async removeItem(key) {
      await chrome.storage.local.remove(k(key));
    },
  };
};

let current: { origin: string; client: SupabaseClient } | null = null;

export function getClient(backend: BackendConfig): SupabaseClient {
  if (current && current.origin === backend.url) return current.client;
  const client = createClient(backend.url, backend.anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false, // worker 수명이 짧으므로 타이머 대신 매 실행 때 getSession() 으로 갱신
      detectSessionInUrl: false,
      storage: storageFor(backend.url),
    },
    global: { headers: { 'x-client-info': 'shatsu-ren' } },
  });
  current = { origin: backend.url, client };
  return client;
}

export function dropClient(): void {
  current = null;
}

const LOGIN_ATTEMPT_KEY = 'shatsu.loginAttempt';
const ATTEMPT_TTL_MS = 5 * 60 * 1000;

export type LoginResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      code: 'CANCELLED' | 'IN_PROGRESS' | 'FAILED' | 'INVALID_CALLBACK';
      message?: string | undefined;
    };

/** Google 로그인: PKCE + identity.launchWebAuthFlow. 사용자 버튼 동작에서만 호출한다. */
export async function loginWithGoogle(client: SupabaseClient): Promise<LoginResult> {
  const attempt = (await chrome.storage.local.get(LOGIN_ATTEMPT_KEY))[LOGIN_ATTEMPT_KEY] as
    { at: number } | undefined;
  if (attempt && Date.now() - attempt.at < ATTEMPT_TTL_MS)
    return { ok: false, code: 'IN_PROGRESS' };
  await chrome.storage.local.set({ [LOGIN_ATTEMPT_KEY]: { at: Date.now() } });
  try {
    const redirectTo = chrome.identity.getRedirectURL('auth');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
        scopes: 'openid email profile',
      },
    });
    if (error || !data.url) return { ok: false, code: 'FAILED', message: error?.message };
    let callback: string | undefined;
    try {
      callback = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        code: /cancel|closed|did not approve/i.test(msg) ? 'CANCELLED' : 'FAILED',
        message: msg,
      };
    }
    if (!callback) return { ok: false, code: 'CANCELLED' };
    const cb = new URL(callback);
    if (cb.origin + cb.pathname !== redirectTo) return { ok: false, code: 'INVALID_CALLBACK' };
    const code = cb.searchParams.get('code');
    if (!code) {
      const desc =
        cb.searchParams.get('error_description') ?? cb.searchParams.get('error') ?? undefined;
      return {
        ok: false,
        code: desc ? 'FAILED' : 'INVALID_CALLBACK',
        ...(desc ? { message: desc } : {}),
      };
    }
    const ex = await client.auth.exchangeCodeForSession(code);
    if (ex.error || !ex.data.session)
      return { ok: false, code: 'FAILED', message: ex.error?.message };
    return { ok: true, session: ex.data.session };
  } finally {
    await chrome.storage.local.remove(LOGIN_ATTEMPT_KEY);
  }
}

/** 개발 빌드 전용: 로컬 Supabase 합성 계정(이메일+비밀번호). release 빌드에서는 코드가 제거된다. */
export async function loginDev(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<LoginResult> {
  if (!DEV_AUTH) return { ok: false, code: 'FAILED', message: 'dev auth disabled' };
  let r = await client.auth.signInWithPassword({ email, password });
  if (r.error && /invalid login/i.test(r.error.message)) {
    const s = await client.auth.signUp({ email, password });
    if (s.error) return { ok: false, code: 'FAILED', message: s.error.message };
    r = await client.auth.signInWithPassword({ email, password });
  }
  if (r.error || !r.data.session) return { ok: false, code: 'FAILED', message: r.error?.message };
  return { ok: true, session: r.data.session };
}

/** 만료됐으면 SDK 가 refresh 한다. 실패하면 null → auth_required. */
export async function currentSession(client: SupabaseClient): Promise<Session | null> {
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session;
}

export function sessionIdOf(session: Session): string | null {
  try {
    const payload = JSON.parse(
      atob(session.access_token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return typeof payload.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}
