/**
 * 3-way reconcile (순수 함수).  base = observed(마지막 합의), local = 브라우저 현재, remote = shadow(서버 확정).
 * 브라우저 API 나 DB 를 직접 만지지 않는다. 결과를 엔진이 journal/outbox 로 실행한다.
 */
import type { FolderOrder, NodeRecord } from 'shatsu-ren-protocol';
import { fitsLimits, isSyncableUrl } from 'shatsu-ren-protocol';
import type { LocalTree } from './browser';
import type {
  Binding,
  ConflictKind,
  ConflictRecord,
  ObservedNode,
  OutboxEntry,
  ReviewItem,
} from './types';

export interface ReconcileInput {
  binding: Binding;
  rootGlobalId: string;
  local: LocalTree;
  observed: Map<string, ObservedNode>; // localId →
  shadowNodes: Map<string, NodeRecord>; // globalId → (live + tombstone)
  shadowOrders: Map<string, FolderOrder>; // parent globalId →
  pendingOps: Map<string, OutboxEntry>; // targetId(globalId) → 미완료 op
  openConflicts: Set<string>; // globalId
  /** 로컬에서 사라졌지만 브라우저 다른 곳에 존재하는 localId (범위 밖 이동) */
  existsElsewhere: Set<string>;
  /** 다른 동기화 폴더에서 옮겨 와 아직 그쪽 기록이 남은 localId. 그쪽이 삭제를 보낼 때까지 보류 */
  foreignObserved?: Set<string>;
  approvedOutboundDeletes: Set<string>; // 사용자가 승인한 대량 삭제 globalId
  approvedInboundDeletes: Set<string>;
  openReviewKinds: Set<string>; // 이미 열린 review kind (중복 생성 방지)
  newId: () => string;
}

export type LocalAction =
  | {
      type: 'create';
      globalId: string;
      parentGlobalId: string;
      kind: 'folder' | 'bookmark';
      title: string;
      url: string | null;
      revision: number;
      depth: number;
    }
  | {
      type: 'update';
      globalId: string;
      localId: string;
      title?: string;
      url?: string;
      revision: number;
    }
  | { type: 'move'; globalId: string; localId: string; parentGlobalId: string; revision: number }
  | { type: 'remove'; globalId: string; localId: string; count: number }
  | {
      type: 'reorder';
      parentGlobalId: string;
      parentLocalId: string;
      orderedGlobalIds: string[];
      orderRevision: number;
    };

export type OpDraft =
  | {
      kind: 'create';
      globalId: string;
      localId: string;
      parentGlobalId: string;
      nodeKind: 'folder' | 'bookmark';
      title: string;
      url: string | null;
      afterGlobalId: string | null;
      depth: number;
    }
  | {
      kind: 'patch';
      globalId: string;
      localId: string;
      baseRevision: number;
      patch: { title?: string; url?: string };
      base: ObservedNode;
    }
  | {
      kind: 'move';
      globalId: string;
      localId: string;
      baseRevision: number;
      parentGlobalId: string;
      afterGlobalId: string | null;
      base: ObservedNode;
    }
  | {
      kind: 'reorder';
      parentGlobalId: string;
      parentLocalId: string;
      baseOrderRevision: number;
      orderedGlobalIds: string[];
    }
  | {
      kind: 'deleteSubtree';
      globalId: string;
      baseRevision: number;
      count: number;
      base: ObservedNode;
    };

export interface ConflictDraft {
  orders?: NonNullable<ConflictRecord['orders']>;
  globalId: string;
  localId: string | null;
  kind: ConflictKind;
  nodeKind: 'folder' | 'bookmark';
  base: { title: string; url: string | null; parentGlobalId: string | null; revision: number };
  local: { title: string; url: string | null; parentGlobalId: string | null } | null;
  remote: {
    title: string;
    url: string | null;
    parentGlobalId: string | null;
    revision: number;
    deleted: boolean;
  };
}

export interface ReviewDraft {
  kind: 'mass_delete_out' | 'mass_delete_in' | 'moved_out' | 'excluded_url';
  items: {
    globalId: string | null;
    localId: string | null;
    title: string;
    kind: string;
    url?: string | null;
  }[];
  scopeCount: number;
}

