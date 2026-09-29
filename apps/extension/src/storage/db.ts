import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CollectionRecord, Commit, FolderOrder, NodeRecord } from 'shatsu-ren-protocol';
import type {
  BackupRecord,
  Binding,
  ConflictRecord,
  JournalEntry,
  ObservedNode,
  OutboxEntry,
  ReviewItem,
} from '../sync/types';

/** 로컬 데이터는 backend origin + user + workspace 로 격리한다. */
export interface Scope {
  backendUrl: string;
  userId: string;
  workspaceId: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

interface Schema extends DBSchema {
  meta: { key: string; value: MetaRecord };
  bindings: { key: string; value: Binding };
  observed: {
    key: string;
    value: ObservedNode;
    indexes: { byGlobal: string; byCollection: string };
  };
  shadow_nodes: {
    key: string;
    value: NodeRecord;
    indexes: { byCollection: string; byParent: string };
  };
  shadow_orders: { key: string; value: FolderOrder };
  collections: { key: string; value: CollectionRecord };
  outbox: { key: string; value: OutboxEntry; indexes: { byStatus: string; byNode: string } };
  inbox: { key: number; value: { seq: number; commit: Commit; receivedAt: number } };
  journal: { key: string; value: JournalEntry; indexes: { byStatus: string } };
  conflicts: { key: string; value: ConflictRecord; indexes: { byStatus: string } };
  reviews: { key: string; value: ReviewItem; indexes: { byStatus: string } };
  backups: { key: string; value: BackupRecord };
}

export type Db = IDBPDatabase<Schema>;

const openDbs = new Map<string, Promise<Db>>();

export async function scopeHash(scope: Scope): Promise<string> {
  const text = `${scope.backendUrl}|${scope.userId}|${scope.workspaceId}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function openScopedDb(scope: Scope): Promise<Db> {
  const name = `shatsu-${await scopeHash(scope)}`;
  let p = openDbs.get(name);
  if (!p) {
    p = openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('bindings', { keyPath: 'collectionId' });
        const ob = db.createObjectStore('observed', { keyPath: 'localId' });
        ob.createIndex('byGlobal', 'globalId');
        ob.createIndex('byCollection', 'collectionId');
        const sn = db.createObjectStore('shadow_nodes', { keyPath: 'id' });
        sn.createIndex('byCollection', 'collectionId');
        sn.createIndex('byParent', 'parentId');
        db.createObjectStore('shadow_orders', { keyPath: 'parentId' });
        db.createObjectStore('collections', { keyPath: 'id' });
        const out = db.createObjectStore('outbox', { keyPath: 'opId' });
        out.createIndex('byStatus', 'status');
        out.createIndex('byNode', 'targetId');
        db.createObjectStore('inbox', { keyPath: 'seq' });
        const j = db.createObjectStore('journal', { keyPath: 'id' });
        j.createIndex('byStatus', 'status');
        const c = db.createObjectStore('conflicts', { keyPath: 'id' });
        c.createIndex('byStatus', 'status');
        const r = db.createObjectStore('reviews', { keyPath: 'id' });
        r.createIndex('byStatus', 'status');
        db.createObjectStore('backups', { keyPath: 'id' });
      },
      blocking() {
        openDbs.delete(name);
      },
    });
    openDbs.set(name, p);
  }
  return p;
}

export async function getMeta<T>(db: Db, key: string): Promise<T | undefined> {
  return (await db.get('meta', key))?.value as T | undefined;
}
export async function setMeta(db: Db, key: string, value: unknown): Promise<void> {
  await db.put('meta', { key, value });
}

/** 저장 실패는 성공 표시 금지 대상 → 호출자가 StorageError 로 상태를 올린다. */
export class StorageError extends Error {
  override name = 'StorageError';
}

export async function must<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw new StorageError(e instanceof Error ? e.message : String(e));
  }
}
