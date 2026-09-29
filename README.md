# shatsu-ren

**Your bookmarks, across browsers.** · 한국어 안내: [README.ko.md](./README.ko.md)

shatsu-ren (샤츠렌) is an open-source (MIT) Manifest V3 extension that keeps a bookmark folder you choose in sync between Chromium-based browsers (Google Chrome, [Aside](https://aside.com)) and between computers, using one Google account. Bookmarks stay in the browser's native bookmark manager; the extension only syncs the folders you explicitly connect.

> **Status (2026-09-29): local v1 implementation, verified end-to-end on a local Supabase stack.** There is no public hosted service yet, Google sign-in is implemented but unverified (no OAuth credentials were available), and the extension is not in any store. See [docs/validation/RESULTS.md](./docs/validation/RESULTS.md) for exactly what was verified.

## What it does

- Sync add / edit (title, URL) / move / reorder / delete of bookmarks and folders inside connected folders, including empty folders and order.
- Realtime: a change in one browser reaches the other in about **0.3 s** on a local stack (p95 measured, 60 samples); a 5-minute check recovers lost signals.
- First connection shows a preview (what goes where, duplicates kept, unsupported URLs excluded, **0 deletes**) and takes a local backup before applying.
- Conflicts (same item edited on both sides, delete vs. edit) are never resolved silently; you choose *my change / server change / keep both*.
- Mass deletes (≥20 items, or ≥5 and ≥20 % of a folder) stop for review on the sending **and** the receiving browser.
- 30-day trash restore, local JSON export/import, per-folder pause, disconnect without deleting anything.
- Korean and English UI, light/dark theme, keyboard operable.

## What it does not do (v1)

- No end-to-end encryption: the server (Supabase project operator) can read titles, URLs and folder structure.
- Only Google sign-in. No Firefox/Safari/mobile. No AI tags, no link checking, no new-tab page.
- Moving an item out of a connected folder into another connected folder is reviewed, not guessed.
- Browsers that are closed or asleep catch up after they come back.

## Install (development build)

Requirements: Node ≥ 22, pnpm 12, Docker-compatible runtime (Docker Desktop or [colima](https://github.com/abiosoft/colima)), [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
git clone https://github.com/LESANF/shatsu-ren.git
cd shatsu-ren
pnpm setup             # pnpm install --frozen-lockfile
supabase start         # local Auth + Postgres + Realtime; applies supabase/migrations
pnpm --filter shatsu-ren-extension build:dev-auth   # extension pointing at http://127.0.0.1:54321
```

The dev build writes `apps/extension/.output/chrome-mv3-dev`. Load it as an unpacked extension:

- **Aside / Chromium**: `chrome://extensions` → Developer mode → *Load unpacked* → select that folder.
- **Google Chrome 137+**: same steps. (Chrome ignores `--load-extension`, so automated tests use Playwright's Chromium; see [docs/validation/COMPATIBILITY.md](./docs/validation/COMPATIBILITY.md).)

The dev build shows a **"Local test login"** form (synthetic email + password against the local Supabase). It is compiled out of release builds. Details: [docs/INSTALL.md](./docs/INSTALL.md).

## Release ZIP

```bash
pnpm zip   # apps/extension/.output/shatsu-ren-<version>-chrome.zip (+ .sha256)
```

A release build has **no backend baked in** unless `WXT_SUPABASE_URL` / `WXT_SUPABASE_ANON_KEY` are set at build time; users can connect their own Supabase project under *Settings → Advanced*. See [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md).

## How syncing works (short)

- Each browser profile is a *device* bound to its Supabase auth session. Each account has one *workspace*; each connected folder is a *collection*.
- Every change is an idempotent *operation* (`opId`) applied by a Postgres function under a per-workspace lock; commits get a monotonic `seq`. Receipts make retries safe (same `opId` + same body → same result; different body → `OP_ID_REUSED`).
- Clients keep a 3-way base (last agreed state) per item and compare it with the browser (local) and the server (shadow). Local-only change → send; remote-only → apply; both → conflict.
- The server publishes a fixed `{type:"changed"}` signal on a private Realtime channel; the commit log is the source of truth.
- Deletes are tombstones; subtree deletes are verified with a SHA-256 digest of the subtree, so concurrent additions inside a folder block the delete.

Full design: [docs/BLUEPRINT.md](./docs/BLUEPRINT.md). Decisions and deviations: [docs/DECISIONS.md](./docs/DECISIONS.md).

## Development

| Command | What |
|---|---|
| `pnpm typecheck` / `pnpm lint` | TypeScript strict / prettier |
| `pnpm test` | pure logic tests (protocol digest vectors, 3-way reconcile) |
| `pnpm test:db` | pgTAP (digest vectors + grants) against the local Supabase |
| `pnpm --filter shatsu-ren-tests test:db` | RPC integration tests with real Auth sessions, PostgREST and Realtime |
| `pnpm test:e2e` | Playwright: Chromium ↔ Aside end-to-end (needs both browsers, local stack, dev-auth build) |
| `pnpm build` / `pnpm zip` | production build / release ZIP |

Repository layout: `apps/extension` (WXT + React), `packages/protocol` (types, schemas, digest, test vectors), `supabase` (migrations, pgTAP tests, `delete-account` edge function), `tests` (integration + browser E2E), `docs`.

## Compatibility and evidence

- Verified: macOS 26.6 · Playwright Chromium 153 · Aside 1.0.928.1 · Supabase CLI 2.118 local stack. Google Chrome 154: manual unpacked load only. Windows/Linux: not verified.
- [docs/validation/RESULTS.md](./docs/validation/RESULTS.md) — 73 acceptance scenarios with pass / fail / blocked and evidence paths.
- [docs/validation/PERFORMANCE.md](./docs/validation/PERFORMANCE.md), [docs/validation/COMPATIBILITY.md](./docs/validation/COMPATIBILITY.md), screenshots in `docs/validation/screenshots/` (synthetic data only).

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md). Never paste real bookmarks or tokens into issues.

## License

MIT © 2026 LESANF. The name and any future logo are not covered by the code license. The current icon is a monochrome placeholder generated by `apps/extension/scripts/make-placeholder-icons.mjs`.
