# Git commit / push + remote credential management — design

**Date:** 2026-07-22
**Status:** approved (user: "니 하고싶은대로 다 해 … 끝까지 구현")

## Problem

Users can clone a repo into a session workspace (`POST /api/projects` with `gitUrl`), but there is no way to commit or push back. Clone auth is deliberately disabled (`GIT_ASKPASS=/bin/echo`), so private repos fail. We need: (1) commit & push from the session chat UI, (2) git remote credential management (GitHub/GitLab/Bitbucket via HTTPS PAT), (3) a credential picker at clone time, (4) Claude itself able to `git push` from its subprocess.

## Decisions (from brainstorm)

- Credential ownership: both per-user and admin-common, mirroring the Claude-token model (`user → common`).
- Auth mechanism: HTTPS Personal Access Token only (no SSH keys in v1).
- Commit flow: file-level staging selection + message; separate Push; plus Claude can commit/push itself.

## Data model — `git_credentials`

id TEXT PK · scope('user'|'common') · owner_id (user id, or '' for common so the unique index holds) · provider('github'|'gitlab'|'bitbucket'|'other') · host (resolution key, e.g. github.com) · username (PAT = password) · token_enc (AES-GCM via secret-box.ts) · author_name? · author_email? · created_at. Unique (scope, owner_id, host). Migration via CREATE TABLE IF NOT EXISTS in initDb(). Token NEVER returned — only { id, provider, host, username, authorEmail, setAt } meta.

## Credential resolution

remote URL → host → user credential(host) → common credential(host) → none. `none` = unauthenticated (public ok, private fails with "add a credential for <host>" hint).

## Auth injection (no token in URL)

Static `GIT_ASKPASS` helper (written once, 0700) echoing `$GIT_CRED_USERNAME`/`$GIT_CRED_PASSWORD`. Secret lives only in child-process env, never on disk/URL/reflog. Env per git call: GIT_ASKPASS, GIT_TERMINAL_PROMPT=0, GIT_CRED_USERNAME, GIT_CRED_PASSWORD. Same for clone, REST push, Claude subprocess.

## Author identity

name = author_name(cred) || display_name; email = author_email(cred) || `<username>@<git_author_domain>` (admin setting, default ccw.local). Via GIT_AUTHOR_*/GIT_COMMITTER_* env — no git config writes.

## Backend files

- db/schema.ts + db/index.ts — table + DDL.
- auth/git-cred.ts — CRUD, hostFromGitUrl, resolveGitCred(userId,host), gitIdentity, askpassEnv(cred), ensure askpass script.
- lib/git-ops.ts — gitStatus/gitCommit/gitPush/originHost.
- routes/projects.ts — GET/POST /api/projects/:id/git/{status,commit,push}; credentialId? into clone.
- routes/git-credentials.ts — GET /api/git-credentials ({mine,common} meta), POST (admin guard for common), DELETE /:id (ownership/admin guard); registered in index.ts.
- claude/config-layering.ts — merge optional ctx.gitEnv.
- claude/session-manager.ts — resolve credential+identity for turn author → ctx.gitEnv.

## Frontend files

- components/GitCredentials.tsx — GitCredList({scope}) (reused) + GitCredentialsModal.
- Sidebar.tsx entry; AdminPanel.tsx common section; Chat.tsx ProjectMenu picker + header Commit/Push pills + GitPanel.
- lib/store.ts + api.ts — credential methods; git ops via api.
- lib/i18n.ts — ko+en keys.

## Demo / docs

demo/router.ts + data.ts — mock git-credentials + status/commit/push, seed a dirty repo + a stored credential. README.md + README.ko.md — feature entry.

## Out of scope (v1)

SSH keys; branch switch/create; pull/merge/fetch; per-file diff; conflict resolution. Push = current branch → origin only.

## Security

Tokens AES-GCM at rest, never returned, meta only. Token only in child env. Credential host must match remote host. Git-op endpoints behind requireAuth + canAccess; common writes behind requireAdmin. validGitUrl allow-list unchanged.
