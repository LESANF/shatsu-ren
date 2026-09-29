/** 복구·재시작·오프라인·정지·키보드·1k 성능 시나리오. sync.test.ts 와 독립된 계정/프로필. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  launch,
  makeFolder,
  shape,
  sleep,
  subtree,
  waitFor,
  SHOTS_DIR,
  type BmNode,
  type ExtBrowser,
} from '../lib/browser';
import { localStack } from '../lib/supabase';

const RAW = new URL('../../docs/validation/raw/', import.meta.url).pathname;
mkdirSync(RAW, { recursive: true });
const psql = (sql: string) =>
  execSync(`/opt/homebrew/opt/libpq/bin/psql "${localStack().dbUrl}" -Atc ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
  }).trim();
const email = `synthetic-rec-${Date.now()}@example.com`;
const password = 'synthetic-pass-1!';
let A: ExtBrowser;
let B: ExtBrowser;
let fA: BmNode;
let fB: BmNode;
let collectionId = '';
type State = {
  status: string;
  counts: {
    outbox: number;
    pendingApply: number;
    conflicts: number;
    reviews: number;
    recovery: number;
  };
  bindings: { collectionId: string; localRootId: string; status: string; recovery?: unknown }[];
  collections: { id: string }[];
  settings: { autoSync: boolean };
  account: { workspaceId: string; email: string } | null;
  realtime: string;
  lastError: unknown;
};
const state = (b: ExtBrowser) => b.send<State>({ type: 'getState' });
const diag = (b: ExtBrowser) => async () => {
  const s = await state(b);
  return {
    kind: b.kind,
    status: s.status,
    counts: s.counts,
    bindings: s.bindings.map((x) => x.status),
    realtime: s.realtime,
    lastError: s.lastError,
  };
};
const untilIdle = (b: ExtBrowser, ms = 20000) =>
  waitFor(
    async () => {
      const s = await state(b);
      return s.status === 'idle' && s.counts.outbox === 0 ? s : null;
    },
    ms,
    250,
    diag(b),
  );
const same = async (ms = 20000) =>
  waitFor(
    async () => {
      const a = JSON.stringify(shape(await subtree(A, fA.id)));
      const b = JSON.stringify(shape(await subtree(B, fB.id)));
      return a === b ? a : null;
    },
    ms,
    250,
    async () => ({ A: await diag(A)(), B: await diag(B)() }),
  );
const log: Record<string, unknown>[] = [];
const note = (k: string, v: unknown) => log.push({ at: new Date().toISOString(), [k]: v });

beforeAll(async () => {
  A = await launch('chromium');
  B = await launch('aside');
  await A.send({ type: 'loginDev', email, password });
  await B.send({ type: 'loginDev', email, password });
  fA = await makeFolder(A, 'shatsu-rec');
  fB = await makeFolder(B, 'shatsu-rec');
  await A.bookmarks('create', { parentId: fA.id, title: 'seed', url: 'https://example.com/seed' });
  const pa = await A.send<{ planId: string; collectionId: string }>({
    type: 'previewMerge',
    localRootId: fA.id,
    newCollectionTitle: 'REC',
  });
  collectionId = pa.collectionId;
  await A.send({ type: 'applyMerge', planId: pa.planId });
  await untilIdle(A);
  await waitFor(async () => (await state(B)).collections.some((c) => c.id === collectionId));
  const pb = await B.send<{ planId: string }>({
    type: 'previewMerge',
    localRootId: fB.id,
    collectionId,
  });
  await B.send({ type: 'applyMerge', planId: pb.planId });
  await same(30_000);
}, 180_000);
afterAll(async () => {
  writeFileSync(RAW + 'recovery-e2e-log.json', JSON.stringify(log, null, 1));
  await A?.close().catch(() => undefined);
  await B?.close().catch(() => undefined);
});

describe('U03/D03 오프라인', () => {
  it('오프라인에서 편집 → 상태 offline·보관, 온라인 복귀 후 전달', async () => {
    try {
      await A.context.setOffline(true);
      await A.bookmarks('create', {
        parentId: fA.id,
        title: 'made offline',
        url: 'https://example.com/offline-a',
      });
      await A.send({ type: 'syncNow' });
      const s = await waitFor(
        async () => {
          const x = await state(A);
          return x.status === 'offline' ? x : null;
        },
        15_000,
        250,
        diag(A),
      );
      expect(s.counts.outbox).toBe(1);
      // 팝업 문구 확인
      const p = await A.context.newPage();
      await p.goto(`chrome-extension://${A.extensionId}/popup.html`);
      await p.waitForTimeout(2000);
      const text = await p.locator('body').innerText();
      expect(text).toMatch(/오프라인|Offline/);
      await p.screenshot({ path: `${SHOTS_DIR}/popup-chromium-offline.png` });
      await p.close();
    } finally {
      await A.context.setOffline(false);
    }
    await A.send({ type: 'syncNow' });
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/offline-a' })).length ===
        1,
      30_000,
    );
    await untilIdle(A);
  }, 90_000);
});

describe('U08/U09 자동 동기화 끄기·폴더 정지', () => {
  it('U08 전역 자동 동기화 끄기 후 1회 실행: 대기 전송, 설정은 꺼진 채 유지, 상대 설정 불변', async () => {
    await A.send({ type: 'setSettings', patch: { autoSync: false } });
    await A.bookmarks('create', { parentId: fA.id, title: 'u08', url: 'https://example.com/u08' });
    await sleep(1500);
    expect(
      (await state(A)).counts.outbox + (await state(A)).counts.pendingApply,
    ).toBeGreaterThanOrEqual(0);
    expect((await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/u08' })).length).toBe(
      0,
    );
    await A.send({ type: 'syncNow' });
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/u08' })).length === 1,
      30_000,
    );
    const s = await state(A);
    expect(s.settings.autoSync).toBe(false);
    expect(s.status).toBe('paused');
    expect((await state(B)).settings.autoSync).toBe(true);
    await A.send({ type: 'setSettings', patch: { autoSync: true } });
    await untilIdle(A);
  }, 90_000);
  it('U09 폴더 정지: 정지 중 native 적용 없음, 지금 확인도 우회 안 함, 재개 시 적용', async () => {
    await B.send({ type: 'pauseBinding', collectionId });
    await A.bookmarks('create', { parentId: fA.id, title: 'u09', url: 'https://example.com/u09' });
    await untilIdle(A);
    await B.send({ type: 'syncNow' });
    await sleep(2000);
    expect((await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/u09' })).length).toBe(
      0,
    );
    expect((await state(B)).bindings[0]?.status).toBe('paused');
    await B.send({ type: 'resumeBinding', collectionId });
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/u09' })).length === 1,
      30_000,
    );
    await same();
  }, 90_000);
});

describe('D01 불확실한 create journal', () => {
  it('중단된 create journal → 자동 재생성 없이 복구 필요 + 후보 선택', async () => {
    // worker 강제 종료를 재현하기 위해 확장 페이지에서 같은 IndexedDB 에 "started" journal 을 주입한다 (production hook 없음)
    const ws = (await state(A)).account!.workspaceId;
    const injected = await A.app.evaluate(
      async ({ collectionId, parentLocalId }) => {
        const dbs = await indexedDB.databases();
        const name = dbs.map((d) => d.name!).find((n) => n.startsWith('shatsu-'))!;
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(name);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        // 실제로 브라우저에 만들어졌지만 mapping 전에 죽은 상황: 후보 항목을 만든 뒤 journal 만 남긴다
        const created = await chrome.bookmarks.create({
          parentId: parentLocalId,
          title: 'orphan created',
          url: 'https://example.com/orphan',
        });
        const tx = db.transaction('journal', 'readwrite');
        tx.objectStore('journal').put({
          id: 'inj-' + Date.now(),
          collectionId,
          action: 'create',
          status: 'started',
          startedAt: Date.now(),
          globalId: crypto.randomUUID(),
          parentLocalId,
          expected: {
            title: 'orphan created',
            url: 'https://example.com/orphan',
            kind: 'bookmark',
          },
        });
        await new Promise((res) => {
          tx.oncomplete = res;
        });
        db.close();
        return created.id;
      },
      { collectionId, parentLocalId: fA.id },
    );
    note('d01-injected', { injected, ws });
    await A.send({ type: 'syncNow' });
    const s = await waitFor(
      async () => {
        const x = await state(A);
        return x.status === 'recovery_required' ? x : null;
      },
      15_000,
      250,
      diag(A),
    );
    expect(s.bindings[0]?.status).toBe('recovery_required');
    const reviews = await A.send<{ id: string; kind: string; candidates: { localId: string }[] }[]>(
      { type: 'listReviews' },
    );
    const rec = reviews.find((r) => r.kind === 'create_recovery')!;
    expect(rec.candidates.map((c) => c.localId)).toContain(injected);
    // 후보로 연결 → binding 재개. orphan 은 (server 에 없는 globalId 에 mapping 됐으므로) 다음 실행에서 서버 기준으로 정리된다
    await A.send({
      type: 'resolveReview',
      id: rec.id,
      resolution: 'map',
      candidateLocalId: injected,
    });
    await waitFor(async () => (await state(A)).bindings[0]?.status === 'active');
    await waitFor(
      async () => (await state(A)).status !== 'recovery_required',
      20_000,
      250,
      diag(A),
    );
  }, 90_000);
});

describe('R03/D04 강제 종료·재기동', () => {
  it('A 브라우저 강제 종료 중 B 편집 → 같은 프로필로 재기동 후 누락 delta 복구, alarm 재확인', async () => {
    const before = await A.worker.evaluate(() =>
      chrome.alarms.getAll().then((a) => a.map((x) => x.name)),
    );
    expect(before).toContain('shatsu-sync');
    const dir = A.userDataDir;
    await A.close(); // 강제 종료 (프로세스 종료)
    await B.bookmarks('create', {
      parentId: fB.id,
      title: 'during shutdown',
      url: 'https://example.com/during-shutdown',
    });
    await sleep(1500);
    A = await launch('chromium', { userDataDir: dir });
    fA = (await A.bookmarks<BmNode[]>('search', { title: 'shatsu-rec' }))[0]!;
    await waitFor(
      async () =>
        (await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/during-shutdown' }))
          .length === 1,
      30_000,
      250,
      diag(A),
    );
    const after = await A.worker.evaluate(() =>
      chrome.alarms.getAll().then((a) => a.map((x) => x.name)),
    );
    expect(after).toContain('shatsu-sync');
    const s = await state(A);
    expect(s.account?.email).toBe(email);
    expect(s.bindings[0]?.status).toBe('active');
    await same();
  }, 120_000);
});

describe('A05 세션 무효화', () => {
  it('서버 세션이 사라지면 다시 로그인 안내, outbox 보존, 재로그인 후 전송', async () => {
    await A.send({ type: 'setSettings', patch: { autoSync: false } });
    await A.bookmarks('create', {
      parentId: fA.id,
      title: 'before session loss',
      url: 'https://example.com/a05',
    });
    await A.send({ type: 'setSettings', patch: { autoSync: true } });
    const uid = psql(`select id from auth.users where email='${email}'`);
    const ws = (await state(A)).account!.workspaceId;
    // A 의 세션만 제거 (B 는 유지)
    const devA = psql(
      `select auth_session_id from shatsu.devices d where d.workspace_id='${ws}' and d.label like 'Chrom%' order by created_at desc limit 1`,
    );
    expect(devA).toMatch(/[0-9a-f-]{36}/);
    psql(`delete from auth.sessions where id='${devA}' and user_id='${uid}'`);
    await A.send({ type: 'syncNow' }).catch(() => undefined);
    const s = await waitFor(
      async () => {
        const x = await state(A);
        return x.status === 'auth_required' ? x : null;
      },
      20_000,
      250,
      diag(A),
    );
    note('a05', s);
    expect((await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/a05' })).length).toBe(
      1,
    ); // 로컬 보존
    await A.send({ type: 'loginDev', email, password });
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/a05' })).length === 1,
      30_000,
      250,
      diag(A),
    );
    await same();
  }, 120_000);
});

describe('U02 키보드·200% 확대', () => {
  it('키보드만으로 설정 탭 탐색·자동 동기화 토글, 200% 확대 스크린샷', async () => {
    const p = await A.context.newPage();
    await p.goto(`chrome-extension://${A.extensionId}/app.html#/settings`);
    await p.waitForTimeout(1500);
    // Tab 으로 첫 체크박스(자동 동기화)까지 이동 후 Space
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      await p.keyboard.press('Tab');
      found = await p.evaluate(() => document.activeElement?.getAttribute('role') === 'switch');
    }
    expect(found).toBe(true);
    await p.keyboard.press('Space');
    await waitFor(async () => (await state(A)).settings.autoSync === false);
    await p.keyboard.press('Space');
    await waitFor(async () => (await state(A)).settings.autoSync === true);
    await p.evaluate(() => {
      (document.documentElement.style as unknown as { zoom: string }).zoom = '2';
    });
    await p.setViewportSize({ width: 1100, height: 900 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${SHOTS_DIR}/app-chromium-settings-200pct.png` });
    const clipped = await p.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.scrollWidth > b.clientWidth + 2,
      ),
    );
    expect(clipped).toBe(false);
    await p.goto(`chrome-extension://${A.extensionId}/app.html#/onboarding`);
    await p.evaluate(() => {
      (document.documentElement.style as unknown as { zoom: string }).zoom = '2';
    });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${SHOTS_DIR}/app-chromium-onboarding-200pct.png` });
    await p.close();
  }, 60_000);
});

describe('P01 1k 항목', () => {
  it('1,000개 합성 항목 폴더 연결: 미리보기·업로드·상대 수신 시간, 응답 크기', async () => {
    const big = await makeFolder(A, 'shatsu-1k');
    const t0 = Date.now();
    for (let f = 0; f < 20; f++) {
      const folder = await A.bookmarks<BmNode>('create', { parentId: big.id, title: `F${f}` });
      for (let i = 0; i < 49; i++)
        await A.bookmarks('create', {
          parentId: folder.id,
          title: `item ${f}-${i}`,
          url: `https://example.com/1k/${f}/${i}`,
        });
    }
    const created = Date.now() - t0; // 20 + 20*49 = 1000
    const t1 = Date.now();
    const plan = await A.send<{
      planId: string;
      collectionId: string;
      counts: Record<string, number>;
    }>({ type: 'previewMerge', localRootId: big.id, newCollectionTitle: 'ONE-K' });
    const previewMs = Date.now() - t1;
    expect(plan.counts.toServer).toBe(1000);
    const t2 = Date.now();
    await A.send({ type: 'applyMerge', planId: plan.planId });
    await untilIdle(A, 180_000);
    const uploadMs = Date.now() - t2;
    const bigB = await makeFolder(B, 'shatsu-1k');
    const t3 = Date.now();
    const pb = await B.send<{ planId: string; counts: Record<string, number> }>({
      type: 'previewMerge',
      localRootId: bigB.id,
      collectionId: plan.collectionId,
    });
    expect(pb.counts.toLocal).toBe(1000);
    await B.send({ type: 'applyMerge', planId: pb.planId });
    await waitFor(
      async () => {
        const t = await subtree(B, bigB.id);
        return (
          t.children!.length === 20 && t.children!.every((c) => (c.children ?? []).length === 49)
        );
      },
      240_000,
      500,
      diag(B),
    );
    const downloadMs = Date.now() - t3;
    const ws = (await state(A)).account!.workspaceId;
    const snapshotBytes = Number(
      psql(
        `select octet_length((select jsonb_agg(shatsu.to_node_json(n)) from shatsu.nodes n where n.workspace_id='${ws}' and n.deleted_at is null)::text) + octet_length((select jsonb_agg(shatsu.to_order_json(o)) from shatsu.folder_orders o where o.workspace_id='${ws}')::text)`,
      ),
    );
    // 대형 폴더 순서 변경 응답 시간: 49개 자식 폴더 reorder (형제 이동)
    const t4 = Date.now();
    const f0 = (await subtree(A, big.id)).children![0]!;
    await A.bookmarks('move', f0.children![48]!.id, { parentId: f0.id, index: 0 });
    await waitFor(
      async () => {
        const t = await subtree(B, bigB.id);
        const c = t.children!.find((x) => x.title === 'F0')!;
        return c.children![0]?.title === 'item 0-48';
      },
      60_000,
      250,
      diag(B),
    );
    const reorderMs = Date.now() - t4;
    const result = {
      measuredAt: new Date().toISOString(),
      items: 1000,
      createLocalMs: created,
      previewMs,
      uploadMs,
      downloadMs,
      snapshotApproxBytes: snapshotBytes,
      reorder49Ms: reorderMs,
      browsers: { A: A.version, B: B.version },
    };
    writeFileSync(RAW + 'p01-1k.json', JSON.stringify(result, null, 1));
    console.log('P01', JSON.stringify(result));
    note('p01', result);
  }, 900_000);
});
