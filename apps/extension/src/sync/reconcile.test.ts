import { describe, expect, it } from 'vitest';
import type { FolderOrder, NodeRecord } from 'shatsu-ren-protocol';
import type { LocalTree } from './browser';
import { reconcile, type ReconcileInput } from './reconcile';
import type { ObservedNode, OutboxEntry } from './types';

const COL = '00000000-0000-4000-8000-00000000c001';
const ROOT_G = '00000000-0000-4000-8000-0000000000aa';
let seq = 0;
const gid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function tree(
  spec: {
    id: string;
    parent: string | null;
    kind: 'folder' | 'bookmark';
    title: string;
    url?: string;
  }[],
): LocalTree {
  const nodes = new Map<string, LocalTree['nodes'] extends Map<string, infer V> ? V : never>();
  const children = new Map<string, string[]>();
  nodes.set('r', {
    id: 'r',
    parentId: null,
    index: 0,
    kind: 'folder',
    title: 'Root',
    url: null,
    unmodifiable: false,
  });
  children.set('r', []);
  for (const s of spec) {
    const parent = s.parent ?? 'r';
    const sib = children.get(parent) ?? [];
    nodes.set(s.id, {
      id: s.id,
      parentId: parent,
      index: sib.length,
      kind: s.kind,
      title: s.title,
      url: s.url ?? null,
      unmodifiable: false,
    });
    sib.push(s.id);
    children.set(parent, sib);
    if (s.kind === 'folder') children.set(s.id, []);
  }
  return { rootId: 'r', nodes, children };
}

function snode(p: Partial<NodeRecord> & { id: string; kind: NodeRecord['kind'] }): NodeRecord {
  return {
    collectionId: COL,
    parentId: ROOT_G,
    title: '',
    url: p.kind === 'bookmark' ? 'https://example.com/' : null,
    revision: 1,
    deletedAt: null,
    deletionId: null,
    ...p,
  };
}

function input(over: Partial<ReconcileInput>): ReconcileInput {
  return {
    binding: { collectionId: COL, localRootId: 'r', status: 'active', createdAt: 0 },
    rootGlobalId: ROOT_G,
    local: tree([]),
    observed: new Map(),
    shadowNodes: new Map([[ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })]]),
    shadowOrders: new Map([[ROOT_G, { parentId: ROOT_G, orderedChildIds: [], revision: 0 }]]),
    pendingOps: new Map(),
    openConflicts: new Set(),
    existsElsewhere: new Set(),
    approvedOutboundDeletes: new Set(),
    approvedInboundDeletes: new Set(),
    openReviewKinds: new Set(),
    newId: gid,
    ...over,
  };
}
const rootObs: ObservedNode = {
  localId: 'r',
  globalId: ROOT_G,
  collectionId: COL,
  parentLocalId: null,
  kind: 'root',
  title: '',
  url: null,
  revision: 1,
  childOrder: [],
  orderRevision: 0,
};
const obs = (localId: string, globalId: string, p: Partial<ObservedNode> = {}): ObservedNode => ({
  localId,
  globalId,
  collectionId: COL,
  parentLocalId: 'r',
  kind: 'bookmark',
  title: 't',
  url: 'https://example.com/',
  revision: 1,
  ...p,
});

