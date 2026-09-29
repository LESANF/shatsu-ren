import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Operation, Receipt, RpcResult } from 'shatsu-ren-protocol';

export interface LocalStack {
  url: string;
  anonKey: string;
  serviceKey: string;
  dbUrl: string;
}

let cached: LocalStack | null = null;
export function localStack(): LocalStack {
  if (cached) return cached;
  const raw = execSync('supabase status -o json', {
    cwd: new URL('../..', import.meta.url).pathname,
    encoding: 'utf8',
  });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  cached = { url: j.API_URL, anonKey: j.ANON_KEY, serviceKey: j.SERVICE_ROLE_KEY, dbUrl: j.DB_URL };
  return cached;
}

export function anonClient(): SupabaseClient {
  const s = localStack();
  return createClient(s.url, s.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 합성 계정 (example.com). 비밀번호 로그인은 로컬 테스트 전용. */
export async function syntheticUser(
  tag = 'user',
): Promise<{ client: SupabaseClient; email: string; userId: string; password: string }> {
  const s = localStack();
  const email = `synthetic-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `synthetic-${randomUUID()}`;
  const client = createClient(s.url, s.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.session) throw new Error('signup failed: ' + error?.message);
  return { client, email, userId: data.user!.id, password };
}

/** 같은 계정으로 새 세션(=새 장치) 하나 더 */
export async function anotherSession(email: string, password: string): Promise<SupabaseClient> {
  const s = localStack();
  const client = createClient(s.url, s.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function rpc<T = unknown>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn} transport error: ${error.message}`);
  return data as RpcResult<T>;
}

export async function register(client: SupabaseClient, label = 'test') {
  const r = await rpc<{
    deviceId: string;
    workspaceId: string;
    generationId: string;
    headSeq: number;
  }>(client, 'sync_register_device', { p_label: label, p_browser: 'test' });
  if (!r.ok) throw new Error('register failed ' + r.error.code);
  return r.data;
}

export const env = (generationId: string, op: Operation) => ({
  protocolVersion: 1,
  generationId,
  op,
});

export async function apply(client: SupabaseClient, generationId: string, op: Operation) {
  const r = await rpc<{ receipt: Receipt; headSeq: number }>(client, 'sync_apply_operation', {
    p_env: env(generationId, op),
  });
  if (!r.ok) throw new Error('apply transport-level domain error ' + r.error.code);
  return r.data.receipt;
}

export async function newCollection(
  client: SupabaseClient,
  generationId: string,
  title = 'Synthetic',
) {
  const collectionId = randomUUID();
  const rootNodeId = randomUUID();
  const rc = await apply(client, generationId, {
    kind: 'createCollection',
    opId: randomUUID(),
    collectionId,
    rootNodeId,
    title,
  });
  if (rc.status !== 'applied') throw new Error('createCollection ' + rc.status + ' ' + rc.code);
  return { collectionId, rootNodeId };
}

export async function createNode(
  client: SupabaseClient,
  generationId: string,
  collectionId: string,
  parentId: string,
  o: {
    kind?: 'bookmark' | 'folder';
    title?: string;
    url?: string | null;
    afterId?: string | null;
    nodeId?: string;
  } = {},
) {
  const nodeId = o.nodeId ?? randomUUID();
  const kind = o.kind ?? 'bookmark';
  const receipt = await apply(client, generationId, {
    kind: 'create',
    opId: randomUUID(),
    collectionId,
    nodeId,
    nodeKind: kind,
    parentId,
    title: o.title ?? 'item',
    url: kind === 'bookmark' ? (o.url ?? `https://example.com/${nodeId.slice(0, 8)}`) : null,
    afterId: o.afterId ?? null,
  });
  return { nodeId, receipt };
}

export async function snapshot(client: SupabaseClient) {
  const r = await rpc<{
    nodes: {
      id: string;
      parentId: string | null;
      revision: number;
      title: string;
      url: string | null;
      deletedAt: string | null;
    }[];
    orders: { parentId: string; orderedChildIds: string[]; revision: number }[];
    headSeq: number;
    generationId: string;
  }>(client, 'sync_snapshot');
  if (!r.ok) throw new Error('snapshot ' + r.error.code);
  return r.data;
}

export const uuid = randomUUID;
