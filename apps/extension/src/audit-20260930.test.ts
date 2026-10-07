import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NodeRecord, FolderOrder, Receipt } from 'shatsu-ren-protocol';
import type { Ctx } from './sync/context';
import type { LocalTree, LocalNode } from './sync/browser';
import type { Binding, ObservedNode, OutboxEntry } from './sync/types';

const mocked = vi.hoisted(() => ({
  ctx: null as Ctx | null,
  settings: {
    autoSync: true,
    realtime: false,
    pollMinutes: 5,
    locale: 'ko',
    theme: 'light',
    deviceLabel: '',
  },
  tree: null as LocalTree | null,
  nextId: 100,
  api: {
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    removeTree: vi.fn(),
    get: vi.fn(),
    getChildren: vi.fn(),
  },
  rpc: {
    changes: vi.fn(),
    snapshot: vi.fn(),
    applyOne: vi.fn(),
    applyMany: vi.fn(),
    devices: vi.fn(),
    registerDevice: vi.fn(),
    revokeDevice: vi.fn(),
  },
}));
vi.mock('./sync/context', () => ({
  prepareContext: vi.fn(async () => ({ ok: true, ctx: mocked.ctx })),
  getSettings: vi.fn(async () => mocked.settings),
  setSettings: vi.fn(),
  getAccount: vi.fn(async () => mocked.ctx?.account),
  setAccount: vi.fn(),
  browserName: vi.fn(() => 'Audit'),
}));
vi.mock('./sync/browser', () => ({
  api: mocked.api,
  getSubTree: vi.fn(async () => mocked.tree),
  getFolderTree: vi.fn(),
  isUnder: vi.fn(async () => false),
}));
vi.mock('./sync/rpc', async (original) => ({
  ...(await original<typeof import('./sync/rpc')>()),
  rpc: mocked.rpc,
}));
vi.mock('./config', () => ({
  DEV_AUTH: true,
  VERSION: 'audit',
  getBackend: vi.fn(async () => mocked.ctx?.backend),
  setCustomBackend: vi.fn(),
  hostPattern: (s: string) => s + '/*',
}));
vi.mock('./auth/session', () => ({
  currentSession: vi.fn(async () => ({
    user: { id: mocked.ctx?.account.userId, email: 'synthetic-audit@example.com' },
  })),
  getClient: vi.fn(),
  dropClient: vi.fn(),
  loginDev: vi.fn(),
  loginWithGoogle: vi.fn(),
}));

import { Engine } from './sync/engine';
import {
  reconcile,
  deletionFingerprint,
  type ReconcileInput,
  type LocalAction,
} from './sync/reconcile';
import { Service } from './service';
import { openScopedDb, setMeta, type Db } from './storage/db';
import { DomainError } from './sync/rpc';
import { localFingerprint } from './sync/plan';
import { RealtimeLink } from './sync/realtime';

let ctx: Ctx;
let binding: Binding;
let rootGlobal: string;
let rootLocal: string;
let engine: Engine;

