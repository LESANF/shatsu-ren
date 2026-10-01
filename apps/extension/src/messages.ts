import type { DeviceRecord, TrashEntry } from 'shatsu-ren-protocol';
import type { MergePlan } from './sync/plan';
import type {
  Binding,
  ConflictRecord,
  RecentChange,
  ReviewItem,
  SyncStatusKind,
} from './sync/types';
import type { TreePickerNode } from './sync/browser';
import type { Settings } from './sync/context';

/** UI ↔ worker 메시지. sender 는 worker 가 확장 내부인지 검증한다. */
export interface StateSnapshot {
  version: string;
  devAuth: boolean;
  backend: { url: string; source: 'build' | 'custom' } | null;
  account: { email: string; userId: string; deviceId: string; workspaceId: string } | null;
  settings: Settings;
  status: SyncStatusKind;
  statusDetail?: string;
  lastServerCheckAt: number | null;
  nextRetryAt: number | null;
  realtime: 'off' | 'connecting' | 'connected' | 'reconnecting';
  running: { reason: string; phase: string; startedAt: number } | null;
  counts: {
    outbox: number;
    pendingApply: number;
    conflicts: number;
    reviews: number;
    recovery: number;
  };
  bindings: (Binding & { title: string; rootTitle: string | null; itemCount: number })[];
  collections: {
    id: string;
    title: string;
    rootNodeId: string;
    bound: boolean;
    /** 연결 안 된 공유 폴더만 계산. 북마크·폴더 합계 */
    itemCount: number | null;
    createdAt: string | null;
    /** 만든 브라우저의 장치 이름 (모르면 null) */
    createdBy: string | null;
    createdHere: boolean;
  }[];
  recent: RecentChange[];
  lastError: { code: string; message?: string; at: number } | null;
  blocked: { code: string; at: number } | null;
  problems: { kind: string; count: number }[];
}

export type Request =
  | { type: 'getState' }
  | { type: 'login'; provider: 'google' }
  | { type: 'loginDev'; email: string; password: string }
  | { type: 'logout'; pendingChoice?: 'keep' | 'discard' }
  | { type: 'syncNow' }
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'getFolderTree' }
  | {
      type: 'previewMerge';
      localRootId: string;
      collectionId?: string;
      newCollectionTitle?: string;
    }
  | { type: 'previewNewLocalFolder'; collectionId: string; parentLocalId: string; title: string }
  | { type: 'previewConnect'; copyFrom: string | null }
  | { type: 'applyMerge'; planId: string }
  | { type: 'pauseBinding'; collectionId: string }
  | { type: 'resumeBinding'; collectionId: string }
  | { type: 'disconnectBinding'; collectionId: string; pendingChoice?: 'keep' | 'discard' }
  | { type: 'listConflicts' }
  | {
      type: 'resolveConflict';
      id: string;
      resolution: 'mine' | 'theirs' | 'both';
      fingerprint?: string;
    }
  | { type: 'listReviews' }
  | {
      type: 'resolveReview';
      id: string;
      resolution: string;
      candidateLocalId?: string;
      fingerprint?: string;
    }
  | { type: 'listHistory'; beforeSeq?: number; limit?: number }
  | { type: 'listDevices' }
  | { type: 'revokeDevice'; deviceId: string }
  | { type: 'listTrash' }
  | {
      type: 'restoreTrash';
      deletionId: string;
      collectionId: string;
      parentGlobalId: string | null;
    }
  | { type: 'listBackups' }
  | { type: 'exportBackup'; backupId?: string }
  | { type: 'importPreview'; json: string }
  | { type: 'importApply'; importId: string; parentLocalId: string }
  | { type: 'setBackend'; url: string; anonKey: string }
  | { type: 'resetBackend' }
  | { type: 'diagnostics' }
  | { type: 'deleteAccount'; confirmEmail: string }
  | { type: 'recoverGeneration' }
  | { type: 'getConflictDetail'; id: string };

export type Response<T extends Request['type']> = T extends 'getState'
  ? StateSnapshot
  : T extends 'getFolderTree'
    ? TreePickerNode[]
    : T extends 'previewConnect'
      ? MergePlan & {
          collectionTitle: string;
          localTitle: string;
          connectMode: 'start' | 'receive' | 'rejoin';
        }
      : T extends 'previewMerge' | 'previewNewLocalFolder'
        ? MergePlan & { collectionTitle: string }
        : T extends 'listConflicts'
          ? ConflictRecord[]
          : T extends 'listReviews'
            ? ReviewItem[]
            : T extends 'listDevices' | 'revokeDevice'
              ? DeviceRecord[]
              : T extends 'listTrash'
                ? TrashEntry[]
                : T extends 'listHistory'
                  ? { items: RecentChange[]; hasMore: boolean }
                  : T extends 'getConflictDetail'
                    ? ConflictRecord & {
                        localUrl: string | null;
                        remoteUrl: string | null;
                        orderTitles?: { local: string[]; remote: string[] };
                      }
                    : unknown;

export type Reply = { ok: true; data: unknown } | { ok: false; code: string; message?: string };

export async function send<T extends Request>(req: T): Promise<Response<T['type']>> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply | undefined;
  if (!reply) throw new Error('NO_WORKER');
  if (!reply.ok) throw Object.assign(new Error(reply.message ?? reply.code), { code: reply.code });
  return reply.data as Response<T['type']>;
}
