/**
 * subtree digest — SQL(shatsu.subtree_digest) 과 동일 규칙.
 *
 * 입력 라인(각 줄 끝 '\n', UTF-8):
 *   N <id> <revision> <parentId|-> <deleted 0|1>   … id 바이트순 정렬
 *   O <parentId> <orderRevision> <childId,childId,…> … parentId 바이트순 정렬
 * 결과: SHA-256 hex(소문자).
 * uuid 는 소문자 텍스트. 제목·URL 은 포함하지 않는다.
 */
export interface DigestNode {
  id: string;
  revision: number;
  parentId: string | null;
  deleted: boolean;
}
export interface DigestOrder {
  parentId: string;
  revision: number;
  orderedChildIds: string[];
}

const byteCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function digestInput(nodes: DigestNode[], orders: DigestOrder[]): string {
  const n = [...nodes]
    .sort((a, b) => byteCompare(a.id, b.id))
    .map((x) => `N ${x.id} ${x.revision} ${x.parentId ?? '-'} ${x.deleted ? 1 : 0}\n`);
  const o = [...orders]
    .sort((a, b) => byteCompare(a.parentId, b.parentId))
    .map((x) => `O ${x.parentId} ${x.revision} ${x.orderedChildIds.join(',')}\n`);
  return n.join('') + o.join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function subtreeDigest(nodes: DigestNode[], orders: DigestOrder[]): Promise<string> {
  return sha256Hex(digestInput(nodes, orders));
}

/** 살아 있는 node 집합에서 rootId 아래 subtree(루트 포함)를 뽑아 digest 를 계산한다. */
export async function subtreeDigestOf(
  rootId: string,
  liveNodes: Iterable<{ id: string; parentId: string | null; revision: number; kind: string }>,
  orders: Iterable<DigestOrder>,
): Promise<string> {
  const children = new Map<string, { id: string; revision: number; kind: string }[]>();
  const byId = new Map<
    string,
    { id: string; parentId: string | null; revision: number; kind: string }
  >();
  for (const n of liveNodes) {
    byId.set(n.id, n);
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? [];
      arr.push(n);
      children.set(n.parentId, arr);
    }
  }
  const root = byId.get(rootId);
  if (!root) return subtreeDigest([], []);
  const inSub = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    inSub.add(id);
    for (const c of children.get(id) ?? []) stack.push(c.id);
  }
  const dn: DigestNode[] = [];
  for (const id of inSub) {
    const n = byId.get(id)!;
    dn.push({ id, revision: n.revision, parentId: n.parentId, deleted: false });
  }
  const dord: DigestOrder[] = [];
  for (const o of orders) if (inSub.has(o.parentId)) dord.push(o);
  return subtreeDigest(dn, dord);
}
