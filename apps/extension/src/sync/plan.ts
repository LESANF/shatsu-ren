/**
 * 최초 병합 계획. 보수적 자동 매칭: 루트 아래 상대 경로(제목 배열)·종류·제목·URL 이 정확히 같고 양쪽 후보가 하나뿐일 때만.
 * 미리보기는 server headSeq + 로컬 fingerprint 에 묶인다.
 */
import type { NodeRecord } from 'shatsu-ren-protocol';
import { isSyncableUrl, sha256Hex } from 'shatsu-ren-protocol';
import { getMeta, type Db } from '../storage/db';
import { getSubTree, type LocalTree } from './browser';
import type { Ctx } from './context';
import { reconcile } from './reconcile';
import type { ObservedNode } from './types';

export interface MergePlan {
  planId: string;
  collectionId: string;
  rootGlobalId: string;
  localRootId: string;
  headSeq: number;
  localFingerprint: string;
  counts: {
    toLocal: number; // 이 브라우저에 추가
    toServer: number; // 계정에 추가
    matched: number;
    duplicateCandidates: number; // 쌍
    excluded: number;
    deletes: 0;
    folders: { toLocal: number; toServer: number };
    reorderedFolders: number;
  };
  /** 항목별 내용 (제목·방향·경로). URL 은 넣지 않고 상세에서 조회 */
  items: {
    direction: 'toLocal' | 'toServer' | 'matched' | 'duplicate' | 'excluded';
    title: string;
    kind: string;
    path: string[];
    reason?: string;
  }[];
  matches: { localId: string; globalId: string }[];
  createdAt: number;
}

export async function localFingerprint(tree: LocalTree): Promise<string> {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    for (const c of tree.children.get(id) ?? []) {
      const n = tree.nodes.get(c)!;
      lines.push(JSON.stringify([depth, n.id, n.parentId, n.kind, n.title, n.url, n.unmodifiable]));
      walk(c, depth + 1);
    }
  };
  walk(tree.rootId, 0);
  return sha256Hex(lines.join('\n'));
}

type Key = string; // JSON of [pathTitles..., kind, title, url]
const keyOf = (path: string[], kind: string, title: string, url: string | null) =>
  JSON.stringify([path, kind, title, url]);

