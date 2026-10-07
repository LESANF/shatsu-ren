/**
 * 실제 브라우저 종단 시나리오: Chromium(Playwright) ↔ Aside(실제 바이너리), 로컬 Supabase, 합성 계정·합성 북마크.
 * 결과는 docs/validation/RESULTS.md 에 기록한다. 타임스탬프·지연은 raw JSON 으로 남긴다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const RAW = new URL('../../docs/validation/raw/', import.meta.url).pathname;
mkdirSync(RAW, { recursive: true });
const email = `synthetic-e2e-${Date.now()}@example.com`;
const password = 'synthetic-pass-1!';
let A: ExtBrowser; // chromium
let B: ExtBrowser; // aside
let folderA: BmNode;
let folderB: BmNode;
let collectionId = '';
const log: Record<string, unknown>[] = [];
const note = (k: string, v: unknown) => {
  log.push({ at: new Date().toISOString(), [k]: v });
};

type State = {
  status: string;
  counts: { outbox: number; pendingApply: number; conflicts: number; reviews: number };
  bindings: { collectionId: string; localRootId: string; status: string }[];
  collections: { id: string; title: string; rootNodeId: string }[];
  realtime: string;
  lastServerCheckAt: number | null;
  account: { email: string } | null;
  settings: { autoSync: boolean };
};
const state = (b: ExtBrowser) => b.send<State>({ type: 'getState' });
const resolveConflict = async (b: ExtBrowser, id: string, resolution: string) => {
  const conflict = await b.send<{ fingerprint: string }>({ type: 'getConflictDetail', id });
  return b.send({ type: 'resolveConflict', id, resolution, fingerprint: conflict.fingerprint });
};
const diag = (b: ExtBrowser) => async () => {
  const s = await state(b);
  return {
    kind: b.kind,
    status: s.status,
    counts: s.counts,
    bindings: s.bindings.map((x) => x.status),
    realtime: s.realtime,
    lastError: (s as { lastError?: unknown }).lastError,
    blocked: (s as { blocked?: unknown }).blocked,
    running: (s as { running?: unknown }).running,
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
const shapeOf = async (b: ExtBrowser, id: string) => shape(await subtree(b, id));
const untilSameShape = async (ms = 20000) =>
  waitFor(
    async () => {
      const a = JSON.stringify(await shapeOf(A, folderA.id));
      const bb = JSON.stringify(await shapeOf(B, folderB.id));
      return a === bb ? a : null;
    },
    ms,
    250,
    async () => ({
      A: await diag(A)(),
      B: await diag(B)(),
      shapeA: await shapeOf(A, folderA.id),
      shapeB: await shapeOf(B, folderB.id),
    }),
  );

beforeAll(async () => {
  A = await launch('chromium');
  B = await launch('aside');
  note('browsers', { A: A.version, B: B.version, extA: A.extensionId, extB: B.extensionId });
}, 120_000);
afterAll(async () => {
  writeFileSync(RAW + 'sync-e2e-log.json', JSON.stringify(log, null, 1));
  await A?.close().catch(() => undefined);
  await B?.close().catch(() => undefined);
});

describe('B01/B02/U05 최초 연결과 추가 브라우저 연결', () => {
  it('A: 로그인 → 합성 폴더 연결(빈 서버) → 삭제 0, 항목 등록', async () => {
    await A.send({ type: 'loginDev', email, password });
    folderA = await makeFolder(A, 'shatsu-e2e');
    const f1 = await A.bookmarks<BmNode>('create', { parentId: folderA.id, title: 'Sub 1' });
    await A.bookmarks('create', {
      parentId: folderA.id,
      title: 'Example A',
      url: 'https://example.com/a',
    });
    await A.bookmarks('create', {
      parentId: f1.id,
      title: 'Example B',
      url: 'https://example.com/b',
    });
    await A.bookmarks('create', { parentId: f1.id, title: 'Empty' });
    await A.bookmarks('create', {
      parentId: folderA.id,
      title: 'JS excluded',
      url: 'javascript:void(0)',
    });
    const before = await shapeOf(A, folderA.id);
    const plan = await A.send<{
      planId: string;
      counts: Record<string, number>;
      collectionId: string;
    }>({ type: 'previewMerge', localRootId: folderA.id, newCollectionTitle: 'E2E Shared' });
    note('planA', plan.counts);
    expect(plan.counts.toServer).toBe(4); // Sub 1, Example A, Example B, Empty
    expect(plan.counts.toLocal).toBe(0);
    expect(plan.counts.deletes).toBe(0);
    expect(plan.counts.excluded).toBe(1);
    collectionId = plan.collectionId;
    const r = await A.send<{ run: { outcome: string; sent: number } }>({
      type: 'applyMerge',
      planId: plan.planId,
    });
    note('applyA', r);
    await untilIdle(A);
    expect(await shapeOf(A, folderA.id)).toEqual(before); // 로컬 복제·삭제 없음
    const s = await state(A);
    expect(s.bindings[0]?.collectionId).toBe(collectionId);
  }, 90_000);

  it('B: 같은 계정 로그인 → 기존 공유 폴더를 로컬 폴더에 연결 → 동일 트리, 이름 자동 연결 없음', async () => {
    await B.send({ type: 'loginDev', email, password });
    const s0 = await state(B);
    expect(s0.status).toBe('unconfigured');
    expect(s0.collections.find((c) => c.id === collectionId)?.title).toBe('E2E Shared');
    expect(s0.bindings).toEqual([]); // 이름이 같아도 자동 연결 없음
    folderB = await makeFolder(B, 'shatsu-e2e');
    // B 에 이미 같은 북마크 하나가 있는 경우(중복 매칭): 정확 매칭은 연결, 나머지는 받기
    await B.bookmarks('create', {
      parentId: folderB.id,
      title: 'Example A',
      url: 'https://example.com/a',
    });
    const plan = await B.send<{ planId: string; counts: Record<string, number> }>({
      type: 'previewMerge',
      localRootId: folderB.id,
      collectionId,
    });
    note('planB', plan.counts);
    expect(plan.counts.matched).toBe(1);
    expect(plan.counts.toLocal).toBe(3);
    expect(plan.counts.toServer).toBe(0);
    expect(plan.counts.deletes).toBe(0);
    await B.send({ type: 'applyMerge', planId: plan.planId });
    await untilIdle(B);
    await untilIdle(A);
    const same = await untilSameShape();
    note('mergedShape', JSON.parse(same));
    expect(JSON.parse(same)).toEqual({
      t: 'shatsu-e2e',
      c: [
        {
          t: 'Sub 1',
          c: [
            { t: 'Example B', u: 'https://example.com/b' },
            { t: 'Empty', c: [] },
          ],
        },
        { t: 'Example A', u: 'https://example.com/a' },
      ],
    });
    // 제외 항목은 A 에만 남고 B 에는 없다
    expect((await subtree(B, folderB.id)).children!.some((x) => x.title === 'JS excluded')).toBe(
      false,
    );
    expect((await subtree(A, folderA.id)).children!.some((x) => x.title === 'JS excluded')).toBe(
      true,
    );
  }, 120_000);
});

describe('R01/C01 양방향 실시간 전파와 지연', () => {
  it('A→B, B→A 각 30회 단일 생성: p50/p95 기록', async () => {
    const lat: { dir: string; ms: number }[] = [];
    for (const [src, dst, dir] of [
      [A, B, 'A→B'],
      [B, A, 'B→A'],
    ] as const) {
      const srcRoot = src === A ? folderA.id : folderB.id;
      const dstRoot = dst === A ? folderA.id : folderB.id;
      for (let i = 0; i < 30; i++) {
        const url = `https://example.com/${dir === 'A→B' ? 'ab' : 'ba'}/${i}`;
        const t0 = Date.now();
        await src.bookmarks('create', { parentId: srcRoot, title: `lat ${dir} ${i}`, url });
        const arrived = () =>
          dst
            .bookmarks<BmNode[]>('search', { url })
            .then((r) => r.some((n) => n.parentId === dstRoot));
        try {
          await waitFor(arrived, 10_000, 50);
          lat.push({ dir, ms: Date.now() - t0 });
        } catch {
          // 실시간 신호 유실 의심: 진단 기록 후 보조 경로(지금 확인)로 복구되는지 확인 (R02)
          const d = { i, dir, src: await diag(src)(), dst: await diag(dst)() };
          const run = await dst.send({ type: 'syncNow' });
          const recovered = await waitFor(arrived, 15_000, 100)
            .then(() => true)
            .catch(() => false);
          note('signalLost', { ...d, run, recovered });
          lat.push({ dir, ms: Date.now() - t0 });
          if (!recovered)
            throw new Error('not recovered by manual sync: ' + JSON.stringify(d).slice(0, 800));
        }
      }
    }
    const stats = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
      return { n: s.length, p50: q(0.5), p95: q(0.95), max: s.at(-1) };
    };
    const lost = log.filter((e) => 'signalLost' in e).length;
    const summary = {
      'A→B': stats(lat.filter((l) => l.dir === 'A→B').map((l) => l.ms)),
      'B→A': stats(lat.filter((l) => l.dir === 'B→A').map((l) => l.ms)),
      signalLostAndRecovered: lost,
    };
    note('latency', summary);
    writeFileSync(
      RAW + 'r01-latency.json',
      JSON.stringify({ measuredAt: new Date().toISOString(), samples: lat, summary }, null, 1),
    );
    console.log('R01 latency', JSON.stringify(summary));
    expect(lat.length).toBe(60);
    await untilSameShape(30_000);
  }, 600_000);
});

describe('C01/C02/E01 수정·이동·순서·삭제 전파', () => {
  it('제목/URL 수정 (A→B)', async () => {
    const [n] = await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/a' });
    await A.bookmarks('update', n!.id, {
      title: 'Example A (renamed)',
      url: 'https://example.com/a2',
    });
    await waitFor(async () =>
      (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/a2' })).find(
        (x) => x.title === 'Example A (renamed)',
      ),
    );
    await untilSameShape();
  }, 60_000);
  it('폴더 이동 + 순서 변경 (B→A), 빈 폴더 유지', async () => {
    const tB = await subtree(B, folderB.id);
    const sub1 = tB.children!.find((c) => c.title === 'Sub 1')!;
    const empty = sub1.children!.find((c) => c.title === 'Empty')!;
    await B.bookmarks('move', empty.id, { parentId: folderB.id, index: 0 });
    const s = await untilSameShape(30_000);
    const parsed = JSON.parse(s) as { c: { t: string }[] };
    expect(parsed.c[0]?.t).toBe('Empty');
    // 형제 순서만 변경
    const ex = tB.children!.find((c) => c.title === 'Sub 1')!;
    await B.bookmarks('move', ex.id, { parentId: folderB.id, index: 0 });
    const s2 = JSON.parse(await untilSameShape(30_000)) as { c: { t: string }[] };
    expect(s2.c.map((x) => x.t).slice(0, 2)).toEqual(['Sub 1', 'Empty']);
  }, 90_000);
  it('E01 폴더 삭제(A) → B 에서 하위 포함 삭제, 휴지통 등록', async () => {
    const tA = await subtree(A, folderA.id);
    const sub1 = tA.children!.find((c) => c.title === 'Sub 1')!;
    await A.bookmarks('removeTree', sub1.id);
    await waitFor(
      async () => !(await subtree(B, folderB.id)).children!.some((c) => c.title === 'Sub 1'),
      30_000,
    );
    await untilSameShape();
    const trash = await B.send<{ itemCount: number; rootTitle: string }[]>({ type: 'listTrash' });
    expect(trash.find((t) => t.rootTitle === 'Sub 1')?.itemCount).toBe(2);
  }, 60_000);
  it('E04 휴지통 복원(B) → 양쪽에 다시 생성', async () => {
    const trash = await B.send<{ deletionId: string; collectionId: string; rootTitle: string }[]>({
      type: 'listTrash',
    });
    const t = trash.find((x) => x.rootTitle === 'Sub 1')!;
    await B.send({
      type: 'restoreTrash',
      deletionId: t.deletionId,
      collectionId: t.collectionId,
      parentGlobalId: null,
    });
    await waitFor(
      async () => (await subtree(A, folderA.id)).children!.some((c) => c.title === 'Sub 1'),
      30_000,
    );
    const s = JSON.parse(await untilSameShape()) as { c: { t: string; c?: unknown[] }[] };
    expect(s.c.find((c) => c.t === 'Sub 1')?.c).toHaveLength(1);
  }, 60_000);
});

describe('C03/C04 충돌', () => {
  it('C03 같은 북마크를 양쪽에서 동시 수정 → 두 번째 장치에서 충돌, 조용한 덮어쓰기 없음, "내 변경 사용" 후 수렴', async () => {
    await A.send({ type: 'setSettings', patch: { autoSync: false } });
    await B.send({ type: 'setSettings', patch: { autoSync: false } });
    const [a] = await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/a2' });
    const [b] = await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/a2' });
    await A.bookmarks('update', a!.id, { title: 'Title from A' });
    await B.bookmarks('update', b!.id, { title: 'Title from B' });
    await A.send({ type: 'setSettings', patch: { autoSync: true } });
    await A.send({ type: 'syncNow' });
    await untilIdle(A);
    await B.send({ type: 'setSettings', patch: { autoSync: true } });
    await B.send({ type: 'syncNow' });
    const sB = await waitFor(async () => {
      const s = await state(B);
      return s.counts.conflicts > 0 ? s : null;
    });
    expect(sB.status).toBe('conflict');
    expect((await B.bookmarks<BmNode[]>('get', b!.id))[0]!.title).toBe('Title from B'); // 덮어쓰기 없음
    expect((await A.bookmarks<BmNode[]>('get', a!.id))[0]!.title).toBe('Title from A');
    const conflicts = await B.send<
      { id: string; kind: string; local: { title: string }; remote: { title: string } }[]
    >({ type: 'listConflicts' });
    expect(conflicts[0]).toMatchObject({
      kind: 'edit_edit',
      local: { title: 'Title from B' },
      remote: { title: 'Title from A' },
    });
    note('conflictC03', conflicts[0]);
    await resolveConflict(B, conflicts[0]!.id, 'mine');
    await waitFor(
      async () => (await A.bookmarks<BmNode[]>('get', a!.id))[0]!.title === 'Title from B',
      30_000,
    );
    await untilSameShape();
  }, 120_000);
  it('C04 원격 삭제 vs 로컬 미전송 수정 → 수정 보존, 사용자 결정(수정본 보관 → 새 항목으로 재업로드)', async () => {
    await A.send({ type: 'setSettings', patch: { autoSync: false } });
    const [a] = await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/ab/1' });
    const [b] = await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/ab/1' });
    await B.bookmarks('remove', b!.id);
    // B 의 삭제가 서버에 확정된 것을 휴지통으로 확인한 뒤 A 를 재개한다 (경합 방지)
    await waitFor(
      async () =>
        (await B.send<{ rootTitle: string }[]>({ type: 'listTrash' })).some(
          (t) => t.rootTitle === b!.title,
        ),
      30_000,
      300,
      diag(B),
    );
    await A.bookmarks('update', a!.id, { title: 'edited while remote deleted' });
    await A.send({ type: 'setSettings', patch: { autoSync: true } });
    const run = await A.send({ type: 'syncNow' });
    note('c04-syncNow', run);
    const sA = await waitFor(
      async () => {
        const s = await state(A);
        return s.counts.conflicts > 0 ? s : null;
      },
      30_000,
      250,
      async () => ({ ...(await diag(A)()), run }),
    );
    expect(sA.status).toBe('conflict');
    expect((await A.bookmarks<BmNode[]>('get', a!.id))[0]!.title).toBe(
      'edited while remote deleted',
    );
    const c = await A.send<{ id: string; kind: string }[]>({ type: 'listConflicts' });
    expect(c[0]?.kind).toBe('local_edit_remote_delete');
    await resolveConflict(A, c[0]!.id, 'mine');
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/ab/1' })).some(
          (n) => n.title === 'edited while remote deleted',
        ),
      30_000,
    );
    await untilSameShape();
  }, 120_000);
});

describe('E03/U11 대량 삭제 보호', () => {
  it('A 에서 25개 삭제 → 확인 없이 B 에도 반영, 서버 휴지통에 남음', async () => {
    const countLat = async (b: ExtBrowser, root: string) =>
      (await subtree(b, root)).children!.filter(
        (c) => c.url?.includes('/ab/') || c.url?.includes('/ba/'),
      ).length;
    await untilSameShape(30_000);
    const beforeB = await countLat(B, folderB.id);
    const victims = (await subtree(A, folderA.id))
      .children!.filter((c) => c.url?.includes('/ab/') || c.url?.includes('/ba/'))
      .slice(0, 25);
    expect(victims.length).toBe(25);
    for (const v of victims) await A.bookmarks('remove', v.id);
    await waitFor(
      async () => (await countLat(B, folderB.id)) === beforeB - 25,
      30_000,
      250,
      diag(B),
    );
    expect((await state(A)).counts.reviews).toBe(0);
    expect((await state(B)).counts.reviews).toBe(0);
    const trash = await A.send<unknown[]>({ type: 'listTrash' });
    expect(trash.length).toBeGreaterThanOrEqual(25);
    await untilSameShape(30_000);
  }, 180_000);
});

describe('D03/U04 재시작·오프라인 편집·팝업', () => {
  it('B 를 자동 동기화 끈 채 편집 → 브라우저 재시작 → 재개 후 반영', async () => {
    await B.send({ type: 'setSettings', patch: { autoSync: false } });
    await B.bookmarks('create', {
      parentId: folderB.id,
      title: 'offline edit',
      url: 'https://example.com/offline',
    });
    await sleep(1500);
    expect(
      (await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/offline' })).length,
    ).toBe(0);
    const dir = B.userDataDir;
    await B.close({ keepProfile: true });
    B = await launch('aside', { userDataDir: dir });
    const s = await state(B);
    expect(s.account?.email).toBe(email);
    expect(s.settings.autoSync).toBe(false);
    expect(s.status).toBe('paused');
    folderB = (await B.bookmarks<BmNode[]>('search', { title: 'shatsu-e2e' }))[0]!;
    await B.send({ type: 'setSettings', patch: { autoSync: true } });
    await waitFor(
      async () =>
        (await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/offline' })).length ===
        1,
      30_000,
    );
    await untilSameShape();
  }, 120_000);
  it('U04/U01 팝업·화면 스크린샷 (밝음/어둠)', async () => {
    for (const [b, name] of [
      [A, 'chromium'],
      [B, 'aside'],
    ] as const) {
      const p = await b.context.newPage();
      await p.setViewportSize({ width: 360, height: 560 });
      await p.goto(`chrome-extension://${b.extensionId}/popup.html`);
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${SHOTS_DIR}/popup-${name}-light.png` });
      await p.emulateMedia({ colorScheme: 'dark' });
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${SHOTS_DIR}/popup-${name}-dark.png` });
      await p.emulateMedia({ colorScheme: 'light' });
      await p.setViewportSize({ width: 1100, height: 800 });
      for (const route of ['/', '/folders', '/history', '/recovery', '/settings']) {
        await p.goto(`chrome-extension://${b.extensionId}/app.html#${route}`);
        await p.getByRole('navigation').waitFor();
        if (route === '/') await p.getByText(email, { exact: false }).first().waitFor();
        await p.waitForTimeout(1500);
        await p.screenshot({
          path: `${SHOTS_DIR}/app-${name}${route === '/' ? '-overview' : route.replace('/', '-')}.png`,
          fullPage: true,
        });
      }
      await p.emulateMedia({ colorScheme: 'dark' });
      await p.goto(`chrome-extension://${b.extensionId}/app.html#/`);
      await p.getByRole('navigation').waitFor();
      await p.getByText(email, { exact: false }).first().waitFor();
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${SHOTS_DIR}/app-${name}-overview-dark.png`, fullPage: true });
      await p.close();
    }
  }, 120_000);
});

describe('A06/F07 계정 전환 격리', () => {
  it('A 로그아웃 후 다른 계정 로그인 → binding 없음, B 는 영향 없음, 이전 계정 데이터 전송 없음', async () => {
    await A.send({ type: 'logout' });
    const other = `synthetic-other-${Date.now()}@example.com`;
    await A.send({ type: 'loginDev', email: other, password });
    const s = await state(A);
    expect(s.account?.email).toBe(other);
    expect(s.bindings).toEqual([]);
    expect(s.collections).toEqual([]);
    expect(s.status).toBe('unconfigured');
    await A.bookmarks('create', {
      parentId: folderA.id,
      title: 'after switch',
      url: 'https://example.com/after-switch',
    });
    await sleep(4000);
    expect(
      (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/after-switch' })).length,
    ).toBe(0);
    const sB = await state(B);
    expect(sB.account?.email).toBe(email);
    expect(sB.bindings.length).toBe(1);
    // 다시 원래 계정으로 로그인하면 binding 과 대기 상태 복원
    await A.send({ type: 'logout' });
    await A.send({ type: 'loginDev', email, password });
    const s2 = await waitFor(async () => {
      const x = await state(A);
      return x.bindings.length === 1 ? x : null;
    });
    expect(s2.bindings[0]?.collectionId).toBe(collectionId);
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/after-switch' }))
          .length === 1,
      30_000,
    );
  }, 120_000);
});