export interface ReconcileOutput {
  localActions: LocalAction[];
  ops: OpDraft[];
  conflicts: ConflictDraft[];
  reviews: ReviewDraft[];
  /** 브라우저/서버 변경 없이 base 만 갱신 (합의·제외 표시 등) */
  observedUpserts: ObservedNode[];
  observedDeletes: string[]; // localId
  stats: {
    localNew: number;
    remoteNew: number;
    excluded: number;
    matched: number;
    localDeletes: number;
    remoteDeletes: number;
    held: number;
  };
}

export function reconcile(inp: ReconcileInput): ReconcileOutput {
  const { local, observed, shadowNodes, shadowOrders, pendingOps, openConflicts } = inp;
  const out: ReconcileOutput = {
    localActions: [],
    ops: [],
    conflicts: [],
    reviews: [],
    observedUpserts: [],
    observedDeletes: [],
    stats: {
      localNew: 0,
      remoteNew: 0,
      excluded: 0,
      matched: 0,
      localDeletes: 0,
      remoteDeletes: 0,
      held: 0,
    },
  };
  const rootLocal = local.rootId;
  const collectionId = inp.binding.collectionId;
  const observedChildren = new Map<string, string[]>();
  const shadowChildren = new Map<string, string[]>();
  for (const n of shadowNodes.values()) {
    if (!n.parentId || n.deletedAt) continue;
    const children = shadowChildren.get(n.parentId) ?? [];
    children.push(n.id);
    shadowChildren.set(n.parentId, children);
  }
  for (const o of observed.values()) {
    if (!o.parentLocalId) continue;
    const children = observedChildren.get(o.parentLocalId) ?? [];
    children.push(o.localId);
    observedChildren.set(o.parentLocalId, children);
  }

  // globalId → localId (observed 기준)
  const g2l = new Map<string, string>();
  for (const o of observed.values()) if (o.globalId) g2l.set(o.globalId, o.localId);
  g2l.set(inp.rootGlobalId, rootLocal);

  // root observed 보장
  const rootObs = observed.get(rootLocal);
  if (!rootObs) {
    out.observedUpserts.push({
      localId: rootLocal,
      globalId: inp.rootGlobalId,
      collectionId,
      parentLocalId: null,
      kind: 'root',
      title: '',
      url: null,
      revision: 1,
      childOrder: [],
      orderRevision: -1,
    });
  }

  // 새로 발급된 globalId 를 이 실행 안에서 자식들이 참조할 수 있게
  const assigned = new Map<string, string>(); // localId → globalId (이번 실행 create)
  const hasOpenConflictAbove = (localId: string): boolean => {
    let cur: string | null | undefined = localId;
    for (let i = 0; i < 64 && cur && cur !== rootLocal; i++) {
      const o = observed.get(cur);
      if (o?.globalId && openConflicts.has(o.globalId)) return true;
      cur = local.nodes.get(cur)?.parentId ?? null;
    }
    return false;
  };
  const globalOf = (localId: string): string | null => {
    if (localId === rootLocal) return inp.rootGlobalId;
    return observed.get(localId)?.globalId ?? assigned.get(localId) ?? null;
  };
  const syncedGlobal = (localId: string): string | null => {
    if (localId === rootLocal) return inp.rootGlobalId;
    const o = observed.get(localId);
    if (!o?.globalId || o.revision === 0) return null;
    const s = shadowNodes.get(o.globalId);
    return s && !s.deletedAt ? o.globalId : null;
  };
  /** anchor: 바로 앞 형제 중 전역 ID 가 있는 것. 서버에 이미 있으면 같은 부모여야 하고, 이번 실행/대기 중 create 는 outbox 순서상 먼저 적용되므로 허용. */
  const prevSyncedSibling = (
    localId: string,
    parentLocalId: string,
    parentGlobal: string,
  ): string | null => {
    const sibs = local.children.get(parentLocalId) ?? [];
    const idx = sibs.indexOf(localId);
    for (let i = idx - 1; i >= 0; i--) {
      const sib = sibs[i]!;
      const g = globalOf(sib);
      if (!g) continue;
      const sh = shadowNodes.get(g);
      if (sh) {
        if (!sh.deletedAt && sh.parentId === parentGlobal) return g;
        continue;
      }
      const o = observed.get(sib);
      if (assigned.has(sib) || (o && o.revision === 0 && pendingOps.has(g))) return g;
    }
    return null;
  };

  // ---- 1. 로컬 항목 순회 (트리 순서: 부모 먼저)
  const walkOrder: string[] = [];
  const stack = [...(local.children.get(rootLocal) ?? [])].reverse();
  while (stack.length) {
    const id = stack.pop()!;
    if (local.nodes.get(id)?.unmodifiable) continue;
    walkOrder.push(id);
    const kids = local.children.get(id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  const depthOf = (localId: string) => {
    let d = 0;
    let cur = local.nodes.get(localId)?.parentId ?? null;
    while (cur && cur !== rootLocal) {
      d++;
      cur = local.nodes.get(cur)?.parentId ?? null;
    }
    return d;
  };
  const excludedReview: ReviewDraft['items'] = [];

  for (const localId of walkOrder) {
    const l = local.nodes.get(localId)!;
    let b = observed.get(localId);
    const syncable = l.kind === 'folder' || isSyncableUrl(l.url);
    // 한도 초과(아주 긴 제목·URL)는 서버가 거부하므로 보내지 않고 보류한다
    const fits = fitsLimits(l.title, l.url);
    const parentLocalId = l.parentId ?? rootLocal;

    if (
      !b ||
      (b.excluded && !b.globalId) ||
      (b.revision === 0 &&
        b.globalId &&
        !pendingOps.has(b.globalId) &&
        !shadowNodes.has(b.globalId))
    ) {
      if (!syncable) {
        out.stats.excluded++;
        if (!b)
          out.observedUpserts.push({
            localId,
            globalId: null,
            collectionId,
            parentLocalId,
            kind: l.kind,
            title: l.title,
            url: l.url,
            revision: 0,
            excluded: 'unsupported_url',
          });
        continue;
      }
      // 로컬 새 항목 → 서버 create (부모가 확정/발급된 경우만). 충돌 중인 폴더 아래는 보류.
      if (!fits || inp.foreignObserved?.has(localId) || hasOpenConflictAbove(localId)) {
        out.stats.held++;
        continue;
      }
      const parentGlobal = globalOf(parentLocalId);
      if (!parentGlobal) {
        out.stats.held++;
        continue;
      }
      if (
        parentLocalId !== rootLocal &&
        pendingOps.has(parentGlobal) &&
        !assigned.has(parentLocalId)
      ) {
        // 부모 create 가 아직 승인 대기 → 부모 승인 후 다음 실행에서
        out.stats.held++;
        continue;
      }
      const globalId = b?.globalId ?? inp.newId();
      assigned.set(localId, globalId);
      out.stats.localNew++;
      const afterGlobalId = prevSyncedSibling(localId, parentLocalId, parentGlobal);
      out.ops.push({
        kind: 'create',
        globalId,
        localId,
        parentGlobalId: parentGlobal,
        nodeKind: l.kind,
        title: l.title,
        url: l.kind === 'bookmark' ? l.url : null,
        afterGlobalId,
        depth: depthOf(localId),
      });
      out.observedUpserts.push({
        localId,
        globalId,
        collectionId,
        parentLocalId,
        kind: l.kind,
        title: l.title,
        url: l.kind === 'bookmark' ? l.url : null,
        revision: 0,
        ...(l.kind === 'folder' ? { childOrder: [], orderRevision: 0 } : {}),
      });
      continue;
    }
    if (!b.globalId) continue; // excluded 상태 유지 (위에서 처리)
    if (
      !fits ||
      pendingOps.has(b.globalId) ||
      openConflicts.has(b.globalId) ||
      hasOpenConflictAbove(localId)
    ) {
      out.stats.held++;
      continue;
    }
    if (b.revision === 0) {
      const remote = shadowNodes.get(b.globalId);
      if (remote && !remote.deletedAt) {
        const parentGlobal = b.parentLocalId ? globalOf(b.parentLocalId) : inp.rootGlobalId;
        if (remote.title !== b.title || remote.url !== b.url || remote.parentId !== parentGlobal) {
          out.conflicts.push({
            globalId: b.globalId,
            localId,
            kind: 'edit_edit',
            nodeKind: l.kind,
            base: baseOf(b, parentGlobal),
            local: { title: l.title, url: l.url, parentGlobalId: globalOf(parentLocalId) },
            remote: {
              title: remote.title,
              url: remote.url,
              parentGlobalId: remote.parentId,
              revision: remote.revision,
              deleted: false,
            },
          });
          continue;
        }
        b = { ...b, revision: remote.revision };
        out.observedUpserts.push(b);
      } else {
        out.stats.held++;
        continue;
      }
    } // create 승인 대기 (op 가 failed 로 정리되면 엔진이 unmap)

    if (!b.globalId) continue;
    const s = shadowNodes.get(b.globalId);
    const localParentGlobal = globalOf(parentLocalId);
    const titleChanged = l.title !== b.title;
    const urlChanged = l.kind === 'bookmark' && l.url !== b.url;
    const baseParentGlobal = b.parentLocalId ? globalOf(b.parentLocalId) : inp.rootGlobalId;
    const parentChanged = localParentGlobal !== baseParentGlobal;
    const localChanged = titleChanged || urlChanged || parentChanged;

    if (l.kind === 'bookmark' && !syncable) {
      // 알려진 항목이 지원 불가 URL 로 바뀜 → 검토, 원격 자동 삭제 없음
      excludedReview.push({
        globalId: b.globalId,
        localId,
        title: l.title,
        kind: l.kind,
        url: l.url,
      });
      out.stats.held++;
      continue;
    }

    const remoteState = !s
      ? 'missing'
      : s.deletedAt
        ? 'deleted'
        : s.revision !== b.revision
          ? 'changed'
          : 'same';
    if (remoteState === 'same') {
      out.stats.matched++;
      if (!localChanged) continue;
      if (parentChanged) {
        if (!localParentGlobal) {
          out.stats.held++;
          continue;
        }
        const afterGlobalId = prevSyncedSibling(localId, parentLocalId, localParentGlobal);
        out.ops.push({
          kind: 'move',
          globalId: b.globalId,
          localId,
          baseRevision: b.revision,
          parentGlobalId: localParentGlobal,
          afterGlobalId,
          base: b,
        });
      } else {
        const patch: { title?: string; url?: string } = {};
        if (titleChanged) patch.title = l.title;
        if (urlChanged && l.url) patch.url = l.url;
        out.ops.push({
          kind: 'patch',
          globalId: b.globalId,
          localId,
          baseRevision: b.revision,
          patch,
          base: b,
        });
      }
      continue;
    }
    if (remoteState === 'deleted' || remoteState === 'missing') {
      const subtreeHasLocalChanges = hasUnsentChanges(localId);
      if (localChanged || subtreeHasLocalChanges) {
        out.conflicts.push({
          globalId: b.globalId,
          localId,
          kind: 'local_edit_remote_delete',
          nodeKind: l.kind,
          base: baseOf(b, baseParentGlobal),
          local: { title: l.title, url: l.url, parentGlobalId: localParentGlobal },
          remote: {
            title: b.title,
            url: b.url,
            parentGlobalId: baseParentGlobal,
            revision: s?.revision ?? b.revision,
            deleted: true,
          },
        });
        continue;
      }
      out.stats.remoteDeletes++;
      out.localActions.push({
        type: 'remove',
        globalId: b.globalId,
        localId,
        count: subtreeSize(localId),
      });
      continue;
    }
    // remote changed
    const sParentGlobal = s!.parentId;
    const remoteVals = { title: s!.title, url: s!.url, parentGlobalId: sParentGlobal };
    if (!localChanged) {
      if (s!.title !== l.title || (l.kind === 'bookmark' && s!.url !== l.url)) {
        out.localActions.push({
          type: 'update',
          globalId: b.globalId,
          localId,
          ...(s!.title !== l.title ? { title: s!.title } : {}),
          ...(l.kind === 'bookmark' && s!.url && s!.url !== l.url ? { url: s!.url } : {}),
          revision: s!.revision,
        });
      }
      if (sParentGlobal && sParentGlobal !== localParentGlobal) {
        out.localActions.push({
          type: 'move',
          globalId: b.globalId,
          localId,
          parentGlobalId: sParentGlobal,
          revision: s!.revision,
        });
      }
      if (
        s!.title === l.title &&
        (l.kind !== 'bookmark' || s!.url === l.url) &&
        sParentGlobal === localParentGlobal
      ) {
        out.observedUpserts.push({ ...b, title: l.title, url: l.url, revision: s!.revision });
      }
      continue;
    }
    // 양쪽 변경
    if (
      remoteVals.title === l.title &&
      remoteVals.url === (l.kind === 'bookmark' ? l.url : null) &&
      remoteVals.parentGlobalId === localParentGlobal
    ) {
      out.observedUpserts.push({
        ...b,
        title: l.title,
        url: l.url,
        parentLocalId,
        revision: s!.revision,
      });
      continue;
    }
    const onlyMove =
      !titleChanged &&
      !urlChanged &&
      parentChanged &&
      remoteVals.title === b.title &&
      remoteVals.url === b.url;
    out.conflicts.push({
      globalId: b.globalId,
      localId,
      kind: onlyMove ? 'move_move' : 'edit_edit',
      nodeKind: l.kind,
      base: baseOf(b, baseParentGlobal),
      local: { title: l.title, url: l.url, parentGlobalId: localParentGlobal },
      remote: { ...remoteVals, revision: s!.revision, deleted: false },
    });
  }

  if (excludedReview.length && !inp.openReviewKinds.has('excluded_url'))
    out.reviews.push({ kind: 'excluded_url', items: excludedReview, scopeCount: observed.size });

  // ---- 2. 로컬에서 사라진 항목 (삭제 또는 범위 밖 이동)
  const removedTop: ObservedNode[] = [];
  const movedOut: ReviewDraft['items'] = [];
  for (const b of observed.values()) {
    if (b.kind === 'root' || local.nodes.has(b.localId)) continue;
    if (!b.globalId) {
      out.observedDeletes.push(b.localId);
      continue;
    } // 제외 항목이 사라짐
    if (b.revision === 0 && !pendingOps.has(b.globalId)) {
      out.observedDeletes.push(b.localId);
      continue;
    } // 미승인 생성 후 삭제
    if (pendingOps.has(b.globalId) || openConflicts.has(b.globalId)) {
      out.stats.held++;
      continue;
    }
    if (inp.existsElsewhere.has(b.localId)) {
      movedOut.push({
        globalId: b.globalId,
        localId: b.localId,
        title: b.title,
        kind: b.kind,
        url: b.url,
      });
      continue;
    }
    // 부모도 사라졌으면 최상위만 처리
    const parentGone =
      b.parentLocalId && b.parentLocalId !== rootLocal && !local.nodes.has(b.parentLocalId);
    if (parentGone) continue;
    removedTop.push(b);
  }
  if (movedOut.length && !inp.openReviewKinds.has('moved_out'))
    out.reviews.push({ kind: 'moved_out', items: movedOut, scopeCount: observed.size });
  else if (movedOut.length) out.stats.held += movedOut.length;

  const deleteDrafts: OpDraft[] = [];
  const deleteItems: ReviewDraft['items'] = [];
  for (const b of removedTop) {
    const s = shadowNodes.get(b.globalId!);
    if (!s || s.deletedAt) {
      // 양쪽 삭제 → base 정리
      for (const id of observedSubtree(b.localId)) out.observedDeletes.push(id);
      continue;
    }
    // 폴더 안에서 아직 못 본 원격 변경(수정·추가)이 있으면 조용히 지우지 않고 충돌로 묻는다
    const unseenInside = (id: string): boolean =>
      (shadowChildren.get(id) ?? []).some((c) => {
        const n = shadowNodes.get(c);
        if (!n || n.deletedAt) return false;
        const lid = g2l.get(c);
        const ob = lid ? observed.get(lid) : undefined;
        return !ob || ob.revision !== n.revision || unseenInside(c);
      });
    if (
      s.revision !== b.revision ||
      (b.kind === 'folder' && !b.forceDelete && unseenInside(b.globalId!))
    ) {
      out.conflicts.push({
        globalId: b.globalId!,
        localId: null,
        kind: 'local_delete_remote_edit',
        nodeKind: b.kind as 'folder' | 'bookmark',
        base: baseOf(b, b.parentLocalId ? globalOf(b.parentLocalId) : inp.rootGlobalId),
        local: null,
        remote: {
          title: s.title,
          url: s.url,
          parentGlobalId: s.parentId,
          revision: s.revision,
          deleted: false,
        },
      });
      continue;
    }
    const size = observedSubtree(b.localId).length;
    const descendants = new Set([b.globalId!]);
    for (const id of descendants)
      for (const child of shadowChildren.get(id) ?? []) descendants.add(child);
    for (const id of descendants) {
      const node = shadowNodes.get(id)!;
      deleteItems.push({
        globalId: id,
        localId: g2l.get(id) ?? null,
        title: node.title,
        kind: node.kind,
        url: node.url,
      });
    }
    deleteDrafts.push({
      kind: 'deleteSubtree',
      globalId: b.globalId!,
      baseRevision: b.revision,
      count: size,
      base: b,
    });
  }
  const mappedCount = [...observed.values()].filter((o) => o.globalId && o.kind !== 'root').length;
  const allApproved = deleteDrafts.every(
    (d) => d.kind === 'deleteSubtree' && inp.approvedOutboundDeletes.has(d.globalId),
  );
  // 삭제는 확인 없이 그대로 따라간다(사용자 결정 2026-10-01). 되돌리기는 서버 휴지통(30일)과 로컬 백업으로.
  void allApproved;
  out.ops.push(...deleteDrafts);
  out.stats.localDeletes += deleteDrafts.length;

  // ---- 3. 서버에만 있는 살아 있는 항목 → 로컬 생성 (부모 먼저)
  const remoteNew: NodeRecord[] = [];
  for (const s of shadowNodes.values()) {
    if (s.collectionId !== collectionId || s.deletedAt || s.kind === 'root') continue;
    if (g2l.has(s.id)) continue;
    remoteNew.push(s);
  }
  const remoteDepth = (n: NodeRecord): number => {
    let d = 0;
    let cur = n.parentId;
    while (cur && cur !== inp.rootGlobalId) {
      d++;
      cur = shadowNodes.get(cur)?.parentId ?? null;
      if (d > 64) break;
    }
    return d;
  };
  remoteNew.sort((a, b) => remoteDepth(a) - remoteDepth(b));
  const remoteNewIds = new Set(remoteNew.map((n) => n.id));
  const heldRemoteNew = new Set<string>();
  for (const s of remoteNew) {
    if (!s.parentId) continue;
    const parentLocalId = g2l.get(s.parentId);
    const parentConflict = openConflicts.has(s.parentId);
    if (
      parentConflict ||
      heldRemoteNew.has(s.parentId) ||
      (parentLocalId && !local.nodes.has(parentLocalId))
    ) {
      heldRemoteNew.add(s.id);
      out.stats.held++;
      continue;
    }
    const parentIsRemoteNew = remoteNewIds.has(s.parentId);
    if (!parentLocalId && !parentIsRemoteNew) {
      heldRemoteNew.add(s.id);
      out.stats.held++;
      continue;
    }
    out.stats.remoteNew++;
    out.localActions.push({
      type: 'create',
      globalId: s.id,
      parentGlobalId: s.parentId,
      kind: s.kind as 'folder' | 'bookmark',
      title: s.title,
      url: s.url,
      revision: s.revision,
      depth: remoteDepth(s),
    });
  }

  // 수신 대량 삭제 보호
  const removes = out.localActions.filter((a) => a.type === 'remove') as Extract<
    LocalAction,
    { type: 'remove' }
  >[];
  void removes; // 원격 삭제도 확인 없이 적용한다

  // ---- 4. 폴더 순서 (자식 집합이 양쪽 동일할 때만)
  const folders = [rootLocal, ...walkOrder.filter((id) => local.nodes.get(id)!.kind === 'folder')];
  for (const fLocal of folders) {
    const fGlobal = syncedGlobal(fLocal);
    if (!fGlobal) continue;
    if (openConflicts.has(fGlobal) || pendingOps.has(fGlobal)) continue;
    const b =
      fLocal === rootLocal
        ? (rootObs ?? out.observedUpserts.find((o) => o.localId === rootLocal))
        : observed.get(fLocal);
    const order = shadowOrders.get(fGlobal);
    if (!b || !order) continue;
    const localKids = local.children.get(fLocal) ?? [];
    const localG = localKids
      .map((k) => syncedGlobal(k))
      .filter((g): g is string => !!g && shadowNodes.get(g)?.parentId === fGlobal);
    const remoteLive = order.orderedChildIds.filter((g) => {
      const n = shadowNodes.get(g);
      return n && !n.deletedAt && n.parentId === fGlobal;
    });
    // 아직 로컬에 만들어지지 않은 원격 자식이 있으면 이번 실행에서는 순서를 판단하지 않는다 (다음 실행에서 처리)
    if (remoteLive.some((g) => !g2l.has(g))) continue;
    const remoteG = remoteLive;
    const localSet = new Set(localG);
    const remoteSet = new Set(remoteG);
    const sameSet = localG.length === remoteG.length && localG.every((g) => remoteSet.has(g));
    if (!sameSet) continue;
    const baseG = (b.childOrder ?? [])
      .map((k) => globalOf(k))
      .filter((g): g is string => !!g && localSet.has(g));
    const remoteChanged = order.revision !== (b.orderRevision ?? -1);
    const localChanged = !sameSeq(localG, baseG) && baseG.length === localG.length;
    if (localChanged && remoteChanged && !sameSeq(localG, remoteG)) {
      const folder = local.nodes.get(fLocal)!;
      const node = shadowNodes.get(fGlobal)!;
      out.conflicts.push({
        globalId: fGlobal,
        localId: fLocal,
        kind: 'order_order',
        nodeKind: 'folder',
        base: baseOf(b, node.parentId),
        local: { title: folder.title, url: null, parentGlobalId: node.parentId },
        remote: {
          title: node.title,
          url: null,
          parentGlobalId: node.parentId,
          revision: node.revision,
          deleted: false,
        },
        orders: { base: baseG, local: localG, remote: remoteG, remoteRevision: order.revision },
      });
      continue;
    }
    if (remoteChanged) {
      if (!sameSeq(localG, remoteG)) {
        out.localActions.push({
          type: 'reorder',
          parentGlobalId: fGlobal,
          parentLocalId: fLocal,
          orderedGlobalIds: remoteG,
          orderRevision: order.revision,
        });
      } else {
        out.observedUpserts.push({ ...b, childOrder: localKids, orderRevision: order.revision });
      }
    } else if (localChanged) {
      out.ops.push({
        kind: 'reorder',
        parentGlobalId: fGlobal,
        parentLocalId: fLocal,
        baseOrderRevision: order.revision,
        orderedGlobalIds: localG,
      });
    } else if (!sameSeq(localKids, b.childOrder ?? [])) {
      out.observedUpserts.push({ ...b, childOrder: localKids });
    }
  }

  return out;

  function hasUnsentChanges(localId: string): boolean {
    const kids = local.children.get(localId) ?? [];
    const base = observed.get(localId)?.childOrder;
    if (base && !sameSeq(kids, base)) return true;
    for (const k of kids) {
      const kb = observed.get(k);
      const kl = local.nodes.get(k)!;
      if (!kb || !kb.globalId || kb.revision === 0) {
        if (kl.kind === 'folder' || isSyncableUrl(kl.url)) return true;
      } else if (
        kl.title !== kb.title ||
        (kl.kind === 'bookmark' && kl.url !== kb.url) ||
        kl.parentId !== kb.parentLocalId ||
        pendingOps.has(kb.globalId)
      )
        return true;
      if (hasUnsentChanges(k)) return true;
    }
    return false;
  }
  function subtreeSize(localId: string): number {
    const kids = local.children.get(localId) ?? [];
    return 1 + kids.reduce((s, k) => s + subtreeSize(k), 0);
  }
  function observedSubtree(localId: string): string[] {
    const res = [localId];
    for (const id of observedChildren.get(localId) ?? []) res.push(...observedSubtree(id));
    return res;
  }
}

function baseOf(b: ObservedNode, parentGlobalId: string | null) {
  return { title: b.title, url: b.url, parentGlobalId, revision: b.revision };
}
function sameSeq(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function deletionFingerprint(
  items: ReviewItem['items'],
  local: LocalTree,
  nodes: Map<string, NodeRecord>,
  orders: Map<string, FolderOrder>,
): string {
  const localIds = new Set<string>();
  const remoteIds = new Set<string>();
  const remoteChildren = new Map<string, string[]>();
  for (const n of nodes.values())
    if (n.parentId) {
      const children = remoteChildren.get(n.parentId) ?? [];
      children.push(n.id);
      remoteChildren.set(n.parentId, children);
    }
  const collect = (id: string, ids: Set<string>, children: Map<string, string[]>) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const child of children.get(id) ?? []) collect(child, ids, children);
  };
  for (const item of items) {
    if (item.localId) collect(item.localId, localIds, local.children);
    if (item.globalId) collect(item.globalId, remoteIds, remoteChildren);
  }
  return JSON.stringify([
    [...localIds]
      .sort()
      .map((id) => [id, local.nodes.get(id) ?? null, local.children.get(id) ?? []]),
    [...remoteIds].sort().map((id) => [id, nodes.get(id) ?? null, orders.get(id) ?? null]),
  ]);
}
