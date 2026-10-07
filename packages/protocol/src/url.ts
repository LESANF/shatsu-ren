import { LIMITS } from './types';

/** v1 동기화 대상 URL 은 http/https 만. 정규화(대소문자·trailing slash·query 제거)는 하지 않는다. */
export function isSyncableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const lower = url.slice(0, 8).toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 서버 한도(maxTitleBytes·maxUrlBytes) 안인지. 넘는 항목은 올리지 않고 로컬에만 둔다. */
export function fitsLimits(title: string, url: string | null | undefined): boolean {
  return utf8Bytes(title) <= LIMITS.maxTitleBytes && (!url || utf8Bytes(url) <= LIMITS.maxUrlBytes);
}