const localNode = (
  id: string,
  parentId: string | null,
  kind: 'folder' | 'bookmark',
  title = id,
): LocalNode => ({
  id,
  parentId,
  index: 0,
  kind,
  title,
  url: kind === 'bookmark' ? `https://example.com/${id}` : null,
  unmodifiable: false,
});
const shadowNode = (
  id: string,
  parentId: string | null,
  kind: NodeRecord['kind'],
  title = id,
): NodeRecord => ({
  id,
  collectionId: binding.collectionId,
  parentId,
  kind,
  title,
  url: kind === 'bookmark' ? `https://example.com/${title}` : null,
  revision: 1,
  deletedAt: null,
  deletionId: null,
});
const observedNode = (
  id: string,
  globalId: string,
  parentLocalId: string | null,
  kind: ObservedNode['kind'],
  title = id,
): ObservedNode => ({
  localId: id,
  globalId,
  collectionId: binding.collectionId,
  parentLocalId,
  kind,
  title,
  url: kind === 'bookmark' ? `https://example.com/${title}` : null,
  revision: 1,
  ...(kind === 'bookmark' ? {} : { childOrder: [], orderRevision: 0 }),
});
function input(
  observed = new Map<string, ObservedNode>(),
  shadowNodes = new Map<string, NodeRecord>(),
): ReconcileInput {
  return {
    binding,
    rootGlobalId: rootGlobal,
    local: mocked.tree!,
    observed,
    shadowNodes,
    shadowOrders: new Map(),
    pendingOps: new Map(),
    openConflicts: new Set(),
    existsElsewhere: new Set(),
    approvedOutboundDeletes: new Set(),
    approvedInboundDeletes: new Set(),
    openReviewKinds: new Set(),
    newId: randomUUID,
  };
}
function pendingEntry(
  globalId: string,
  localId: string,
  status: OutboxEntry['status'] = 'pending',
): OutboxEntry {
  const opId = randomUUID();
  return {
    opId,
    collectionId: binding.collectionId,
    targetId: globalId,
    status,
    createdAt: Date.now(),
    attempts: 1,
    context: { localId },
    env: {
      protocolVersion: 1,
      generationId: ctx.account.generationId,
      op: {
        kind: 'create',
        opId,
        collectionId: binding.collectionId,
        nodeId: globalId,
        nodeKind: 'bookmark',
        parentId: rootGlobal,
        title: localId,
        url: `https://example.com/${localId}`,
        afterId: null,
      },
    },
  };
}
async function applyLocal(actions: LocalAction[], observed = new Map<string, ObservedNode>()) {
  return (
    engine as unknown as {
      applyLocal: (
        ctx: Ctx,
        b: Binding,
        root: string,
        tree: LocalTree,
        actions: LocalAction[],
        ob: Map<string, ObservedNode>,
      ) => Promise<number>;
    }
  ).applyLocal(ctx, binding, rootGlobal, mocked.tree!, actions, observed);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocked.settings.autoSync = true;
  rootGlobal = randomUUID();
  rootLocal = 'root';
  binding = {
    collectionId: randomUUID(),
    localRootId: rootLocal,
    status: 'active',
    createdAt: Date.now(),
  };
  const userId = randomUUID(),
    workspaceId = randomUUID();
  const db = await openScopedDb({ backendUrl: 'https://audit.invalid', userId, workspaceId });
  ctx = {
    db,
    backend: { url: 'https://audit.invalid', anonKey: 'synthetic', source: 'custom' },
    client: {} as SupabaseClient,
    accessToken: 'synthetic',
    account: {
      backendUrl: 'https://audit.invalid',
      userId,
      workspaceId,
      email: 'synthetic-audit@example.com',
      sessionId: randomUUID(),
      deviceId: randomUUID(),
      generationId: randomUUID(),
      protocolVersion: 1,
      registeredAt: Date.now(),
    },
  };
  mocked.ctx = ctx;
  mocked.tree = {
    rootId: rootLocal,
    nodes: new Map([[rootLocal, localNode(rootLocal, null, 'folder')]]),
    children: new Map([[rootLocal, []]]),
  };
  mocked.api.get.mockImplementation(async (id: string) => {
    const n = mocked.tree?.nodes.get(id);
    return n
      ? { id, title: n.title, parentId: n.parentId ?? undefined, ...(n.url ? { url: n.url } : {}) }
      : null;
  });
  mocked.api.getChildren.mockImplementation(async (id: string) =>
    (mocked.tree?.children.get(id) ?? []).map((lid) => {
      const n = mocked.tree!.nodes.get(lid)!;
      return { id: lid, parentId: id, title: n.title, ...(n.url ? { url: n.url } : {}) };
    }),
  );
  mocked.api.create.mockImplementation(
    async (p: { parentId: string; title: string; url?: string }) => {
      const id = String(mocked.nextId++);
      mocked.tree!.nodes.set(id, {
        ...localNode(id, p.parentId, p.url ? 'bookmark' : 'folder', p.title),
        url: p.url ?? null,
      });
      mocked.tree!.children.set(p.parentId, [...(mocked.tree!.children.get(p.parentId) ?? []), id]);
      return { id, parentId: p.parentId, title: p.title, url: p.url, index: 0 };
    },
  );
  mocked.api.update.mockImplementation(async (id: string, p: { title?: string; url?: string }) => {
    const n = mocked.tree!.nodes.get(id)!;
    Object.assign(n, p);
    return { id, title: n.title, url: n.url ?? undefined };
  });
  mocked.rpc.changes.mockImplementation(async () => ({
    generationId: ctx.account.generationId,
    headSeq: 0,
    commits: [],
    nextCursor: 0,
    hasMore: false,
  }));
  mocked.rpc.applyOne.mockImplementation(
    async (_client: SupabaseClient, env: OutboxEntry['env']) => ({
      generationId: ctx.account.generationId,
      headSeq: 1,
      receipt: { opId: env.op.opId, status: 'applied', revision: 1 },
    }),
  );
  mocked.rpc.devices.mockResolvedValue([]);
  await db.put('bindings', binding);
  await db.put('collections', {
    id: binding.collectionId,
    title: 'Synthetic',
    rootNodeId: rootGlobal,
    revision: 0,
  });
  await db.put('shadow_nodes', shadowNode(rootGlobal, null, 'root'));
  await db.put('observed', observedNode(rootLocal, rootGlobal, null, 'root'));
  await setMeta(db, 'receivedSeq', 0);
  vi.stubGlobal('chrome', {
    alarms: { create: vi.fn(), get: vi.fn() },
    bookmarks: {
      getSubTree: vi.fn(async () => [{ id: rootLocal, title: 'Synthetic', children: [] }]),
      getTree: vi.fn(async () => [{ id: '0', title: '', children: [] }]),
    },
    storage: { local: { set: vi.fn(), get: vi.fn(async () => ({})) } },
  });
  engine = new Engine();
});

