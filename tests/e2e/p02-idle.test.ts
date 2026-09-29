/** P02: 팝업/설정 탭을 닫고 30분 이상 유휴 → socket 유지, 유휴 뒤 편집 즉시 전달, 쓰기 폭주 없음. 별도 장기 실행. */
import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, makeFolder, subtree, waitFor, type BmNode, type ExtBrowser } from '../lib/browser';
import { localStack } from '../lib/supabase';

const RAW = new URL('../../docs/validation/raw/', import.meta.url).pathname;
mkdirSync(RAW, { recursive: true });
const IDLE_MIN = Number(process.env.P02_IDLE_MIN ?? 31);
const psql = (sql: string) =>
  execSync(`/opt/homebrew/opt/libpq/bin/psql "${localStack().dbUrl}" -Atc ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
  }).trim();
let A: ExtBrowser;
let B: ExtBrowser;
afterAll(async () => {
  await A?.close().catch(() => undefined);
  await B?.close().catch(() => undefined);
});

describe('P02 장시간 유휴', () => {
  it(
    `${IDLE_MIN}분 유휴 후 즉시 전달`,
    async () => {
      A = await launch('chromium');
      B = await launch('aside');
      const email = `synthetic-p02-${Date.now()}@example.com`;
      await A.send({ type: 'loginDev', email, password: 'synthetic-pass-1!' });
      await B.send({ type: 'loginDev', email, password: 'synthetic-pass-1!' });
      const fA = await makeFolder(A, 'shatsu-p02');
      const fB = await makeFolder(B, 'shatsu-p02');
      await A.bookmarks('create', {
        parentId: fA.id,
        title: 'seed',
        url: 'https://example.com/seed',
      });
      const pa = await A.send<{ planId: string; collectionId: string }>({
        type: 'previewMerge',
        localRootId: fA.id,
        newCollectionTitle: 'P02',
      });
      await A.send({ type: 'applyMerge', planId: pa.planId });
      await waitFor(async () =>
        (await B.send<{ collections: { id: string }[] }>({ type: 'getState' })).collections.some(
          (c) => c.id === pa.collectionId,
        ),
      );
      const pb = await B.send<{ planId: string }>({
        type: 'previewMerge',
        localRootId: fB.id,
        collectionId: pa.collectionId,
      });
      await B.send({ type: 'applyMerge', planId: pb.planId });
      await waitFor(async () => (await subtree(B, fB.id)).children!.length === 1, 30_000);
      const st = await A.send<{ account: { workspaceId: string } }>({ type: 'getState' });
      const ws = st.account.workspaceId;
      const commitsBefore = Number(
        psql(`select count(*) from shatsu.commits where workspace_id='${ws}'`),
      );
      const receiptsBefore = Number(
        psql(`select count(*) from shatsu.operation_receipts where workspace_id='${ws}'`),
      );
      // 팝업/설정 탭 닫기 (worker 만 남긴다)
      for (const b of [A, B])
        for (const p of b.context.pages()) await p.close().catch(() => undefined);
      const t0 = Date.now();
      console.log(`P02 idle start ${new Date().toISOString()} for ${IDLE_MIN} min`);
      await new Promise((r) => setTimeout(r, IDLE_MIN * 60_000));
      const commitsAfterIdle = Number(
        psql(`select count(*) from shatsu.commits where workspace_id='${ws}'`),
      );
      const receiptsAfterIdle = Number(
        psql(`select count(*) from shatsu.operation_receipts where workspace_id='${ws}'`),
      );
      // 유휴 뒤 편집 (B→A, A→B): 페이지 없이 worker 만으로 전달되는지 — 생성은 worker evaluate 로
      const t1 = Date.now();
      await B.worker.evaluate(
        (pid) =>
          chrome.bookmarks.create({
            parentId: pid,
            title: 'after idle B',
            url: 'https://example.com/after-idle-b',
          }),
        fB.id,
      );
      await waitFor(
        async () =>
          (
            await A.worker.evaluate(() =>
              chrome.bookmarks.search({ url: 'https://example.com/after-idle-b' }),
            )
          ).length === 1,
        30_000,
        100,
      );
      const latBA = Date.now() - t1;
      const t2 = Date.now();
      await A.worker.evaluate(
        (pid) =>
          chrome.bookmarks.create({
            parentId: pid,
            title: 'after idle A',
            url: 'https://example.com/after-idle-a',
          }),
        fA.id,
      );
      await waitFor(
        async () =>
          (
            await B.worker.evaluate(() =>
              chrome.bookmarks.search({ url: 'https://example.com/after-idle-a' }),
            )
          ).length === 1,
        30_000,
        100,
      );
      const latAB = Date.now() - t2;
      const socketsA = await A.worker.evaluate(
        () => (globalThis as { __shatsuSockets?: number }).__shatsuSockets ?? null,
      );
      const result = {
        measuredAt: new Date().toISOString(),
        idleMinutes: (Date.now() - t0) / 60000,
        commitsDuringIdle: commitsAfterIdle - commitsBefore,
        receiptsDuringIdle: receiptsAfterIdle - receiptsBefore,
        latencyAfterIdleMs: { 'B→A': latBA, 'A→B': latAB },
        socketsA,
        browsers: { A: A.version, B: B.version },
      };
      writeFileSync(RAW + 'p02-idle.json', JSON.stringify(result, null, 1));
      console.log('P02', JSON.stringify(result));
      expect(commitsAfterIdle - commitsBefore).toBe(0);
      expect(latBA).toBeLessThan(5000);
      expect(latAB).toBeLessThan(5000);
      void A;
      void B;
      const _unused: BmNode | null = null;
      void _unused;
    },
    (IDLE_MIN + 5) * 60_000,
  );
});
