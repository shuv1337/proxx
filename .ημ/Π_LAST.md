# Π Snapshot: request-log cache analytics rollup fix

- **Repo:** `open-hax/proxx`
- **Branch:** `fork-tax/20260330-205903-aco-route-quota-cooldowns`
- **Previous tag:** `Π/20260402-184515-migration-pipeline-routing-cleanup`
- **Intended Π tag:** `Π/20260404-010801-request-log-cache-rollup-failure-exclusion`
- **Generated:** `2026-04-04T01:08:01Z`

## What this snapshot preserves

This Π handoff captures the request-log cache analytics correction for persisted rollups. The bug was that hourly/daily/model/account rollups counted `promptCacheKeyUsed` and `cacheHit` even when the request later classified as an error, so weekly/monthly dashboard-style cache hit percentages could be badly understated relative to the direct entry-based analytics path.

### Rollup accounting fix
- `src/lib/request-log-store.ts` — added shared error-aware cache counter predicates
- Hourly, daily, daily-model, daily-account, and account-accumulator rollups now exclude failed prompt-cache attempts
- Delta/update paths now decrement cache counters if an entry is later reclassified as errored

### Regression coverage
- `src/tests/request-log-store.test.ts` — covers both initial failed-attempt exclusion and late reclassification removal
- Existing proxy analytics regression tests still pass for the direct API surfaces

### Working-tree notes
- Preserved tracked `receipts.log` mutation from session-mycology background activity
- Dropped untracked accidental `package-lock.json` instead of snapshotting it into the pnpm-managed repo

## Verification

- Build: `pnpm build` ✅
- Focused store tests: `npx tsx --test src/tests/request-log-store.test.ts` ✅
- Focused proxy analytics regressions: targeted `src/tests/proxy.test.ts` prompt-cache summary assertions ✅
- Broader note: unrelated known-red remains in full filtered proxy run (`glm chat requests skip ollama-cloud when provider catalog does not advertise the requested model`)

## Deferred

- Rebuild live `services/proxx` request-log metadata so running weekly/monthly dashboards stop reading stale cache counters
- Consider relabeling UI surfaces to distinguish cache hit rate vs cached token share more explicitly
