import type { Envelope, Receipt } from 'shatsu-ren-protocol';

export type BindingStatus =
  'active' | 'paused' | 'root_missing' | 'recovery_required' | 'permission_required';

export interface Binding {
  collectionId: string;
  localRootId: string;
  status: BindingStatus;
  createdAt: number;
  pausedAt?: number;
  /** recovery_required 사유 (create journal 불확실 등) */
  recovery?: { journalId: string; reason: string };
}

/** base(마지막 합의 상태) + mapping. 로컬 항목 하나당 한 행. */
export interface ObservedNode {
  localId: string;
  /** 서버 전역 ID. 아직 서버에 없는 새 항목도 미리 발급(revision 0). 제외 항목은 null. */
  globalId: string | null;
  collectionId: string;
  parentLocalId: string | null; // binding root 자신은 null
  kind: 'root' | 'folder' | 'bookmark';
  title: string;
  url: string | null;
  /** 합의된 서버 revision (0 = 아직 서버 미승인) */
  revision: number;
  /** 폴더: 합의된 자식 순서(localId) 와 서버 order revision */
  childOrder?: string[];
  orderRevision?: number;
  excluded?: 'unsupported_url' | 'unreadable';
}

export type OutboxStatus = 'pending' | 'in_flight' | 'held' | 'done' | 'failed';

export interface OutboxEntry {
  opId: string;
  env: Envelope;
  /** 하나의 node(또는 reorder 의 parent) 당 미완료 op 하나 */
  targetId: string;
  collectionId: string;
  status: OutboxStatus;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** 충돌 UI 용: 사용자가 편집하기 전 base 와 로컬 제안 값 */
  context?: { localId?: string; base?: Partial<ObservedNode>; proposed?: Partial<ObservedNode> };
  receipt?: Receipt;
  dependsOn?: string[];
}

export interface JournalEntry {
  id: string;
  collectionId: string;
  action: 'create' | 'update' | 'move' | 'remove' | 'reorder';
  status: 'started' | 'done' | 'failed';
  startedAt: number;
  globalId?: string;
  localId?: string;
  parentLocalId?: string;
  expected?: { title?: string; url?: string | null; kind?: string; index?: number };
  resultLocalId?: string;
  error?: string;
}

export type ConflictKind =
  'edit_edit' | 'local_edit_remote_delete' | 'local_delete_remote_edit' | 'move_move';

export interface ConflictRecord {
  id: string;
  collectionId: string;
  globalId: string;
  localId: string | null;
  kind: ConflictKind;
  nodeKind: 'folder' | 'bookmark';
  base: { title: string; url: string | null; parentGlobalId: string | null; revision: number };
  local: { title: string; url: string | null; parentGlobalId: string | null } | null; // null = 로컬 삭제
  remote: {
    title: string;
    url: string | null;
    parentGlobalId: string | null;
    revision: number;
    deleted: boolean;
  };
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
  resolution?: 'mine' | 'theirs' | 'both';
}

export type ReviewKind =
  'mass_delete_out' | 'mass_delete_in' | 'moved_out' | 'create_recovery' | 'excluded_url';

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  collectionId: string;
  status: 'open' | 'resolved';
  createdAt: number;
  /** 영향 항목 요약 (제목만, URL 은 상세에서) */
  items: {
    globalId: string | null;
    localId: string | null;
    title: string;
    kind: string;
    url?: string | null;
  }[];
  /** 범위 크기(비율 표시용) */
  scopeCount?: number;
  /** create_recovery: 후보 목록 */
  candidates?: { localId: string; title: string; url: string | null }[];
  journalId?: string;
  resolution?: string;
  resolvedAt?: number;
}

export interface BackupRecord {
  id: string;
  createdAt: number;
  reason: 'initial_merge' | 'mass_change' | 'manual' | 'disconnect';
  collectionId: string | null;
  bytes: number;
  /** chrome.bookmarks 트리 (합성이 아닌 실제 사용자 데이터 — 내보내기 화면에서 경고) */
  tree: unknown;
}

/** UI 로 보내는 상태 스냅샷 */
export type SyncStatusKind =
  | 'unconfigured'
  | 'idle'
  | 'syncing'
  | 'pending'
  | 'offline'
  | 'reconnecting'
  | 'paused'
  | 'review_required'
  | 'conflict'
  | 'recovery_required'
  | 'auth_required'
  | 'blocked'
  | 'checking';

export interface RecentChange {
  seq: number;
  at: string;
  deviceLabel: string;
  isThisDevice: boolean;
  kind: string;
  summary: { title: string; count: number; nodeKind: string };
}
