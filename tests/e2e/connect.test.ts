/** 단일 공유 폴더 정책: 첫 브라우저는 북마크바 맨 앞 shatsu-ren 폴더에 복사본을 올리고, 다음 브라우저는 같은 폴더를 받는다. */
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
const email = `synthetic-connect-${Date.now()}@example.com`,
  password = 'synthetic-pass-1!';
afterAll(async () => {
  await A?.close().catch(() => undefined);
  await B?.close().catch(() => undefined);
});

const bar = async (b: ExtBrowser) => (await b.bookmarks<BmNode[]>('getTree'))[0]!.children![0]!;
const shatsu = async (b: ExtBrowser) => {
  const k = (await subtree(b, (await bar(b)).id)).children!;
  return { first: k[0]!, all: k.filter((c) => c.title === 'shatsu-ren') };
};

describe('single shared folder', () => {
  it('first browser copies a folder into bar-front shatsu-ren; second browser receives it; edits flow both ways', async () => {
    A = await launch('chromium');
    B = await launch('aside');
    await A.send({ type: 'loginDev', email, password });
    const barA = await bar(A);
    const src = await A.bookmarks<BmNode>('create', { parentId: barA.id, title: '내 북마크' });
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
    const before = shape(await subtree(A, src.id));

    const p = await A.send<{
      planId: string;
      connectMode: string;
      counts: { toServer: number; deletes: number };
    }>({ type: 'previewConnect', copyFrom: src.id });
    expect(p.connectMode).toBe('start');
    expect(p.counts.toServer).toBe(3);
    expect(p.counts.deletes).toBe(0);
    await A.send({ type: 'applyMerge', planId: p.planId });
    const a1 = await shatsu(A);
    expect(a1.first.title).toBe('shatsu-ren'); // 북마크바 맨 앞
    expect(shape(await subtree(A, src.id))).toEqual(before); // 원본 그대로
    await waitFor(async () => {
      const s = await A.send<{ status: string; counts: { outbox: number } }>({ type: 'getState' });
      return s.status === 'idle' && s.counts.outbox === 0;
    }, 30000);

    await B.send({ type: 'loginDev', email, password });
    const q = await B.send<{ planId: string; connectMode: string; counts: { toLocal: number } }>({
      type: 'previewConnect',
      copyFrom: null,
    });
    expect(q.connectMode).toBe('receive');
    expect(q.counts.toLocal).toBe(3);
    await B.send({ type: 'applyMerge', planId: q.planId });
    const same = async () =>
      JSON.stringify(shape(await subtree(A, (await shatsu(A)).first.id))) ===
      JSON.stringify(shape(await subtree(B, (await shatsu(B)).first.id)));
    await waitFor(same, 30000);
    expect((await shatsu(B)).first.title).toBe('shatsu-ren');
    expect((await shatsu(B)).all.length).toBe(1);

    await B.bookmarks('create', {
      parentId: (await shatsu(B)).first.id,
      title: 'From Aside',
      url: 'https://example.com/aside',
    });
    await waitFor(
      async () =>
        (await A.bookmarks<BmNode[]>('search', { url: 'https://example.com/aside' })).length === 1,
      30000,
    );
    await A.bookmarks('create', {
      parentId: (await shatsu(A)).first.id,
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
  }, 240000);

  it('screens: connect step (first and second browser)', async () => {
    const C = await launch('chromium');
    await C.send({ type: 'loginDev', email, password });
    await C.send({ type: 'syncNow' });
    const pg = await C.context.newPage();
    await pg.setViewportSize({ width: 820, height: 700 });
    await pg.goto(`chrome-extension://${C.extensionId}/app.html#/onboarding`);
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `${SHOTS_DIR}/connect-join.png`, fullPage: true });
    await C.close();
    const D = await launch('chromium');
    await D.send({
      type: 'loginDev',
      email: `synthetic-connect-new-${Date.now()}@example.com`,
      password,
    });
    const pd = await D.context.newPage();
    await pd.setViewportSize({ width: 820, height: 900 });
    await pd.goto(`chrome-extension://${D.extensionId}/app.html#/onboarding`);
    await pd.waitForTimeout(2500);
    await pd.screenshot({ path: `${SHOTS_DIR}/connect-start.png`, fullPage: true });
    await D.close();
  }, 120000);
});
