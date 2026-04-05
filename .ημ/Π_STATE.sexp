;; Π State Snapshot
;; Generated: 2026-04-04T01:08:01Z

(
  :repo "open-hax/proxx"
  :branch "fork-tax/20260330-205903-aco-route-quota-cooldowns"
  :previous-tag "Π/20260402-184515-migration-pipeline-routing-cleanup"
  :intended-tag "Π/20260404-010801-request-log-cache-rollup-failure-exclusion"
  :remote "origin"

  :work-description
  "Correct persisted request-log cache analytics so failed prompt-cache attempts no longer count toward cache hit/key-use rollups.

  Changes:
  - Added isRequestLogEntryError/countsTowardCacheKeyUse/countsTowardCacheHit helpers in request-log-store.ts
  - Applied the predicates to hourly, daily, daily-model, daily-account, and account-accumulator rollups
  - Updated delta/reclassification paths so cache counters decrement when an entry becomes errored
  - Added regression tests covering direct failed-attempt exclusion and late error reclassification removal
  - Preserved tracked receipts.log mutation and excluded accidental package-lock.json from the snapshot"

  :verification (
    :build "pass (pnpm build)"
    :store-tests "pass (npx tsx --test src/tests/request-log-store.test.ts)"
    :proxy-analytics "pass (targeted src/tests/proxy.test.ts cache-hit summary regressions)"
    :known-red "unrelated proxy.test failure remains: glm chat requests skip ollama-cloud when provider catalog does not advertise the requested model")

  :deferred (
    :metadata-rebuild "Rebuild live services/proxx request-log metadata to refresh stale weekly/monthly cache counters"
    :ui-labeling "Disambiguate cache hit rate vs cached token share in operator UI"))
