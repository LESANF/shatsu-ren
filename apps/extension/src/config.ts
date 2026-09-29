/** 백엔드 연결 설정. 빌드 기본값(운영/개발) 또는 사용자가 고급 설정에서 입력한 개인 Supabase 프로젝트. */
export interface BackendConfig {
  url: string; // 정확한 origin, 끝 슬래시 없음
  anonKey: string;
  source: 'build' | 'custom';
}

const KEY = 'shatsu.backend';

export const buildBackend: BackendConfig | null = __SHATSU_BACKEND_URL__
  ? {
      url: __SHATSU_BACKEND_URL__.replace(/\/$/, ''),
      anonKey: __SHATSU_BACKEND_KEY__,
      source: 'build',
    }
  : null;

export const DEV_AUTH = __SHATSU_DEV_AUTH__;
export const VERSION = __SHATSU_VERSION__;

export async function getBackend(): Promise<BackendConfig | null> {
  const v = (await chrome.storage.local.get(KEY))[KEY] as BackendConfig | undefined;
  return v ?? buildBackend;
}

export async function setCustomBackend(
  cfg: { url: string; anonKey: string } | null,
): Promise<BackendConfig | null> {
  if (!cfg) {
    await chrome.storage.local.remove(KEY);
    return buildBackend;
  }
  const url = validateBackendUrl(cfg.url);
  const next: BackendConfig = { url, anonKey: cfg.anonKey.trim(), source: 'custom' };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** https 만 허용, 개발 예외는 http://127.0.0.1 만. TLS 오류 무시 옵션은 없다. */
export function validateBackendUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error('INVALID_URL');
  }
  const isLocalDev = u.protocol === 'http:' && u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !isLocalDev) throw new Error('INVALID_URL');
  if (u.username || u.password) throw new Error('INVALID_URL');
  return u.origin;
}

export const hostPattern = (origin: string) => origin + '/*';
