# Π Snapshot — 2026-03-18T17:58:36Z

- Repo: `open-hax-openai-proxy`
- Branch: `hotfix/gpt-5.4-free-access`
- Remote: `origin/hotfix/gpt-5.4-free-access`
- Base HEAD at capture start: `2e012ff`
- Working tree at capture start: dirty

## What changed
- Add dashboard usage window modes (daily / weekly / monthly) with retained daily buckets in `src/lib/request-log-store.ts` and overview query support in `src/lib/ui-routes.ts`.
- Persist UI preferences across dashboard, chat, images, tools, and credentials pages via `web/src/lib/local-storage.ts` and `web/src/lib/use-stored-state.ts`.
- Allow `gpt-5.4` on free OpenAI OAuth accounts by updating GPT policy defaults and related provider-policy/proxy tests.

## Files to inspect
- `src/lib/request-log-store.ts`
- `src/lib/ui-routes.ts`
- `src/lib/policy/defaults/gpt.ts`
- `src/tests/provider-policy.test.ts`
- `src/tests/proxy.test.ts`
- `web/src/lib/api.ts`
- `web/src/lib/local-storage.ts`
- `web/src/lib/use-stored-state.ts`
- `web/src/pages/DashboardPage.tsx`
- `web/src/pages/CredentialsPage.tsx`
- `specs/drafts/dashboard-usage-window-modes.md`
- `specs/drafts/ui-preferences-localstorage.md`

## Verification
- pass: `pnpm run build`
- pass: `pnpm run web:build`
- pass: `pnpm run typecheck`
- fail: `pnpm test` (`ERR_MODULE_NOT_FOUND` for `dist/app.js`, `dist/lib/request-log-store.js`, and `dist/lib/provider-strategy.js` while running built tests)

## Notes
- Artifacts capture the pre-snapshot base head; the final Π commit/tag are created after artifact assembly.
- This Π preserves the current branch state despite the existing built-test resolution failure.
