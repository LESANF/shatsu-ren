# Agent rules — shatsu-ren

Every change, by any agent or human, follows this. `.githooks/` and branch protection on `main` enforce it. Do not bypass (`--no-verify`, force-push, direct push to `main`).

1. Work on a branch. Never commit on `main`.
2. Every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`. `prepare-commit-msg` adds it when missing; keep it.
3. Land via PR: `gh pr create --base main`, then `gh pr merge --merge --delete-branch`. Merge commits only; squash and rebase are disabled on the repo so original commit SHAs survive.
4. Commit author email is `nagong1000@naver.com` (the one linked to the GitHub account). `pre-commit` rejects anything else; cloud sessions must run `git config user.email nagong1000@naver.com` first.
5. The repo stays public.

Why: GitHub counts merged PRs (Pull Shark) and co-authored commits inside merged PRs (Pair Extraordinaire) only in public repos, at merge time, with no backfill.

Setup once per clone: `pnpm install` runs `prepare`, which sets `core.hooksPath .githooks`.
