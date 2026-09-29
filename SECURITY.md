# Security

## Reporting

Please do **not** open public issues for vulnerabilities or for anything that includes personal bookmark data or tokens.

Use GitHub's private vulnerability reporting on this repository (*Security → Report a vulnerability*). No separate e-mail address is published yet; when one exists it will be listed here.

## What to include

The class of issue, affected component (`apps/extension`, `supabase/migrations`, `supabase/functions/delete-account`, `packages/protocol`), reproduction with synthetic data, and impact (cross-account access, data loss, token exposure…).

## Model

- All server data lives in the `shatsu` Postgres schema with RLS enabled and no direct table access for `anon`/`authenticated`; only `public.sync_*` SECURITY DEFINER functions are callable, and each one verifies `auth.uid()`, the live `auth.sessions` row from the JWT `session_id`, and the device's `revoked_at`.
- Realtime uses private channels; subscription is authorized by the same checks, clients cannot publish, and the broadcast payload is a fixed `{type:"changed"}`.
- The extension stores the Supabase session in `chrome.storage.local`, never in web page storage; PKCE is used for Google sign-in; `service_role` keys are never in the extension.
- Only `http`/`https` bookmark URLs are synced; titles/URLs are rendered as text (never `innerHTML`); CSP forbids remote code and eval.
- Known limitation: an open Realtime channel keeps its authorization until the JWT is re-evaluated, so a revoked device may still learn *that* something changed (never *what*) until then. Data RPCs re-check revocation every call.