describe('audit: sharing safety regressions', () => {
  it('AUD-21 concurrent realtime checks reuse one channel and logout runs after connection', async () => {
    const channel = { state: 'joined', on: vi.fn(), subscribe: vi.fn() };
    const client = {
      realtime: {
        setAuth: vi.fn(async () => undefined),
        isConnected: () => true,
        disconnect: vi.fn(),
      },
      channel: vi.fn(() => channel),
      removeAllChannels: vi.fn(async () => []),
    };
    const link = new RealtimeLink(
      () => undefined,
      () => undefined,
    );
    const c = client as unknown as SupabaseClient;
    await Promise.all([
      link.connect(c, 'workspace', 'token'),
      link.connect(c, 'workspace', 'token'),
    ]);
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    await Promise.all([link.connect(c, 'workspace', 'token'), link.disconnect()]);
    expect(link.status).toBe('off');
    expect(link.health().channel).toBeNull();
    expect(client.realtime.disconnect).toHaveBeenCalledTimes(1);
  });

  it('AUD-20 reorder receipts retain the submitted order when native order changes in flight', async () => {
    const ga = randomUUID(),
      gb = randomUUID();
    await ctx.db.put('observed', observedNode('a', ga, rootLocal, 'bookmark'));
    await ctx.db.put('observed', observedNode('b', gb, rootLocal, 'bookmark'));
    const entry: OutboxEntry = {
      ...pendingEntry(rootGlobal, rootLocal),
      env: {
        protocolVersion: 1,
        generationId: ctx.account.generationId,
        op: {
          kind: 'reorder',
          opId: randomUUID(),
          collectionId: binding.collectionId,
          parentId: rootGlobal,
          baseOrderRevision: 1,
          orderedChildIds: [gb, ga],
        },
      },
    };
    mocked.api.getChildren.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await (
      engine as unknown as {
        applyReceipt: (db: Db, entry: OutboxEntry, receipt: Receipt) => Promise<void>;
      }
    ).applyReceipt(ctx.db, entry, { opId: entry.env.op.opId, status: 'applied', orderRevision: 2 });
    expect((await ctx.db.get('observed', rootLocal))?.childOrder).toEqual(['b', 'a']);
    expect(mocked.api.getChildren).not.toHaveBeenCalled();
  });

  it.each(['edit', 'account'])(
    'AUD-19 %s during the pre-deletion backup requires another review',
    async (change) => {
      const gid = randomUUID();
      mocked.tree!.nodes.set('item', localNode('item', rootLocal, 'bookmark'));
      mocked.tree!.children.set(rootLocal, ['item']);
      const remote = {
        ...shadowNode(gid, rootGlobal, 'bookmark', 'item'),
        deletedAt: new Date().toISOString(),
      };
      await ctx.db.put('shadow_nodes', remote);
      await ctx.db.put('observed', observedNode('item', gid, rootLocal, 'bookmark'));
      const fingerprint = deletionFingerprint(
        [{ globalId: gid, localId: 'item', title: 'item', kind: 'bookmark' }],
        mocked.tree!,
        new Map([[gid, remote]]),
        new Map(),
      );
      const id = randomUUID();
      await ctx.db.put('conflicts', {
        id,
        collectionId: binding.collectionId,
        globalId: gid,
        localId: 'item',
        kind: 'local_edit_remote_delete',
        nodeKind: 'bookmark',
        base: {
          title: 'item',
          url: 'https://example.com/item',
          parentGlobalId: rootGlobal,
          revision: 1,
        },
        local: { title: 'item', url: 'https://example.com/item', parentGlobalId: rootGlobal },
        remote: {
          title: remote.title,
          url: remote.url,
          parentGlobalId: rootGlobal,
          revision: 1,
          deleted: true,
        },
        fingerprint,
        status: 'open',
        createdAt: Date.now(),
      });
      const service = new Service();
      vi.spyOn(service.engine, 'backup').mockImplementationOnce(async () => {
        if (change === 'edit') mocked.tree!.nodes.get('item')!.title = 'edited while backing up';
        else service.engine.bumpEpoch();
        return randomUUID();
      });
      await expect(
        service.handle({ type: 'resolveConflict', id, resolution: 'theirs', fingerprint }),
      ).rejects.toMatchObject({ code: 'RECHECK' });
      expect(mocked.api.remove).not.toHaveBeenCalled();
      expect(mocked.api.removeTree).not.toHaveBeenCalled();
      expect((await ctx.db.get('conflicts', id))?.status).toBe('open');
    },
  );

  it('AUD-17 keeps merge plans across worker restart and backs up before server writes', async () => {
    const planId = randomUUID();
    await setMeta(ctx.db, `mergePlan:${planId}`, {
      planId,
      collectionId: randomUUID(),
      rootGlobalId: randomUUID(),
      localRootId: rootLocal,
      headSeq: 0,
      localFingerprint: await localFingerprint(mocked.tree!),
      createCollection: { title: 'Synthetic' },
    });
    const service = new Service();
    vi.spyOn(service.engine, 'backup').mockRejectedValueOnce(
      new DOMException('full', 'QuotaExceededError'),
    );
    await expect(service.handle({ type: 'applyMerge', planId })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(mocked.rpc.applyOne).not.toHaveBeenCalled();
    expect(mocked.api.create).not.toHaveBeenCalled();
    expect(await ctx.db.get('meta', `mergePlan:${planId}`)).toBeDefined();
  });

  it('AUD-18 persisted imports never duplicate a completed or uncertain native create', async () => {
    const service = new Service();
    const preview = (await service.handle({
      type: 'importPreview',
      json: JSON.stringify({
        format: 'shatsu-ren-backup',
        version: 1,
        tree: {
          title: '',
          children: [
            { title: 'first', url: 'https://example.com/first' },
            { title: 'second', url: 'https://example.com/second' },
          ],
        },
      }),
    })) as { importId: string };
    const create = mocked.api.create.getMockImplementation()!;
    mocked.api.create
      .mockImplementationOnce(create)
      .mockRejectedValueOnce(new Error('interrupted'));
    await expect(
      service.handle({ type: 'importApply', importId: preview.importId, parentLocalId: rootLocal }),
    ).rejects.toThrow('interrupted');
    expect(mocked.api.create).toHaveBeenCalledTimes(2);
    await expect(
      new Service().handle({
        type: 'importApply',
        importId: preview.importId,
        parentLocalId: rootLocal,
      }),
    ).rejects.toMatchObject({ code: 'RECHECK' });
    expect(mocked.api.create).toHaveBeenCalledTimes(2);
    expect([...mocked.tree!.nodes.values()].filter((node) => node.title === 'first')).toHaveLength(
      1,
    );
  });

  it('AUD-01 replays interrupted outbox entries with their original operation ID', async () => {
    const gid = randomUUID();
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['a']);
    await ctx.db.put('observed', { ...observedNode('a', gid, rootLocal, 'bookmark'), revision: 0 });
    const entry = pendingEntry(gid, 'a', 'in_flight');
    await ctx.db.put('outbox', entry);
    await engine.requestSync('manual', { force: true });
    expect(mocked.rpc.applyOne).toHaveBeenCalled();
    expect(engine.lastResult?.message).toBeUndefined();
    expect((await ctx.db.get('outbox', entry.opId))?.status).toBe('done');
  });
  it('AUD-02 repairs completed create mapping without duplicating the bookmark', async () => {
    const gid = randomUUID();
    mocked.tree!.nodes.set('orphan', {
      ...localNode('orphan', rootLocal, 'bookmark', 'item'),
      url: 'https://example.com/item',
    });
    mocked.tree!.children.set(rootLocal, ['orphan']);
    await ctx.db.put('shadow_nodes', shadowNode(gid, rootGlobal, 'bookmark', 'item'));
    await ctx.db.put('journal', {
      id: randomUUID(),
      action: 'create',
      status: 'done',
      startedAt: Date.now(),
      collectionId: binding.collectionId,
      globalId: gid,
      parentLocalId: rootLocal,
      resultLocalId: 'orphan',
      expected: { title: 'item', url: 'https://example.com/item', kind: 'bookmark' },
    });
    await engine.requestSync('manual', { force: true });
    expect(mocked.api.create).not.toHaveBeenCalled();
    expect(mocked.tree!.children.get(rootLocal)).toHaveLength(1);
  });
  it('AUD-03 disconnect keeps pending operations without submitting them', async () => {
    const entry = pendingEntry(randomUUID(), 'a');
    await ctx.db.put('outbox', entry);
    const svc = new Service();
    await svc.handle({
      type: 'disconnectBinding',
      collectionId: binding.collectionId,
      pendingChoice: 'keep',
    });
    await svc.engine.requestSync('manual', { force: true });
    expect(mocked.rpc.applyOne).not.toHaveBeenCalled();
  });
  it('AUD-05 account invalidation stops the next native action', async () => {
    mocked.api.create.mockImplementationOnce(
      async (p: { title: string; parentId: string; url?: string }) => {
        engine.bumpEpoch();
        return { id: 'first', ...p };
      },
    );
    const make = (): LocalAction => ({
      type: 'create',
      globalId: randomUUID(),
      parentGlobalId: rootGlobal,
      kind: 'bookmark',
      title: 'item',
      url: 'https://example.com/item',
      revision: 1,
      depth: 0,
    });
    await applyLocal([make(), make()]);
    expect(mocked.api.create).toHaveBeenCalledTimes(1);
  });
  it('AUD-06 same-item conflict reappears after earlier conflict was resolved', async () => {
    const gid = randomUUID();
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark', 'local'));
    mocked.tree!.children.set(rootLocal, ['a']);
    await ctx.db.put('observed', observedNode('a', gid, rootLocal, 'bookmark', 'base'));
    await ctx.db.put('shadow_nodes', {
      ...shadowNode(gid, rootGlobal, 'bookmark', 'remote'),
      revision: 2,
    });
    await ctx.db.put('conflicts', {
      id: `${binding.collectionId}:${gid}`,
      collectionId: binding.collectionId,
      globalId: gid,
      localId: 'a',
      kind: 'edit_edit',
      nodeKind: 'bookmark',
      base: {
        title: 'base',
        url: 'https://example.com/base',
        parentGlobalId: rootGlobal,
        revision: 1,
      },
      local: { title: 'local', url: 'https://example.com/local', parentGlobalId: rootGlobal },
      remote: {
        title: 'remote',
        url: 'https://example.com/remote',
        parentGlobalId: rootGlobal,
        revision: 2,
        deleted: false,
      },
      status: 'resolved',
      createdAt: Date.now(),
    });
    await engine.requestSync('manual', { force: true });
    expect(await ctx.db.getAllFromIndex('conflicts', 'byStatus', 'open')).toHaveLength(1);
  });
  it('AUD-07 recovers orphaned revision-zero mapping with its stable global ID', async () => {
    const gid = randomUUID();
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['a']);
    await ctx.db.put('observed', { ...observedNode('a', gid, rootLocal, 'bookmark'), revision: 0 });
    await engine.requestSync('manual', { force: true });
    expect(mocked.rpc.applyOne).toHaveBeenCalled();
  });
  it('AUD-08 records local intent while automatic transfer is paused', async () => {
    mocked.settings.autoSync = false;
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['a']);
    await engine.requestSync('event');
    expect(await ctx.db.getAll('outbox')).toHaveLength(1);
    expect(engine.lastResult?.outcome).toBe('skipped');
  });
  it('AUD-09 negative control: failed local update remains pending', async () => {
    const gid = randomUUID();
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['a']);
    await ctx.db.put('observed', observedNode('a', gid, rootLocal, 'bookmark'));
    await ctx.db.put('shadow_nodes', {
      ...shadowNode(gid, rootGlobal, 'bookmark', 'a'),
      title: 'remote',
      revision: 2,
    });
    mocked.api.update.mockRejectedValue(new Error('synthetic update failed'));
    await engine.requestSync('manual', { force: true });
    expect((await ctx.db.get('meta', 'pendingApplyCount'))?.value).toBe(1);
    expect(await ctx.db.getAllFromIndex('journal', 'byStatus', 'failed')).not.toHaveLength(0);
  });
  it('AUD-10 server restoration holds old intent for review', async () => {
    const entry = pendingEntry(randomUUID(), 'a');
    await ctx.db.put('outbox', entry);
    mocked.rpc.snapshot.mockResolvedValue({
      generationId: ctx.account.generationId,
      headSeq: 0,
      collections: [],
      nodes: [],
      orders: [],
    });
    const svc = new Service();
    await svc.handle({ type: 'recoverGeneration' });
    expect(mocked.rpc.applyOne).not.toHaveBeenCalled();
  });
  it('AUD-11 readonly nodes are excluded from upload', () => {
    const node = { ...localNode('a', rootLocal, 'bookmark'), unmodifiable: true };
    mocked.tree!.nodes.set('a', node);
    mocked.tree!.children.set(rootLocal, ['a']);
    expect(reconcile(input()).ops.some((o) => o.kind === 'create')).toBe(false);
  });
  it('AUD-12 receiving into a new folder rejects an already bound collection', async () => {
    const svc = new Service();
    await expect(
      svc.handle({
        type: 'previewNewLocalFolder',
        collectionId: binding.collectionId,
        parentLocalId: rootLocal,
        title: 'nested',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_BOUND' });
  });
  it('AUD-13 rate limiting preserves local intent and schedules retry', async () => {
    mocked.tree!.nodes.set('a', localNode('a', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['a']);
    mocked.rpc.changes.mockRejectedValue(
      new DomainError({ code: 'RATE_LIMITED', retryAfterSeconds: 30 }),
    );
    await engine.requestSync('manual', { force: true });
    expect(engine.lastResult?.outcome).toBe('blocked');
    expect((await ctx.db.get('meta', 'nextRetryAt'))?.value).toBeGreaterThan(Date.now());
    expect(await ctx.db.getAllFromIndex('outbox', 'byStatus', 'pending')).toHaveLength(1);
  });
  it('AUD-14 conflict resolution pulls fresh server state before native changes', async () => {
    const svc = new Service();
    const gid = randomUUID();
    mocked.tree!.nodes.set('a', {
      ...localNode('a', rootLocal, 'bookmark', 'local'),
      url: 'https://example.com/local',
    });
    mocked.tree!.children.set(rootLocal, ['a']);
    await ctx.db.put('observed', observedNode('a', gid, rootLocal, 'bookmark', 'base'));
    await ctx.db.put('shadow_nodes', {
      ...shadowNode(gid, rootGlobal, 'bookmark', 'stale remote'),
      revision: 2,
    });
    const id = `${binding.collectionId}:${gid}`;
    await ctx.db.put('conflicts', {
      id,
      collectionId: binding.collectionId,
      globalId: gid,
      localId: 'a',
      kind: 'edit_edit',
      nodeKind: 'bookmark',
      base: {
        title: 'base',
        url: 'https://example.com/base',
        parentGlobalId: rootGlobal,
        revision: 1,
      },
      local: { title: 'local', url: 'https://example.com/local', parentGlobalId: rootGlobal },
      remote: {
        title: 'stale remote',
        url: 'https://example.com/stale remote',
        parentGlobalId: rootGlobal,
        revision: 2,
        deleted: false,
      },
      status: 'open',
      createdAt: Date.now(),
    });
    await svc.handle({ type: 'resolveConflict', id, resolution: 'theirs' });
    expect(mocked.api.update.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocked.rpc.changes.mock.invocationCallOrder[0]!,
    );
  });
});

describe('audit: pure reconcile scaling, synthetic unchanged flat folders', () => {
  it('AUD-15 quota failure blocks success and commits neither mapping nor intent', async () => {
    mocked.tree!.nodes.set('quota-node', localNode('quota-node', rootLocal, 'bookmark'));
    mocked.tree!.children.set(rootLocal, ['quota-node']);
    const original = ctx.db.transaction.bind(ctx.db);
    const spy = vi.spyOn(ctx.db, 'transaction').mockImplementation((...args) => {
      if (args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].includes('observed'))
        throw new DOMException('synthetic quota failure', 'QuotaExceededError');
      return original(...args);
    });
    try {
      const svc = new Service();
      await svc.boot();
      await svc.engine.requestSync('manual', { force: true });
      expect(svc.engine.lastResult?.outcome).toBe('blocked');
      const st = await svc.getState();
      expect(st.lastError?.code).toBe('STORAGE_FAILED');
      expect(st.status).toBe('blocked');
      expect(await ctx.db.get('observed', 'quota-node')).toBeUndefined();
      expect(await ctx.db.getAll('outbox')).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('AUD-16 unchanged 1000-child order needs one native read and no moves', async () => {
    const observed = new Map<string, ObservedNode>();
    const ids: string[] = [],
      globals: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = `order-${i}`,
        gid = randomUUID();
      ids.push(id);
      globals.push(gid);
      mocked.tree!.nodes.set(id, localNode(id, rootLocal, 'bookmark'));
      observed.set(id, observedNode(id, gid, rootLocal, 'bookmark'));
    }
    mocked.tree!.children.set(rootLocal, ids);
    await applyLocal(
      [
        {
          type: 'reorder',
          parentGlobalId: rootGlobal,
          parentLocalId: rootLocal,
          orderedGlobalIds: globals,
          orderRevision: 2,
        },
      ],
      observed,
    );
    expect(mocked.api.getChildren).toHaveBeenCalledTimes(1);
    expect(mocked.api.move).not.toHaveBeenCalled();
  });

  it('records 1k / 10k single-folder reconciliation cost', () => {
    const results = [];
    for (const count of [1000, 10000]) {
      const nodes = new Map<string, LocalNode>([[rootLocal, localNode(rootLocal, null, 'folder')]]);
      const ob = new Map<string, ObservedNode>();
      const sn = new Map<string, NodeRecord>();
      const globalKids = [],
        localKids = [];
      for (let i = 0; i < count; i++) {
        const id = `l${i}`,
          gid = randomUUID();
        localKids.push(id);
        globalKids.push(gid);
        nodes.set(id, localNode(id, rootLocal, 'bookmark'));
        ob.set(id, observedNode(id, gid, rootLocal, 'bookmark'));
        sn.set(gid, shadowNode(gid, rootGlobal, 'bookmark', id));
      }
      ob.set(rootLocal, {
        ...observedNode(rootLocal, rootGlobal, null, 'root'),
        childOrder: localKids,
        orderRevision: 1,
      });
      sn.set(rootGlobal, shadowNode(rootGlobal, null, 'root'));
      mocked.tree = { rootId: rootLocal, nodes, children: new Map([[rootLocal, localKids]]) };
      const inp = input(ob, sn);
      inp.shadowOrders = new Map<string, FolderOrder>([
        [rootGlobal, { parentId: rootGlobal, orderedChildIds: globalKids, revision: 1 }],
      ]);
      const times = [];
      for (let r = 0; r < 5; r++) {
        const t = performance.now();
        const out = reconcile(inp);
        times.push(performance.now() - t);
        expect(out.ops).toHaveLength(0);
      }
      times.sort((a, b) => a - b);
      results.push({ count, medianMs: times[2], maxMs: times.at(-1) });
    }
    console.log('AUDIT_RECONCILE_BENCHMARK', JSON.stringify(results));
  }, 30000);
});
