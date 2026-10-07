/**
 * 올리기/받기 정책: 고른 폴더를 이름을 붙여 서버에 올리면(연결 유지) 다른 브라우저는 북마크바 맨 앞에
 * 같은 이름 폴더로 받아 연결한다. 이름은 계정 안에서 겹치지 않는다. 되돌리기는 서버 내용으로 다시 받는다.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  launch,
  shape,
  subtree,
  waitFor,
  SHOTS_DIR,
  type BmNode,
  type ExtBrowser,
} from '../lib/browser';

let A: ExtBrowser;
let B: ExtBrowser;
const email = `synthetic-connect-${Date.now()}@example.com`;
const password = 'synthetic-pass-1!';
afterAll(async () => {
  await A?.close().catch(() => undefined);
  await B?.close().catch(() => undefined);
});

type Plan = {
  planId: string;
  connectMode: string;
  counts: { toServer: number; toLocal: number; deletes: number };
};
const bar = async (b: ExtBrowser) => (await b.bookmarks<BmNode[]>('getTree'))[0]!.children![0]!;
const barKids = async (b: ExtBrowser) => (await subtree(b, (await bar(b)).id)).children!;
const idle = (b: ExtBrowser) =>
  waitFor(async () => {
    const s = await b.send<{ status: string; counts: { outbox: number } }>({ type: 'getState' });
    return s.status === 'idle' && s.counts.outbox === 0;
  }, 30000);

describe('upload / download', () => {
  it('upload a named folder, download elsewhere, sync both ways, reject duplicate names, restore server version', async () => {
    A = await launch('chromium');
    B = await launch('aside');
    await A.send({ type: 'loginDev', email, password });
    const src = await A.bookmarks<BmNode>('create', {
      parentId: (await bar(A)).id,
      title: '내 북마크',
    });
    await A.bookmarks('create', {
      parentId: src.id,
      title: 'Example A',
      url: 'https://example.com/a',
    });
    const sub = await A.bookmarks<BmNode>('create', { parentId: src.id, title: 'Sub' });
    await A.bookmarks('create', {
      parentId: sub.id,
      title: 'Example B',
      url: 'https://example.com/b',
    });

    const up = await A.send<Plan>({ type: 'previewUpload', localRootId: src.id, title: '테스트1' });
    expect(up.connectMode).toBe('upload');
    expect(up.counts.toServer).toBe(3);
    expect(up.counts.deletes).toBe(0);
    await A.send({ type: 'applyMerge', planId: up.planId });
    await idle(A);
    // 같은 이름은 거부 (앞뒤 공백·대소문자 무시)
    const other = await A.bookmarks<BmNode>('create', {
      parentId: (await bar(A)).id,
      title: '다른 폴더',
    });
    await expect(
      A.send({ type: 'previewUpload', localRootId: other.id, title: ' 테스트1 ' }),
    ).rejects.toThrow(/DUPLICATE_TITLE/);

    await B.send({ type: 'loginDev', email, password });
    const down = await B.send<{ collections: { id: string; title: string }[] }>({
      type: 'getState',
    });
    const set = down.collections.find((c) => c.title === '테스트1')!;
    const dn = await B.send<Plan>({ type: 'previewDownload', collectionId: set.id });
    expect(dn.connectMode).toBe('receive');
    expect(dn.counts.toLocal).toBe(3);
    await B.send({ type: 'applyMerge', planId: dn.planId });
    const bFolder = async () => (await barKids(B))[0]!;
    await waitFor(
      async () =>
        (await bFolder()).title === '테스트1' &&
        (await subtree(B, (await bFolder()).id)).children!.length === 2,
      30000,
    );
    const kids = async (b: ExtBrowser, id: string) =>
      JSON.stringify((shape(await subtree(b, id)) as { c: unknown[] }).c);
    const same = async () => (await kids(A, src.id)) === (await kids(B, (await bFolder()).id));
    await waitFor(same, 30000);
    // 이미 받은 것은 다시 받을 수 없다 (중복 폴더 방지)
    await expect(B.send({ type: 'previewDownload', collectionId: set.id })).rejects.toThrow(
      /ALREADY_BOUND/,
    );

    // 양방향
    await B.bookmarks('create', {
      parentId: (await bFolder()).id,
      title: 'From Aside',
      url: 'https://example.com/aside',
    });
    await waitFor(
      async () =>
        (await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/aside' })).length === 1,
      30000,
    );
    await A.bookmarks('create', {
      parentId: src.id,
      title: 'From Chromium',
      url: 'https://example.com/chromium',
    });
    await waitFor(
      async () =>
        (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/chromium' })).length ===
        1,
      30000,
    );
    await waitFor(same, 30000);

    // 되돌리기: B 에만 있는(올라가지 않은) 항목은 사라지고 서버 내용으로 다시 받는다
    await B.send({ type: 'setSettings', patch: { autoSync: false } });
    await B.bookmarks('create', {
      parentId: (await bFolder()).id,
      title: 'local only',
      url: 'https://example.com/local-only',
    });
    const st = await B.send<{ bindings: { collectionId: string }[] }>({ type: 'getState' });
    await B.send({ type: 'resetToServer', collectionId: st.bindings[0]!.collectionId });
    expect(
      (await B.bookmarks<BmNode[]>('search', { url: 'https://example.com/local-only' })).length,
    ).toBe(0);
    await B.send({ type: 'setSettings', patch: { autoSync: true } });
    await idle(B);
    expect((await barKids(B))[0]!.title).toBe('테스트1');
    expect((await barKids(B)).filter((c) => c.title === '테스트1').length).toBe(1);
    await waitFor(same, 30000);
  }, 300000);

  it('upload with "also create a synced folder here": copy at bar front is connected, original untouched', async () => {
    const e2 = `synthetic-copy-${Date.now()}@example.com`;
    const C = await launch('chromium');
    const D = await launch('aside');
    try {
      await C.send({ type: 'loginDev', email: e2, password });
      const src = await C.bookmarks<BmNode>('create', {
        parentId: (await bar(C)).id,
        title: '원본',
      });
      await C.bookmarks('create', {
        parentId: src.id,
        title: 'Example C',
        url: 'https://example.com/c',
      });
      const before = shape(await subtree(C, src.id));
      const up = await C.send<Plan>({
        type: 'previewUpload',
        localRootId: src.id,
        title: '클라우드2',
        makeSyncFolder: true,
      });
      expect(up.counts.toServer).toBe(1);
      await C.send({ type: 'applyMerge', planId: up.planId });
      await idle(C);
      const front = (await barKids(C))[0]!;
      expect(front.title).toBe('클라우드2');
      expect(shape(await subtree(C, src.id))).toEqual(before);
      const st = await C.send<{ bindings: { localRootId: string }[] }>({ type: 'getState' });
      expect(st.bindings.map((b) => b.localRootId)).toEqual([front.id]); // 원본은 연결 안 됨

      await D.send({ type: 'loginDev', email: e2, password });
      const sets = await D.send<{ collections: { id: string; title: string }[] }>({
        type: 'getState',
      });
      const dn = await D.send<Plan>({
        type: 'previewDownload',
        collectionId: sets.collections.find((c) => c.title === '클라우드2')!.id,
      });
      await D.send({ type: 'applyMerge', planId: dn.planId });
      await waitFor(
        async () =>
          (await D.bookmarks<BmNode[]>('search', { url: 'https://example.com/c' })).length === 1,
        30000,
      );
      await C.bookmarks('create', {
        parentId: front.id,
        title: 'via copy',
        url: 'https://example.com/via-copy',
      });
      await waitFor(
        async () =>
          (await D.bookmarks<BmNode[]>('search', { url: 'https://example.com/via-copy' }))
            .length === 1,
        30000,
      );
      expect(
        (await C.bookmarks<BmNode[]>('search', { url: 'https://example.com/via-copy' }))[0]!
          .parentId,
      ).toBe(front.id);
    } finally {
      await C.close().catch(() => undefined);
      await D.close().catch(() => undefined);
    }
  }, 240000);

  it('screens: upload and download tabs', async () => {
    const C = await launch('chromium');
    await C.send({ type: 'loginDev', email, password });
    await C.send({ type: 'syncNow' });
    const pg = await C.context.newPage();
    await pg.setViewportSize({ width: 820, height: 800 });
    await pg.goto(`chrome-extension://${C.extensionId}/app.html#/onboarding`);
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${SHOTS_DIR}/connect-download.png`, fullPage: true });
    await pg.getByRole('tab').nth(1).click();
    await pg.locator('.tree .node').first().click();
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: `${SHOTS_DIR}/connect-upload.png`, fullPage: true });
    await C.close();
  }, 120000);
});