export async function buildMergePlan(
  ctx: Ctx,
  collectionId: string,
  rootGlobalId: string,
  localRootId: string,
): Promise<MergePlan> {
  const { db } = ctx;
  const local = await getSubTree(localRootId);
  if (!local) throw new Error('ROOT_MISSING');
  const shadow = (await db.getAllFromIndex('shadow_nodes', 'byCollection', collectionId)).filter(
    (n) => !n.deletedAt,
  );
  const shadowMap = new Map(shadow.map((n) => [n.id, n]));
  const headSeq = (await getMeta<number>(db, 'headSeq')) ?? 0;

  // 로컬 키
  const localKeys = new Map<Key, string[]>(); // key → localIds
  const localPath = new Map<string, string[]>();
  const walkL = (id: string, path: string[]) => {
    for (const c of local.children.get(id) ?? []) {
      const n = local.nodes.get(c)!;
      localPath.set(c, path);
      if (n.kind === 'bookmark' && !isSyncableUrl(n.url)) continue;
      const k = keyOf(path, n.kind, n.title, n.kind === 'bookmark' ? n.url : null);
      localKeys.set(k, [...(localKeys.get(k) ?? []), c]);
      if (n.kind === 'folder') walkL(c, [...path, n.title]);
    }
  };
  walkL(localRootId, []);
  // 원격 키
  const remoteKeys = new Map<Key, string[]>();
  const remotePath = new Map<string, string[]>();
  const rchildren = new Map<string, NodeRecord[]>();
  for (const n of shadow)
    if (n.parentId) rchildren.set(n.parentId, [...(rchildren.get(n.parentId) ?? []), n]);
  const walkR = (gid: string, path: string[]) => {
    for (const n of rchildren.get(gid) ?? []) {
      remotePath.set(n.id, path);
      const k = keyOf(path, n.kind, n.title, n.kind === 'bookmark' ? n.url : null);
      remoteKeys.set(k, [...(remoteKeys.get(k) ?? []), n.id]);
      if (n.kind === 'folder') walkR(n.id, [...path, n.title]);
    }
  };
  walkR(rootGlobalId, []);

  // 유일 후보 매칭. 조상 폴더가 모호(중복 이름)하면 그 하위는 매칭하지 않는다.
  const ambiguousFolderPaths = new Set<string>();
  for (const [k, ids] of localKeys)
    if (ids.length > 1 && JSON.parse(k)[1] === 'folder')
      ambiguousFolderPaths.add(JSON.stringify([...JSON.parse(k)[0], JSON.parse(k)[2]]));
  for (const [k, ids] of remoteKeys)
    if (ids.length > 1 && JSON.parse(k)[1] === 'folder')
      ambiguousFolderPaths.add(JSON.stringify([...JSON.parse(k)[0], JSON.parse(k)[2]]));
  const underAmbiguous = (path: string[]) => {
    for (let i = 1; i <= path.length; i++)
      if (ambiguousFolderPaths.has(JSON.stringify(path.slice(0, i)))) return true;
    return false;
  };

  const matches: { localId: string; globalId: string }[] = [];
  let duplicateCandidates = 0;
  const matchedLocal = new Set<string>();
  const matchedRemote = new Set<string>();
  for (const [k, lids] of localKeys) {
    const rids = remoteKeys.get(k);
    if (!rids) continue;
    const path = JSON.parse(k)[0] as string[];
    if (lids.length === 1 && rids.length === 1 && !underAmbiguous(path)) {
      matches.push({ localId: lids[0]!, globalId: rids[0]! });
      matchedLocal.add(lids[0]!);
      matchedRemote.add(rids[0]!);
    } else {
      duplicateCandidates += Math.min(lids.length, rids.length);
    }
  }

  // observed seed 로 reconcile 을 dry-run 해 실제 계획 수치를 얻는다
  const seeds = seedObserved(collectionId, rootGlobalId, localRootId, local, shadowMap, matches);
  const shadowOrders = new Map<string, import('shatsu-ren-protocol').FolderOrder>();
  for (const n of shadow)
    if (n.kind !== 'bookmark') {
      const o = await db.get('shadow_orders', n.id);
      if (o) shadowOrders.set(n.id, o);
    }
  const out = reconcile({
    binding: { collectionId, localRootId, status: 'active', createdAt: Date.now() },
    rootGlobalId,
    local,
    observed: new Map(seeds.map((s) => [s.localId, s])),
    shadowNodes: shadowMap,
    shadowOrders,
    pendingOps: new Map(),
    openConflicts: new Set(),
    existsElsewhere: new Set(),
    approvedOutboundDeletes: new Set(),
    approvedInboundDeletes: new Set(),
    openReviewKinds: new Set(),
    newId: () => crypto.randomUUID(),
  });
  const items: MergePlan['items'] = [];
  let foldersToLocal = 0,
    foldersToServer = 0;
  for (const a of out.localActions)
    if (a.type === 'create') {
      if (a.kind === 'folder') foldersToLocal++;
      items.push({
        direction: 'toLocal',
        title: a.title,
        kind: a.kind,
        path: remotePath.get(a.globalId) ?? [],
      });
    }
  for (const o of out.ops)
    if (o.kind === 'create') {
      if (o.nodeKind === 'folder') foldersToServer++;
      items.push({
        direction: 'toServer',
        title: o.title,
        kind: o.nodeKind,
        path: localPath.get(o.localId) ?? [],
      });
    }
  for (const m of matches) {
    const n = local.nodes.get(m.localId)!;
    items.push({
      direction: 'matched',
      title: n.title,
      kind: n.kind,
      path: localPath.get(m.localId) ?? [],
    });
  }
  for (const [k, lids] of localKeys) {
    const rids = remoteKeys.get(k);
    if (rids && !(lids.length === 1 && rids.length === 1 && !underAmbiguous(JSON.parse(k)[0])))
      for (const lid of lids) {
        const n = local.nodes.get(lid)!;
        items.push({
          direction: 'duplicate',
          title: n.title,
          kind: n.kind,
          path: localPath.get(lid) ?? [],
          reason: 'ambiguous',
        });
      }
  }
  for (const [id, n] of local.nodes)
    if (id !== localRootId && n.kind === 'bookmark' && !isSyncableUrl(n.url))
      items.push({
        direction: 'excluded',
        title: n.title,
        kind: n.kind,
        path: localPath.get(id) ?? [],
        reason: 'unsupported_url',
      });
  const deletes =
    out.localActions.filter((a) => a.type === 'remove').length +
    out.ops.filter((o) => o.kind === 'deleteSubtree').length;
  if (deletes !== 0) throw new Error('INVARIANT: initial merge must not delete');

  return {
    planId: crypto.randomUUID(),
    collectionId,
    rootGlobalId,
    localRootId,
    headSeq,
    localFingerprint: await localFingerprint(local),
    counts: {
      toLocal: out.localActions.filter((a) => a.type === 'create').length,
      toServer: out.ops.filter((o) => o.kind === 'create').length,
      matched: matches.length,
      duplicateCandidates,
      excluded: out.stats.excluded,
      deletes: 0,
      folders: { toLocal: foldersToLocal, toServer: foldersToServer },
      reorderedFolders: out.localActions.filter((a) => a.type === 'reorder').length,
    },
    items,
    matches,
    createdAt: Date.now(),
  };
}

