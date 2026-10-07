import type { SupabaseClient } from '@supabase/supabase-js';
import { getBackend, type BackendConfig } from '../config';
import { currentSession, getClient, sessionIdOf } from '../auth/session';
import { openScopedDb, type Db } from '../storage/db';
import { DomainError, rpc, TransportError } from './rpc';

export interface Account {
  backendUrl: string;
  userId: string;
  email: string;
  sessionId: string;
  workspaceId: string;
  deviceId: string;
  generationId: string;
  protocolVersion: number;
  registeredAt: number;
}

export interface Settings {
  autoSync: boolean;
  /** 실시간(WebSocket) 연결 사용 여부. 끄면 주기 확인 + 수동 갱신만 */
  realtime: boolean;
  /** 주기 확인 간격(분): 5 / 30 / 240 */
  pollMinutes: 5 | 30 | 240;
  locale: 'auto' | 'ko' | 'en';
  theme: 'auto' | 'light' | 'dark';
  deviceLabel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoSync: true,
  realtime: true,
  pollMinutes: 5,
  locale: 'auto',
  theme: 'auto',
  deviceLabel: '',
};

const ACCOUNT_KEY = (origin: string) => `shatsu.account:${origin}`;
const SETTINGS_KEY = 'shatsu.settings';

export async function getSettings(): Promise<Settings> {
  const v = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
    Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(v ?? {}) };
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getAccount(origin: string): Promise<Account | null> {
  return (
    ((await chrome.storage.local.get(ACCOUNT_KEY(origin)))[ACCOUNT_KEY(origin)] as
      Account | undefined) ?? null
  );
}
export async function setAccount(origin: string, acc: Account | null): Promise<void> {
  if (acc) await chrome.storage.local.set({ [ACCOUNT_KEY(origin)]: acc });
  else await chrome.storage.local.remove(ACCOUNT_KEY(origin));
}

export interface Ctx {
  backend: BackendConfig;
  client: SupabaseClient;
  account: Account;
  db: Db;
  accessToken: string;
}

export type CtxResult =
  | { ok: true; ctx: Ctx }
  | {
      ok: false;
      reason: 'no_backend' | 'auth_required' | 'device_revoked' | 'offline' | 'blocked';
      message?: string;
    };

export function browserName(): string {
  const ua = navigator.userAgent;
  const brands =
    (navigator as { userAgentData?: { brands: { brand: string; version: string }[] } })
      .userAgentData?.brands ?? [];
  const b = brands.find((x) => !/Not.A.Brand|Chromium/i.test(x.brand));
  if (b) return `${b.brand} ${b.version}`;
  const m = /(Chrome|Aside)\/([\d.]+)/.exec(ua);
  return m ? `${m[1]} ${m[2]}` : 'Chromium';
}

/** 인증·장치 등록·scoped DB 준비. 등록은 세션이 바뀌었을 때만 서버에 다시 요청한다. */
export async function prepareContext(opts: { forceRegister?: boolean } = {}): Promise<CtxResult> {
  const backend = await getBackend();
  if (!backend) return { ok: false, reason: 'no_backend' };
  const client = getClient(backend);
  const session = await currentSession(client);
  if (!session) return { ok: false, reason: 'auth_required' };
  const sessionId = sessionIdOf(session);
  if (!sessionId) return { ok: false, reason: 'auth_required', message: 'no session_id claim' };
  let account = await getAccount(backend.url);
  if (
    !account ||
    account.sessionId !== sessionId ||
    account.userId !== session.user.id ||
    opts.forceRegister
  ) {
    const settings = await getSettings();
    try {
      const r = await rpc.registerDevice(
        client,
        settings.deviceLabel || defaultDeviceLabel(),
        browserName(),
      );
      account = {
        backendUrl: backend.url,
        userId: session.user.id,
        email: session.user.email ?? '',
        sessionId,
        workspaceId: r.workspaceId,
        deviceId: r.deviceId,
        generationId: r.generationId,
        protocolVersion: r.protocolVersion,
        registeredAt: Date.now(),
      };
      await setAccount(backend.url, account);
    } catch (e) {
      if (e instanceof DomainError) {
        if (e.error.code === 'DEVICE_REVOKED') return { ok: false, reason: 'device_revoked' };
        return { ok: false, reason: 'blocked', message: e.error.code };
      }
      if (e instanceof TransportError && e.kind === 'unauthorized')
        return { ok: false, reason: 'auth_required' };
      return { ok: false, reason: 'offline', message: e instanceof Error ? e.message : String(e) };
    }
  }
  const db = await openScopedDb({
    backendUrl: backend.url,
    userId: account.userId,
    workspaceId: account.workspaceId,
  });
  return { ok: true, ctx: { backend, client, account, db, accessToken: session.access_token } };
}

export function defaultDeviceLabel(): string {
  const b = browserName().replace(/\s[\d.]+$/, '') || 'Browser'; // "Google Chrome 153" → "Google Chrome"
  const os = /Mac/.test(navigator.userAgent)
    ? 'macOS'
    : /Windows/.test(navigator.userAgent)
      ? 'Windows'
      : /Linux/.test(navigator.userAgent)
        ? 'Linux'
        : '';
  return [b, os].filter(Boolean).join(' · ');
}
