/** 도메인 오류 코드. SQL(shatsu.fail) 과 동일한 문자열을 쓴다. HTTP 상태와 혼동하지 않는다. */
export const ErrorCodes = [
  'UNAUTHENTICATED',
  'SESSION_INVALID',
  'DEVICE_NOT_REGISTERED',
  'DEVICE_REVOKED',
  'FORBIDDEN',
  'WORKSPACE_DELETING',
  'PROTOCOL_VERSION_MISMATCH',
  'SERVER_GENERATION_CHANGED',
  'INVALID_OPERATION',
  'INVALID_URL',
  'NOT_FOUND',
  'PARENT_NOT_FOUND',
  'ANCHOR_NOT_FOUND',
  'REVISION_CONFLICT',
  'ORDER_CONFLICT',
  'DIGEST_MISMATCH',
  'CYCLE',
  'DUPLICATE_ID',
  'DUPLICATE_TITLE',
  'ALREADY_DELETED',
  'RESTORE_CONFLICT',
  'OP_ID_REUSED',
  'NOT_ATTEMPTED',
  'CURSOR_EXPIRED',
  'LIMIT_EXCEEDED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];

export interface RpcError {
  code: ErrorCode;
  message?: string;
  /** 충돌 시 관련 ID / revision. 제목·URL 은 넣지 않는다. */
  nodeId?: string;
  parentId?: string;
  currentRevision?: number;
  currentOrderRevision?: number;
  retryAfterSeconds?: number;
  generationId?: string;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };
