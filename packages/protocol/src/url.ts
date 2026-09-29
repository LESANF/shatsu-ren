/** v1 동기화 대상 URL 은 http/https 만. 정규화(대소문자·trailing slash·query 제거)는 하지 않는다. */
export function isSyncableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const lower = url.slice(0, 8).toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
