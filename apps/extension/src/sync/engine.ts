/**
 * 동기화 실행기. worker 안에서 단일 queue 로 실행한다. 영속 상태는 IndexedDB(scope 별)에 있고
 * 메모리 상태는 진행 표시용일 뿐이다. worker 재기동 후에도 journal/outbox 에서 이어간다.
 */
import type {
  Commit,
  Envelope,
  FolderOrder,
  NodeRecord,
  Receipt,
  Snapshot,
} from 'shatsu-ren-protocol';
import { PROTOCOL_VERSION, subtreeDigestOf } from 'shatsu-ren-protocol';
import { getMeta, setMeta, StorageError, type Db } from '../storage/db';
import { api, getSubTree, type LocalTree } from './browser';
import { prepareContext, setAccount, type Ctx, type CtxResult } from './context';
import { deletionFingerprint, reconcile, type LocalAction, type OpDraft } from './reconcile';
import { DomainError, rpc, TransportError } from './rpc';
import type {
  Binding,
  ConflictRecord,
  JournalEntry,
  ObservedNode,
  OutboxEntry,
  ReviewItem,
} from './types';

export type RunReason =
  'startup' | 'event' | 'alarm' | 'realtime' | 'manual' | 'resume' | 'login' | 'merge';

export interface RunResult {
  reason: RunReason;
  startedAt: number;
  finishedAt: number;
  outcome: 'ok' | 'skipped' | 'auth_required' | 'offline' | 'blocked' | 'error';
  message?: string;
  code?: string;
  sent: number;
  applied: number;
  held: number;
}

export interface EngineHooks {
  onProgress?: (p: { phase: string; done?: number; total?: number }) => void;
  onRunFinished?: (r: RunResult) => void;
  /** 접근 토큰 갱신 시 (Realtime setAuth) */
  onToken?: (token: string) => void;
}

const BACKOFF_MIN = [1, 2, 5, 15];
export const RETRY_ALARM = 'shatsu-retry';

export class Engine {
  private chain: Promise<unknown> = Promise.resolve();
  private queued = false;
  running: { reason: RunReason; startedAt: number; phase: string } | null = null;
  epoch = 0;
  lastResult: RunResult | null = null;
  constructor(private hooks: EngineHooks = {}) {}

  /** 같은 프로필의 중복 실행 방지: 실행 중이면 한 번만 더 예약 */
  requestSync(reason: RunReason, opts: { force?: boolean } = {}): Promise<RunResult> {
    if (this.running && this.queued && !opts.force) return this.chain as Promise<RunResult>;
    this.queued = true;
    const epoch = this.epoch;
    const p = this.chain.then(async () => {
      this.queued = false;
      return this.runOnce(reason, opts, epoch);
    });
    this.chain = p.catch(() => undefined);
    return p;
  }

  bumpEpoch(): void {
    this.epoch++;
  }

