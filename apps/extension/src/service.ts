/** worker 측 요청 처리. 모든 화면 상태는 여기(실제 엔진·DB) 에서 읽는다. */
import type { DeviceRecord } from 'shatsu-ren-protocol';
import { isSyncableUrl, LIMITS } from 'shatsu-ren-protocol';
import { currentSession, dropClient, getClient, loginDev, loginWithGoogle } from './auth/session';
import { DEV_AUTH, getBackend, setCustomBackend, VERSION, hostPattern } from './config';
import type { Request, StateSnapshot } from './messages';
import { getMeta, setMeta, type Db } from './storage/db';
import { api, getFolderTree, getSubTree } from './sync/browser';
import {
  getAccount,
  getSettings,
  prepareContext,
  setAccount,
  setSettings,
  type Ctx,
} from './sync/context';
import { Engine, RETRY_ALARM } from './sync/engine';
import { buildMergePlan, commitPlan, type MergePlan } from './sync/plan';
import { RealtimeLink } from './sync/realtime';
import { deletionFingerprint } from './sync/reconcile';
import { DomainError, rpc, TransportError } from './sync/rpc';
import { representativeStatus } from './sync/status';
import type { ConflictRecord, RecentChange, ReviewItem } from './sync/types';

export const SYNC_ALARM = 'shatsu-sync';
type StoredPlan = MergePlan & {
  collectionTitle: string;
  createCollection?: { title: string };
  newLocalFolder?: { parentLocalId: string; title: string };
};

export class Service {
  engine: Engine;
  realtime: RealtimeLink;
  private offline = false;
  private ready = false;
  private devices: DeviceRecord[] = [];
  private lastToken = '';
  private progress: { phase: string; done?: number; total?: number } | null = null;

  constructor() {
    this.engine = new Engine({
      onProgress: (p) => {
        this.progress = p;
      },
      onRunFinished: (r) => {
        if (r.outcome === 'offline') this.offline = true;
        else if (r.outcome === 'ok') this.offline = false;
        if (r.outcome === 'ok') void this.ensureRealtime();
      },
      onToken: (t) => {
        if (t !== this.lastToken) {
          this.lastToken = t;
          void this.realtime.setAuth(t);
        }
      },
    });
    this.realtime = new RealtimeLink(
      () => void this.engine.requestSync('realtime'),
      () => undefined,
    );
  }

  async boot(): Promise<void> {
    await this.ensureAlarm();
    this.ready = true;
    void this.engine.requestSync('startup').then(() => this.ensureRealtime());
  }

