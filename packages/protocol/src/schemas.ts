import { z } from 'zod';
import { ErrorCodes } from './errors';
import { PROTOCOL_VERSION } from './types';

const uuid = z.uuid();
const nonNegInt = z.number().int().nonnegative();

export const NodeRecordSchema = z.object({
  id: uuid,
  collectionId: uuid,
  kind: z.enum(['root', 'folder', 'bookmark']),
  parentId: uuid.nullable(),
  title: z.string(),
  url: z.string().nullable(),
  revision: nonNegInt,
  deletedAt: z.string().nullable(),
  deletionId: uuid.nullable(),
});

export const FolderOrderSchema = z.object({
  parentId: uuid,
  orderedChildIds: z.array(uuid),
  revision: nonNegInt,
});

export const CollectionRecordSchema = z.object({
  id: uuid,
  title: z.string(),
  rootNodeId: uuid,
  revision: nonNegInt,
});

const base = { opId: uuid, collectionId: uuid };
export const OperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    ...base,
    nodeId: uuid,
    nodeKind: z.enum(['folder', 'bookmark']),
    parentId: uuid,
    title: z.string(),
    url: z.string().nullable(),
    afterId: uuid.nullable(),
  }),
  z.object({
    kind: z.literal('patch'),
    ...base,
    nodeId: uuid,
    baseRevision: nonNegInt,
    patch: z.object({ title: z.string().optional(), url: z.string().optional() }),
  }),
  z.object({
    kind: z.literal('move'),
    ...base,
    nodeId: uuid,
    baseRevision: nonNegInt,
    parentId: uuid,
    afterId: uuid.nullable(),
  }),
  z.object({
    kind: z.literal('reorder'),
    ...base,
    parentId: uuid,
    baseOrderRevision: nonNegInt,
    orderedChildIds: z.array(uuid),
  }),
  z.object({
    kind: z.literal('deleteSubtree'),
    ...base,
    nodeId: uuid,
    baseRevision: nonNegInt,
    expectedSubtreeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  z.object({ kind: z.literal('restore'), ...base, deletionId: uuid, parentId: uuid.nullable() }),
  z.object({ kind: z.literal('createCollection'), ...base, rootNodeId: uuid, title: z.string() }),
  z.object({
    kind: z.literal('patchCollection'),
    ...base,
    baseRevision: nonNegInt,
    title: z.string(),
  }),
]);

export const EnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  generationId: uuid,
  op: OperationSchema,
});

export const ReceiptSchema = z.object({
  opId: uuid,
  status: z.enum(['applied', 'noop', 'conflict', 'rejected', 'not_attempted']),
  seq: nonNegInt.optional(),
  code: z.string().optional(),
  nodeId: uuid.optional(),
  revision: nonNegInt.optional(),
  currentRevision: nonNegInt.optional(),
  parentId: uuid.optional(),
  orderRevision: nonNegInt.optional(),
  deletionId: uuid.optional(),
});

export const CommitSchema = z.object({
  seq: z.number().int().positive(),
  sourceDeviceId: uuid,
  opId: uuid,
  kind: z.string(),
  payload: z.object({
    nodes: z.array(NodeRecordSchema),
    orders: z.array(FolderOrderSchema),
    collections: z.array(CollectionRecordSchema).optional(),
    deletionId: uuid.optional(),
    restoredDeletionId: uuid.optional(),
  }),
  serverTime: z.string(),
});

export const RpcErrorSchema = z.object({
  code: z.enum(ErrorCodes),
  message: z.string().optional(),
  nodeId: uuid.optional(),
  parentId: uuid.optional(),
  currentRevision: nonNegInt.optional(),
  currentOrderRevision: nonNegInt.optional(),
  retryAfterSeconds: z.number().optional(),
  generationId: uuid.optional(),
});

export const rpcResult = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: RpcErrorSchema }),
  ]);

export const SyncInfoSchema = z.object({
  protocolVersion: z.number().int(),
  generationId: uuid,
  workspaceId: uuid,
  headSeq: nonNegInt,
  status: z.enum(['active', 'deleting']),
  limits: z.record(z.string(), z.number()),
});

export const SnapshotSchema = z.object({
  generationId: uuid,
  headSeq: nonNegInt,
  collections: z.array(CollectionRecordSchema),
  nodes: z.array(NodeRecordSchema),
  orders: z.array(FolderOrderSchema),
});

export const ChangesPageSchema = z.object({
  generationId: uuid,
  headSeq: nonNegInt,
  commits: z.array(CommitSchema),
  nextCursor: nonNegInt,
  hasMore: z.boolean(),
});

export const DeviceRecordSchema = z.object({
  id: uuid,
  label: z.string(),
  browser: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  isCurrent: z.boolean(),
});

export const RegisterResultSchema = z.object({
  deviceId: uuid,
  workspaceId: uuid,
  generationId: uuid,
  protocolVersion: z.number().int(),
  headSeq: nonNegInt,
});

export const TrashEntrySchema = z.object({
  deletionId: uuid,
  collectionId: uuid,
  rootNodeId: uuid,
  rootTitle: z.string().nullable(),
  itemCount: nonNegInt,
  originalParentId: uuid,
  deletedAt: z.string(),
  expiresAt: z.string(),
  restoredAt: z.string().nullable(),
  sourceDeviceId: uuid.nullable(),
});
