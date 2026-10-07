import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  ChangesPageSchema,
  DeviceRecordSchema,
  RegisterResultSchema,
  ReceiptSchema,
  SnapshotSchema,
  SyncInfoSchema,
  TrashEntrySchema,
  rpcResult,
  type ChangesPage,
  type DeviceRecord,
  type Envelope,
  type Receipt,
  type RpcError,
  type Snapshot,
  type SyncInfo,
  type TrashEntry,
} from 'shatsu-ren-protocol';

/** transport 오류(네트워크·401·429·5xx·schema 불일치)는 도메인 오류와 구분한다. */
export class TransportError extends Error {
  constructor(
    public kind:
      | 'offline'
      | 'server'
      | 'unauthorized'
      | 'rate_limited'
      | 'too_large'
      | 'bad_response'
      | 'timeout',
    message: string,
    public status?: number,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export class DomainError extends Error {
  constructor(public error: RpcError) {
    super(error.code);
    this.name = 'DomainError';
  }
}

const TIMEOUT_MS = 15_000;

async function call<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  schema: z.ZodType,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await client.rpc(fn, args).abortSignal(ctrl.signal);
  } catch (e) {
    throw new TransportError('offline', e instanceof Error ? e.message : 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.error) {
    const status = res.status;
    if (ctrl.signal.aborted) throw new TransportError('timeout', 'timeout');
    if (status === 401) throw new TransportError('unauthorized', res.error.message, status);
    if (status === 429) throw new TransportError('rate_limited', res.error.message, status, 60);
    if (status === 413) throw new TransportError('too_large', res.error.message, status);
    if (status >= 500 || status === 0)
      throw new TransportError('server', res.error.message, status);
    throw new TransportError('bad_response', `${status} ${res.error.message}`, status);
  }
  const parsed = rpcResult(schema).safeParse(res.data) as
    | { success: true; data: { ok: true; data: unknown } | { ok: false; error: RpcError } }
    | { success: false; error: z.ZodError };
  if (!parsed.success)
    throw new TransportError(
      'bad_response',
      'schema mismatch: ' + parsed.error.issues[0]?.path.join('.'),
    );
  if (!parsed.data.ok) throw new DomainError(parsed.data.error);
  return parsed.data.data as T;
}

const ApplyOneSchema = z.object({
  receipt: ReceiptSchema,
  headSeq: z.number().int(),
  generationId: z.uuid(),
});
const ApplyManySchema = z.object({
  receipts: z.array(ReceiptSchema),
  headSeq: z.number().int(),
  generationId: z.uuid(),
});

export const rpc = {
  registerDevice: (c: SupabaseClient, label: string, browser: string) =>
    call<{
      deviceId: string;
      workspaceId: string;
      generationId: string;
      protocolVersion: number;
      headSeq: number;
    }>(c, 'sync_register_device', { p_label: label, p_browser: browser }, RegisterResultSchema),
  info: (c: SupabaseClient) => call<SyncInfo>(c, 'sync_info', {}, SyncInfoSchema),
  devices: (c: SupabaseClient) =>
    call<DeviceRecord[]>(c, 'sync_devices', {}, z.array(DeviceRecordSchema)),
  revokeDevice: (c: SupabaseClient, deviceId: string) =>
    call<{ deviceId: string }>(
      c,
      'sync_revoke_device',
      { p_device_id: deviceId },
      z.object({ deviceId: z.uuid() }),
    ),
  snapshot: (c: SupabaseClient) => call<Snapshot>(c, 'sync_snapshot', {}, SnapshotSchema),
  changes: (c: SupabaseClient, afterSeq: number, limit = 200) =>
    call<ChangesPage>(
      c,
      'sync_changes',
      { p_after_seq: afterSeq, p_limit: limit },
      ChangesPageSchema,
    ),
  applyOne: (c: SupabaseClient, env: Envelope) =>
    call<{ receipt: Receipt; headSeq: number; generationId: string }>(
      c,
      'sync_apply_operation',
      { p_env: env },
      ApplyOneSchema,
    ),
  applyMany: (c: SupabaseClient, envs: Envelope[]) =>
    call<{ receipts: Receipt[]; headSeq: number; generationId: string }>(
      c,
      'sync_apply_operations',
      { p_envs: envs },
      ApplyManySchema,
    ),
  deleteCollection: (c: SupabaseClient, collectionId: string) =>
    call<{ seq: number }>(
      c,
      'sync_delete_collection',
      { p_collection_id: collectionId },
      z.object({ seq: z.number().int() }),
    ),
  trash: (c: SupabaseClient) => call<TrashEntry[]>(c, 'sync_trash', {}, z.array(TrashEntrySchema)),
};