  /** 주기 확인 alarm 을 설정값에 맞춘다 (5/30/240분). */
  async ensureAlarm(): Promise<void> {
    const settings = await getSettings();
    const existing = await chrome.alarms.get(SYNC_ALARM);
    if (!existing || existing.periodInMinutes !== settings.pollMinutes) {
      await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: settings.pollMinutes });
    }
  }

  async ensureRealtime(): Promise<void> {
    const epoch = this.engine.epoch;
    const settings = await getSettings();
    const res = await prepareContext();
    if (epoch !== this.engine.epoch) return;
    if (!res.ok) {
      await this.realtime.disconnect();
      return;
    }
    const bindings = await res.ctx.db.getAll('bindings');
    if (epoch !== this.engine.epoch) return;
    if (!settings.autoSync || !settings.realtime || !bindings.some((b) => b.status === 'active')) {
      await this.realtime.disconnect();
      return;
    }
    await this.realtime.connect(res.ctx.client, res.ctx.account.workspaceId, res.ctx.accessToken);
  }

  onBookmarkEvent(): void {
    // durable dirty 표시 후 짧은 병합 대기 (200ms) — 이벤트 자체는 트리거일 뿐, 실제 판단은 reconcile
    void chrome.storage.local.set({ 'shatsu.dirtyAt': Date.now() });
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.engine.requestSync('event'), 200);
  }
  private debounce: ReturnType<typeof setTimeout> | undefined;

  onAlarm(name: string): void {
    if (name === SYNC_ALARM) {
      void this.engine.requestSync('alarm').then(() => this.ensureRealtime());
    }
    if (name === RETRY_ALARM) void this.engine.requestSync('alarm');
  }

  // -------------------------------------------------------------- 요청
  async handle(req: Request): Promise<unknown> {
    switch (req.type) {
      case 'getState':
        return this.getState();
      case 'login':
        return this.login();
      case 'loginDev':
        return this.loginDev(req.email, req.password);
      case 'logout':
        return this.logout(req.pendingChoice ?? 'keep');
      case 'syncNow': {
        const r = await this.engine.requestSync('manual', { force: true });
        await this.ensureRealtime();
        return r;
      }
      case 'setSettings': {
        const s = await setSettings(req.patch);
        if (req.patch.autoSync !== undefined) {
          if (req.patch.autoSync) void this.engine.requestSync('resume');
          else await this.realtime.disconnect();
        }
        if (req.patch.realtime !== undefined) await this.ensureRealtime();
        if (req.patch.pollMinutes !== undefined) await this.ensureAlarm();
        if (req.patch.deviceLabel !== undefined) {
          const c = await prepareContext();
          if (c.ok)
            await rpc
              .registerDevice(
                c.ctx.client,
                req.patch.deviceLabel,
                (await import('./sync/context')).browserName(),
              )
              .catch(() => undefined);
        }
        return s;
      }
      case 'getFolderTree':
        return getFolderTree();
      case 'previewMerge':
        return this.previewMerge(req.localRootId, req.collectionId, req.newCollectionTitle);
      case 'previewNewLocalFolder':
        return this.previewNewLocalFolder(req.collectionId, req.parentLocalId, req.title);
      case 'applyMerge':
        return this.applyMerge(req.planId);
      case 'pauseBinding':
        return this.setBindingStatus(req.collectionId, 'paused');
      case 'resumeBinding':
        return this.setBindingStatus(req.collectionId, 'active');
      case 'disconnectBinding':
        return this.disconnectBinding(req.collectionId, req.pendingChoice ?? 'keep');
      case 'listConflicts':
        return this.withDb((db) => db.getAllFromIndex('conflicts', 'byStatus', 'open'));
      case 'getConflictDetail':
        return this.conflictDetail(req.id);
      case 'resolveConflict':
        return this.resolveConflict(req.id, req.resolution, req.fingerprint);
      case 'listReviews':
        return this.withDb((db) => db.getAllFromIndex('reviews', 'byStatus', 'open'));
      case 'resolveReview':
        return this.resolveReview(req.id, req.resolution, req.candidateLocalId, req.fingerprint);
      case 'listHistory':
        return this.listHistory(req.beforeSeq, req.limit ?? 50);
      case 'listDevices':
        return this.listDevices();
      case 'revokeDevice':
        return this.withCtx(async (ctx) => {
          await rpc.revokeDevice(ctx.client, req.deviceId);
          return this.listDevices();
        });
      case 'listTrash':
        return this.withCtx((ctx) => rpc.trash(ctx.client));
      case 'restoreTrash':
        return this.restoreTrash(req.deletionId, req.collectionId, req.parentGlobalId);
      case 'listBackups':
        return this.withDb(async (db) =>
          (await db.getAll('backups'))
            .map(({ tree: _t, ...b }) => b)
            .sort((a, b) => b.createdAt - a.createdAt),
        );
      case 'exportBackup':
        return this.exportBackup(req.backupId);
      case 'importPreview':
        return this.importPreview(req.json);
      case 'importApply':
        return this.importApply(req.importId, req.parentLocalId);
      case 'setBackend':
        return this.setBackend(req.url, req.anonKey);
      case 'resetBackend':
        return this.resetBackend();
      case 'diagnostics':
        return this.diagnostics();
      case 'deleteAccount':
        return this.deleteAccount(req.confirmEmail);
      case 'recoverGeneration':
        return this.recoverGeneration();
      default:
        throw Object.assign(new Error('unknown request'), { code: 'INVALID_REQUEST' });
    }
  }

  private async withCtx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> {
    const res = await prepareContext();
    if (!res.ok)
      throw Object.assign(new Error(res.message ?? res.reason), { code: res.reason.toUpperCase() });
    return fn(res.ctx);
  }
  private withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.withCtx((c) => fn(c.db));
  }
  private checkEpoch(epoch: number): void {
    if (epoch !== this.engine.epoch)
      throw Object.assign(new Error('account changed'), { code: 'RECHECK' });
  }

  // -------------------------------------------------------------- 상태
  async getState(): Promise<StateSnapshot> {
    const settings = await getSettings();
    const backend = await getBackend();
    const base: StateSnapshot = {
      version: VERSION,
      devAuth: DEV_AUTH,
      backend: backend ? { url: backend.url, source: backend.source } : null,
      account: null,
      settings,
      status: 'checking',
      lastServerCheckAt: null,
      nextRetryAt: null,
      realtime: this.realtime.status,
      running: this.engine.running
        ? { ...this.engine.running, phase: this.progress?.phase ?? this.engine.running.phase }
        : null,
      counts: { outbox: 0, pendingApply: 0, conflicts: 0, reviews: 0, recovery: 0 },
      bindings: [],
      collections: [],
      recent: [],
      lastError: null,
      blocked: null,
      problems: [],
    };
    if (!backend) return { ...base, status: 'blocked', statusDetail: 'NO_BACKEND' };
    const client = getClient(backend);
    const session = await currentSession(client);
    if (!session) return { ...base, status: 'auth_required' };
    const account = await getAccount(backend.url);
    if (!account || account.userId !== session.user.id) {
      const res = await prepareContext();
      if (!res.ok)
        return {
          ...base,
          status:
            res.reason === 'auth_required'
              ? 'auth_required'
              : res.reason === 'device_revoked'
                ? 'auth_required'
                : res.reason === 'offline'
                  ? 'offline'
                  : 'blocked',
          statusDetail: res.reason,
          account: {
            email: session.user.email ?? '',
            userId: session.user.id,
            deviceId: '',
            workspaceId: '',
          },
        };
    }
    const res = await prepareContext();
    if (!res.ok)
      return {
        ...base,
        status:
          res.reason === 'auth_required' || res.reason === 'device_revoked'
            ? 'auth_required'
            : res.reason === 'offline'
              ? 'offline'
              : 'blocked',
        statusDetail: res.reason,
        account: account
          ? {
              email: account.email,
              userId: account.userId,
              deviceId: account.deviceId,
              workspaceId: account.workspaceId,
            }
          : null,
      };
    const { db } = res.ctx;
    const acc = res.ctx.account;
    const bindings = await db.getAll('bindings');
    const collections = await db.getAll('collections');
    const conflicts = (await db.getAllFromIndex('conflicts', 'byStatus', 'open')).length;
    const reviews = (await db.getAllFromIndex('reviews', 'byStatus', 'open')).length;
    const outbox =
      (await db.getAllFromIndex('outbox', 'byStatus', 'pending')).length +
      (await db.getAllFromIndex('outbox', 'byStatus', 'in_flight')).length;
    const pendingApply = (await getMeta<number>(db, 'pendingApplyCount')) ?? 0;
    const blocked =
      (await getMeta<{ code: string; at: number }>(db, 'blocked')) ??
      (this.engine.lastResult?.outcome === 'error' || this.engine.lastResult?.outcome === 'blocked'
        ? { code: this.engine.lastResult.code ?? 'INTERNAL', at: this.engine.lastResult.finishedAt }
        : null);
    const lastError =
      (await getMeta<{ code: string; message?: string; at: number }>(db, 'lastError')) ?? null;
    const recovery = bindings.filter(
      (b) => b.status === 'recovery_required' || b.status === 'root_missing',
    ).length;
    const status = representativeStatus({
      workerReady: this.ready,
      // 엔진이 서버에서 SESSION_INVALID/DEVICE_REVOKED/401 을 받았으면 로컬 세션이 남아 있어도 재로그인 상태
      authRequired:
        !!lastError &&
        ['SESSION_INVALID', 'DEVICE_REVOKED', 'unauthorized', 'DEVICE_NOT_REGISTERED'].includes(
          lastError.code,
        ),
      blocked:
        blocked && blocked.code !== 'STORAGE_FAILED'
          ? blocked
          : lastError?.code === 'STORAGE_FAILED'
            ? { code: 'STORAGE_FAILED' }
            : null,
      recoveryRequired: recovery,
      conflicts,
      reviews,
      bindings: bindings.length,
      activeBindings: bindings.filter((b) => b.status === 'active').length,
      pausedBindings: bindings.filter((b) => b.status === 'paused').length,
      autoSync: settings.autoSync,
      offline: this.offline || ['offline', 'server', 'timeout'].includes(lastError?.code ?? ''),
      realtime:
        this.realtime.status === 'off'
          ? 'off'
          : this.realtime.status === 'connected'
            ? 'connected'
            : 'reconnecting',
      running: !!this.engine.running,
      outbox,
      pendingApply,
    });
    const bindingsView = [] as StateSnapshot['bindings'];
    for (const b of bindings) {
      const col = collections.find((c) => c.id === b.collectionId);
      const root = await api.get(b.localRootId);
      const itemCount = (
        await db.getAllFromIndex('observed', 'byCollection', b.collectionId)
      ).filter((o) => o.globalId && o.kind !== 'root').length;
      bindingsView.push({
        ...b,
        title: col?.title ?? '',
        rootTitle: root?.title ?? null,
        itemCount,
      });
    }
    const problems: StateSnapshot['problems'] = [];
    if (conflicts) problems.push({ kind: 'conflict', count: conflicts });
    if (reviews) problems.push({ kind: 'review', count: reviews });
    if (recovery) problems.push({ kind: 'recovery', count: recovery });
    if (blocked) problems.push({ kind: blocked.code, count: 1 });
    return {
      ...base,
      account: {
        email: acc.email,
        userId: acc.userId,
        deviceId: acc.deviceId,
        workspaceId: acc.workspaceId,
      },
      status,
      ...(blocked
        ? { statusDetail: blocked.code }
        : lastError
          ? { statusDetail: lastError.code }
          : {}),
      lastServerCheckAt: (await getMeta<number>(db, 'lastServerCheckAt')) ?? null,
      nextRetryAt: (await getMeta<number>(db, 'nextRetryAt')) ?? null,
      counts: { outbox, pendingApply, conflicts, reviews, recovery },
      bindings: bindingsView,
      collections: collections.map((c) => ({
        id: c.id,
        title: c.title,
        rootNodeId: c.rootNodeId,
        bound: bindings.some((b) => b.collectionId === c.id),
      })),
      recent: (await this.listHistory(undefined, 5)).items,
      lastError,
      blocked,
      problems,
    };
  }

  // -------------------------------------------------------------- 인증
  private async login() {
    const backend = await getBackend();
    if (!backend) throw Object.assign(new Error('no backend'), { code: 'NO_BACKEND' });
    const r = await loginWithGoogle(getClient(backend));
    if (!r.ok) throw Object.assign(new Error(r.message ?? r.code), { code: r.code });
    return this.afterLogin();
  }
  private async loginDev(email: string, password: string) {
    if (!DEV_AUTH) throw Object.assign(new Error('dev auth disabled'), { code: 'FORBIDDEN' });
    const backend = await getBackend();
    if (!backend) throw Object.assign(new Error('no backend'), { code: 'NO_BACKEND' });
    const r = await loginDev(getClient(backend), email, password);
    if (!r.ok) throw Object.assign(new Error(r.message ?? r.code), { code: r.code });
    return this.afterLogin();
  }
  private async afterLogin() {
    this.engine.bumpEpoch();
    const res = await prepareContext({ forceRegister: true });
    if (!res.ok)
      throw Object.assign(new Error(res.message ?? res.reason), { code: res.reason.toUpperCase() });
    const r = await this.engine.requestSync('login');
    await this.ensureRealtime();
    return { account: res.ctx.account.email, run: r.outcome };
  }
  private async logout(pendingChoice: 'keep' | 'discard') {
    this.engine.bumpEpoch();
    await this.realtime.disconnect();
    const backend = await getBackend();
    if (!backend) return { ok: true };
    const client = getClient(backend);
    const account = await getAccount(backend.url);
    let revoked = false;
    if (account) {
      try {
        await rpc.revokeDevice(client, account.deviceId);
        revoked = true;
      } catch {
        /* 오프라인: 다른 장치에서 철회 가능 */
      }
      if (pendingChoice === 'discard') {
        const res = await prepareContext().catch(() => null);
        if (res?.ok) {
          const tx = res.ctx.db.transaction(['outbox', 'observed'], 'readwrite');
          for (const o of await tx.objectStore('outbox').getAll())
            if (o.status !== 'done') await tx.objectStore('outbox').delete(o.opId);
          for (const o of await tx.objectStore('observed').getAll())
            if (o.revision === 0) await tx.objectStore('observed').delete(o.localId);
          await tx.done;
        }
      }
    }
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    await setAccount(backend.url, null);
    dropClient();
    return { ok: true, revoked };
  }

  // -------------------------------------------------------------- 연결(온보딩)
  private async previewMerge(
    localRootId: string,
    collectionId?: string,
    newCollectionTitle?: string,
  ) {
    return this.withCtx(async (ctx) => {
      const root = await api.get(localRootId);
      if (!root || root.url)
        throw Object.assign(new Error('folder not found'), { code: 'ROOT_MISSING' });
      if (root.unmodifiable === 'managed')
        throw Object.assign(new Error('managed folder'), { code: 'MANAGED' });
      // 중첩 binding 금지
      const { isUnder } = await import('./sync/browser');
      for (const b of await ctx.db.getAll('bindings')) {
        if (
          b.localRootId === localRootId ||
          (await isUnder(localRootId, b.localRootId)) ||
          (await isUnder(b.localRootId, localRootId))
        )
          throw Object.assign(new Error('nested binding'), { code: 'NESTED_BINDING' });
      }
      await this.engine.pull(ctx);
      let rootGlobalId: string;
      let title: string;
      let createCollection: { title: string } | undefined;
      if (collectionId) {
        const col = await ctx.db.get('collections', collectionId);
        if (!col) throw Object.assign(new Error('collection not found'), { code: 'NOT_FOUND' });
        if (await ctx.db.get('bindings', collectionId))
          throw Object.assign(new Error('already bound'), { code: 'ALREADY_BOUND' });
        rootGlobalId = col.rootNodeId;
        title = col.title;
      } else {
        collectionId = crypto.randomUUID();
        rootGlobalId = crypto.randomUUID();
        title = (newCollectionTitle ?? root.title ?? '').trim() || root.title || 'shatsu-ren';
        createCollection = { title };
      }
      const plan = await buildMergePlan(ctx, collectionId, rootGlobalId, localRootId);
      const full = {
        ...plan,
        collectionTitle: title,
        ...(createCollection ? { createCollection } : {}),
      };
      await setMeta(ctx.db, `mergePlan:${plan.planId}`, full);
      return full;
    });
  }
  private async previewNewLocalFolder(collectionId: string, parentLocalId: string, title: string) {
    return this.withCtx(async (ctx) => {
      if (await ctx.db.get('bindings', collectionId))
        throw Object.assign(new Error('already bound'), { code: 'ALREADY_BOUND' });
      const { isUnder } = await import('./sync/browser');
      for (const binding of await ctx.db.getAll('bindings'))
        if (
          binding.localRootId === parentLocalId ||
          (await isUnder(parentLocalId, binding.localRootId))
        )
          throw Object.assign(new Error('nested binding'), { code: 'NESTED_BINDING' });
      const parent = await api.get(parentLocalId);
      if (!parent || parent.url || parent.unmodifiable === 'managed')
        throw Object.assign(new Error('bad parent'), { code: 'ROOT_MISSING' });
      const col = await ctx.db.get('collections', collectionId);
      if (!col) throw Object.assign(new Error('collection'), { code: 'NOT_FOUND' });
      const siblings = await api.getChildren(parentLocalId);
      let name = title.trim() || col.title;
      let i = 2;
      while (siblings.some((s) => !s.url && s.title === name))
        name = `${title.trim() || col.title} (${i++})`;
      const remote = (
        await ctx.db.getAllFromIndex('shadow_nodes', 'byCollection', collectionId)
      ).filter((n) => !n.deletedAt && n.kind !== 'root');
      const plan: MergePlan & {
        collectionTitle: string;
        newLocalFolder: { parentLocalId: string; title: string };
      } = {
        planId: crypto.randomUUID(),
        collectionId,
        rootGlobalId: col.rootNodeId,
        localRootId: '',
        headSeq: (await getMeta<number>(ctx.db, 'headSeq')) ?? 0,
        localFingerprint: '',
        counts: {
          toLocal: remote.length,
          toServer: 0,
          matched: 0,
          duplicateCandidates: 0,
          excluded: 0,
          deletes: 0,
          folders: { toLocal: remote.filter((n) => n.kind === 'folder').length, toServer: 0 },
          reorderedFolders: 0,
        },
        items: remote.map((n) => ({
          direction: 'toLocal' as const,
          title: n.title,
          kind: n.kind,
          path: [],
        })),
        matches: [],
        createdAt: Date.now(),
        collectionTitle: col.title,
        newLocalFolder: { parentLocalId, title: name },
      };
      await setMeta(ctx.db, `mergePlan:${plan.planId}`, plan);
      return plan;
    });
  }
  private async applyMerge(planId: string) {
    return this.withCtx(async (ctx) => {
      const epoch = this.engine.epoch;
      const plan = await getMeta<StoredPlan>(ctx.db, `mergePlan:${planId}`);
      if (!plan) throw Object.assign(new Error('plan expired'), { code: 'REPLAN' });
      await this.engine.pull(ctx);
      if (((await getMeta<number>(ctx.db, 'headSeq')) ?? 0) !== plan.headSeq)
        throw Object.assign(new Error('server changed'), { code: 'REPLAN' });
      if (!plan.newLocalFolder) {
        const local = await getSubTree(plan.localRootId);
        if (
          !local ||
          (await (await import('./sync/plan')).localFingerprint(local)) !== plan.localFingerprint
        )
          throw Object.assign(new Error('local changed'), { code: 'REPLAN' });
      }
      await this.engine.backup(ctx.db, null, 'initial_merge');
      this.checkEpoch(epoch);
      if (plan.createCollection) {
        const r = await rpc.applyOne(ctx.client, {
          protocolVersion: 1,
          generationId: ctx.account.generationId,
          op: {
            kind: 'createCollection',
            opId: plan.planId,
            collectionId: plan.collectionId,
            rootNodeId: plan.rootGlobalId,
            title: plan.createCollection.title,
          },
        });
        if (r.receipt.status !== 'applied' && r.receipt.status !== 'noop')
          throw Object.assign(new Error(r.receipt.code), { code: r.receipt.code ?? 'REJECTED' });
        await this.engine.pull(ctx);
        const headSeq = (await getMeta<number>(ctx.db, 'headSeq')) ?? 0;
        if (headSeq !== plan.headSeq + 1)
          throw Object.assign(new Error('server changed'), { code: 'REPLAN' });
        plan.headSeq = headSeq;
        delete plan.createCollection;
        await setMeta(ctx.db, `mergePlan:${planId}`, plan);
      }
      if (plan.newLocalFolder) {
        if (await ctx.db.get('journal', planId))
          throw Object.assign(new Error('interrupted folder creation; inspect before retrying'), {
            code: 'RECHECK',
          });
        await ctx.db.put('journal', {
          id: planId,
          collectionId: plan.collectionId,
          action: 'create',
          status: 'started',
          startedAt: Date.now(),
          parentLocalId: plan.newLocalFolder.parentLocalId,
          expected: { title: plan.newLocalFolder.title, kind: 'folder' },
        });
        this.checkEpoch(epoch);
        const created = await api.create({
          parentId: plan.newLocalFolder.parentLocalId,
          title: plan.newLocalFolder.title,
        });
        plan.localRootId = created.id;
        const tree = await getSubTree(created.id);
        plan.localFingerprint = await (await import('./sync/plan')).localFingerprint(tree!);
        plan.headSeq = (await getMeta<number>(ctx.db, 'headSeq')) ?? 0;
        delete plan.newLocalFolder;
        const tx = ctx.db.transaction(['journal', 'meta'], 'readwrite');
        await tx.objectStore('journal').put({
          ...(await tx.objectStore('journal').get(planId))!,
          status: 'done',
          resultLocalId: created.id,
        });
        await tx.objectStore('meta').put({ key: `mergePlan:${planId}`, value: plan });
        await tx.done;
      }
      const res = await commitPlan(ctx, plan, () =>
        this.engine.backup(
          ctx.db,
          {
            collectionId: plan.collectionId,
            localRootId: plan.localRootId,
            status: 'active',
            createdAt: Date.now(),
          },
          'initial_merge',
        ),
      );
      if (!res.ok) {
        if (res.code === 'REPLAN') {
          const fresh = await buildMergePlan(
            ctx,
            plan.collectionId,
            plan.rootGlobalId,
            plan.localRootId,
          );
          await setMeta(ctx.db, `mergePlan:${fresh.planId}`, {
            ...fresh,
            collectionTitle: plan.collectionTitle,
          });
          throw Object.assign(new Error('replan'), { code: 'REPLAN', planId: fresh.planId });
        }
        throw Object.assign(new Error(res.code), { code: res.code });
      }
      await ctx.db.delete('meta', `mergePlan:${planId}`);
      const run = await this.engine.requestSync('merge', { force: true });
      await this.ensureRealtime();
      return { backupId: res.backupId, run };
    });
  }
  private async setBindingStatus(collectionId: string, status: 'paused' | 'active') {
    return this.withCtx(async (ctx) => {
      const b = await ctx.db.get('bindings', collectionId);
      if (!b) throw Object.assign(new Error('binding'), { code: 'NOT_FOUND' });
      const next = { ...b, status, ...(status === 'paused' ? { pausedAt: Date.now() } : {}) };
      if (status === 'active') delete (next as { recovery?: unknown }).recovery;
      await ctx.db.put('bindings', next);
      if (status === 'active') void this.engine.requestSync('resume');
      await this.ensureRealtime();
      return next;
    });
  }
  private async disconnectBinding(collectionId: string, pendingChoice: 'keep' | 'discard') {
    this.engine.bumpEpoch();
    return this.withCtx(async (ctx) => {
      const b = await ctx.db.get('bindings', collectionId);
      if (!b) return { ok: true };
      await this.engine.backup(ctx.db, b, 'disconnect');
      const tx = ctx.db.transaction(
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
      await this.ensureRealtime();
      return { ok: true };
    });
  }

  // -------------------------------------------------------------- 충돌
  private async conflictDetail(id: string) {
    return this.withDb(async (db) => {
      const c = await db.get('conflicts', id);
      if (!c) throw Object.assign(new Error('conflict'), { code: 'NOT_FOUND' });
      const titles = new Map(
        (await db.getAllFromIndex('shadow_nodes', 'byCollection', c.collectionId)).map((n) => [
          n.id,
          n.title,
        ]),
      );
      return {
        ...c,
        localUrl: c.local?.url ?? null,
        remoteUrl: c.remote.url,
        ...(c.orders
          ? {
              orderTitles: {
                local: c.orders.local.map((id) => titles.get(id) ?? id),
                remote: c.orders.remote.map((id) => titles.get(id) ?? id),
              },
            }
          : {}),
      };
    });
  }
  private async resolveConflict(
    id: string,
    resolution: 'mine' | 'theirs' | 'both',
    reviewedFingerprint?: string,
  ) {
    return this.withCtx(async (ctx) => {
      const epoch = this.engine.epoch;
      const { db } = ctx;
      await this.engine.pull(ctx);
      const c = await db.get('conflicts', id);
      if (!c || c.status !== 'open')
        throw Object.assign(new Error('conflict'), { code: 'NOT_FOUND' });
      if (c.fingerprint) {
        const binding = await db.get('bindings', c.collectionId);
        const local = binding ? await getSubTree(binding.localRootId) : null;
        if (!local) throw Object.assign(new Error('root missing'), { code: 'ROOT_MISSING' });
        const nodes = new Map(
          (await db.getAllFromIndex('shadow_nodes', 'byCollection', c.collectionId)).map((n) => [
            n.id,
            n,
          ]),
        );
        const orders = new Map((await db.getAll('shadow_orders')).map((o) => [o.parentId, o]));
        const fingerprint = deletionFingerprint(
          [{ globalId: c.globalId, localId: c.localId, title: c.base.title, kind: c.nodeKind }],
          local,
          nodes,
          orders,
        );
        if (fingerprint !== c.fingerprint || reviewedFingerprint !== c.fingerprint) {
          const current = c.localId ? await api.get(c.localId) : null;
          const remote = nodes.get(c.globalId);
          const mapped = new Map(
            (await db.getAllFromIndex('observed', 'byCollection', c.collectionId)).map((node) => [
              node.localId,
              node.globalId,
            ]),
          );
          await db.put('conflicts', {
            ...c,
            fingerprint,
            ...(c.orders
              ? {
                  orders: {
                    ...c.orders,
                    local: (local.children.get(c.localId ?? '') ?? []).flatMap((id) =>
                      mapped.get(id) ? [mapped.get(id)!] : [],
                    ),
                    remote: orders.get(c.globalId)?.orderedChildIds ?? [],
                    remoteRevision: orders.get(c.globalId)?.revision ?? c.orders.remoteRevision,
                  },
                }
              : {}),
            local: current
              ? {
                  ...c.local!,
                  title: current.title,
                  url: current.url ?? null,
                  parentGlobalId: mapped.get(current.parentId ?? '') ?? null,
                }
              : c.local,
            ...(remote
              ? {
                  remote: {
                    title: remote.title,
                    url: remote.url,
                    parentGlobalId: remote.parentId,
                    revision: remote.revision,
                    deleted: !!remote.deletedAt,
                  },
                }
              : {}),
          });
          throw Object.assign(new Error('changed; review again'), { code: 'RECHECK' });
        }
      }
      const shadow = await db.get('shadow_nodes', c.globalId);
      if (
        shadow &&
        (shadow.revision !== c.remote.revision || !!shadow.deletedAt !== c.remote.deleted)
      ) {
        // 처리 중 새 revision → 재확인 (충돌 레코드 갱신)
        await db.put('conflicts', {
          ...c,
          remote: {
            title: shadow.title,
            url: shadow.url,
            parentGlobalId: shadow.parentId,
            revision: shadow.revision,
            deleted: !!shadow.deletedAt,
          },
        });
        throw Object.assign(new Error('changed'), { code: 'RECHECK' });
      }
      const obs = c.localId
        ? await db.get('observed', c.localId)
        : await db.getFromIndex('observed', 'byGlobal', c.globalId);
      if (c.localId && c.local) {
        const current = await api.get(c.localId);
        const parent = current?.parentId ? await db.get('observed', current.parentId) : null;
        if (
          !current ||
          current.title !== c.local.title ||
          (current.url ?? null) !== c.local.url ||
          (parent?.globalId ?? null) !== c.local.parentGlobalId
        )
          throw Object.assign(new Error('local changed'), { code: 'RECHECK' });
      }
      const parentLocalOf = async (g: string | null) =>
        g ? ((await db.getFromIndex('observed', 'byGlobal', g))?.localId ?? null) : null;
      if (c.kind === 'order_order' && c.orders && obs) {
        if (resolution === 'both')
          throw Object.assign(new Error('choose one order'), { code: 'RECHECK' });
        const mapping = new Map(
          (await db.getAllFromIndex('observed', 'byCollection', c.collectionId)).flatMap((node) =>
            node.globalId ? [[node.globalId, node.localId] as const] : [],
          ),
        );
        await db.put('observed', {
          ...obs,
          childOrder:
            resolution === 'mine'
              ? c.orders.remote.flatMap((id) => (mapping.has(id) ? [mapping.get(id)!] : []))
              : (await api.getChildren(obs.localId)).map((node) => node.id),
          orderRevision: resolution === 'mine' ? c.orders.remoteRevision : -1,
        });
      } else if (c.kind === 'edit_edit' || c.kind === 'move_move') {
        if (!obs || !c.local) throw Object.assign(new Error('state'), { code: 'RECHECK' });
        if (resolution === 'mine') {
          // base = remote 로 갱신 → 다음 실행에서 로컬 값이 새 op 으로 제출됨 (새 opId, 새 baseRevision)
          await db.put('observed', {
            ...obs,
            title: c.remote.title,
            url: c.remote.url,
            parentLocalId: (await parentLocalOf(c.remote.parentGlobalId)) ?? obs.parentLocalId,
            revision: c.remote.revision,
          });
        } else {
          if (resolution === 'both' && c.nodeKind === 'bookmark' && c.local.url) {
            this.checkEpoch(epoch);
            await api.create({
              parentId:
                obs.parentLocalId ??
                (await parentLocalOf(c.local.parentGlobalId)) ??
                obs.parentLocalId!,
              title: c.local.title,
              url: c.local.url,
            });
          }
          const changes: { title?: string; url?: string } = { title: c.remote.title };
          if (c.nodeKind === 'bookmark' && c.remote.url) changes.url = c.remote.url;
          this.checkEpoch(epoch);
          await api.update(obs.localId, changes);
          const pl = await parentLocalOf(c.remote.parentGlobalId);
          this.checkEpoch(epoch);
          if (pl && pl !== obs.parentLocalId) await api.move(obs.localId, { parentId: pl });
          await db.put('observed', {
            ...obs,
            title: c.remote.title,
            url: c.remote.url,
            parentLocalId: pl ?? obs.parentLocalId,
            revision: c.remote.revision,
          });
        }
      } else if (c.kind === 'local_edit_remote_delete') {
        if (!obs) throw Object.assign(new Error('state'), { code: 'RECHECK' });
        const ids = [obs.localId];
        const all = await db.getAllFromIndex('observed', 'byCollection', c.collectionId);
        for (let i = 0; i < ids.length; i++)
          for (const x of all) if (x.parentLocalId === ids[i]) ids.push(x.localId);
        if (resolution === 'mine') {
          // 로컬 보관: mapping 해제 → 새 항목으로 재업로드
          const tx = db.transaction('observed', 'readwrite');
          for (const lid of ids) await tx.store.delete(lid);
          await tx.done;
        } else {
          await this.engine.backup(db, null, 'manual');
          const binding = await db.get('bindings', c.collectionId);
          const nodes = new Map(
            (await db.getAllFromIndex('shadow_nodes', 'byCollection', c.collectionId)).map((n) => [
              n.id,
              n,
            ]),
          );
          const orders = new Map((await db.getAll('shadow_orders')).map((o) => [o.parentId, o]));
          const local = binding ? await getSubTree(binding.localRootId) : null;
          if (
            !local ||
            !c.fingerprint ||
            deletionFingerprint(
              [{ globalId: c.globalId, localId: c.localId, title: c.base.title, kind: c.nodeKind }],
              local,
              nodes,
              orders,
            ) !== c.fingerprint
          )
            throw Object.assign(new Error('changed during backup; review again'), {
              code: 'RECHECK',
            });
          const n = local.nodes.get(obs.localId);
          this.checkEpoch(epoch);
          if (n) {
            if (n.url) await api.remove(obs.localId);
            else await api.removeTree(obs.localId);
          }
          const tx = db.transaction('observed', 'readwrite');
          for (const lid of ids) await tx.store.delete(lid);
          await tx.done;
        }
      } else if (c.kind === 'local_delete_remote_edit') {
        if (!obs) throw Object.assign(new Error('state'), { code: 'RECHECK' });
        if (resolution === 'mine') {
          await db.put('observed', { ...obs, revision: c.remote.revision }); // 삭제 op 이 새 digest 로 제출됨
        } else {
          const ids = [obs.localId];
          const all = await db.getAllFromIndex('observed', 'byCollection', c.collectionId);
          for (let i = 0; i < ids.length; i++)
            for (const x of all) if (x.parentLocalId === ids[i]) ids.push(x.localId);
          const tx = db.transaction('observed', 'readwrite');
          for (const lid of ids) await tx.store.delete(lid);
          await tx.done; // 서버 전용 항목 → 다음 실행에서 로컬 재생성
        }
      }
      this.checkEpoch(epoch);
      await db.put('conflicts', { ...c, status: 'resolved', resolution, resolvedAt: Date.now() });
      const run = await this.engine.requestSync('manual', { force: true });
      return { ok: true, run: run.outcome };
    });
  }

  // -------------------------------------------------------------- 검토
  private async resolveReview(
    id: string,
    resolution: string,
    candidateLocalId?: string,
    reviewedFingerprint?: string,
  ) {
    return this.withCtx(async (ctx) => {
      const { db } = ctx;
      const r = await db.get('reviews', id);
      if (!r || r.status !== 'open')
        throw Object.assign(new Error('review'), { code: 'NOT_FOUND' });
      if (resolution === 'later') return { ok: true };
      if (r.kind.startsWith('mass_delete')) {
        await this.engine.pull(ctx);
        const binding = await db.get('bindings', r.collectionId);
        const local = binding ? await getSubTree(binding.localRootId) : null;
        if (!local) throw Object.assign(new Error('root missing'), { code: 'ROOT_MISSING' });
        const nodes = new Map(
          (await db.getAllFromIndex('shadow_nodes', 'byCollection', r.collectionId)).map((n) => [
            n.id,
            n,
          ]),
        );
        const orders = new Map((await db.getAll('shadow_orders')).map((o) => [o.parentId, o]));
        const fingerprint = deletionFingerprint(r.items, local, nodes, orders);
        if (
          !r.fingerprint ||
          fingerprint !== r.fingerprint ||
          (resolution === 'approve' && reviewedFingerprint !== r.fingerprint)
        ) {
          const items = r.items.map((item) => {
            const node = item.globalId ? nodes.get(item.globalId) : null;
            return node ? { ...item, title: node.title, url: node.url } : item;
          });
          if (r.kind === 'mass_delete_out') {
            const mapped = new Map(
              (await db.getAllFromIndex('observed', 'byCollection', r.collectionId)).flatMap(
                (node) => (node.globalId ? [[node.globalId, node.localId] as const] : []),
              ),
            );
            const children = new Map<string, string[]>();
            for (const node of nodes.values()) {
              if (!node.parentId || node.deletedAt) continue;
              const ids = children.get(node.parentId) ?? [];
              ids.push(node.id);
              children.set(node.parentId, ids);
            }
            const seen = new Set(items.flatMap((item) => (item.globalId ? [item.globalId] : [])));
            for (const id of seen)
              for (const child of children.get(id) ?? []) {
                if (seen.has(child)) continue;
                seen.add(child);
                const node = nodes.get(child)!;
                items.push({
                  globalId: child,
                  localId: mapped.get(child) ?? null,
                  title: node.title,
                  url: node.url,
                  kind: node.kind,
                });
              }
          }
          await db.put('reviews', {
            ...r,
            fingerprint: deletionFingerprint(items, local, nodes, orders),
            items,
          });
          throw Object.assign(new Error('changed; review again'), { code: 'RECHECK' });
        }
        if (resolution === 'approve') await this.engine.backup(db, binding!, 'mass_change', local);
      }
      if (r.kind === 'generation_recovery' && resolution === 'approve') {
        const pending = (await getMeta<string[]>(db, 'generationRecoveryBindings')) ?? [];
        const collections = new Set(
          (await db.getAll('collections')).map((collection) => collection.id),
        );
        const tx = db.transaction(['outbox', 'bindings', 'meta'], 'readwrite');
        for (const entry of await tx.objectStore('outbox').getAll())
          if (entry.status === 'held' && entry.lastError === 'SERVER_GENERATION_CHANGED')
            await tx.objectStore('outbox').put({ ...entry, status: 'failed' });
        for (const collectionId of pending) {
          const binding = await tx.objectStore('bindings').get(collectionId);
          if (binding)
            await tx.objectStore('bindings').put({
              ...binding,
              status: collections.has(collectionId) ? 'active' : 'recovery_required',
            });
        }
        await tx.objectStore('meta').put({ key: 'blocked', value: null });
        await tx.done;
      }
      if (r.kind === 'mass_delete_out' && resolution === 'restore') {
        const tx = db.transaction('observed', 'readwrite');
        for (const it of r.items)
          if (it.localId) {
            const ids = [it.localId];
            const all = await tx.store.index('byCollection').getAll(r.collectionId);
            for (let i = 0; i < ids.length; i++)
              for (const x of all) if (x.parentLocalId === ids[i]) ids.push(x.localId);
            for (const lid of ids) await tx.store.delete(lid);
          }
        await tx.done;
      }
      if (r.kind === 'moved_out' && resolution === 'keep') {
        const tx = db.transaction('observed', 'readwrite');
        const all = await tx.store.index('byCollection').getAll(r.collectionId);
        const ids = new Set(r.items.flatMap((it) => (it.localId ? [it.localId] : [])));
        for (const id of ids)
          for (const node of all) if (node.parentLocalId === id) ids.add(node.localId);
        for (const id of ids) await tx.store.delete(id);
        await tx.done;
      }
      if (r.kind === 'moved_out' && resolution === 'delete') {
        // 범위 밖 항목을 삭제 대상으로: existsElsewhere 무시 목록에 기록
        const ignore = (await getMeta<string[]>(db, 'ignoreElsewhere')) ?? [];
        await setMeta(db, 'ignoreElsewhere', [
          ...ignore,
          ...r.items.map((i) => i.localId).filter((x): x is string => !!x),
        ]);
      }
      if (r.kind === 'excluded_url' && resolution === 'restore') {
        const tx = db.transaction('observed', 'readwrite');
        for (const it of r.items)
          if (it.localId) {
            const o = await tx.store.get(it.localId);
            if (o)
              await tx.store.put({
                ...o,
                globalId: null,
                revision: 0,
                excluded: 'unsupported_url',
              });
          }
        await tx.done;
      }
      if (r.kind === 'create_recovery') {
        const binding = await db.get('bindings', r.collectionId);
        const item = r.items[0];
        if (resolution === 'map' && candidateLocalId && item?.globalId) {
          const cand = await api.get(candidateLocalId);
          const s = await db.get('shadow_nodes', item.globalId);
          if (cand && s)
            await db.put('observed', {
              localId: cand.id,
              globalId: item.globalId,
              collectionId: r.collectionId,
              parentLocalId: cand.parentId ?? null,
              kind: cand.url ? 'bookmark' : 'folder',
              title: cand.title,
              url: cand.url ?? null,
              revision: s.revision,
              ...(cand.url ? {} : { childOrder: [], orderRevision: -1 }),
            });
        }
        if (resolution === 'cancel') return { ok: true };
        if (binding) {
          const next = { ...binding, status: 'active' as const };
          delete (next as { recovery?: unknown }).recovery;
          await db.put('bindings', next);
        }
      }
      await db.put('reviews', { ...r, status: 'resolved', resolution, resolvedAt: Date.now() });
      const run = await this.engine.requestSync('manual', { force: true });
      return { ok: true, run: run.outcome };
    });
  }

  // -------------------------------------------------------------- 내역·장치·휴지통·백업
  private async listHistory(
    beforeSeq: number | undefined,
    limit: number,
  ): Promise<{ items: RecentChange[]; hasMore: boolean }> {
    const res = await prepareContext();
    if (!res.ok) return { items: [], hasMore: false };
    const { db, account } = res.ctx;
    const range = beforeSeq ? IDBKeyRange.upperBound(beforeSeq, true) : undefined;
    const rows = (await db.getAll('inbox', range)).sort((a, b) => b.seq - a.seq);
    const page = rows.slice(0, limit);
    if (!this.devices.length) this.devices = (await getMeta<DeviceRecord[]>(db, 'devices')) ?? [];
    if (
      !page.some((r) => this.devices.some((d) => d.id === r.commit.sourceDeviceId)) &&
      page.length
    ) {
      try {
        this.devices = await rpc.devices(res.ctx.client);
        await setMeta(db, 'devices', this.devices);
      } catch {
        /* 오프라인: 라벨 없이 표시 */
      }
    }
    const items = page.map(({ commit }) => {
      const nodes = commit.payload.nodes.filter((n) => n.kind !== 'root');
      const first = nodes[0] ?? null;
      const dev = this.devices.find((d) => d.id === commit.sourceDeviceId);
      return {
        seq: commit.seq,
        at: commit.serverTime,
        deviceLabel: dev?.label ?? '',
        isThisDevice: commit.sourceDeviceId === account.deviceId,
        kind: commit.kind,
        summary: {
          title: first?.title ?? commit.payload.collections?.[0]?.title ?? '',
          count: nodes.length || 1,
          nodeKind: first?.kind ?? 'folder',
        },
      };
    });
    return { items, hasMore: rows.length > limit };
  }
  private async listDevices() {
    return this.withCtx(async (ctx) => {
      this.devices = await rpc.devices(ctx.client);
      await setMeta(ctx.db, 'devices', this.devices);
      return this.devices;
    });
  }
  private async restoreTrash(
    deletionId: string,
    collectionId: string,
    parentGlobalId: string | null,
  ) {
    return this.withCtx(async (ctx) => {
      const r = await rpc.applyOne(ctx.client, {
        protocolVersion: 1,
        generationId: ctx.account.generationId,
        op: {
          kind: 'restore',
          opId: crypto.randomUUID(),
          collectionId,
          deletionId,
          parentId: parentGlobalId,
        },
      });
      if (r.receipt.status !== 'applied')
        throw Object.assign(new Error(r.receipt.code), { code: r.receipt.code ?? 'REJECTED' });
      const run = await this.engine.requestSync('manual', { force: true });
      return { receipt: r.receipt, run: run.outcome };
    });
  }
  private async exportBackup(backupId?: string) {
    return this.withDb(async (db) => {
      const tree = backupId
        ? (await db.get('backups', backupId))?.tree
        : (await chrome.bookmarks.getTree())[0];
      if (!tree) throw Object.assign(new Error('backup'), { code: 'NOT_FOUND' });
      return {
        filename: `shatsu-ren-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        json: JSON.stringify(
          { format: 'shatsu-ren-backup', version: 1, exportedAt: new Date().toISOString(), tree },
          null,
          1,
        ),
      };
    });
  }
  private async importPreview(json: string) {
    if (new TextEncoder().encode(json).byteLength > 16 * 1024 * 1024)
      throw Object.assign(new Error('too large'), { code: 'LIMIT_EXCEEDED' });
    let parsed: { format?: string; version?: number; tree?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch {
      throw Object.assign(new Error('bad json'), { code: 'INVALID_FILE' });
    }
    if (parsed.format !== 'shatsu-ren-backup' || parsed.version !== 1 || !parsed.tree)
      throw Object.assign(new Error('unsupported'), { code: 'INVALID_FILE' });
    let count = 0,
      excluded = 0,
      depth = 0;
    const seen = new Set<unknown>();
    const walk = (n: unknown, d: number): void => {
      if (d > LIMITS.maxDepth || seen.size >= LIMITS.maxActiveNodes)
        throw Object.assign(new Error('import limit'), { code: 'LIMIT_EXCEEDED' });
      if (!n || typeof n !== 'object' || seen.has(n))
        throw Object.assign(new Error('bad node'), { code: 'INVALID_FILE' });
      seen.add(n);
      const node = n as { title?: unknown; url?: unknown; children?: unknown };
      if (typeof node.title !== 'string')
        throw Object.assign(new Error('bad title'), { code: 'INVALID_FILE' });
      if (new TextEncoder().encode(node.title).byteLength > LIMITS.maxTitleBytes)
        throw Object.assign(new Error('title too large'), { code: 'LIMIT_EXCEEDED' });
      depth = Math.max(depth, d);
      if (node.url !== undefined) {
        if (typeof node.url !== 'string')
          throw Object.assign(new Error('bad url'), { code: 'INVALID_FILE' });
        if (new TextEncoder().encode(node.url).byteLength > LIMITS.maxUrlBytes)
          throw Object.assign(new Error('url too large'), { code: 'LIMIT_EXCEEDED' });
        if (!isSyncableUrl(node.url)) excluded++;
        else count++;
      } else {
        count++;
        if (node.children !== undefined && !Array.isArray(node.children))
          throw Object.assign(new Error('bad children'), { code: 'INVALID_FILE' });
        for (const c of (node.children as unknown[]) ?? []) walk(c, d + 1);
      }
    };
    walk(parsed.tree, 0);
    if (count > LIMITS.maxActiveNodes)
      throw Object.assign(new Error('too many'), { code: 'LIMIT_EXCEEDED' });
    if (depth > LIMITS.maxDepth)
      throw Object.assign(new Error('too deep'), { code: 'LIMIT_EXCEEDED' });
    const importId = crypto.randomUUID();
    await this.withDb((db) => setMeta(db, `import:${importId}`, { tree: parsed.tree, count }));
    return { importId, count, excluded, depth };
  }
  private async importApply(importId: string, parentLocalId: string) {
    return this.withDb(async (db) => {
      const imp = await getMeta<{ tree: unknown; count: number }>(db, `import:${importId}`);
      if (!imp) throw Object.assign(new Error('import expired'), { code: 'REPLAN' });
      const parent = await api.get(parentLocalId);
      if (!parent || parent.url) throw Object.assign(new Error('parent'), { code: 'ROOT_MISSING' });
      let created = 0;
      const epoch = this.engine.epoch;
      const walk = async (
        n: { title: string; url?: string; children?: unknown[] },
        pid: string,
        path: string,
      ) => {
        if (epoch !== this.engine.epoch)
          throw Object.assign(new Error('account changed'), { code: 'RECHECK' });
        if (n.url !== undefined && !isSyncableUrl(n.url)) return;
        const id = `import:${importId}:${path}`;
        const journal = await db.get('journal', id);
        let localId = journal?.resultLocalId;
        if (journal && (!localId || !(await api.get(localId))))
          throw Object.assign(new Error('interrupted import; inspect the imported items'), {
            code: 'RECHECK',
          });
        if (!journal) {
          await db.put('journal', {
            id,
            collectionId: '',
            action: 'create',
            status: 'started',
            startedAt: Date.now(),
            parentLocalId: pid,
            expected: { title: n.title, url: n.url ?? null, kind: n.url ? 'bookmark' : 'folder' },
          });
          this.checkEpoch(epoch);
          const node = await api.create({
            parentId: pid,
            title: n.title,
            ...(n.url ? { url: n.url } : {}),
          });
          localId = node.id;
          await db.put('journal', {
            ...(await db.get('journal', id))!,
            status: 'done',
            resultLocalId: localId,
          });
          created++;
        }
        if (n.url !== undefined) {
          return;
        }
        const children = (n.children ?? []) as {
          title: string;
          url?: string;
          children?: unknown[];
        }[];
        for (const [i, child] of children.entries()) await walk(child, localId!, `${path}.${i}`);
      };
      const root = imp.tree as { title: string; url?: string; children?: unknown[] };
      for (const [i, c] of (
        (root.children ?? []) as {
          title: string;
          url?: string;
          children?: unknown[];
        }[]
      ).entries())
        await walk(c, parentLocalId, String(i));
      await db.delete('meta', `import:${importId}`);
      void this.engine.requestSync('event');
      return { created };
    });
  }

  // -------------------------------------------------------------- 백엔드·계정
  private async setBackend(url: string, anonKey: string) {
    const origin = (await import('./config')).validateBackendUrl(url);
    const granted = await chrome.permissions
      .request({ origins: [hostPattern(origin)] })
      .catch(() => false);
    if (!granted) throw Object.assign(new Error('permission'), { code: 'PERMISSION_DENIED' });
    // 임시 연결로 응답 schema 확인 (인증 전 sync_info 는 읽을 수 없으므로 auth settings 만)
    const r = await fetch(`${origin}/auth/v1/settings`, { headers: { apikey: anonKey } }).catch(
      () => null,
    );
    if (!r || !r.ok)
      throw Object.assign(new Error('backend unreachable'), { code: 'BACKEND_UNREACHABLE' });
    await this.logout('keep');
    await setCustomBackend({ url: origin, anonKey });
    return { url: origin };
  }
  private async resetBackend() {
    await this.logout('keep');
    await setCustomBackend(null);
    return { ok: true };
  }
  private async diagnostics() {
    const state = await this.getState();
    const res = await prepareContext();
    const failedJournal = res.ok
      ? (await res.ctx.db.getAllFromIndex('journal', 'byStatus', 'failed')).slice(-20).map((j) => ({
          id: j.id,
          action: j.action,
          error: j.error,
          startedAt: new Date(j.startedAt).toISOString(),
        }))
      : [];
    const outboxFailed = res.ok
      ? (await res.ctx.db.getAllFromIndex('outbox', 'byStatus', 'failed')).slice(-20).map((o) => ({
          opId: o.opId,
          kind: o.env.op.kind,
          code: o.receipt?.code,
          attempts: o.attempts,
        }))
      : [];
    // URL·제목·토큰 없음. 계정 이메일도 마스킹.
    return {
      exportedAt: new Date().toISOString(),
      version: VERSION,
      browser: navigator.userAgent,
      backend: state.backend?.source ?? null,
      status: state.status,
      statusDetail: state.statusDetail ?? null,
      counts: state.counts,
      bindings: state.bindings.map((b) => ({ status: b.status, itemCount: b.itemCount })),
      lastError: state.lastError,
      blocked: state.blocked,
      realtime: state.realtime,
      realtimeHealth: this.realtime.health(),
      lastServerCheckAt: state.lastServerCheckAt
        ? new Date(state.lastServerCheckAt).toISOString()
        : null,
      lastRun: this.engine.lastResult,
      failedJournal,
      outboxFailed,
    };
  }
  private async deleteAccount(confirmEmail: string) {
    return this.withCtx(async (ctx) => {
      const requestId = (await getMeta<string>(ctx.db, 'deletionRequestId')) ?? crypto.randomUUID();
      await setMeta(ctx.db, 'deletionRequestId', requestId);
      const res = await fetch(`${ctx.backend.url}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: ctx.backend.anonKey,
          Authorization: `Bearer ${ctx.accessToken}`,
        },
        body: JSON.stringify({ requestId, confirmEmail }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { code: string; message?: string };
      };
      if (!res.ok || !body.ok)
        throw Object.assign(new Error(body.error?.message ?? String(res.status)), {
          code: body.error?.code ?? 'INTERNAL',
          retryable: res.status >= 500,
        });
      this.engine.bumpEpoch();
      await this.realtime.disconnect();
      await ctx.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      await setAccount(ctx.backend.url, null);
      dropClient();
      return { ok: true };
    });
  }
  private async recoverGeneration() {
    this.engine.bumpEpoch();
    const res = await prepareContext({ forceRegister: true });
    if (!res.ok) throw Object.assign(new Error(res.reason), { code: res.reason.toUpperCase() });
    const { db, account } = res.ctx;
    await this.engine.backup(db, null, 'manual');
    await setMeta(db, 'generationId', account.generationId);
    const snap = await this.engine.rebuildFromSnapshot(res.ctx);
    const bindings = await db.getAll('bindings');
    await setMeta(
      db,
      'generationRecoveryBindings',
      bindings.filter((b) => b.status === 'active').map((b) => b.collectionId),
    );
    const tx = db.transaction(['outbox', 'bindings', 'reviews', 'meta'], 'readwrite');
    for (const o of await tx.objectStore('outbox').getAll())
      if (
        o.status === 'pending' ||
        o.status === 'in_flight' ||
        (o.status === 'failed' && o.receipt?.code === 'SERVER_GENERATION_CHANGED')
      )
        await tx.objectStore('outbox').put({
          ...o,
          status: 'held',
          lastError: 'SERVER_GENERATION_CHANGED',
        });
    for (const b of bindings)
      if (b.status === 'active') await tx.objectStore('bindings').put({ ...b, status: 'paused' });
    await tx.objectStore('reviews').put({
      id: crypto.randomUUID(),
      kind: 'generation_recovery',
      collectionId: '',
      status: 'open',
      createdAt: Date.now(),
      scopeCount: snap.nodes.length,
      items: snap.nodes
        .filter((n) => n.kind !== 'root')
        .map((n) => ({
          globalId: n.id,
          localId: null,
          title: n.title,
          kind: n.kind,
          url: n.url,
        })),
    });
    await tx
      .objectStore('meta')
      .put({ key: 'blocked', value: { code: 'SERVER_GENERATION_CHANGED', at: Date.now() } });
    await tx.done;
    return { run: 'review_required' };
  }
}

export type { ConflictRecord, ReviewItem };
export { TransportError, DomainError };
