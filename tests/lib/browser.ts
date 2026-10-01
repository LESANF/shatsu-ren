import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export type BrowserKind = 'chromium' | 'chrome' | 'aside';
export const EXT_DIR = resolve(
  new URL('../../apps/extension/.output/chrome-mv3-dev', import.meta.url).pathname,
);
export const SHOTS_DIR = resolve(
  new URL('../../docs/validation/screenshots', import.meta.url).pathname,
);
mkdirSync(SHOTS_DIR, { recursive: true });

// 주의: Google Chrome 137+ 브랜드 빌드는 --load-extension 을 무시한다(2026-09-29 Chrome 154 에서 실측). 자동 테스트는 Playwright Chromium 을 쓴다.
const EXEC: Record<BrowserKind, { channel?: 'chrome'; executablePath?: string }> = {
  chromium: {},
  chrome: { channel: 'chrome' },
  aside: { executablePath: '/Applications/Aside.app/Contents/MacOS/Aside' },
};

export interface ExtBrowser {
  kind: BrowserKind;
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  app: Page; // app.html (메시지 전송·UI)
  send<T = unknown>(req: Record<string, unknown>): Promise<T>;
  bookmarks<T>(fn: string, ...args: unknown[]): Promise<T>;
  close(opts?: { keepProfile?: boolean }): Promise<void>;
  version: string;
  userDataDir: string;
}

/** 사용자 실제 프로필을 건드리지 않도록 임시 user-data-dir 로 실행한다. */
export async function launch(
  kind: BrowserKind,
  opts: { extDir?: string; userDataDir?: string } = {},
): Promise<ExtBrowser> {
  // Aside 는 직전 인스턴스 종료 직후 실행이 걸릴 수 있어 1회 재시도한다
  for (let attempt = 0; ; attempt++) {
    try {
      return await launchInner(kind, opts);
    } catch (e) {
      if (attempt >= 1) throw e;
      console.log(`[launch ${kind}] retry after failure: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}
const ownedProfiles = new Set<string>();

async function launchInner(
  kind: BrowserKind,
  opts: { extDir?: string; userDataDir?: string },
): Promise<ExtBrowser> {
  const extDir = opts.extDir ?? EXT_DIR;
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), `shatsu-${kind}-`));
  if (!opts.userDataDir) ownedProfiles.add(userDataDir);
  const t0 = Date.now();
  const step = (m: string) => console.log(`[launch ${kind}] +${Date.now() - t0}ms ${m}`);
  step('start');
  const context = await chromium
    .launchPersistentContext(userDataDir, {
      ...EXEC[kind],
      headless: false,
      timeout: 30000,
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        '--no-first-run',
      ],
      ignoreDefaultArgs: [
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
    })
    .catch((error) => {
      if (!opts.userDataDir && ownedProfiles.delete(userDataDir))
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      throw error;
    });
  try {
    step('context ready');
    let closed = false;
    context.on('close', () => {
      closed = true;
    });
    // 내장 component extension(예: Google Network Speech) 의 worker 가 먼저 잡힐 수 있어 우리 background.js 를 폴링으로 찾는다
    // Aside 는 자체 내부 확장 worker 도 background.js 라서 manifest 이름으로 식별한다
    const isOurs = async (w: Worker) =>
      w.url().endsWith('/background.js') &&
      (await Promise.race([
        w.evaluate(() => chrome.runtime.getManifest().name).catch(() => ''),
        new Promise<string>((r) => setTimeout(() => r(''), 2000)),
      ])) === 'shatsu-ren';
    let worker: Worker | undefined;
    const t1 = Date.now();
    while (!worker && Date.now() - t1 < 30_000) {
      if (closed) throw new Error(`${kind} context closed during launch`);
      for (const w of context.serviceWorkers())
        if (await isOurs(w)) {
          worker = w;
          break;
        }
      if (!worker) await new Promise((r) => setTimeout(r, 200));
    }
    if (!worker)
      throw new Error(
        'shatsu-ren service worker not found (workers: ' +
          context
            .serviceWorkers()
            .map((w) => w.url())
            .join(', ') +
          ')',
      );
    const extensionId = new URL(worker.url()).host;
    step('worker found ' + extensionId);
    await new Promise((r) => setTimeout(r, 1500)); // Aside: 시작 직후 newPage 가 닫힌 타깃을 잡는 경우가 있어 잠시 대기
    if (closed) throw new Error(`${kind} context closed after launch`);
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html`, { timeout: 20_000 });
    step('app page open');
    const version = await app.evaluate(() => navigator.userAgent);
    const b: ExtBrowser = {
      kind,
      context,
      extensionId,
      worker,
      app,
      version,
      userDataDir,
      async send<T>(req: Record<string, unknown>): Promise<T> {
        const r = (await app.evaluate((m) => chrome.runtime.sendMessage(m), req)) as {
          ok: boolean;
          data?: T;
          code?: string;
          message?: string;
        };
        if (!r?.ok)
          throw Object.assign(new Error(`${req.type}: ${r?.code} ${r?.message ?? ''}`), {
            code: r?.code,
          });
        return r.data as T;
      },
      bookmarks<T>(fn: string, ...args: unknown[]): Promise<T> {
        return app.evaluate(
          ([f, a]) =>
            (chrome.bookmarks as unknown as Record<string, (...x: unknown[]) => Promise<unknown>>)[
              f
            ]!(...a),
          [fn, args] as [string, unknown[]],
        ) as Promise<T>;
      },
      close: async (closeOpts = {}) => {
        await context.close();
        if (!closeOpts.keepProfile && ownedProfiles.delete(userDataDir))
          rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
    return b;
  } catch (error) {
    await context.close();
    if (!opts.userDataDir)
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
  every = 250,
  diag?: () => Promise<unknown>,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) {
      const d = diag ? await diag().catch((e) => String(e)) : undefined;
      throw new Error(
        'waitFor timeout' + (d !== undefined ? ' · last: ' + JSON.stringify(d).slice(0, 1500) : ''),
      );
    }
    await sleep(every);
  }
}

export interface BmNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  index?: number;
  children?: BmNode[];
}

/** 북마크바 아래에 합성 테스트 폴더 생성 */
export async function makeFolder(b: ExtBrowser, title: string): Promise<BmNode> {
  const tree = await b.bookmarks<BmNode[]>('getTree');
  const bar = tree[0]!.children![0]!; // 첫 최상위(북마크바) — 이름으로 단정하지 않고 트리에서 선택
  return b.bookmarks<BmNode>('create', { parentId: bar.id, title });
}

export const subtree = async (b: ExtBrowser, id: string) =>
  (await b.bookmarks<BmNode[]>('getSubTree', id))[0]!;

/** 비교용: 제목/URL/구조만 (id 제외). 동기화 제외 대상(http/https 아님)은 뺀다. */
export function shape(n: BmNode): unknown {
  return n.url
    ? { t: n.title, u: n.url }
    : {
        t: n.title,
        c: (n.children ?? []).filter((c) => !c.url || /^https?:\/\//i.test(c.url)).map(shape),
      };
}
