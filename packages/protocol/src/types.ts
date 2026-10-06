export const PROTOCOL_VERSION = 1 as const;

export const LIMITS = {
  maxActiveNodes: 10_000,
  maxDepth: 32,
  maxTitleBytes: 4 * 1024,
  maxUrlBytes: 16 * 1024,
  maxOperationBytes: 2 * 1024 * 1024,
  maxBatchOps: 100,
  maxResponseBytes: 32 * 1024 * 1024,
  writesPerMinutePerDevice: 120,
  changesPageSize: 200,
} as const;

export type NodeKind = 'root' | 'folder' | 'bookmark';

export interface NodeRecord {
  id: string;
  collectionId: string;
  kind: NodeKind;
  parentId: string | null;
  title: string;
  url: string | null;
  revision: number;
  deletedAt: string | null;
  deletionId: string | null;
}

export interface FolderOrder {
  parentId: string;
  orderedChildIds: string[];
  revision: number;
}

export interface CollectionRecord {
  id: string;
  title: string;
  rootNodeId: string;
  revision: number;
  createdAt?: string | undefined;
  createdByDeviceId?: string | null | undefined;
}

export interface DeviceRecord {
  id: string;
  label: string;
  browser: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  isCurrent: boolean;
}

/** 클라이언트가 서버로 보내는 명령. 재전송 시 opId 와 body 를 바꾸지 않는다. */
export type Operation =
  | {
      kind: 'create';
      opId: string;
      collectionId: string;
      nodeId: string;
      nodeKind: 'folder' | 'bookmark';
      parentId: string;
      title: string;
      url: string | null;
      afterId: string | null;
    }
  | {
      kind: 'patch';
      opId: string;
      collectionId: string;
      nodeId: string;
      baseRevision: number;
      patch: { title?: string; url?: string };
    }
  | {
      kind: 'move';
      opId: string;
      collectionId: string;
      nodeId: string;
      baseRevision: number;
      parentId: string;
      afterId: string | null;
    }
  | {
      kind: 'reorder';
      opId: string;
      collectionId: string;
      parentId: string;
      baseOrderRevision: number;
      orderedChildIds: string[];
    }
  | {
      kind: 'deleteSubtree';
      opId: string;
      collectionId: string;
      nodeId: string;
      baseRevision: number;
      expectedSubtreeDigest: string;
    }
  | {
      kind: 'restore';
      opId: string;
      collectionId: string;
      deletionId: string;
      /** null 이면 원래 부모(살아 있을 때만) */
      parentId: string | null;
    }
  | {
      kind: 'createCollection';
      opId: string;
      collectionId: string;
      rootNodeId: string;
      title: string;
    }
  | {
      kind: 'patchCollection';
      opId: string;
      collectionId: string;
      baseRevision: number;
      title: string;
    };

export type OperationKind = Operation['kind'];

export interface Envelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  generationId: string;
  op: Operation;
}

export type ReceiptStatus = 'applied' | 'noop' | 'conflict' | 'rejected' | 'not_attempted';

export interface Receipt {
  opId: string;
  status: ReceiptStatus;
  seq?: number;
  code?: string;
  nodeId?: string;
  revision?: number;
  currentRevision?: number;
  parentId?: string;
  orderRevision?: number;
  deletionId?: string;
}

/** commit payload = 바뀐 node 최종값 + 영향 받은 폴더 최종 순서 */
export interface CommitPayload {
  nodes: NodeRecord[];
  orders: FolderOrder[];
  collections?: CollectionRecord[];
  deletionId?: string;
  restoredDeletionId?: string;
  /** deleteCollection commit: 이 서버 북마크가 통째로 지워졌다 */
  deletedCollectionId?: string;
}

export interface Commit {
  seq: number;
  sourceDeviceId: string;
  opId: string;
  kind: OperationKind | 'deleteCollection';
  payload: CommitPayload;
  serverTime: string;
}

export interface SyncInfo {
  protocolVersion: number;
  generationId: string;
  workspaceId: string;
  headSeq: number;
  status: 'active' | 'deleting';
  limits: typeof LIMITS;
}

export interface Snapshot {
  generationId: string;
  headSeq: number;
  collections: CollectionRecord[];
  nodes: NodeRecord[];
  orders: FolderOrder[];
}

export interface ChangesPage {
  generationId: string;
  headSeq: number;
  commits: Commit[];
  nextCursor: number;
  hasMore: boolean;
}

export interface TrashEntry {
  deletionId: string;
  collectionId: string;
  rootNodeId: string;
  rootTitle: string | null;
  itemCount: number;
  originalParentId: string;
  deletedAt: string;
  expiresAt: string;
  restoredAt: string | null;
  sourceDeviceId: string | null;
}
