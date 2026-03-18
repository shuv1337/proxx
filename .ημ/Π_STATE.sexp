(pi-state
  (timestamp "2026-03-18T17:58:36Z")
  (repo "open-hax-openai-proxy")
  (branch "hotfix/gpt-5.4-free-access")
  (remote "origin/hotfix/gpt-5.4-free-access")
  (base-head "2e012ff")
  (previous-pi-head "2e012ff")
  (dirty-before true)
  (intent-clean-after true)
  (status-digest "e3b0-c442-98fc-1c14")
  (summary
    "Add dashboard usage window modes (daily/weekly/monthly) backed by retained daily buckets in request-log-store and dashboard overview API."
    "Persist UI preferences in localStorage across dashboard, chat, images, tools, and credentials surfaces via new web storage helpers."
    "Allow gpt-5.4 on free OpenAI OAuth accounts and update provider-policy/proxy coverage to match observed upstream behavior.")
  (verification
    (check (status "pass") (command "pnpm run build"))
    (check (status "pass") (command "pnpm run web:build"))
    (check (status "pass") (command "pnpm run typecheck"))
    (check (status "fail") (command "pnpm test") (note "ERR_MODULE_NOT_FOUND for dist/app.js, dist/lib/request-log-store.js, and dist/lib/provider-strategy.js while executing built tests"))))
