import { describe, expect, it, afterAll } from 'vitest';
import { launch, type ExtBrowser } from '../lib/browser';

const opened: ExtBrowser[] = [];
afterAll(async () => {
  for (const b of opened) await b.close().catch(() => undefined);
});

describe('smoke: 확장 로드·worker·dev 로그인', () => {
  for (const kind of ['chromium', 'aside'] as const) {
    it(`${kind}: worker 기동, 상태 조회, dev 로그인, 장치 등록`, async () => {
      const b = await launch(kind);
      opened.push(b);
      console.log(kind, 'UA:', b.version);
      const s1 = await b.send<{
        status: string;
        devAuth: boolean;
        backend: { url: string } | null;
      }>({ type: 'getState' });
      expect(s1.devAuth).toBe(true);
      expect(s1.backend?.url).toBe('http://127.0.0.1:54321');
      expect(s1.status).toBe('auth_required');
      const email = `synthetic-smoke-${Date.now()}@example.com`;
      const r = await b.send<{ account: string; run: string }>({
        type: 'loginDev',
        email,
        password: 'synthetic-pass-1!',
      });
      expect(r.account).toBe(email);
      const s2 = await b.send<{ status: string; account: { email: string; deviceId: string } }>({
        type: 'getState',
      });
      expect(s2.account.email).toBe(email);
      expect(s2.account.deviceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(s2.status).toBe('unconfigured');
      const tree = await b.send<{ id: string; title: string }[]>({ type: 'getFolderTree' });
      expect(tree.length).toBeGreaterThan(0);
    }, 90_000);
  }
});
