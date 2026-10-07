import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { subtreeDigestOf, type Receipt } from 'shatsu-ren-protocol';
import {
  apply,
  createNode,
  localStack,
  newCollection,
  register,
  rpc,
  snapshot,
  syntheticUser,
  uuid,
} from '../lib/supabase';

const users: string[] = [];
const sql = (statement: string) =>
  execFileSync(
    '/opt/homebrew/opt/libpq/bin/psql',
    [localStack().dbUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8' },
  ).trim();

afterEach(() => {
  for (const id of users.splice(0)) {
    sql(
      `delete from auth.users where id = '${id}' and email like 'synthetic-server-safety-%@example.com';`,
    );
  }
});

async function fixture() {
  const user = await syntheticUser('server-safety');
  users.push(user.userId);
  const device = await register(user.client);
  const collection = await newCollection(user.client, device.generationId);
  const folder = await createNode(
    user.client,
    device.generationId,
    collection.collectionId,
    collection.rootNodeId,
    { kind: 'folder' },
  );
  const bookmark = await createNode(
    user.client,
    device.generationId,
    collection.collectionId,
    folder.nodeId,
    { title: 'preserve me' },
  );
  const before = await snapshot(user.client);
  const digest = await subtreeDigestOf(
    folder.nodeId,
    before.nodes.map((n) => ({
      ...n,
      kind: n.parentId === null ? 'root' : n.url === null ? 'folder' : 'bookmark',
    })),
    before.orders,
  );
  const operations: Record<string, Record<string, unknown>> = {
    patch: { kind: 'patch', nodeId: bookmark.nodeId, baseRevision: 1, patch: { title: 'changed' } },
    move: {
      kind: 'move',
      nodeId: bookmark.nodeId,
      baseRevision: 1,
      parentId: collection.rootNodeId,
      afterId: null,
    },
    reorder: {
      kind: 'reorder',
      parentId: folder.nodeId,
      baseOrderRevision: 1,
      orderedChildIds: [bookmark.nodeId],
    },
    deleteSubtree: {
      kind: 'deleteSubtree',
      nodeId: folder.nodeId,
      baseRevision: 1,
      expectedSubtreeDigest: digest,
    },
    patchCollection: { kind: 'patchCollection', baseRevision: 0, title: 'changed' },
    create: {
      kind: 'create',
      nodeId: uuid(),
      parentId: folder.nodeId,
      nodeKind: 'bookmark',
      title: 'new',
      url: 'https://example.com/new',
      afterId: null,
    },
    createCollection: { kind: 'createCollection', rootNodeId: uuid(), title: 'new' },
    restore: { kind: 'restore', deletionId: uuid(), parentId: null },
  };
  const send = (op: Record<string, unknown>) =>
    rpc<{ receipt: Receipt }>(user.client, 'sync_apply_operation', {
      p_env: {
        protocolVersion: 1,
        generationId: device.generationId,
        op: { opId: uuid(), collectionId: collection.collectionId, ...op },
      },
    });
  return { ...user, ...device, ...collection, folder, bookmark, before, operations, send };
}

describe('server trust boundary', () => {
  const preconditions = [
    ['patch', 'baseRevision'],
    ['move', 'baseRevision'],
    ['reorder', 'baseOrderRevision'],
    ['deleteSubtree', 'baseRevision'],
    ['deleteSubtree', 'expectedSubtreeDigest'],
    ['patchCollection', 'baseRevision'],
  ];
  for (const [kind = '', field = ''] of preconditions) {
    it.each(['missing', 'null', 'string', 'negative', 'fraction', 'overflow'])(
      'rejects ' + kind + ' ' + field + ' when %s without changing bookmarks',
      async (invalid) => {
        // Given: a real collection and subtree, with a malformed required precondition.
        const f = await fixture();
        const op = { ...f.operations[kind] };
        if (invalid === 'missing') delete op[field];
        else
          op[field] = {
            null: null,
            string: '1',
            negative: -1,
            fraction: 1.5,
            overflow: 2147483648,
          }[invalid];
        // When: the raw RPC bypasses client-side schemas.
        const result = await f.send(op);
        // Then: neither nodes, orders, collections nor the commit cursor change.
        expect(result).toMatchObject({
          ok: true,
          data: { receipt: { status: 'rejected', code: 'INVALID_OPERATION' } },
        });
        expect(await snapshot(f.client)).toEqual(f.before);
        expect(await rpc(f.client, 'sync_trash')).toEqual({ ok: true, data: [] });
      },
    );
  }

  it.each([
    ['patch', 'collectionId', null],
    ['patch', 'nodeId', 7],
    ['patch', 'patch', null],
    ['patch', 'patch', []],
    ['patch', 'patch', { title: 7 }],
    ['patch', 'patch', { url: null }],
    ['create', 'title', null],
    ['create', 'nodeKind', null],
    ['create', 'url', 123],
    ['create', 'afterId', false],
    ['reorder', 'orderedChildIds', null],
    ['reorder', 'orderedChildIds', [null]],
    ['createCollection', 'rootNodeId', null],
    ['createCollection', 'title', {}],
    ['patchCollection', 'title', null],
    ['restore', 'parentId', false],
    ['restore', 'deletionId', null],
    ['patch', 'opId', null],
  ])('rejects malformed %s.%s', async (kind, field, value) => {
    // Given
    const f = await fixture();
    if (typeof kind !== 'string' || typeof field !== 'string') throw new TypeError('invalid case');
    // When
    const result = await f.send({ ...f.operations[kind], [field]: value });
    // Then
    expect(result).toMatchObject({
      ok: true,
      data: { receipt: { status: 'rejected', code: 'INVALID_OPERATION' } },
    });
    expect(await snapshot(f.client)).toEqual(f.before);
  });

  it.each(
    [null, [], 1, {}, { protocolVersion: '1' }, { protocolVersion: 1, op: null }].map((value) => ({
      value,
    })),
  )('rejects malformed envelope %j', async ({ value }) => {
    // Given
    const f = await fixture();
    // When
    const result = await rpc(f.client, 'sync_apply_operation', { p_env: value });
    // Then
    expect(result).toMatchObject({
      ok: true,
      data: { receipt: { status: 'rejected', code: 'INVALID_OPERATION' } },
    });
    expect(await snapshot(f.client)).toEqual(f.before);
  });

  it('rejects a null batch', async () => {
    // Given
    const f = await fixture();
    // When
    const result = await rpc(f.client, 'sync_apply_operations', { p_envs: null });
    // Then
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_OPERATION' } });
    expect(await snapshot(f.client)).toEqual(f.before);
  });

  it('stops a batch at a malformed deletion and preserves its subtree', async () => {
    // Given
    const f = await fixture();
    const invalid = { ...f.operations.deleteSubtree };
    delete invalid.expectedSubtreeDigest;
    // When
    const result = await rpc(f.client, 'sync_apply_operations', {
      p_envs: [invalid, f.operations.patch].map((op) => ({
        protocolVersion: 1,
        generationId: f.generationId,
        op: { ...op, opId: uuid(), collectionId: f.collectionId },
      })),
    });
    // Then
    expect(result).toMatchObject({
      ok: true,
      data: {
        receipts: [{ status: 'rejected', code: 'INVALID_OPERATION' }, { status: 'not_attempted' }],
      },
    });
    expect(await snapshot(f.client)).toEqual(f.before);
  });
});

describe('depth and Realtime session safety', () => {
  async function deepFixture() {
    const f = await fixture();
    let parentId: string = f.rootNodeId;
    for (let depth = 2; depth <= 32; depth++) {
      const node = await createNode(f.client, f.generationId, f.collectionId, parentId, {
        kind: 'folder',
      });
      expect(node.receipt.status).toBe('applied');
      parentId = node.nodeId;
    }
    return { ...f, deepest: parentId };
  }

  it('rejects moving a bookmark beyond maxDepth', async () => {
    // Given
    const f = await deepFixture();
    const before = await snapshot(f.client);
    // When
    const result = await f.send({ ...f.operations.move, parentId: f.deepest });
    // Then
    expect(result).toMatchObject({
      ok: true,
      data: { receipt: { status: 'rejected', code: 'LIMIT_EXCEEDED', limit: 'maxDepth' } },
    });
    expect(await snapshot(f.client)).toEqual(before);
  });

  it.each(['bookmark', 'folder'])(
    'rejects restoring a %s subtree beyond maxDepth',
    async (kind) => {
      // Given
      const f = await deepFixture();
      const nodeId = kind === 'bookmark' ? f.bookmark.nodeId : f.folder.nodeId;
      const beforeDelete = await snapshot(f.client);
      const deleted = await apply(f.client, f.generationId, {
        kind: 'deleteSubtree',
        opId: uuid(),
        collectionId: f.collectionId,
        nodeId,
        baseRevision: 1,
        expectedSubtreeDigest: await subtreeDigestOf(
          nodeId,
          beforeDelete.nodes.map((n) => ({
            ...n,
            kind: n.parentId === null ? 'root' : n.url === null ? 'folder' : 'bookmark',
          })),
          beforeDelete.orders,
        ),
      });
      expect(deleted.status).toBe('applied');
      const before = await snapshot(f.client);
      const trash = await rpc(f.client, 'sync_trash');
      // When
      const result = await f.send({
        kind: 'restore',
        deletionId: deleted.deletionId,
        parentId: f.deepest,
      });
      // Then
      expect(result).toMatchObject({
        ok: true,
        data: { receipt: { status: 'rejected', code: 'LIMIT_EXCEEDED', limit: 'maxDepth' } },
      });
      expect(await snapshot(f.client)).toEqual(before);
      expect(await rpc(f.client, 'sync_trash')).toEqual(trash);
    },
  );

  it.each(['deleted', 'expired'])(
    'denies Realtime authorization when the auth session is %s',
    async (state) => {
      // Given: the same JWT still authorizes the active device before session invalidation.
      const f = await fixture();
      const args = { p_topic: `workspace:${f.workspaceId}` };
      expect((await f.client.rpc('shatsu_can_subscribe', args)).data).toBe(true);
      // When: only this synthetic account's session is invalidated server-side.
      sql(
        state === 'deleted'
          ? `delete from auth.sessions where user_id = '${f.userId}';`
          : `update auth.sessions set not_after = now() - interval '1 second' where user_id = '${f.userId}';`,
      );
      const result = await f.client.rpc('shatsu_can_subscribe', args);
      // Then
      expect(result.error).toBeNull();
      expect(result.data).toBe(false);
    },
  );
});

it('preserves unrelated public function grants during initial migration revocation', () => {
  // Given
  const initial = readFileSync(
    new URL('../../supabase/migrations/20260929000000_shatsu_core.sql', import.meta.url),
    'utf8',
  );
  const revoke = initial.match(
    /revoke all on (?:all functions in schema public|function\s+public\.)[\s\S]*?;/,
  )?.[0];
  if (!revoke) throw new TypeError('public revocation statement not found');
  const name = `server_safety_${uuid().replaceAll('-', '')}`;
  // When
  const result = sql(`begin;
    create function public.${name}() returns int language sql as 'select 1';
    grant execute on function public.${name}() to anon, authenticated;
    ${revoke}
    select has_function_privilege('anon', 'public.${name}()', 'execute')
      and has_function_privilege('authenticated', 'public.${name}()', 'execute');
    rollback;`);
  // Then
  expect(result.split('\n')).toContain('t');
});
