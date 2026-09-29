import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import vectors from './vectors.json';
import { digestInput, subtreeDigest, subtreeDigestOf } from './digest';
import { EnvelopeSchema } from './schemas';

describe('subtree digest', () => {
  for (const c of vectors.cases) {
    it(c.name, async () => {
      const input = digestInput(c.nodes, c.orders);
      expect(input).toBe(c.input);
      const expected = c.sha256 ?? createHash('sha256').update(c.input, 'utf8').digest('hex');
      expect(await subtreeDigest(c.nodes, c.orders)).toBe(expected);
    });
  }
  it('subtreeDigestOf picks only descendants', async () => {
    const A = '00000000-0000-4000-8000-00000000000a';
    const B = '00000000-0000-4000-8000-00000000000b';
    const X = '00000000-0000-4000-8000-0000000000ff';
    const nodes = [
      { id: A, parentId: null, revision: 7, kind: 'folder' },
      { id: B, parentId: A, revision: 1, kind: 'bookmark' },
      { id: X, parentId: null, revision: 1, kind: 'bookmark' },
    ];
    const orders = [{ parentId: A, revision: 4, orderedChildIds: [B] }];
    const d = await subtreeDigestOf(A, nodes, orders);
    expect(d).toBe(
      await subtreeDigest(
        [
          { id: A, parentId: null, revision: 7, deleted: false },
          { id: B, parentId: A, revision: 1, deleted: false },
        ],
        orders,
      ),
    );
  });
});

describe('envelope schema', () => {
  it('rejects wrong protocol version', () => {
    const r = EnvelopeSchema.safeParse({
      protocolVersion: 2,
      generationId: '00000000-0000-4000-8000-000000000001',
      op: {
        kind: 'patchCollection',
        opId: '00000000-0000-4000-8000-000000000002',
        collectionId: '00000000-0000-4000-8000-000000000003',
        baseRevision: 0,
        title: 'x',
      },
    });
    expect(r.success).toBe(false);
  });
});