  private async runOnce(
    reason: RunReason,
    opts: { force?: boolean },
    epoch: number,
  ): Promise<RunResult> {
    const startedAt = Date.now();
    this.running = { reason, startedAt, phase: 'prepare' };
    const done = (outcome: RunResult['outcome'], extra: Partial<RunResult> = {}): RunResult => {
      const r: RunResult = {
        reason,
        startedAt,
        finishedAt: Date.now(),
        outcome,
        sent: 0,
        applied: 0,
        held: 0,
        ...extra,
      };
      this.running = null;
      this.lastResult = r;
      this.hooks.onRunFinished?.(r);
      return r;
    };
    let ctxRes: CtxResult;
    try {
      ctxRes = await prepareContext();
    } catch (e) {
      return done('error', { message: String(e) });
    }
    if (!ctxRes.ok) {
      const map = {
        no_backend: 'blocked',
        auth_required: 'auth_required',
        device_revoked: 'blocked',
        offline: 'offline',
        blocked: 'blocked',
      } as const;
      return done(map[ctxRes.reason], {
        code: ctxRes.reason,
        ...(ctxRes.message ? { message: ctxRes.message } : {}),
      });
    }
    const { ctx } = ctxRes;
    this.hooks.onToken?.(ctx.accessToken);
    if (epoch !== this.epoch) return done('skipped', { message: 'epoch changed' });
    try {
      const r = await this.execute(ctx, reason, opts, epoch);
      return done(r.outcome, r);
    } catch (e) {
      if (
        e instanceof StorageError ||
        (e instanceof Error &&
          ['QuotaExceededError', 'InvalidStateError', 'UnknownError', 'AbortError'].includes(
            e.name,
          ))
      ) {
        await setMeta(ctx.db, 'lastError', {
          code: 'STORAGE_FAILED',
          message: e.message,
          at: Date.now(),
        }).catch(() => undefined);
        return done('blocked', { code: 'STORAGE_FAILED', message: e.message });
      }
      if (e instanceof TransportError) {
        await this.scheduleRetry(ctx.db, e);
        const outcome =
          e.kind === 'unauthorized'
            ? 'auth_required'
            : e.kind === 'offline' || e.kind === 'server' || e.kind === 'timeout'
              ? 'offline'
              : 'blocked';
        await setMeta(ctx.db, 'lastError', {
          code: e.kind,
          message: e.message,
          at: Date.now(),
          status: e.status,
        });
        return done(outcome, { code: e.kind, message: e.message });
      }
      if (e instanceof DomainError) {
        if (e.error.code === 'RATE_LIMITED') await this.scheduleRetry(ctx.db, e.error);
        // 서버에서 보관함·장치가 지워졌으면(초기화 등) 캐시된 등록을 버려 다음 실행에서 다시 등록한다
        if (e.error.code === 'DEVICE_NOT_REGISTERED') await setAccount(ctx.backend.url, null);
        await setMeta(ctx.db, 'lastError', { code: e.error.code, at: Date.now() });
        return done(
          e.error.code === 'DEVICE_REVOKED' || e.error.code === 'SESSION_INVALID'
            ? 'auth_required'
            : 'blocked',
          { code: e.error.code },
        );
      }
      await setMeta(ctx.db, 'lastError', {
        code: 'INTERNAL',
        message: String(e),
        at: Date.now(),
      }).catch(() => undefined);
      return done('error', { message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }

  private phase(p: string, extra: { done?: number; total?: number } = {}) {
    if (this.running) this.running.phase = p;
    this.hooks.onProgress?.({ phase: p, ...extra });
  }

  private async scheduleRetry(db: Db, e: { retryAfterSeconds?: number | undefined }) {
    const attempts = ((await getMeta<number>(db, 'retryAttempts')) ?? 0) + 1;
    const minutes = e.retryAfterSeconds
      ? e.retryAfterSeconds / 60
      : BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1]!;
    const jitter = 1 + (Math.random() - 0.5) * 0.4;
    const at = Date.now() + Math.max(minutes * 60_000 * jitter, (e.retryAfterSeconds ?? 0) * 1000);
    await setMeta(db, 'retryAttempts', attempts);
    await setMeta(db, 'nextRetryAt', at);
    await chrome.alarms.create(RETRY_ALARM, { when: at });
  }

  // -------------------------------------------------------------- 한 번의 동기화
  private async execute(
    ctx: Ctx,
    reason: RunReason,
    opts: { force?: boolean },
    epoch: number,
  ): Promise<Omit<RunResult, 'reason' | 'startedAt' | 'finishedAt'>> {
    const { db, client, account } = ctx;
    const settings = await (await import('./context')).getSettings();
    let bindings = await db.getAll('bindings');
    const activeBindings = bindings.filter((b) => b.status === 'active');
    const nextRetryAt = await getMeta<number>(db, 'nextRetryAt');
    const transferEnabled =
      !(nextRetryAt && nextRetryAt > Date.now() && !opts.force && reason !== 'manual') &&
      !(
        !settings.autoSync &&
        reason !== 'manual' &&
        reason !== 'merge' &&
        reason !== 'login' &&
        !opts.force
      );
    // 1. generation / 프로토콜
    const gen = (await getMeta<string>(db, 'generationId')) ?? null;
    if (gen && gen !== account.generationId) {
      // 서버 복원 감지: 쓰기 정지, 사용자 복구(스냅샷 재구성) 전까지 blocked
      await setMeta(db, 'blocked', { code: 'SERVER_GENERATION_CHANGED', at: Date.now() });
      return {
        outcome: 'blocked',
        code: 'SERVER_GENERATION_CHANGED',
        sent: 0,
        applied: 0,
        held: 0,
      };
    }
    if (!gen) await setMeta(db, 'generationId', account.generationId);
    let blocked = await getMeta<{ code: string; version?: string }>(db, 'blocked');
    // 예전 버전이 남긴 LIMIT 정지, 업데이트 전의 버전 불일치 정지는 풀어 준다
    if (
      blocked &&
      (blocked.code === 'LIMIT_EXCEEDED' ||
        (blocked.code === 'PROTOCOL_VERSION_MISMATCH' &&
          blocked.version !== chrome.runtime.getManifest().version))
    ) {
      await setMeta(db, 'blocked', null);
      blocked = undefined;
    }
    if (blocked && blocked.code !== 'STORAGE_FAILED')
      return { outcome: 'blocked', code: blocked.code, sent: 0, applied: 0, held: 0 };

    // 2. 미완료 journal 복구
    this.phase('journal');
    await this.recoverJournal(db, bindings);
    bindings = await db.getAll('bindings');
    const interrupted = await db.getAllFromIndex('outbox', 'byStatus', 'in_flight');
    const recovery = db.transaction('outbox', 'readwrite');
    for (const entry of interrupted) await recovery.store.put({ ...entry, status: 'pending' });
    await recovery.done;

    // 3. 서버 변경 수신 (changes → shadow). 오프라인이면 로컬 intent(outbox) 는 계속 기록하고 전송만 건너뛴다.
    this.phase('pull');
    let pulled = false;
    let offlineError: TransportError | DomainError | null = null;
    try {
      if (transferEnabled) pulled = await this.pull(ctx);
    } catch (e) {
      if (
        e instanceof TransportError &&
        (e.kind === 'offline' || e.kind === 'server' || e.kind === 'timeout')
      )
        offlineError = e;
      else if (e instanceof DomainError && e.error.code === 'RATE_LIMITED') offlineError = e;
      else throw e;
    }
    if (epoch !== this.epoch) return { outcome: 'skipped', sent: 0, applied: 0, held: 0 };

    // 4~8. binding 별 3-way
    let sent = 0,
      applied = 0,
      held = 0;
    const collections = new Map((await db.getAll('collections')).map((c) => [c.id, c]));
    let opIndex = 0;
    const runBase = Date.now();
    let pendingApply = 0;
    // 동기화 폴더 사이 이동 감지용: 연결된 로컬 루트 → collection
    const rootToCollection = new Map(
      bindings.filter((b) => b.status === 'active').map((b) => [b.localRootId, b.collectionId]),
    );
    const boundRootOf = async (localId: string): Promise<string | null> => {
      let cur: string | undefined = localId;
      for (let i = 0; cur && i < 64; i++) {
        if (rootToCollection.has(cur)) return rootToCollection.get(cur)!;
        cur = (await api.get(cur))?.parentId;
      }
      return null;
    };
    for (const binding of bindings) {
      if (binding.status === 'root_missing') {
        // 루트가 다시 보이면(브라우저 기동 직후 일시적 실패 등) 자동 재개. 사용자가 다시 선택할 때까지 삭제 전파는 없다.
        if (await getSubTree(binding.localRootId)) {
          await db.put('bindings', { ...binding, status: 'active' });
          binding.status = 'active';
        } else continue;
      }
      if (binding.status !== 'active') continue;
      const coll = collections.get(binding.collectionId);
      if (!coll) continue;
      this.phase('reconcile:' + binding.collectionId);
      let local = await getSubTree(binding.localRootId);
      if (!local) {
        await new Promise((r) => setTimeout(r, 750)); // 기동 직후 북마크 모델 로딩 지연 대비 1회 재시도
        local = await getSubTree(binding.localRootId);
      }
      if (!local) {
        await db.put('bindings', { ...binding, status: 'root_missing' });
        continue;
      }
      const observedAll = await db.getAllFromIndex(
        'observed',
        'byCollection',
        binding.collectionId,
      );
      const observed = new Map(observedAll.map((o) => [o.localId, o]));
      const shadowNodes = new Map(
        (await db.getAllFromIndex('shadow_nodes', 'byCollection', binding.collectionId)).map(
          (n) => [n.id, n],
        ),
      );
      const shadowOrders = new Map<string, FolderOrder>();
      for (const n of shadowNodes.values())
        if (n.kind !== 'bookmark') {
          const o = await db.get('shadow_orders', n.id);
          if (o) shadowOrders.set(n.id, o);
        }
      const pendingOps = new Map<string, OutboxEntry>();
      for (const o of await db.getAll('outbox'))
        if (
          o.collectionId === binding.collectionId &&
          (o.status === 'pending' || o.status === 'in_flight' || o.status === 'held')
        )
          pendingOps.set(o.targetId, o);
      const openConflicts = new Set(
        (await db.getAllFromIndex('conflicts', 'byStatus', 'open'))
          .filter((c) => c.collectionId === binding.collectionId)
          .map((c) => c.globalId),
      );
      // 예전 정책(삭제 확인)으로 열린 삭제 검토는 더 이상 필요 없으니 닫는다. 삭제는 이제 그대로 따라간다.
      for (const r of await db.getAllFromIndex('reviews', 'byStatus', 'open'))
        if (r.collectionId === binding.collectionId && r.kind.startsWith('mass_delete'))
          await db.put('reviews', {
            ...r,
            status: 'resolved',
            resolution: 'policy',
            resolvedAt: Date.now(),
          });
      const openReviews = (await db.getAllFromIndex('reviews', 'byStatus', 'open')).filter(
        (r) => r.collectionId === binding.collectionId,
      );
      const approvedOut = new Set<string>();
      const approvedIn = new Set<string>();
      for (const r of await db.getAll('reviews')) {
        if (r.collectionId !== binding.collectionId || r.status !== 'resolved') continue;
        if (
          !r.fingerprint ||
          r.fingerprint !== deletionFingerprint(r.items, local, shadowNodes, shadowOrders)
        )
          continue;
        if (r.kind === 'mass_delete_out' && r.resolution === 'approve')
          r.items.forEach((i) => i.globalId && approvedOut.add(i.globalId));
        if (r.kind === 'mass_delete_in' && r.resolution === 'approve')
          r.items.forEach((i) => i.globalId && approvedIn.add(i.globalId));
      }
      const existsElsewhere = new Set<string>();
      const ignoreElsewhere = new Set((await getMeta<string[]>(db, 'ignoreElsewhere')) ?? []);
      for (const o of observed.values())
        if (
          o.kind !== 'root' &&
          !local.nodes.has(o.localId) &&
          o.globalId &&
          !ignoreElsewhere.has(o.localId) &&
          (await api.get(o.localId)) &&
          // 다른 동기화 폴더로 옮긴 것은 여기서 삭제로 본다 (그쪽에서 새로 올라간다)
          !(await boundRootOf(o.localId))
        )
          existsElsewhere.add(o.localId);
      const foreignObserved = new Set<string>();
      for (const id of local.nodes.keys()) {
        if (observed.has(id) || id === binding.localRootId) continue;
        const other = await db.get('observed', id);
        if (other && other.collectionId !== binding.collectionId) foreignObserved.add(id);
      }

      const out = reconcile({
        binding,
        rootGlobalId: coll.rootNodeId,
        local,
        observed,
        shadowNodes,
        shadowOrders,
        pendingOps,
        openConflicts,
        existsElsewhere,
        foreignObserved,
        approvedOutboundDeletes: approvedOut,
        approvedInboundDeletes: approvedIn,
        openReviewKinds: new Set(openReviews.map((r) => r.kind)),
        newId: () => crypto.randomUUID(),
      });
      held += out.stats.held;

      // base 갱신 / 충돌 / 검토 기록 (브라우저 변경 전)
      const newOps: OutboxEntry[] = [];
      for (const d of out.ops) {
        const entry = await this.draftToEntry(
          db,
          binding,
          account.generationId,
          d,
          shadowNodes,
          shadowOrders,
        );
        if (entry) newOps.push({ ...entry, createdAt: runBase + opIndex++ * 0.001 });
      }
      const tx = db.transaction(['observed', 'conflicts', 'reviews', 'outbox'], 'readwrite');
      for (const entry of newOps) await tx.objectStore('outbox').put(entry);
      for (const id of out.observedDeletes) await tx.objectStore('observed').delete(id);
      for (const o of out.observedUpserts) await tx.objectStore('observed').put(o);
      for (const c of out.conflicts) {
        const id = crypto.randomUUID();
        if ((await tx.objectStore('conflicts').get(id))?.status !== 'open')
          await tx.objectStore('conflicts').put({
            id,
            collectionId: binding.collectionId,
            ...c,
            fingerprint: deletionFingerprint(
              [{ globalId: c.globalId, localId: c.localId, title: c.base.title, kind: c.nodeKind }],
              local,
              shadowNodes,
              shadowOrders,
            ),
            status: 'open',
            createdAt: Date.now(),
          });
      }
      for (const r of out.reviews)
        await tx.objectStore('reviews').put({
          id: crypto.randomUUID(),
          collectionId: binding.collectionId,
          status: 'open',
          createdAt: Date.now(),
          ...r,
          ...(r.kind.startsWith('mass_delete')
            ? { fingerprint: deletionFingerprint(r.items, local, shadowNodes, shadowOrders) }
            : {}),
        });
      await tx.done;
      if (out.reviews.some((r) => r.kind.startsWith('mass_delete')))
        await this.backup(db, binding, 'mass_change', local);

      // 원격 → 브라우저 적용 (journal)
      pendingApply += out.localActions.length;
      const ok = transferEnabled
        ? await this.applyLocal(
            ctx,
            binding,
            coll.rootNodeId,
            local,
            out.localActions,
            observed,
            epoch,
          )
        : 0;
      applied += ok;
      pendingApply -= ok;

      if (epoch !== this.epoch) return { outcome: 'skipped', sent, applied, held };
    }
    if (!transferEnabled)
      return { outcome: 'skipped', message: 'autoSync off', sent, applied, held };

    if (offlineError) throw offlineError; // outbox 는 기록됐고 retry alarm 이 잡힌다
    // 6~7. outbox 제출 (생성 순서, 묶음 100)
    this.phase('push');
    const result = await this.push(ctx, epoch);
    sent += result.sent;
    if (result.sent > 0) pulled = (await this.pull(ctx)) || pulled; // 자기 commit 반영(echo → base 일치)
    await setMeta(db, 'pendingApplyCount', pendingApply);
    await setMeta(db, 'lastServerCheckAt', Date.now());
    await setMeta(db, 'retryAttempts', 0);
    await setMeta(db, 'nextRetryAt', null);
    await setMeta(db, 'lastError', null);
    // 9. 남은 유효 작업이 있으면 한 번 더 (한도 2)
    const pendingLeft = (await db.getAllFromIndex('outbox', 'byStatus', 'pending')).length;
    const loops = (await getMeta<number>(db, 'loopCount')) ?? 0;
    if (
      (pendingLeft > 0 || pulled || result.sent > 0 || applied > 0) &&
      loops < 2 &&
      activeBindings.length
    ) {
      await setMeta(db, 'loopCount', loops + 1);
      const again = await this.execute(ctx, reason, opts, epoch);
      await setMeta(db, 'loopCount', 0);
      return {
        ...again,
        sent: sent + again.sent,
        applied: applied + again.applied,
        held: again.held,
      };
    }
    await setMeta(db, 'loopCount', 0);
    const cleanup = db.transaction(['outbox', 'journal', 'conflicts', 'reviews'], 'readwrite');
    const completedOps = (
      await cleanup.objectStore('outbox').index('byStatus').getAll('done')
    ).sort((a, b) => b.createdAt - a.createdAt);
    const completedJournal = (await cleanup.objectStore('journal').index('byStatus').getAll('done'))
      .filter((j) => j.collectionId)
      .sort((a, b) => b.startedAt - a.startedAt);
    const resolvedConflicts = (
      await cleanup.objectStore('conflicts').index('byStatus').getAll('resolved')
    ).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    const resolvedReviews = (
      await cleanup.objectStore('reviews').index('byStatus').getAll('resolved')
    ).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    for (const op of completedOps.slice(500)) await cleanup.objectStore('outbox').delete(op.opId);
    for (const journal of completedJournal.slice(500))
      await cleanup.objectStore('journal').delete(journal.id);
    for (const conflict of resolvedConflicts.slice(500))
      await cleanup.objectStore('conflicts').delete(conflict.id);
    for (const review of resolvedReviews.slice(500))
      await cleanup.objectStore('reviews').delete(review.id);
    await cleanup.done;
    return { outcome: 'ok', sent, applied, held };
  }

  // -------------------------------------------------------------- pull
  /** changes 를 모두 받아 shadow/inbox 갱신. 반환: 새 commit 이 있었는지 */
  async pull(ctx: Ctx): Promise<boolean> {
    const { db, client, account } = ctx;
    let cursor = (await getMeta<number>(db, 'receivedSeq')) ?? -1;
    if (cursor < 0) {
      await this.rebuildFromSnapshot(ctx);
      return true;
    }
    let got = false;
    for (let page = 0; page < 50; page++) {
      let res;
      try {
        res = await rpc.changes(client, cursor);
      } catch (e) {
        if (e instanceof DomainError && e.error.code === 'CURSOR_EXPIRED') {
          await this.rebuildFromSnapshot(ctx);
          return true;
        }
        throw e;
      }
      if (res.generationId !== account.generationId) {
        await setMeta(db, 'blocked', { code: 'SERVER_GENERATION_CHANGED', at: Date.now() });
        throw new DomainError({ code: 'SERVER_GENERATION_CHANGED' });
      }
      if (res.commits.length) {
        await this.ingestCommits(db, res.commits);
        got = true;
      }
      cursor = res.nextCursor;
      await setMeta(db, 'receivedSeq', cursor);
      await setMeta(db, 'headSeq', res.headSeq);
      if (!res.hasMore) break;
    }
    return got;
  }

  private async ingestCommits(db: Db, commits: Commit[]) {
    const tx = db.transaction(
      ['shadow_nodes', 'shadow_orders', 'collections', 'inbox'],
      'readwrite',
    );
    const renamed: { id: string; from: string; to: string }[] = [];
    const deleted: string[] = [];
    for (const c of commits) {
      if (c.payload.deletedCollectionId) deleted.push(c.payload.deletedCollectionId);
      for (const col of c.payload.collections ?? []) {
        const prev = await tx.objectStore('collections').get(col.id);
        if (prev && prev.title !== col.title)
          renamed.push({ id: col.id, from: prev.title, to: col.title });
        await tx.objectStore('collections').put(col);
      }
      for (const n of c.payload.nodes) await tx.objectStore('shadow_nodes').put(n);
      for (const o of c.payload.orders) await tx.objectStore('shadow_orders').put(o);
      await tx.objectStore('inbox').put({ seq: c.seq, commit: c, receivedAt: Date.now() });
    }
    await tx.done;
    for (const id of deleted) await this.dropCollection(db, id);
    // 서버 북마크 이름이 바뀌면, 연결된 로컬 폴더도 예전 이름 그대로일 때만 따라 바꾼다
    for (const r of renamed) {
      const b = await db.get('bindings', r.id);
      if (!b) continue;
      const [root] = await chrome.bookmarks.get(b.localRootId).catch(() => []);
      if (root && root.title === r.from) await api.update(b.localRootId, { title: r.to });
    }
    // inbox 는 최근 500개만 보관 (변경 내역 UI 용)
    const keys = await db.getAllKeys('inbox');
    if (keys.length > 500) {
      const txd = db.transaction('inbox', 'readwrite');
      for (const k of keys.slice(0, keys.length - 500)) await txd.store.delete(k);
      await txd.done;
    }
  }

  /** snapshot 으로 shadow 재구성. outbox·observed(intent/base)·충돌은 보존한다. */
  async rebuildFromSnapshot(ctx: Ctx): Promise<Snapshot> {
    const { db, client, account } = ctx;
    this.phase('snapshot');
    const snap = await rpc.snapshot(client);
    if (snap.generationId !== account.generationId) {
      await setMeta(db, 'blocked', { code: 'SERVER_GENERATION_CHANGED', at: Date.now() });
      throw new DomainError({ code: 'SERVER_GENERATION_CHANGED' });
    }
    const tx = db.transaction(
      ['shadow_nodes', 'shadow_orders', 'collections', 'meta'],
      'readwrite',
    );
    await tx.objectStore('shadow_nodes').clear();
    await tx.objectStore('shadow_orders').clear();
    await tx.objectStore('collections').clear();
    for (const c of snap.collections) await tx.objectStore('collections').put(c);
    for (const n of snap.nodes) await tx.objectStore('shadow_nodes').put(n);
    for (const o of snap.orders) await tx.objectStore('shadow_orders').put(o);
    await tx.objectStore('meta').put({ key: 'receivedSeq', value: snap.headSeq });
    await tx.objectStore('meta').put({ key: 'headSeq', value: snap.headSeq });
    await tx.objectStore('meta').put({ key: 'snapshotAt', value: Date.now() });
    await tx.done;
    const alive = new Set(snap.collections.map((c) => c.id));
    for (const b of await db.getAll('bindings'))
      if (!alive.has(b.collectionId)) await this.dropBinding(db, b.collectionId, 'discard');
    return snap;
  }

  // -------------------------------------------------------------- apply (remote → browser)
  private async applyLocal(
    ctx: Ctx,
    binding: Binding,
    rootGlobalId: string,
    local: LocalTree,
    actions: LocalAction[],
    observed: Map<string, ObservedNode>,
    epoch = this.epoch,
  ): Promise<number> {
    const { db } = ctx;
    const g2l = new Map<string, string>();
    for (const o of observed.values()) if (o.globalId) g2l.set(o.globalId, o.localId);
    g2l.set(rootGlobalId, binding.localRootId);
    const order = { create: 0, move: 1, update: 2, reorder: 3, remove: 4 } as const;
    const sorted = [...actions].sort(
      (a, b) =>
        order[a.type] - order[b.type] ||
        (a.type === 'create' && b.type === 'create' ? a.depth - b.depth : 0),
    );
    let count = 0;
    let idx = 0;
    let backedUp = false;
    // 적용 도중 사용자가 같은 항목을 고쳤으면 덮어쓰지 않는다 (다음 실행에서 3-way 로 다시 판단)
    const changedSince = async (localId: string, fields: ('title' | 'url' | 'parentId')[]) => {
      const was = local.nodes.get(localId);
      const now = await api.get(localId);
      if (!was || !now) return true;
      return fields.some((f) => (was[f] ?? null) !== (now[f] ?? null));
    };
    for (const a of sorted) {
      if (epoch !== this.epoch) break;
      this.phase('apply', { done: idx++, total: sorted.length });
      const jid = crypto.randomUUID();
      const journal = async (e: Partial<JournalEntry>) =>
        db.put('journal', {
          id: jid,
          collectionId: binding.collectionId,
          action: a.type,
          status: 'started',
          startedAt: Date.now(),
          ...e,
        } as JournalEntry);
      const finish = async (e: Partial<JournalEntry> = {}, observedNode?: ObservedNode) => {
        const tx = db.transaction(['journal', 'observed'], 'readwrite');
        if (observedNode) await tx.objectStore('observed').put(observedNode);
        await tx
          .objectStore('journal')
          .put({ ...(await tx.objectStore('journal').get(jid))!, status: 'done', ...e });
        await tx.done;
      };
      try {
        if (a.type === 'create') {
          const parentLocalId = g2l.get(a.parentGlobalId);
          if (!parentLocalId) continue;
          await journal({
            globalId: a.globalId,
            parentLocalId,
            expected: { title: a.title, url: a.url, kind: a.kind },
          });
          if (epoch !== this.epoch) break;
          const created = await api.create({
            parentId: parentLocalId,
            title: a.title,
            ...(a.kind === 'bookmark' && a.url ? { url: a.url } : {}),
          });
          g2l.set(a.globalId, created.id);
          await finish(
            { resultLocalId: created.id },
            {
              localId: created.id,
              globalId: a.globalId,
              collectionId: binding.collectionId,
              parentLocalId,
              kind: a.kind,
              title: a.title,
              url: a.kind === 'bookmark' ? a.url : null,
              revision: a.revision,
              ...(a.kind === 'folder' ? { childOrder: [], orderRevision: -1 } : {}),
            },
          );
          local.nodes.set(created.id, {
            id: created.id,
            parentId: parentLocalId,
            index: created.index ?? 0,
            kind: a.kind,
            title: a.title,
            url: a.url,
            unmodifiable: false,
          });
          local.children.set(parentLocalId, [
            ...(local.children.get(parentLocalId) ?? []),
            created.id,
          ]);
          if (a.kind === 'folder') local.children.set(created.id, []);
        } else if (a.type === 'update') {
          await journal({
            globalId: a.globalId,
            localId: a.localId,
            expected: {
              ...(a.title !== undefined ? { title: a.title } : {}),
              ...(a.url !== undefined ? { url: a.url } : {}),
            },
          });
          const changes: { title?: string; url?: string } = {};
          if (a.title !== undefined) changes.title = a.title;
          if (a.url !== undefined) changes.url = a.url;
          if (epoch !== this.epoch) break;
          if (await changedSince(a.localId, ['title', 'url'])) {
            await finish({ status: 'failed', error: 'changed locally' });
            continue;
          }
          const r = await api.update(a.localId, changes);
          const o = observed.get(a.localId);
          await finish(
            {},
            o
              ? {
                  ...o,
                  title: r.title,
                  url: r.url ?? null,
                  revision: a.revision,
                }
              : undefined,
          );
        } else if (a.type === 'move') {
          const parentLocalId = g2l.get(a.parentGlobalId);
          if (!parentLocalId) continue;
          await journal({ globalId: a.globalId, localId: a.localId, parentLocalId });
          if (epoch !== this.epoch) break;
          if (await changedSince(a.localId, ['parentId'])) {
            await finish({ status: 'failed', error: 'changed locally' });
            continue;
          }
          await api.move(a.localId, { parentId: parentLocalId });
          const o = observed.get(a.localId);
          await finish({}, o ? { ...o, parentLocalId, revision: a.revision } : undefined);
        } else if (a.type === 'reorder') {
          await journal({ globalId: a.parentGlobalId, localId: a.parentLocalId });
          const current = await api.getChildren(a.parentLocalId);
          const currentIds = new Set(current.map((c) => c.id));
          const byGlobal = a.orderedGlobalIds
            .map((g) => g2l.get(g))
            .filter((x): x is string => !!x && currentIds.has(x));
          const orderedIds = new Set(byGlobal);
          const rest = current.map((c) => c.id).filter((id) => !orderedIds.has(id));
          const target = [...byGlobal, ...rest];
          const cur = current.map((c) => c.id);
          for (let i = 0; i < target.length; i++) {
            if (epoch !== this.epoch) return count;
            if (cur[i] !== target[i]) {
              await api.move(target[i]!, { parentId: a.parentLocalId, index: i });
              cur.splice(cur.indexOf(target[i]!), 1);
              cur.splice(i, 0, target[i]!);
            }
          }
          await finish();
          const o =
            a.parentLocalId === binding.localRootId
              ? await db.get('observed', binding.localRootId)
              : observed.get(a.parentLocalId);
          if (o)
            await db.put('observed', { ...o, childOrder: target, orderRevision: a.orderRevision });
        } else if (a.type === 'remove') {
          await journal({ globalId: a.globalId, localId: a.localId });
          if (!backedUp) {
            await this.backup(db, binding, 'mass_change');
            backedUp = true;
          }
          // 삭제 직전 로컬 자식 재확인 (서버가 모르는 항목이 있으면 보류)
          const fresh = await getSubTree(a.localId);
          const expectedIds = new Set<string>();
          const collect = (id: string) => {
            expectedIds.add(id);
            for (const child of local.children.get(id) ?? []) collect(child);
          };
          collect(a.localId);
          const unknown =
            fresh &&
            (fresh.nodes.size !== expectedIds.size ||
              [...fresh.nodes.values()].some((n) => {
                const old = local.nodes.get(n.id);
                return (
                  !expectedIds.has(n.id) ||
                  !old ||
                  old.title !== n.title ||
                  old.url !== n.url ||
                  (n.id !== a.localId && old.parentId !== n.parentId) ||
                  JSON.stringify(local.children.get(n.id) ?? []) !==
                    JSON.stringify(fresh.children.get(n.id) ?? [])
                );
              }));
          if (unknown) {
            await finish({ status: 'failed', error: 'unsent children' });
            continue;
          }
          const node = fresh?.nodes.get(a.localId);
          if (epoch !== this.epoch) break;
          if (node) {
            if (node.url) await api.remove(a.localId);
            else await api.removeTree(a.localId);
          }
          await finish();
          const ids = [a.localId];
          for (let i = 0; i < ids.length; i++)
            for (const o of observed.values()) if (o.parentLocalId === ids[i]) ids.push(o.localId);
          const tx = db.transaction('observed', 'readwrite');
          for (const id of ids) await tx.store.delete(id);
          await tx.done;
          for (const id of ids) local.nodes.delete(id);
        }
        count++;
      } catch (e) {
        if (
          e instanceof StorageError ||
          (e instanceof Error &&
            ['QuotaExceededError', 'AbortError', 'UnknownError', 'InvalidStateError'].includes(
              e.name,
            ))
        )
          throw e;
        await db.put('journal', {
          ...(await db.get('journal', jid))!,
          status: 'failed',
          error: String(e),
        });
        if (a.type === 'create') {
          // 생성 실패 결과가 불확실하면 자동 재생성 대신 복구 필요
          await this.markRecovery(db, binding, jid, String(e));
          break;
        }
      }
    }
    // 전역 root 의 base 순서 갱신
    return count;
  }

  private async markRecovery(db: Db, binding: Binding, journalId: string, reason: string) {
    await db.put('bindings', {
      ...(await db.get('bindings', binding.collectionId))!,
      status: 'recovery_required',
      recovery: { journalId, reason },
    });
  }

  /** worker 재기동 후: 'started' 로 남은 journal 처리. create 는 결과를 확인할 수 없으면 복구 필요. */
  private async recoverJournal(db: Db, bindings: Binding[]) {
    for (const j of await db.getAllFromIndex('journal', 'byStatus', 'done')) {
      if (
        j.action !== 'create' ||
        !j.resultLocalId ||
        !j.globalId ||
        (await db.getFromIndex('observed', 'byGlobal', j.globalId))
      )
        continue;
      const node = await api.get(j.resultLocalId);
      const shadow = await db.get('shadow_nodes', j.globalId);
      if (
        node &&
        shadow &&
        !shadow.deletedAt &&
        node.parentId === j.parentLocalId &&
        node.title === j.expected?.title &&
        (node.url ?? null) === (j.expected?.url ?? null)
      ) {
        await db.put('observed', {
          localId: node.id,
          globalId: shadow.id,
          collectionId: j.collectionId,
          parentLocalId: node.parentId ?? null,
          kind: node.url ? 'bookmark' : 'folder',
          title: node.title,
          url: node.url ?? null,
          revision: shadow.revision,
          ...(node.url ? {} : { childOrder: [], orderRevision: -1 }),
        });
      }
    }
    const started = await db.getAllFromIndex('journal', 'byStatus', 'started');
    for (const j of started) {
      if (!j.collectionId || !j.globalId) continue;
      const binding = bindings.find((b) => b.collectionId === j.collectionId);
      if (j.action === 'create' && j.parentLocalId && j.globalId) {
        const already = await db.getFromIndex('observed', 'byGlobal', j.globalId);
        if (already) {
          await db.put('journal', { ...j, status: 'done' });
          continue;
        }
        const kids = await api.getChildren(j.parentLocalId);
        const observedIds = new Set(
          (await db.getAllFromIndex('observed', 'byCollection', j.collectionId)).map(
            (o) => o.localId,
          ),
        );
        const candidates = kids.filter(
          (k) =>
            !observedIds.has(k.id) &&
            k.title === j.expected?.title &&
            (k.url ?? null) === (j.expected?.url ?? null),
        );
        if (candidates.length === 0) {
          await db.put('journal', { ...j, status: 'failed', error: 'not created' });
          continue;
        }
        // 후보가 있어도 자동 mapping 하지 않는다 (D01)
        if (binding) {
          await this.markRecovery(db, binding, j.id, 'uncertain create');
          await db.put('reviews', {
            id: crypto.randomUUID(),
            kind: 'create_recovery',
            collectionId: j.collectionId,
            status: 'open',
            createdAt: Date.now(),
            journalId: j.id,
            items: [
              {
                globalId: j.globalId,
                localId: null,
                title: j.expected?.title ?? '',
                kind: j.expected?.kind ?? 'bookmark',
              },
            ],
            candidates: candidates.map((c) => ({
              localId: c.id,
              title: c.title,
              url: c.url ?? null,
            })),
          });
        }
        await db.put('journal', { ...j, status: 'failed', error: 'uncertain' });
        continue;
      }
      // update/move/remove/reorder: 실제 상태는 다음 3-way 비교가 판단한다
      await db.put('journal', {
        ...j,
        status: 'failed',
        error: 'interrupted; re-evaluated by reconcile',
      });
    }
  }

  // -------------------------------------------------------------- outbox
  private async draftToEntry(
    db: Db,
    binding: Binding,
    generationId: string,
    d: OpDraft,
    shadowNodes: Map<string, NodeRecord>,
    shadowOrders: Map<string, FolderOrder>,
  ): Promise<OutboxEntry | null> {
    const opId = crypto.randomUUID();
    const collectionId = binding.collectionId;
    const base = { opId, collectionId };
    let env: Envelope['op'];
    let targetId: string;
    let context: OutboxEntry['context'] | undefined;
    switch (d.kind) {
      case 'create':
        env = {
          kind: 'create',
          ...base,
          nodeId: d.globalId,
          nodeKind: d.nodeKind,
          parentId: d.parentGlobalId,
          title: d.title,
          url: d.url,
          afterId: d.afterGlobalId,
        };
        targetId = d.globalId;
        context = { localId: d.localId };
        break;
      case 'patch':
        env = {
          kind: 'patch',
          ...base,
          nodeId: d.globalId,
          baseRevision: d.baseRevision,
          patch: d.patch,
        };
        targetId = d.globalId;
        context = { localId: d.localId, base: d.base, proposed: d.patch };
        break;
      case 'move':
        env = {
          kind: 'move',
          ...base,
          nodeId: d.globalId,
          baseRevision: d.baseRevision,
          parentId: d.parentGlobalId,
          afterId: d.afterGlobalId,
        };
        targetId = d.globalId;
        context = { localId: d.localId, base: d.base };
        break;
      case 'reorder':
        env = {
          kind: 'reorder',
          ...base,
          parentId: d.parentGlobalId,
          baseOrderRevision: d.baseOrderRevision,
          orderedChildIds: d.orderedGlobalIds,
        };
        targetId = d.parentGlobalId;
        context = { localId: d.parentLocalId };
        break;
      case 'deleteSubtree': {
        const live = [...shadowNodes.values()].filter((n) => !n.deletedAt);
        const digest = await subtreeDigestOf(d.globalId, live, shadowOrders.values());
        env = {
          kind: 'deleteSubtree',
          ...base,
          nodeId: d.globalId,
          baseRevision: d.baseRevision,
          expectedSubtreeDigest: digest,
        };
        targetId = d.globalId;
        context = { base: d.base };
        break;
      }
    }
    return {
      opId,
      env: { protocolVersion: PROTOCOL_VERSION, generationId, op: env },
      targetId,
      collectionId,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0,
      ...(context ? { context } : {}),
    };
  }

  private async push(ctx: Ctx, epoch: number): Promise<{ sent: number }> {
    const { db, client, account } = ctx;
    const activeCollections = new Set(
      (await db.getAll('bindings')).filter((b) => b.status === 'active').map((b) => b.collectionId),
    );
    const pending = (await db.getAllFromIndex('outbox', 'byStatus', 'pending'))
      .filter((o) => activeCollections.has(o.collectionId))
      .sort((a, b) => a.createdAt - b.createdAt);
    let sent = 0;
    for (let i = 0; i < pending.length; i += 100) {
      if (epoch !== this.epoch) break;
      const batch = pending.slice(i, i + 100);
      const tx = db.transaction('outbox', 'readwrite');
      for (const o of batch)
        await tx.store.put({ ...o, status: 'in_flight', attempts: o.attempts + 1 });
      await tx.done;
      let res;
      try {
        res =
          batch.length === 1
            ? await rpc.applyOne(client, batch[0]!.env).then((r) => ({
                receipts: [r.receipt],
                headSeq: r.headSeq,
                generationId: r.generationId,
              }))
            : await rpc.applyMany(
                client,
                batch.map((b) => b.env),
              );
      } catch (e) {
        const tx2 = db.transaction('outbox', 'readwrite');
        for (const o of batch)
          await tx2.store.put({
            ...o,
            status: 'pending',
            attempts: o.attempts + 1,
            lastError: e instanceof Error ? e.message : String(e),
          });
        await tx2.done;
        throw e;
      }
      if (epoch !== this.epoch) return { sent };
      if (res.generationId !== account.generationId) {
        await setMeta(db, 'blocked', { code: 'SERVER_GENERATION_CHANGED', at: Date.now() });
        throw new DomainError({ code: 'SERVER_GENERATION_CHANGED' });
      }
      for (let k = 0; k < batch.length; k++) {
        const entry = batch[k]!;
        const receipt = res.receipts[k];
        if (!receipt) continue;
        await this.applyReceipt(db, entry, receipt);
        if (receipt.status === 'applied' || receipt.status === 'noop') sent++;
      }
      this.phase('push', { done: Math.min(i + 100, pending.length), total: pending.length });
    }
    return { sent };
  }

  private async applyReceipt(db: Db, entry: OutboxEntry, receipt: Receipt) {
    const op = entry.env.op;
    if (receipt.status === 'applied' || receipt.status === 'noop') {
      // base 갱신: 제안값 + 서버 revision
      if (op.kind === 'create' || op.kind === 'patch' || op.kind === 'move') {
        const o = await db.getFromIndex('observed', 'byGlobal', op.nodeId);
        if (o) {
          const next: ObservedNode = { ...o, revision: receipt.revision ?? o.revision };
          if (op.kind === 'patch') {
            if (op.patch.title !== undefined) next.title = op.patch.title;
            if (op.patch.url !== undefined) next.url = op.patch.url;
          }
          if (op.kind === 'move') {
            const p = await db.getFromIndex('observed', 'byGlobal', op.parentId);
            next.parentLocalId = p?.localId ?? o.parentLocalId;
          }
          if (op.kind === 'create' && receipt.status === 'applied')
            next.revision = receipt.revision ?? 1;
          await db.put('observed', next);
        }
      } else if (op.kind === 'reorder') {
        const o = await db.getFromIndex('observed', 'byGlobal', op.parentId);
        if (o && receipt.orderRevision !== undefined) {
          const mapping = new Map(
            (await db.getAllFromIndex('observed', 'byCollection', entry.collectionId)).flatMap(
              (node) => (node.globalId ? [[node.globalId, node.localId] as const] : []),
            ),
          );
          await db.put('observed', {
            ...o,
            childOrder: op.orderedChildIds.flatMap((id) =>
              mapping.has(id) ? [mapping.get(id)!] : [],
            ),
            orderRevision: receipt.orderRevision,
          });
        }
      } else if (op.kind === 'deleteSubtree') {
        const o = await db.getFromIndex('observed', 'byGlobal', op.nodeId);
        if (o) {
          const ids = [o.localId];
          const all = await db.getAllFromIndex('observed', 'byCollection', entry.collectionId);
          for (let i = 0; i < ids.length; i++)
            for (const x of all) if (x.parentLocalId === ids[i]) ids.push(x.localId);
          const tx = db.transaction('observed', 'readwrite');
          for (const id of ids) await tx.store.delete(id);
          await tx.done;
        }
      }
      await db.put('outbox', { ...entry, status: 'done', receipt });
      return;
    }
    if (receipt.status === 'not_attempted') {
      await db.put('outbox', { ...entry, status: 'pending' });
      return;
    }
    // conflict / rejected: terminal. 다음 3-way 가 shadow 와 비교해 충돌 레코드를 만든다.
    await db.put('outbox', {
      ...entry,
      status: 'failed',
      receipt,
      lastError: receipt.code ?? receipt.status,
    });
    if (
      receipt.code === 'SERVER_GENERATION_CHANGED' ||
      receipt.code === 'PROTOCOL_VERSION_MISMATCH'
    ) {
      // 버전 불일치는 확장을 업데이트하면 풀린다 (version 이 바뀌면 해제)
      await setMeta(db, 'blocked', {
        code: receipt.code,
        at: Date.now(),
        version: chrome.runtime.getManifest().version,
      });
    } else if (receipt.code === 'LIMIT_EXCEEDED' || receipt.code === 'RATE_LIMITED') {
      // 영구 정지하지 않는다: 해당 항목만 실패, 나머지는 계속 동기화
      await setMeta(db, 'lastError', { code: receipt.code, at: Date.now() });
    } else if (op.kind === 'create') {
      // 생성 거부 → 미승인 mapping 해제(다시 로컬 새 항목으로 취급, 부모 충돌이 먼저 처리됨)
      const o = await db.getFromIndex('observed', 'byGlobal', op.nodeId);
      if (o && o.revision === 0) await db.delete('observed', o.localId);
    }
  }

  /** 서버에서 지워진 서버 북마크: shadow 를 비우고 연결만 끊는다. 로컬 폴더는 그대로 둔다. */
  private async dropCollection(db: Db, collectionId: string) {
    const tx = db.transaction(['shadow_nodes', 'shadow_orders', 'collections'], 'readwrite');
    for (const n of await tx
      .objectStore('shadow_nodes')
      .index('byCollection')
      .getAll(collectionId)) {
      await tx.objectStore('shadow_nodes').delete(n.id);
      await tx.objectStore('shadow_orders').delete(n.id);
    }
    await tx.objectStore('collections').delete(collectionId);
    await tx.done;
    await this.dropBinding(db, collectionId, 'discard');
  }

  /** 연결 기록 삭제. 'keep' 이면 아직 안 보낸 outbox 는 남긴다. */
  async dropBinding(db: Db, collectionId: string, pendingChoice: 'keep' | 'discard') {
    const tx = db.transaction(
      ['bindings', 'observed', 'outbox', 'conflicts', 'reviews'],
      'readwrite',
    );
    await tx.objectStore('bindings').delete(collectionId);
    for (const o of await tx.objectStore('observed').index('byCollection').getAll(collectionId))
      await tx.objectStore('observed').delete(o.localId);
    for (const o of await tx.objectStore('outbox').getAll())
      if (
        o.collectionId === collectionId &&
        (pendingChoice === 'discard' || o.status === 'done' || o.status === 'failed')
      )
        await tx.objectStore('outbox').delete(o.opId);
    for (const c of await tx.objectStore('conflicts').getAll())
      if (c.collectionId === collectionId) await tx.objectStore('conflicts').delete(c.id);
    for (const r of await tx.objectStore('reviews').getAll())
      if (r.collectionId === collectionId) await tx.objectStore('reviews').delete(r.id);
    await tx.done;
  }

  // -------------------------------------------------------------- 백업
  async backup(
    db: Db,
    binding: Binding | null,
    reason: 'initial_merge' | 'mass_change' | 'manual' | 'disconnect',
    local?: LocalTree | null,
  ): Promise<string> {
    const tree = binding
      ? (await chrome.bookmarks.getSubTree(binding.localRootId))[0]
      : (await chrome.bookmarks.getTree())[0];
    const json = JSON.stringify(tree);
    const id = crypto.randomUUID();
    await db.put('backups', {
      id,
      createdAt: Date.now(),
      reason,
      collectionId: binding?.collectionId ?? null,
      bytes: new TextEncoder().encode(json).byteLength,
      tree,
    });
    // 최근 5개 / 100 MiB
    const all = (await db.getAll('backups')).sort((a, b) => b.createdAt - a.createdAt);
    let total = 0;
    for (const b of all) {
      total += b.bytes;
      if (all.indexOf(b) >= 5 || total > 100 * 1024 * 1024) await db.delete('backups', b.id);
    }
    void local;
    return id;
  }
}

export type { ConflictRecord, ReviewItem };