/** 매칭 결과로 observed(base) 초기값 생성. 매칭 항목은 서버 revision 을 base 로, 나머지는 존재하지 않음(→ reconcile 이 create 로 처리). */
export function seedObserved(
  collectionId: string,
  rootGlobalId: string,
  localRootId: string,
  local: LocalTree,
  shadow: Map<string, NodeRecord>,
  matches: { localId: string; globalId: string }[],
): ObservedNode[] {
  const seeds: ObservedNode[] = [
    {
      localId: localRootId,
      globalId: rootGlobalId,
      collectionId,
      parentLocalId: null,
      kind: 'root',
      title: '',
      url: null,
      revision: 1,
      childOrder: [],
      orderRevision: -1,
    },
  ];
  for (const m of matches) {
    const n = local.nodes.get(m.localId)!;
    const s = shadow.get(m.globalId)!;
    seeds.push({
      localId: m.localId,
      globalId: m.globalId,
      collectionId,
      parentLocalId: n.parentId ?? localRootId,
      kind: n.kind,
      title: n.title,
      url: n.kind === 'bookmark' ? n.url : null,
      revision: s.revision,
      ...(n.kind === 'folder' ? { childOrder: [], orderRevision: -1 } : {}),
    });
  }
  return seeds;
}

/** 계획 확정: fingerprint/headSeq 재검증 → 백업 → binding + observed seed 저장. 실제 전송·적용은 엔진 실행이 한다. */
export async function commitPlan(
  ctx: Ctx,
  plan: MergePlan,
  backupFn: () => Promise<string>,
): Promise<
  { ok: true; backupId: string } | { ok: false; code: 'REPLAN' | 'ROOT_MISSING' | 'BACKUP_FAILED' }
> {
  const { db } = ctx;
  const local = await getSubTree(plan.localRootId);
  if (!local) return { ok: false, code: 'ROOT_MISSING' };
  const headSeq = (await getMeta<number>(db, 'headSeq')) ?? 0;
  if ((await localFingerprint(local)) !== plan.localFingerprint || headSeq !== plan.headSeq)
    return { ok: false, code: 'REPLAN' };
  let backupId: string;
  try {
    backupId = await backupFn();
  } catch {
    return { ok: false, code: 'BACKUP_FAILED' };
  }
  const shadow = new Map(
    (await db.getAllFromIndex('shadow_nodes', 'byCollection', plan.collectionId)).map((n) => [
      n.id,
      n,
    ]),
  );
  const seeds = seedObserved(
    plan.collectionId,
    plan.rootGlobalId,
    plan.localRootId,
    local,
    shadow,
    plan.matches,
  );
  const tx = db.transaction(['bindings', 'observed'], 'readwrite');
  await tx.objectStore('bindings').put({
    collectionId: plan.collectionId,
    localRootId: plan.localRootId,
    status: 'active',
    createdAt: Date.now(),
  });
  for (const s of seeds) await tx.objectStore('observed').put(s);
  await tx.done;
  return { ok: true, backupId };
}
