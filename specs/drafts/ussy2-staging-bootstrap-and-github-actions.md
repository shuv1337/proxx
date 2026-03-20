# ussy2 staging bootstrap + GitHub Actions deploy gates

## Status
Draft

## Summary
Bootstrap a staging deployment for `orgs/open-hax/proxx` on `error@ussy2.promethean.rest`, then add GitHub Actions workflows that enforce a staging-first promotion model:

- merges into `staging`
  - must pass unit tests + typecheck
  - then deploy to `ussy2.promethean.rest`
  - then run the full live e2e suite against staging
- PRs into `main`
  - must pass linting/typecheck/tests/builds
  - must prove the candidate commit already deployed successfully to staging
  - if no successful staging deployment exists for that commit, merge is blocked
- merges into `main`
  - deploy to `error@ussy.promethean.rest`
  - verify production health after deploy

## Current state
- Production deployment exists and is operational on `ussy.promethean.rest`, but was established manually.
- Repo now has prepared project-local deployment/CI assets for staging + production automation:
  - `.github/workflows/staging-pr.yml`
  - `.github/workflows/deploy-staging.yml`
  - `.github/workflows/main-pr-gate.yml`
  - `.github/workflows/deploy-production.yml`
  - `scripts/ci-lint.sh`
  - `scripts/deploy-remote.sh`
  - `deploy/docker-compose.ssl.yml`
  - `deploy/Caddyfile.template`
- Existing live validation scripts are:
  - `scripts/e2e-test.sh` — broad provider/live route exercise, still environment-sensitive
  - `scripts/e2e-multitenancy-smoke.sh` — focused tenant-policy + tenant-key smoke, green locally against a live DB-backed instance
- Current local SSH access state:
  - `ssh error@ussy.promethean.rest` works
  - `ssh error@ussy2.promethean.rest` currently fails with `Permission denied (publickey,keyboard-interactive)`
- `ussy2.promethean.rest` does not currently answer on `:8789` or `:443`.

## Goals
1. Get a staging instance running on `ussy2.promethean.rest`.
2. Make staging deploy reproducible from repository automation.
3. Make `main` promotion depend on a prior successful staging deployment for the same commit.
4. Make production deploy reproducible from repository automation.

## Non-goals
- Replacing the current production runtime topology with a completely different platform.
- Secret rotation strategy beyond wiring deploy-time secrets into Actions.
- Full branch-protection configuration via API (repo settings still need a human to require the checks, unless a separate admin automation exists).

## Risks
- Staging bootstrap is blocked until SSH authorization to `ussy2.promethean.rest` exists.
- The broad live e2e suite is provider/environment sensitive; gating on it requires either a stable staging runtime or a more deterministic suite.
- GitHub-hosted runners need deploy secrets and SSH keys that are not currently stored in the repo.
- Staging/prod drift is likely if runtime files remain hand-managed outside the repo.

## Open questions
1. What exact runtime path should staging use on the remote host? Proposed: `~/devel/services/proxx-staging`.
2. Should staging use TLS on `ussy2.promethean.rest` immediately? Proposed: yes, mirror production via a dedicated Caddy overlay.
3. Which check name should gate `main` PRs? Proposed: a dedicated `staging-promotion-gate` job that verifies successful staging deploy + live e2e on the PR head SHA.
4. How should secrets be supplied in Actions? Proposed minimum:
   - `STAGING_SSH_PRIVATE_KEY`
   - `STAGING_SSH_HOST`
   - `STAGING_SSH_USER`
   - `STAGING_PROXY_AUTH_TOKEN`
   - `STAGING_ENV_FILE`
   - `STAGING_KEYS_JSON`
   - `STAGING_MODELS_JSON`
   - same set for production

## Phases

### Phase 1: Remote access + staging bootstrap
- Confirm SSH authorization to `error@ussy2.promethean.rest`.
- Create remote runtime directories.
- Sync deployable runtime files.
- Start staging compose stack.
- Verify health.

### Phase 2: Repository deploy scripts
- Add repo-local deploy scripts that can sync files and restart remote staging/prod safely.
- Add repo-local validation scripts suitable for CI.

### Phase 3: GitHub Actions
- Add `staging` PR checks.
- Add `staging` branch deploy workflow.
- Add `main` PR gate workflow.
- Add `main` branch production deploy workflow.

### Phase 4: Documentation + verification
- Document required GitHub secrets and required branch-protection checks.
- Record the staging/prod promotion contract in repo docs/specs.

## Immediate blocker
`error@ussy2.promethean.rest` is not yet reachable with the current local SSH key, so live staging bootstrap cannot complete until SSH auth is fixed.

Evidence gathered:
- `ssh error@ussy.promethean.rest` succeeds.
- `ssh error@ussy2.promethean.rest` currently fails with `Permission denied (publickey,keyboard-interactive)`.
- `ussy2.promethean.rest` does not currently answer on `:8789` or `:443` from the public side.

## Required repository secrets / vars
### Staging secrets
- `STAGING_SSH_PRIVATE_KEY`
- `STAGING_ENV_FILE`
- `STAGING_KEYS_JSON`
- `STAGING_MODELS_JSON`
- `STAGING_PROXY_AUTH_TOKEN`

### Production secrets
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_ENV_FILE`
- `PRODUCTION_KEYS_JSON`
- `PRODUCTION_MODELS_JSON`
- `PRODUCTION_PROXY_AUTH_TOKEN`

### Recommended repo/environment vars
- `STAGING_SSH_HOST` = `ussy2.promethean.rest`
- `STAGING_SSH_USER` = `error`
- `STAGING_DEPLOY_PATH` = `~/devel/services/proxx-staging`
- `STAGING_PUBLIC_HOST` = `ussy2.promethean.rest`
- `STAGING_BASE_URL` = `https://ussy2.promethean.rest`
- `PRODUCTION_SSH_HOST` = `ussy.promethean.rest`
- `PRODUCTION_SSH_USER` = `error`
- `PRODUCTION_DEPLOY_PATH` = `~/devel/services/proxx`
- `PRODUCTION_BASE_URL` = `https://ussy.promethean.rest`

## Required branch-protection checks
### `staging`
- `staging-typecheck`
- `staging-unit-tests`

### `main`
- `main-lint`
- `main-typecheck`
- `main-unit-tests`
- `main-build`
- `main-web-build`
- `staging-promotion-gate`
