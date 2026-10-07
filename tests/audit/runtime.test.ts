import { afterAll, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { launch, makeFolder, subtree, waitFor, type ExtBrowser, type BmNode } from '../lib/browser';
import {
  createNode,
  env,
  localStack,
  newCollection,
  register,
  rpc,
  snapshot,
  syntheticUser,
  uuid,
} from '../lib/supabase';

const opened: ExtBrowser[] = [];
const users: string[] = [];
const extDir = resolve(
  new URL('../../apps/extension/.output/chrome-mv3-dev', import.meta.url).pathname,
);
const shots = resolve(new URL('../../docs/validation/audit-20260930', import.meta.url).pathname);
mkdirSync(shots, { recursive: true });
afterAll(async () => {
  for (const b of opened) await b.close().catch(() => undefined);
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log('synthetic account cleanup failed', id, error.message);
  }
});

it('DB-AUD-01 missing optimistic preconditions cannot mutate shared data', async () => {
  const u = await syntheticUser('audit-null');
  users.push(u.userId);
  const r = await register(u.client);
  const c = await newCollection(u.client, r.generationId);
  const f = await createNode(u.client, r.generationId, c.collectionId, c.rootNodeId, {
    kind: 'folder',
  });
  const b = await createNode(u.client, r.generationId, c.collectionId, f.nodeId);
  const patch = await rpc<{ receipt: { status: string } }>(u.client, 'sync_apply_operation', {
    p_env: {
      protocolVersion: 1,
      generationId: r.generationId,
      op: {
        kind: 'patch',
        opId: uuid(),
        collectionId: c.collectionId,
        nodeId: b.nodeId,
        patch: { title: 'without revision' },
      },
    },
  });
  expect(patch.ok && patch.data.receipt.status === 'applied').toBe(false);
  const del = await rpc<{ receipt: { status: string } }>(u.client, 'sync_apply_operation', {
    p_env: {
      protocolVersion: 1,
      generationId: r.generationId,
      op: { kind: 'deleteSubtree', opId: uuid(), collectionId: c.collectionId, nodeId: f.nodeId },
    },
  });
  expect(del.ok && del.data.receipt.status === 'applied').toBe(false);
  expect((await snapshot(u.client)).nodes.find((n) => n.id === b.nodeId)).toBeDefined();
  const trash = await rpc<{ itemCount: number }[]>(u.client, 'sync_trash');
  expect(trash.ok && trash.data.length).toBe(0);
});

type State = {
  status: string;
  account: { email: string };
  counts: { conflicts: number; reviews: number; outbox: number; pendingApply: number };
  collections: { id: string }[];
};
const state = (b: ExtBrowser) => b.send<State>({ type: 'getState' });
const idle = (b: ExtBrowser) =>
  waitFor(
    async () => {
      const s = await state(b);
      return s.status === 'idle' && s.counts.outbox === 0 && s.counts.pendingApply === 0 ? s : null;
    },
    30000,
    100,
    async () => b.send({ type: 'diagnostics' }),
  );

