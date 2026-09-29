# Contributing

## Ground rules

- Bookmarks are personal data. Never paste real titles/URLs, exported backups, diagnostics with real data, or any token into an issue or PR. Use `example.com` synthetic data (all tests do).
- Do not add features listed as out of scope in `docs/BLUEPRINT.md` §2.2 (payments, other login providers, E2EE, CRDT, AI tagging, new-tab page…) without a design discussion first.
- The extension UI reads state only from the sync engine. Do not add UI-side sync logic or fake success states.

## Verifying a change

Minimum for any PR:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If you touch `supabase/migrations` or `packages/protocol` digest rules:

```bash
supabase start && pnpm test:db && pnpm --filter shatsu-ren-tests test:db
```

If you touch `apps/extension/src/sync` or the UI, run the browser suite (needs Aside installed and a dev-auth build):

```bash
pnpm --filter shatsu-ren-extension build:dev-auth
pnpm test:e2e
```

The SQL digest and the TypeScript digest must stay identical; both are checked against `packages/protocol/src/vectors.json`. Add a vector when you change the rule.

## Reproducing data-loss bugs

Please report: both browser names/versions, the extension version, whether the item was inside a connected folder, the sequence of edits on each side, and an anonymized diagnostics export (*Settings → Advanced → Export diagnostics*; it contains no titles/URLs/tokens). A minimal script against `tests/lib/browser.ts` is ideal.

## Style

TypeScript strict, prettier (`pnpm lint`). Discriminated unions for commands/results, runtime validation (zod / SQL checks) at every boundary, explicit error handling. Keep files close to the code they test.
