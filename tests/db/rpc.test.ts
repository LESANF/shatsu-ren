import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { subtreeDigestOf } from 'shatsu-ren-protocol';
import {
  anonClient,
  anotherSession,
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

const psql = (sql: string) =>
  execSync(`/opt/homebrew/opt/libpq/bin/psql "${localStack().dbUrl}" -Atc ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
  }).trim();

describe('A: 계정·장치·권한', () => {
  it('A01 같은 계정 두 세션 → 같은 workspace, 다른 device', async () => {
    const u = await syntheticUser('a01');
    const c2 = await anotherSession(u.email, u.password);
    const r1 = await register(u.client, 'chrome');
    const r2 = await register(c2, 'aside');
    expect(r1.workspaceId).toBe(r2.workspaceId);
    expect(r1.deviceId).not.toBe(r2.deviceId);
    const devs = await rpc<{ id: string; isCurrent: boolean }[]>(u.client, 'sync_devices');
    expect(devs.ok && devs.data.length).toBe(2);
    expect(devs.ok && devs.data.filter((d) => d.isCurrent).length).toBe(1);
  });

  it('등록 전 조회/변경은 DEVICE_NOT_REGISTERED', async () => {
    const u = await syntheticUser('noreg');
    const r = await rpc(u.client, 'sync_snapshot');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('DEVICE_NOT_REGISTERED');
  });

  it('A02 다른 계정 ID 를 인자로 위조 → 차단, 정보 누출 없음', async () => {
    const a = await syntheticUser('a02a');
    const b = await syntheticUser('a02b');
    const ra = await register(a.client);
    const rb = await register(b.client);
    const colA = await newCollection(a.client, ra.generationId, 'A');
    const { nodeId } = await createNode(
      a.client,
      ra.generationId,
      colA.collectionId,
      colA.rootNodeId,
      { title: 'secret-title' },
    );
    // B 가 A 의 collection/node 를 참조
    const r1 = await apply(b.client, rb.generationId, {
      kind: 'patch',
      opId: uuid(),
      collectionId: colA.collectionId,
      nodeId,
      baseRevision: 1,
      patch: { title: 'x' },
    });
    expect(r1.status).toBe('rejected');
    expect(r1.code).toBe('NOT_FOUND');
    const r2 = await apply(b.client, rb.generationId, {
      kind: 'create',
      opId: uuid(),
      collectionId: colA.collectionId,
      nodeId: uuid(),
      nodeKind: 'bookmark',
      parentId: colA.rootNodeId,
      title: 't',
      url: 'https://example.com/',
      afterId: null,
    });
    expect(r2.status).toBe('conflict');
    expect(r2.code).toBe('PARENT_NOT_FOUND');
    const snapB = await snapshot(b.client);
    expect(snapB.nodes.find((n) => n.id === nodeId)).toBeUndefined();
    expect(JSON.stringify(snapB)).not.toContain('secret-title');
    // 다른 계정 장치 철회 시도
    const rv = await rpc(b.client, 'sync_revoke_device', { p_device_id: ra.deviceId });
    expect(rv.ok).toBe(false);
    const devs = await rpc<{ revokedAt: string | null }[]>(a.client, 'sync_devices');
    expect(devs.ok && devs.data[0]!.revokedAt).toBeNull();
  });

  it('A03 anon/authenticated 직접 테이블·내부 함수 접근 불가', async () => {
    const u = await syntheticUser('a03');
    const anon = anonClient();
    for (const t of ['nodes', 'workspaces', 'commits', 'devices']) {
      const { error } = await anon.from(t).select('*');
      expect(error?.code).toBe('PGRST205');
      const { error: e2 } = await u.client.from(t).select('*');
      expect(e2?.code).toBe('PGRST205');
    }
    const { error } = await u.client
      .schema('shatsu' as never)
      .from('nodes')
      .select('*');
    expect(error).toBeTruthy();
    const { error: e3 } = await u.client.rpc('account_deletion_begin', {
      p_user_id: u.userId,
      p_request_id: uuid(),
    });
    expect(e3?.code).toBe('42501');
    // DB 레벨: authenticated role 은 shatsu 스키마 자체를 못 본다
    expect(() => psql(`set role authenticated; select count(*) from shatsu.nodes;`)).toThrow(
      /permission denied for schema shatsu/,
    );
    expect(() => psql(`set role authenticated; select shatsu.limits();`)).toThrow(
      /permission denied/,
    );
  });

  it('A04 철회된 장치는 기존 JWT 로 읽기/쓰기/재등록 모두 차단', async () => {
    const u = await syntheticUser('a04');
    const c2 = await anotherSession(u.email, u.password);
    await register(u.client, 'one');
    const r2 = await register(c2, 'two');
    const rv = await rpc(u.client, 'sync_revoke_device', { p_device_id: r2.deviceId });
    expect(rv.ok).toBe(true);
    const s = await rpc(c2, 'sync_snapshot');
    expect(!s.ok && s.error.code).toBe('DEVICE_REVOKED');
    const w = await rpc(c2, 'sync_apply_operation', {
      p_env: {
        protocolVersion: 1,
        generationId: r2.generationId,
        op: {
          kind: 'createCollection',
          opId: uuid(),
          collectionId: uuid(),
          rootNodeId: uuid(),
          title: 'x',
        },
      },
    });
    expect(!w.ok && w.error.code).toBe('DEVICE_REVOKED');
    const re = await rpc(c2, 'sync_register_device', { p_label: 'again', p_browser: 'x' });
    expect(!re.ok && re.error.code).toBe('DEVICE_REVOKED');
    // 새 로그인(새 세션)은 새 장치로 등록 가능
    const c3 = await anotherSession(u.email, u.password);
    const r3 = await register(c3, 'three');
    expect(r3.deviceId).not.toBe(r2.deviceId);
  });

  it('세션이 서버에서 사라지면 JWT 가 유효해도 SESSION_INVALID', async () => {
    const u = await syntheticUser('sess');
    const r = await register(u.client);
    psql(`delete from auth.sessions where user_id = '${u.userId}'`);
    const s = await rpc(u.client, 'sync_info');
    expect(!s.ok && s.error.code).toBe('SESSION_INVALID');
    expect(r.workspaceId).toBeTruthy();
  });
});

describe('C: 명령·멱등성·충돌', () => {
  it('C09/C10 동일 opId 재전송 → 같은 receipt·commit 1개, 다른 body → OP_ID_REUSED', async () => {
    const u = await syntheticUser('c09');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const op = {
      kind: 'create' as const,
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: uuid(),
      nodeKind: 'bookmark' as const,
      parentId: col.rootNodeId,
      title: 'a',
      url: 'https://example.com/a',
      afterId: null,
    };
    const r1 = await apply(u.client, r.generationId, op);
    const r2 = await apply(u.client, r.generationId, op);
    expect(r1).toEqual(r2);
    expect(r1.status).toBe('applied');
    const r3 = await apply(u.client, r.generationId, { ...op, title: 'changed' });
    expect(r3.status).toBe('rejected');
    expect(r3.code).toBe('OP_ID_REUSED');
    const snap = await snapshot(u.client);
    expect(snap.headSeq).toBe(2); // createCollection + create
    expect(snap.nodes.filter((n) => n.id === op.nodeId).length).toBe(1);
  });

  it('A07 재로그인으로 device 가 바뀌어도 이미 승인한 op 는 다시 적용되지 않음', async () => {
    const u = await syntheticUser('a07');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const op = {
      kind: 'create' as const,
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: uuid(),
      nodeKind: 'folder' as const,
      parentId: col.rootNodeId,
      title: 'f',
      url: null,
      afterId: null,
    };
    const r1 = await apply(u.client, r.generationId, op);
    const c2 = await anotherSession(u.email, u.password);
    await register(c2, 'relogin');
    const r2 = await apply(c2, r.generationId, op);
    expect(r2).toEqual(r1);
    expect((await snapshot(c2)).headSeq).toBe(2);
  });

  it('C03 revision 충돌 → terminal receipt, 같은 opId 재시도도 같은 충돌', async () => {
    const u = await syntheticUser('c03');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const { nodeId } = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const p1 = await apply(u.client, r.generationId, {
      kind: 'patch',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId,
      baseRevision: 1,
      patch: { title: 'A' },
    });
    expect(p1.status).toBe('applied');
    expect(p1.revision).toBe(2);
    const opB = {
      kind: 'patch' as const,
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId,
      baseRevision: 1,
      patch: { url: 'https://example.com/B' },
    };
    const p2 = await apply(u.client, r.generationId, opB);
    expect(p2.status).toBe('conflict');
    expect(p2.code).toBe('REVISION_CONFLICT');
    expect(p2.currentRevision).toBe(2);
    expect(await apply(u.client, r.generationId, opB)).toEqual(p2);
    const snap = await snapshot(u.client);
    expect(snap.nodes.find((n) => n.id === nodeId)!.title).toBe('A');
  });

  it('no-op 은 commit 없이 noop receipt', async () => {
    const u = await syntheticUser('noop');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const { nodeId } = await createNode(
      u.client,
      r.generationId,
      col.collectionId,
      col.rootNodeId,
      { title: 'same' },
    );
    const p = await apply(u.client, r.generationId, {
      kind: 'patch',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId,
      baseRevision: 1,
      patch: { title: 'same' },
    });
    expect(p.status).toBe('noop');
    expect((await snapshot(u.client)).headSeq).toBe(2);
  });

  it('C06 같은 anchor 뒤 X 다음 Y → anchor,Y,X', async () => {
    const u = await syntheticUser('c06');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const a = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      title: 'anchor',
    });
    const x = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      title: 'x',
      afterId: a.nodeId,
    });
    const y = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      title: 'y',
      afterId: a.nodeId,
    });
    const snap = await snapshot(u.client);
    expect(snap.orders.find((o) => o.parentId === col.rootNodeId)!.orderedChildIds).toEqual([
      a.nodeId,
      y.nodeId,
      x.nodeId,
    ]);
  });

  it('C07 anchor 소실 후 move → ANCHOR_NOT_FOUND, 임의 배치 없음', async () => {
    const u = await syntheticUser('c07');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const a = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const b = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const f = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      kind: 'folder',
    });
    const digest = await subtreeDigestOf(
      a.nodeId,
      (await snapshot(u.client)).nodes.map((n) => ({ ...n, kind: 'x' })),
      (await snapshot(u.client)).orders,
    );
    const d = await apply(u.client, r.generationId, {
      kind: 'deleteSubtree',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: a.nodeId,
      baseRevision: 1,
      expectedSubtreeDigest: digest,
    });
    expect(d.status).toBe('applied');
    const m = await apply(u.client, r.generationId, {
      kind: 'move',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: b.nodeId,
      baseRevision: 1,
      parentId: f.nodeId,
      afterId: a.nodeId,
    });
    expect(m.status).toBe('conflict');
    expect(m.code).toBe('ANCHOR_NOT_FOUND');
    const snap = await snapshot(u.client);
    expect(snap.nodes.find((n) => n.id === b.nodeId)!.parentId).toBe(col.rootNodeId);
  });

  it('C08 순환 이동·다른 collection parent → 거부, 부분 변경 없음', async () => {
    const u = await syntheticUser('c08');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const col2 = await newCollection(u.client, r.generationId, 'other');
    const f1 = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      kind: 'folder',
    });
    const f2 = await createNode(u.client, r.generationId, col.collectionId, f1.nodeId, {
      kind: 'folder',
    });
    const before = await snapshot(u.client);
    const m1 = await apply(u.client, r.generationId, {
      kind: 'move',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: f1.nodeId,
      baseRevision: 1,
      parentId: f2.nodeId,
      afterId: null,
    });
    expect(m1.code).toBe('CYCLE');
    const m2 = await apply(u.client, r.generationId, {
      kind: 'move',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: f2.nodeId,
      baseRevision: 1,
      parentId: col2.rootNodeId,
      afterId: null,
    });
    expect(m2.code).toBe('PARENT_NOT_FOUND');
    const after = await snapshot(u.client);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.orders).toEqual(before.orders);
    expect(after.headSeq).toBe(before.headSeq);
  });

  it('C05 tombstone ID 로 create → DUPLICATE_ID (부활 차단)', async () => {
    const u = await syntheticUser('c05');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const a = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const s = await snapshot(u.client);
    const digest = await subtreeDigestOf(
      a.nodeId,
      s.nodes.map((n) => ({ ...n, kind: 'x' })),
      s.orders,
    );
    expect(
      (
        await apply(u.client, r.generationId, {
          kind: 'deleteSubtree',
          opId: uuid(),
          collectionId: col.collectionId,
          nodeId: a.nodeId,
          baseRevision: 1,
          expectedSubtreeDigest: digest,
        })
      ).status,
    ).toBe('applied');
    const again = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      nodeId: a.nodeId,
    });
    expect(again.receipt.status).toBe('rejected');
    expect(again.receipt.code).toBe('DUPLICATE_ID');
  });

  it('deleteSubtree digest 불일치 → DIGEST_MISMATCH, 삭제 없음; 일치 → 휴지통·복원', async () => {
    const u = await syntheticUser('del');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const f = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      kind: 'folder',
      title: 'F',
    });
    const b1 = await createNode(u.client, r.generationId, col.collectionId, f.nodeId, {
      title: 'b1',
    });
    const b2 = await createNode(u.client, r.generationId, col.collectionId, f.nodeId, {
      title: 'b2',
      afterId: b1.nodeId,
    });
    const s1 = await snapshot(u.client);
    const digest = await subtreeDigestOf(
      f.nodeId,
      s1.nodes.map((n) => ({ ...n, kind: 'x' })),
      s1.orders,
    );
    // 동시에 자식이 추가되면 digest 가 달라진다
    await createNode(u.client, r.generationId, col.collectionId, f.nodeId, { title: 'b3' });
    const d1 = await apply(u.client, r.generationId, {
      kind: 'deleteSubtree',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: f.nodeId,
      baseRevision: 1,
      expectedSubtreeDigest: digest,
    });
    expect(d1.status).toBe('conflict');
    expect(d1.code).toBe('DIGEST_MISMATCH');
    expect((await snapshot(u.client)).nodes.find((n) => n.id === f.nodeId)).toBeTruthy();
    const s2 = await snapshot(u.client);
    const digest2 = await subtreeDigestOf(
      f.nodeId,
      s2.nodes.map((n) => ({ ...n, kind: 'x' })),
      s2.orders,
    );
    const d2 = await apply(u.client, r.generationId, {
      kind: 'deleteSubtree',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: f.nodeId,
      baseRevision: 1,
      expectedSubtreeDigest: digest2,
    });
    expect(d2.status).toBe('applied');
    expect(d2.deletionId).toBeTruthy();
    const s3 = await snapshot(u.client);
    expect(s3.nodes.some((n) => [f.nodeId, b1.nodeId, b2.nodeId].includes(n.id))).toBe(false);
    const trash = await rpc<{ deletionId: string; itemCount: number }[]>(u.client, 'sync_trash');
    expect(trash.ok && trash.data[0]!.itemCount).toBe(4);
    // 복원 (원래 부모 살아 있음)
    const rs = await apply(u.client, r.generationId, {
      kind: 'restore',
      opId: uuid(),
      collectionId: col.collectionId,
      deletionId: d2.deletionId!,
      parentId: null,
    });
    expect(rs.status).toBe('applied');
    const s4 = await snapshot(u.client);
    const b3 = s2.orders.find((o) => o.parentId === f.nodeId)!.orderedChildIds[0]!; // afterId null → 맨 앞
    expect(s4.orders.find((o) => o.parentId === f.nodeId)!.orderedChildIds).toEqual([
      b3,
      b1.nodeId,
      b2.nodeId,
    ]);
    expect(s4.nodes.find((n) => n.id === b1.nodeId)!.revision).toBe(3);
    // 이미 복원된 묶음 재복원 → NOT_FOUND
    const rs2 = await apply(u.client, r.generationId, {
      kind: 'restore',
      opId: uuid(),
      collectionId: col.collectionId,
      deletionId: d2.deletionId!,
      parentId: null,
    });
    expect(rs2.code).toBe('NOT_FOUND');
  });

  it('E04 원래 부모도 삭제된 복원 → PARENT_NOT_FOUND, 선택 부모로 원자적 복원', async () => {
    const u = await syntheticUser('e04');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const p = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      kind: 'folder',
      title: 'P',
    });
    const c = await createNode(u.client, r.generationId, col.collectionId, p.nodeId, {
      title: 'c',
    });
    const del = async (id: string, rev: number) => {
      const s = await snapshot(u.client);
      return apply(u.client, r.generationId, {
        kind: 'deleteSubtree',
        opId: uuid(),
        collectionId: col.collectionId,
        nodeId: id,
        baseRevision: rev,
        expectedSubtreeDigest: await subtreeDigestOf(
          id,
          s.nodes.map((n) => ({ ...n, kind: 'x' })),
          s.orders,
        ),
      });
    };
    const d1 = await del(c.nodeId, 1);
    const d2 = await del(p.nodeId, 1);
    expect(d1.status).toBe('applied');
    expect(d2.status).toBe('applied');
    const r1 = await apply(u.client, r.generationId, {
      kind: 'restore',
      opId: uuid(),
      collectionId: col.collectionId,
      deletionId: d1.deletionId!,
      parentId: null,
    });
    expect(r1.code).toBe('PARENT_NOT_FOUND');
    const r2 = await apply(u.client, r.generationId, {
      kind: 'restore',
      opId: uuid(),
      collectionId: col.collectionId,
      deletionId: d1.deletionId!,
      parentId: col.rootNodeId,
    });
    expect(r2.status).toBe('applied');
    const s = await snapshot(u.client);
    expect(s.nodes.find((n) => n.id === c.nodeId)!.parentId).toBe(col.rootNodeId);
  });

  it('reorder: 자식 집합 불일치 거부, order revision 충돌', async () => {
    const u = await syntheticUser('reorder');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const a = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const b = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      afterId: a.nodeId,
    });
    const s = await snapshot(u.client);
    const rev = s.orders.find((o) => o.parentId === col.rootNodeId)!.revision;
    const bad = await apply(u.client, r.generationId, {
      kind: 'reorder',
      opId: uuid(),
      collectionId: col.collectionId,
      parentId: col.rootNodeId,
      baseOrderRevision: rev,
      orderedChildIds: [a.nodeId],
    });
    expect(bad.code).toBe('INVALID_OPERATION');
    const ok = await apply(u.client, r.generationId, {
      kind: 'reorder',
      opId: uuid(),
      collectionId: col.collectionId,
      parentId: col.rootNodeId,
      baseOrderRevision: rev,
      orderedChildIds: [b.nodeId, a.nodeId],
    });
    expect(ok.status).toBe('applied');
    const stale = await apply(u.client, r.generationId, {
      kind: 'reorder',
      opId: uuid(),
      collectionId: col.collectionId,
      parentId: col.rootNodeId,
      baseOrderRevision: rev,
      orderedChildIds: [a.nodeId, b.nodeId],
    });
    expect(stale.code).toBe('ORDER_CONFLICT');
  });

  it('C14 묶음: 앞 성공 유지, 충돌 이후 not_attempted, 재전송 중복 없음', async () => {
    const u = await syntheticUser('c14');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const n1 = uuid(),
      n2 = uuid(),
      n3 = uuid();
    const mk = (nodeId: string, parentId: string) => ({
      protocolVersion: 1,
      generationId: r.generationId,
      op: {
        kind: 'create',
        opId: uuid(),
        collectionId: col.collectionId,
        nodeId,
        nodeKind: 'bookmark',
        parentId,
        title: 't',
        url: 'https://example.com/',
        afterId: null,
      },
    });
    const envs = [mk(n1, col.rootNodeId), mk(n2, uuid() /* 없는 부모 */), mk(n3, col.rootNodeId)];
    const res = await rpc<{ receipts: { status: string; code?: string }[] }>(
      u.client,
      'sync_apply_operations',
      { p_envs: envs },
    );
    expect(res.ok).toBe(true);
    const rc = res.ok ? res.data.receipts : [];
    expect(rc.map((x) => x.status)).toEqual(['applied', 'conflict', 'not_attempted']);
    const s = await snapshot(u.client);
    expect(s.nodes.some((n) => n.id === n1)).toBe(true);
    expect(s.nodes.some((n) => n.id === n3)).toBe(false);
    // 재전송: 첫 op 는 receipt 재사용
    const res2 = await rpc<{ receipts: { status: string; seq?: number }[] }>(
      u.client,
      'sync_apply_operations',
      { p_envs: envs },
    );
    expect(res2.ok && res2.data.receipts[0]).toEqual(rc[0]);
    expect((await snapshot(u.client)).headSeq).toBe(s.headSeq);
  });

  it('F05 javascript:/data: URL 과 폴더 URL → INVALID_URL/INVALID_OPERATION', async () => {
    const u = await syntheticUser('f05');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'chrome://settings',
    ]) {
      const c = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
        url,
      });
      expect(c.receipt.code).toBe('INVALID_URL');
    }
    const f = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      kind: 'folder',
    });
    const p = await apply(u.client, r.generationId, {
      kind: 'patch',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: f.nodeId,
      baseRevision: 1,
      patch: { url: 'https://example.com/' },
    });
    expect(p.code).toBe('INVALID_OPERATION');
    // 악성 제목은 텍스트로 그대로 저장 (실행 없음)
    const html = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      title: '<img src=x onerror=alert(1)>',
    });
    expect(html.receipt.status).toBe('applied');
  });
});

describe('D: cursor·generation·한도', () => {
  it('changes 페이지·cursor·CURSOR_EXPIRED', async () => {
    const u = await syntheticUser('cur');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    for (let i = 0; i < 5; i++)
      await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId);
    const p1 = await rpc<{
      commits: { seq: number }[];
      nextCursor: number;
      hasMore: boolean;
      headSeq: number;
    }>(u.client, 'sync_changes', { p_after_seq: 0, p_limit: 2 });
    expect(p1.ok && p1.data.commits.map((c) => c.seq)).toEqual([1, 2]);
    expect(p1.ok && p1.data.hasMore).toBe(true);
    expect(p1.ok && p1.data.nextCursor).toBe(2);
    const p2 = await rpc<{ commits: { seq: number }[]; nextCursor: number; hasMore: boolean }>(
      u.client,
      'sync_changes',
      { p_after_seq: 2, p_limit: 10 },
    );
    expect(p2.ok && p2.data.commits.map((c) => c.seq)).toEqual([3, 4, 5, 6]);
    expect(p2.ok && p2.data.hasMore).toBe(false);
    const future = await rpc(u.client, 'sync_changes', { p_after_seq: 99 });
    expect(!future.ok && future.error.code).toBe('CURSOR_EXPIRED');
    // 로그 만료 시뮬레이션: 오래된 commit 삭제
    psql(`delete from shatsu.commits where workspace_id = '${r.workspaceId}' and seq <= 3`);
    const old = await rpc(u.client, 'sync_changes', { p_after_seq: 1 });
    expect(!old.ok && old.error.code).toBe('CURSOR_EXPIRED');
    const fine = await rpc<{ commits: { seq: number }[] }>(u.client, 'sync_changes', {
      p_after_seq: 3,
    });
    expect(fine.ok && fine.data.commits.map((c) => c.seq)).toEqual([4, 5, 6]);
  });

  it('D06 generation 변경 후 이전 세대 명령 거부, 장치 재인증', async () => {
    const u = await syntheticUser('gen');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    psql(`select shatsu.rotate_generations()`);
    const c2 = await anotherSession(u.email, u.password);
    const r2 = await register(c2);
    expect(r2.generationId).not.toBe(r.generationId);
    const rej = await apply(c2, r.generationId, {
      kind: 'createCollection',
      opId: uuid(),
      collectionId: uuid(),
      rootNodeId: uuid(),
      title: 'x',
    });
    expect(rej.code).toBe('SERVER_GENERATION_CHANGED');
    const old = await rpc(u.client, 'sync_info');
    expect(!old.ok && old.error.code).toBe('DEVICE_REVOKED');
    expect(col.collectionId).toBeTruthy();
  });

  it('protocolVersion 불일치 거부 · rate limit 120/min', async () => {
    const u = await syntheticUser('rl');
    const r = await register(u.client);
    const v = await rpc<{ receipt: { code: string } }>(u.client, 'sync_apply_operation', {
      p_env: {
        protocolVersion: 2,
        generationId: r.generationId,
        op: {
          kind: 'createCollection',
          opId: uuid(),
          collectionId: uuid(),
          rootNodeId: uuid(),
          title: 'x',
        },
      },
    });
    expect(v.ok && v.data.receipt.code).toBe('PROTOCOL_VERSION_MISMATCH');
    const col = await newCollection(u.client, r.generationId);
    let limited: { code: string; retryAfterSeconds?: number } | null = null;
    for (let i = 0; i < 125 && !limited; i++) {
      const res = await rpc<unknown>(u.client, 'sync_apply_operation', {
        p_env: {
          protocolVersion: 1,
          generationId: r.generationId,
          op: {
            kind: 'patchCollection',
            opId: uuid(),
            collectionId: col.collectionId,
            baseRevision: 0,
            title: 'Synthetic',
          },
        },
      });
      if (!res.ok) limited = res.error;
    }
    expect(limited?.code).toBe('RATE_LIMITED');
    expect(limited?.retryAfterSeconds).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('purge_expired: 만료 휴지통 본문 제거, ID·삭제 상태 보존', async () => {
    const u = await syntheticUser('purge');
    const r = await register(u.client);
    const col = await newCollection(u.client, r.generationId);
    const a = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      title: 'gone',
    });
    const s = await snapshot(u.client);
    const d = await apply(u.client, r.generationId, {
      kind: 'deleteSubtree',
      opId: uuid(),
      collectionId: col.collectionId,
      nodeId: a.nodeId,
      baseRevision: 1,
      expectedSubtreeDigest: await subtreeDigestOf(
        a.nodeId,
        s.nodes.map((n) => ({ ...n, kind: 'x' })),
        s.orders,
      ),
    });
    psql(
      `update shatsu.trash_payloads set expires_at = now() - interval '1 day' where deletion_id = '${d.deletionId}'`,
    );
    psql(`select shatsu.purge_expired()`);
    expect(psql(`select title from shatsu.nodes where id = '${a.nodeId}'`)).toBe('');
    expect(psql(`select deleted_at is not null from shatsu.nodes where id = '${a.nodeId}'`)).toBe(
      't',
    );
    expect(
      psql(
        `select payload is null and purged_at is not null from shatsu.trash_payloads where deletion_id = '${d.deletionId}'`,
      ),
    ).toBe('t');
    const again = await createNode(u.client, r.generationId, col.collectionId, col.rootNodeId, {
      nodeId: a.nodeId,
    });
    expect(again.receipt.code).toBe('DUPLICATE_ID');
  });
});

describe('R: Realtime 권한', () => {
  const subscribe = (client: ReturnType<typeof anonClient>, topic: string) => {
    const ch = client.channel(topic, { config: { private: true } });
    const status = new Promise<string>((resolve) => {
      ch.subscribe((st, err) => {
        if (st === 'SUBSCRIBED') resolve('SUBSCRIBED');
        else if (st === 'CHANNEL_ERROR' || st === 'CLOSED' || st === 'TIMED_OUT')
          resolve(st + ':' + (err?.message ?? ''));
      });
      setTimeout(() => resolve('TIMEOUT'), 15000);
    });
    return { ch, status };
  };

  it('R04 소유자만 private channel 구독, 타 계정 거부, client 발행은 전달되지 않음, 서버 알림에 본문 없음', async () => {
    const a = await syntheticUser('rta');
    const b = await syntheticUser('rtb');
    const ra = await register(a.client);
    await register(b.client);
    const topic = `workspace:${ra.workspaceId}`;
    a.client.realtime.setAuth((await a.client.auth.getSession()).data.session!.access_token);
    b.client.realtime.setAuth((await b.client.auth.getSession()).data.session!.access_token);
    const subA = subscribe(a.client, topic);
    const received: Record<string, unknown>[] = [];
    subA.ch.on('broadcast', { event: 'changed' }, (m) =>
      received.push(m.payload as Record<string, unknown>),
    );
    expect(await subA.status).toBe('SUBSCRIBED');
    const subB = subscribe(b.client, topic);
    expect(await subB.status).not.toBe('SUBSCRIBED');
    // client 발행 (insert 정책 없음): 같은 소유자의 다른 구독자에게도 전달되지 않아야 한다
    const a2 = await anotherSession(a.email, a.password);
    await register(a2, 'second');
    a2.realtime.setAuth((await a2.auth.getSession()).data.session!.access_token);
    const subA2 = subscribe(a2, topic);
    expect(await subA2.status).toBe('SUBSCRIBED');
    await subA2.ch.send({
      type: 'broadcast',
      event: 'changed',
      payload: { type: 'changed', injected: true },
    });
    await new Promise((r) => setTimeout(r, 2500));
    expect(received.filter((m) => m.injected)).toEqual([]);
    // 서버 발행은 도착하고 payload 에 본문·seq 가 없다
    await newCollection(a.client, ra.generationId, 'secret-collection-title');
    await new Promise((r) => setTimeout(r, 3000));
    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received.at(-1)!;
    expect(last.type).toBe('changed');
    expect(JSON.stringify(last)).not.toContain('secret-collection-title');
    expect(Object.keys(last).filter((k) => !['type', 'id'].includes(k))).toEqual([]);
    await a.client.removeAllChannels();
    await a2.removeAllChannels();
    await b.client.removeAllChannels();
  }, 60_000);
});