describe('reconcile', () => {
  it('B01 빈 서버 첫 연결: 로컬 항목 전부 create op, 삭제 0, 부모 먼저', () => {
    const local = tree([
      { id: 'f', parent: null, kind: 'folder', title: 'F' },
      { id: 'b', parent: 'f', kind: 'bookmark', title: 'B', url: 'https://example.com/b' },
      { id: 'x', parent: null, kind: 'bookmark', title: 'js', url: 'javascript:void(0)' },
    ]);
    const out = reconcile(input({ local }));
    expect(out.ops.map((o) => o.kind)).toEqual(['create', 'create']);
    const [f, b] = out.ops as Extract<(typeof out.ops)[number], { kind: 'create' }>[];
    expect(f!.parentGlobalId).toBe(ROOT_G);
    expect(b!.parentGlobalId).toBe(f!.globalId);
    expect(out.stats.excluded).toBe(1);
    expect(out.localActions).toEqual([]);
    expect(out.observedUpserts.find((o) => o.localId === 'x')?.excluded).toBe('unsupported_url');
  });

  it('원격에만 있는 항목은 로컬 create 액션 (부모 먼저)', () => {
    const F = gid(),
      B = gid();
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [F, snode({ id: F, kind: 'folder', title: 'F' })],
      [B, snode({ id: B, kind: 'bookmark', parentId: F, title: 'B' })],
    ]);
    const out = reconcile(input({ shadowNodes, observed: new Map([['r', rootObs]]) }));
    expect(out.localActions.map((a) => a.type === 'create' && a.globalId)).toEqual([F, B]);
    expect(out.ops).toEqual([]);
  });

  it('C01 로컬 제목 수정 → patch op (baseRevision = 합의 revision)', () => {
    const B = gid();
    const local = tree([
      { id: 'b', parent: null, kind: 'bookmark', title: 'new', url: 'https://example.com/' },
    ]);
    const out = reconcile(
      input({
        local,
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { title: 'old' })],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', title: 'old' })],
        ]),
      }),
    );
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0]).toMatchObject({
      kind: 'patch',
      globalId: B,
      baseRevision: 1,
      patch: { title: 'new' },
    });
  });

  it('원격 제목 수정 → 로컬 update 액션', () => {
    const B = gid();
    const local = tree([
      { id: 'b', parent: null, kind: 'bookmark', title: 'old', url: 'https://example.com/' },
    ]);
    const out = reconcile(
      input({
        local,
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { title: 'old' })],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', title: 'remote', revision: 2 })],
        ]),
      }),
    );
    expect(out.localActions).toEqual([
      { type: 'update', globalId: B, localId: 'b', title: 'remote', revision: 2 },
    ]);
    expect(out.ops).toEqual([]);
  });

  it('C03 양쪽 수정 → 충돌, 조용한 덮어쓰기 없음; 같은 결과면 합의', () => {
    const B = gid();
    const local = tree([
      { id: 'b', parent: null, kind: 'bookmark', title: 'mine', url: 'https://example.com/' },
    ]);
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [B, snode({ id: B, kind: 'bookmark', title: 'theirs', revision: 2 })],
    ]);
    const out = reconcile(
      input({
        local,
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { title: 'old' })],
        ]),
        shadowNodes,
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.localActions).toEqual([]);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]).toMatchObject({
      kind: 'edit_edit',
      local: { title: 'mine' },
      remote: { title: 'theirs', revision: 2 },
      base: { title: 'old', revision: 1 },
    });
    const same = reconcile(
      input({
        local: tree([
          { id: 'b', parent: null, kind: 'bookmark', title: 'theirs', url: 'https://example.com/' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { title: 'old' })],
        ]),
        shadowNodes,
      }),
    );
    expect(same.conflicts).toEqual([]);
    expect(same.observedUpserts.find((o) => o.localId === 'b')).toMatchObject({
      title: 'theirs',
      revision: 2,
    });
  });

  it('C04 원격 삭제 vs 로컬 미전송 수정 → 충돌, 삭제 안 함', () => {
    const B = gid();
    const local = tree([
      { id: 'b', parent: null, kind: 'bookmark', title: 'edited', url: 'https://example.com/' },
    ]);
    const out = reconcile(
      input({
        local,
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { title: 'old' })],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', title: 'old', revision: 2, deletedAt: 'x' })],
        ]),
      }),
    );
    expect(out.localActions).toEqual([]);
    expect(out.conflicts[0]?.kind).toBe('local_edit_remote_delete');
  });

  it('원격 삭제, 로컬 변경 없음 → remove 액션; 폴더 아래 미전송 자식이 있으면 충돌', () => {
    const F = gid();
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [F, snode({ id: F, kind: 'folder', title: 'F', revision: 2, deletedAt: 'x' })],
    ]);
    const clean = reconcile(
      input({
        local: tree([{ id: 'f', parent: null, kind: 'folder', title: 'F' }]),
        observed: new Map([
          ['r', rootObs],
          ['f', obs('f', F, { kind: 'folder', title: 'F', url: null })],
        ]),
        shadowNodes,
      }),
    );
    expect(clean.localActions).toEqual([{ type: 'remove', globalId: F, localId: 'f', count: 1 }]);
    const dirty = reconcile(
      input({
        local: tree([
          { id: 'f', parent: null, kind: 'folder', title: 'F' },
          { id: 'n', parent: 'f', kind: 'bookmark', title: 'new', url: 'https://example.com/n' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['f', obs('f', F, { kind: 'folder', title: 'F', url: null })],
        ]),
        shadowNodes,
      }),
    );
    expect(dirty.localActions).toEqual([]);
    expect(dirty.conflicts[0]?.kind).toBe('local_edit_remote_delete');
  });

  it('E01 로컬 폴더 삭제 → 최상위 하나만 deleteSubtree, 자식은 포함', () => {
    const F = gid(),
      B = gid();
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [F, snode({ id: F, kind: 'folder', title: 'F' })],
      [B, snode({ id: B, kind: 'bookmark', parentId: F })],
    ]);
    const out = reconcile(
      input({
        local: tree([]),
        observed: new Map([
          ['r', rootObs],
          ['f', obs('f', F, { kind: 'folder', url: null })],
          ['b', obs('b', B, { parentLocalId: 'f' })],
        ]),
        shadowNodes,
      }),
    );
    expect(out.ops).toEqual([
      expect.objectContaining({ kind: 'deleteSubtree', globalId: F, count: 2 }),
    ]);
  });

  it('로컬 삭제 vs 원격 수정 → 충돌', () => {
    const B = gid();
    const out = reconcile(
      input({
        local: tree([]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B)],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', revision: 3, title: 'changed' })],
        ]),
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.conflicts[0]?.kind).toBe('local_delete_remote_edit');
  });

  it('E03 대량 삭제(20개) → 검토 보류, 승인 후 op', () => {
    const ids = Array.from({ length: 20 }, () => gid());
    const shadowNodes = new Map<string, NodeRecord>([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
    ]);
    const observed = new Map<string, ObservedNode>([['r', rootObs]]);
    ids.forEach((g, i) => {
      shadowNodes.set(g, snode({ id: g, kind: 'bookmark' }));
      observed.set('l' + i, obs('l' + i, g));
    });
    const held = reconcile(input({ local: tree([]), observed, shadowNodes }));
    expect(held.ops).toEqual([]);
    expect(held.reviews[0]).toMatchObject({ kind: 'mass_delete_out', scopeCount: 20 });
    expect(held.reviews[0]!.items).toHaveLength(20);
    const approved = reconcile(
      input({ local: tree([]), observed, shadowNodes, approvedOutboundDeletes: new Set(ids) }),
    );
    expect(approved.ops).toHaveLength(20);
  });

  it('20% 규칙: 25개 중 5개 삭제 → 검토', () => {
    const ids = Array.from({ length: 25 }, () => gid());
    const shadowNodes = new Map<string, NodeRecord>([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
    ]);
    const observed = new Map<string, ObservedNode>([['r', rootObs]]);
    ids.forEach((g, i) => {
      shadowNodes.set(g, snode({ id: g, kind: 'bookmark' }));
      observed.set('l' + i, obs('l' + i, g));
    });
    const keep = ids.slice(5).map((_, i) => ({
      id: 'l' + (i + 5),
      parent: null,
      kind: 'bookmark' as const,
      title: 't',
      url: 'https://example.com/',
    }));
    const out = reconcile(input({ local: tree(keep), observed, shadowNodes }));
    expect(out.reviews[0]?.kind).toBe('mass_delete_out');
    const four = reconcile(
      input({
        local: tree([
          { id: 'l4', parent: null, kind: 'bookmark', title: 't', url: 'https://example.com/' },
          ...keep,
        ]),
        observed,
        shadowNodes,
      }),
    );
    expect(four.reviews).toEqual([]);
    expect(four.ops).toHaveLength(4);
  });

  it('수신 대량 삭제 → 검토 후 적용', () => {
    const ids = Array.from({ length: 20 }, () => gid());
    const shadowNodes = new Map<string, NodeRecord>([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
    ]);
    const observed = new Map<string, ObservedNode>([['r', rootObs]]);
    const spec = ids.map((g, i) => {
      shadowNodes.set(g, snode({ id: g, kind: 'bookmark', revision: 2, deletedAt: 'x' }));
      observed.set('l' + i, obs('l' + i, g));
      return {
        id: 'l' + i,
        parent: null,
        kind: 'bookmark' as const,
        title: 't',
        url: 'https://example.com/',
      };
    });
    const held = reconcile(input({ local: tree(spec), observed, shadowNodes }));
    expect(held.localActions).toEqual([]);
    expect(held.reviews[0]?.kind).toBe('mass_delete_in');
    const ok = reconcile(
      input({ local: tree(spec), observed, shadowNodes, approvedInboundDeletes: new Set(ids) }),
    );
    expect(ok.localActions.filter((a) => a.type === 'remove')).toHaveLength(20);
  });

  it('C13 범위 밖 이동 → moved_out 검토, 삭제 op 없음', () => {
    const B = gid();
    const out = reconcile(
      input({
        local: tree([]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B)],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark' })],
        ]),
        existsElsewhere: new Set(['b']),
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.reviews[0]?.kind).toBe('moved_out');
  });

  it('C05 오래 꺼진 장치: 원격 tombstone + 로컬 변경 없음 → 로컬 삭제만, 재전송 없음', () => {
    const B = gid();
    const out = reconcile(
      input({
        local: tree([
          { id: 'b', parent: null, kind: 'bookmark', title: 't', url: 'https://example.com/' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B)],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', revision: 2, deletedAt: 'x' })],
        ]),
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.localActions[0]?.type).toBe('remove');
  });

  it('C11 echo: 적용 후 base 가 일치하면 재전송 없음', () => {
    const B = gid();
    const out = reconcile(
      input({
        local: tree([
          { id: 'b', parent: null, kind: 'bookmark', title: 't', url: 'https://example.com/' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B, { revision: 2 })],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark', title: 't', revision: 2 })],
        ]),
        shadowOrders: new Map([[ROOT_G, { parentId: ROOT_G, orderedChildIds: [B], revision: 0 }]]),
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.localActions).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('pending op 이 있는 node 는 추가 op 을 만들지 않는다 (in-flight 보호)', () => {
    const B = gid();
    const pending = new Map<string, OutboxEntry>([
      [
        B,
        {
          opId: 'x',
          env: {
            protocolVersion: 1,
            generationId: 'g',
            op: {
              kind: 'patch',
              opId: 'x',
              collectionId: COL,
              nodeId: B,
              baseRevision: 1,
              patch: { title: 'a' },
            },
          },
          targetId: B,
          collectionId: COL,
          status: 'in_flight',
          createdAt: 0,
          attempts: 1,
        },
      ],
    ]);
    const out = reconcile(
      input({
        local: tree([
          { id: 'b', parent: null, kind: 'bookmark', title: 'b', url: 'https://example.com/' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B)],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark' })],
        ]),
        pendingOps: pending,
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.stats.held).toBe(1);
  });

  it('C02 순서: 로컬 재정렬 → reorder op, 원격 재정렬 → reorder 액션', () => {
    const A = gid(),
      B = gid();
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [A, snode({ id: A, kind: 'bookmark', title: 'a' })],
      [B, snode({ id: B, kind: 'bookmark', title: 'b' })],
    ]);
    const observed = new Map([
      ['r', { ...rootObs, childOrder: ['a', 'b'], orderRevision: 3 }],
      ['a', obs('a', A, { title: 'a' })],
      ['b', obs('b', B, { title: 'b' })],
    ]);
    const localSwapped = tree([
      { id: 'b', parent: null, kind: 'bookmark', title: 'b', url: 'https://example.com/' },
      { id: 'a', parent: null, kind: 'bookmark', title: 'a', url: 'https://example.com/' },
    ]);
    const orders = new Map<string, FolderOrder>([
      [ROOT_G, { parentId: ROOT_G, orderedChildIds: [A, B], revision: 3 }],
    ]);
    const l = reconcile(
      input({ local: localSwapped, observed, shadowNodes, shadowOrders: orders }),
    );
    expect(l.ops).toEqual([
      {
        kind: 'reorder',
        parentGlobalId: ROOT_G,
        parentLocalId: 'r',
        baseOrderRevision: 3,
        orderedGlobalIds: [B, A],
      },
    ]);
    const remoteOrders = new Map<string, FolderOrder>([
      [ROOT_G, { parentId: ROOT_G, orderedChildIds: [B, A], revision: 4 }],
    ]);
    const r = reconcile(
      input({
        local: tree([
          { id: 'a', parent: null, kind: 'bookmark', title: 'a', url: 'https://example.com/' },
          { id: 'b', parent: null, kind: 'bookmark', title: 'b', url: 'https://example.com/' },
        ]),
        observed,
        shadowNodes,
        shadowOrders: remoteOrders,
      }),
    );
    expect(r.localActions).toEqual([
      {
        type: 'reorder',
        parentGlobalId: ROOT_G,
        parentLocalId: 'r',
        orderedGlobalIds: [B, A],
        orderRevision: 4,
      },
    ]);
  });

  it('로컬 이동 → move op (anchor = 앞 형제), 원격 이동 → move 액션', () => {
    const F = gid(),
      A = gid(),
      B = gid();
    const shadowNodes = new Map([
      [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
      [F, snode({ id: F, kind: 'folder', title: 'F' })],
      [A, snode({ id: A, kind: 'bookmark', parentId: F, title: 'a' })],
      [B, snode({ id: B, kind: 'bookmark', title: 'b' })],
    ]);
    const observed = new Map([
      ['r', rootObs],
      ['f', obs('f', F, { kind: 'folder', url: null, title: 'F' })],
      ['a', obs('a', A, { parentLocalId: 'f', title: 'a' })],
      ['b', obs('b', B, { title: 'b' })],
    ]);
    const moved = tree([
      { id: 'f', parent: null, kind: 'folder', title: 'F' },
      { id: 'a', parent: 'f', kind: 'bookmark', title: 'a', url: 'https://example.com/' },
      { id: 'b', parent: 'f', kind: 'bookmark', title: 'b', url: 'https://example.com/' },
    ]);
    const l = reconcile(input({ local: moved, observed, shadowNodes }));
    expect(l.ops).toEqual([
      expect.objectContaining({
        kind: 'move',
        globalId: B,
        parentGlobalId: F,
        afterGlobalId: A,
        baseRevision: 1,
      }),
    ]);
    const remoteMoved = new Map(shadowNodes);
    remoteMoved.set(B, snode({ id: B, kind: 'bookmark', parentId: F, title: 'b', revision: 2 }));
    const r = reconcile(
      input({
        local: tree([
          { id: 'f', parent: null, kind: 'folder', title: 'F' },
          { id: 'a', parent: 'f', kind: 'bookmark', title: 'a', url: 'https://example.com/' },
          { id: 'b', parent: null, kind: 'bookmark', title: 'b', url: 'https://example.com/' },
        ]),
        observed,
        shadowNodes: remoteMoved,
      }),
    );
    expect(r.localActions).toEqual([
      { type: 'move', globalId: B, localId: 'b', parentGlobalId: F, revision: 2 },
    ]);
  });

  it('E07 알려진 항목 URL 이 지원 불가 scheme 으로 변경 → 검토, 원격 삭제 없음', () => {
    const B = gid();
    const out = reconcile(
      input({
        local: tree([
          { id: 'b', parent: null, kind: 'bookmark', title: 't', url: 'javascript:alert(1)' },
        ]),
        observed: new Map([
          ['r', rootObs],
          ['b', obs('b', B)],
        ]),
        shadowNodes: new Map([
          [ROOT_G, snode({ id: ROOT_G, kind: 'root', parentId: null })],
          [B, snode({ id: B, kind: 'bookmark' })],
        ]),
      }),
    );
    expect(out.ops).toEqual([]);
    expect(out.reviews[0]?.kind).toBe('excluded_url');
  });
});