it('BROWSER-AUD-01 same-account sharing continues while deletion is reviewed, with stale approval protection', async () => {
  const u = await syntheticUser('audit-browser');
  users.push(u.userId);
  const a = await launch('chromium', { extDir });
  opened.push(a);
  const b = await launch('aside', { extDir });
  opened.push(b);
  for (const x of [a, b]) {
    await x.send({ type: 'loginDev', email: u.email, password: u.password });
    expect((await state(x)).account.email).toBe(u.email);
  }
  const fa = await makeFolder(a, 'audit-shared');
  const fb = await makeFolder(b, 'audit-shared');
  const folder = await a.bookmarks<BmNode>('create', { parentId: fa.id, title: 'folder' });
  await a.bookmarks('create', {
    parentId: folder.id,
    title: 'child',
    url: 'https://example.com/audit-child',
  });
  const pa = await a.send<{ planId: string; collectionId: string }>({
    type: 'previewMerge',
    localRootId: fa.id,
    newCollectionTitle: 'Audit',
  });
  await a.send({ type: 'applyMerge', planId: pa.planId });
  await idle(a);
  await b.send({ type: 'syncNow' });
  const pb = await b.send<{ planId: string }>({
    type: 'previewMerge',
    localRootId: fb.id,
    collectionId: pa.collectionId,
  });
  await b.send({ type: 'applyMerge', planId: pb.planId });
  await idle(b);
  expect((await subtree(b, fb.id)).children?.[0]?.children?.[0]?.title).toBe('child');
  const t = Date.now();
  await b.bookmarks('create', {
    parentId: fb.id,
    title: 'back to A',
    url: 'https://example.com/audit-reverse',
  });
  await waitFor(
    async () => (await subtree(a, fa.id)).children?.some((n) => n.title === 'back to A'),
    15000,
    50,
  );
  console.log('BROWSER-AUD-01 reverse propagation ms', Date.now() - t, a.version, b.version);
  await idle(a);
  await idle(b);
  for (const x of [a, b]) {
    await x.app.goto(`chrome-extension://${x.extensionId}/app.html#/`);
    await x.app.getByRole('navigation').waitFor();
    await x.app.getByText(u.email, { exact: false }).first().waitFor();
    await x.app.screenshot({ path: resolve(shots, `${x.kind}-overview.png`), fullPage: true });
    await x.send({ type: 'setSettings', patch: { autoSync: false } });
  }
  const remoteChild = (
    await b.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' })
  )[0]!;
  await a.bookmarks('removeTree', folder.id);
  await b.bookmarks('update', remoteChild.id, { title: 'new unseen remote edit' });
  await b.send({ type: 'syncNow' });
  await register(u.client);
  const before = await snapshot(u.client);
  const child = before.nodes.find((n) => n.url === 'https://example.com/audit-child')!;
  expect(child.title).toBe('new unseen remote edit');
  expect(child.deletedAt).toBeNull();
  await a.send({ type: 'syncNow' });
  const after = await snapshot(u.client);
  expect(after.nodes.find((n) => n.id === child.id)?.title).toBe('new unseen remote edit');
  const trash = await a.send<{ itemCount: number; rootTitle: string }[]>({ type: 'listTrash' });
  expect(trash).toHaveLength(0);
  expect((await state(a)).counts.conflicts).toBe(0);
  expect((await state(a)).counts.reviews).toBeGreaterThan(0);
  type Review = { id: string; kind: string; fingerprint: string; items: { title: string }[] };
  const review = (await a.send<Review[]>({ type: 'listReviews' })).find(
    (r) => r.kind === 'mass_delete_out',
  )!;
  expect(review.items.some((item) => item.title === 'new unseen remote edit')).toBe(true);
  for (const x of [a, b]) await x.send({ type: 'setSettings', patch: { autoSync: true } });
  await b.bookmarks('create', {
    parentId: fb.id,
    title: 'shared during review',
    url: 'https://example.com/during-review',
  });
  await waitFor(
    async () => (await subtree(a, fa.id)).children?.some((n) => n.title === 'shared during review'),
    15000,
    50,
    async () => ({
      A: await a.send({ type: 'diagnostics' }),
      B: await b.send({ type: 'diagnostics' }),
    }),
  );
  await b.bookmarks('update', remoteChild.id, { title: 'changed after review' });
  await b.bookmarks('create', {
    parentId: remoteChild.parentId!,
    title: 'new child after review',
    url: 'https://example.com/new-reviewed-child',
  });
  await b.send({ type: 'syncNow' });
  await expect(
    a.send({
      type: 'resolveReview',
      id: review.id,
      resolution: 'approve',
      fingerprint: review.fingerprint,
    }),
  ).rejects.toMatchObject({ code: 'RECHECK' });
  expect((await snapshot(u.client)).nodes.find((n) => n.id === child.id)?.title).toBe(
    'changed after review',
  );
  const refreshed = (await a.send<Review[]>({ type: 'listReviews' })).find(
    (r) => r.id === review.id,
  )!;
  expect(refreshed.items.some((item) => item.title === 'new child after review')).toBe(true);
  await a.send({
    type: 'resolveReview',
    id: refreshed.id,
    resolution: 'restore',
    fingerprint: refreshed.fingerprint,
  });
  await waitFor(
    async () =>
      (await a.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' }))[0]
        ?.title === 'changed after review',
    15000,
    50,
  );
  await idle(a);
  await idle(b);
  const removable = (
    await a.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' })
  )[0]!;
  await a.bookmarks('remove', removable.id);
  await a.send({ type: 'syncNow' });
  const deletion = (await a.send<Review[]>({ type: 'listReviews' })).find(
    (r) => r.kind === 'mass_delete_out',
  )!;
  await a.send({
    type: 'resolveReview',
    id: deletion.id,
    resolution: 'approve',
    fingerprint: deletion.fingerprint,
  });
  await waitFor(async () => (await state(b)).counts.reviews > 0, 15000, 50);
  expect(
    await b.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' }),
  ).toHaveLength(1);
  const incoming = (await b.send<Review[]>({ type: 'listReviews' })).find(
    (r) => r.kind === 'mass_delete_in',
  )!;
  await b.app.goto(`chrome-extension://${b.extensionId}/app.html#/review/${incoming.id}`);
  await b.app.getByRole('button', { name: '여기서도 삭제', exact: true }).click();
  await waitFor(
    async () =>
      (await b.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' })).length ===
      0,
    15000,
    50,
  );
  await b.app.screenshot({ path: resolve(shots, 'aside-deletion-approved.png'), fullPage: true });
  expect((await b.send<unknown[]>({ type: 'listBackups' })).length).toBeGreaterThan(0);
  const approvedTrash = await a.send<
    { deletionId: string; collectionId: string; itemCount: number }[]
  >({ type: 'listTrash' });
  expect(approvedTrash).toHaveLength(1);
  await a.send({
    type: 'restoreTrash',
    deletionId: approvedTrash[0]!.deletionId,
    collectionId: pa.collectionId,
    parentGlobalId: null,
  });
  for (const x of [a, b])
    await waitFor(
      async () =>
        (await x.bookmarks<BmNode[]>('search', { url: 'https://example.com/audit-child' }))
          .length === 1,
      15000,
      50,
    );
  await idle(a);
  await idle(b);
  for (const x of [a, b]) await x.send({ type: 'setSettings', patch: { autoSync: false } });
  const aKids = (await subtree(a, fa.id)).children!;
  const bKids = (await subtree(b, fb.id)).children!;
  await a.bookmarks('move', aKids[0]!.id, { parentId: fa.id });
  await b.bookmarks('move', bKids.at(-1)!.id, { parentId: fb.id, index: 0 });
  expect((await subtree(a, fa.id)).children!.map((node) => node.title)).not.toEqual(
    aKids.map((node) => node.title),
  );
  expect((await subtree(b, fb.id)).children!.map((node) => node.title)).not.toEqual(
    bKids.map((node) => node.title),
  );
  await a.send({ type: 'syncNow' });
  await b.send({ type: 'syncNow' });
  const orderConflict = (
    await b.send<{ id: string; kind: string }[]>({ type: 'listConflicts' })
  ).find((c) => c.kind === 'order_order')!;
  expect(orderConflict).toBeDefined();
  const detail = await b.send<{ fingerprint: string }>({
    type: 'getConflictDetail',
    id: orderConflict.id,
  });
  const chosenOrder = (await subtree(b, fb.id)).children!.map((node) => node.title);
  await b.send({
    type: 'resolveConflict',
    id: orderConflict.id,
    resolution: 'mine',
    fingerprint: detail.fingerprint,
  });
  for (const x of [a, b]) await x.send({ type: 'setSettings', patch: { autoSync: true } });
  await waitFor(
    async () =>
      JSON.stringify((await subtree(a, fa.id)).children!.map((node) => node.title)) ===
      JSON.stringify(chosenOrder),
    15000,
    50,
  );
  console.log(
    'BROWSER-AUD-01 verified: shared additions, concurrent edit preserved, explicit deletion on both browsers, backup and restore',
  );
}, 180000);
