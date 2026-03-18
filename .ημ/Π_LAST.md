branch: hotfix/gpt-5.4-free-access
head: 30f0a14474c6fd2e3fcc77aac478617642d3c1bf
ts: 2026-03-18T18:04:01Z
remote: git@github.com:open-hax/proxx.git
commits:
30f0a14 Π: snapshot 2026-03-18T17:58:36Z [hotfix/gpt-5.4-free-access] (2e012ff)
2e012ff receipts: record full dirty-state restore + deploy
fdc1227 Restore live dirty state (dashboard windows + UI prefs + request log accumulators)
f9a0b63 Allow gpt-5.4 on free OpenAI OAuth accounts
d236e17 Π: snapshot 2026-03-18T04:55:50Z [main] (457a620)
457a620 Π: snapshot 2026-03-17T10:52:47-05:00 [main] (b6c18a0)
b6c18a0 Π: snapshot 2026-03-17T00:12:58-05:00 [main] (4ba3881)
4ba3881 feat: OpenAI images fallback via Codex Responses image_generation
021b82a Π: snapshot 2026-03-16T18:31:34-05:00 [main] (6c71e5c)
6c71e5c Π: snapshot 2026-03-16T18:18:33-05:00 [main] (b543b5e)
b543b5e Π: snapshot 2026-03-15T01:19:36-05:00 [main] (c120c0f)
c120c0f feat: infinite scroll for account health panel
b38614c feat: cursor-based infinite scroll for request log panel
13b198d layout: consolidate yellow panels into left column, tall logs/health columns
7389466 fix: sort account token share by totalTokens not health score
3b2b47c fix: persist account accumulators to disk for correct token stats after restart
76557fe fix: populate account accumulators on startup + layout: tall columns for logs/health
8d8f156 fix: use per-account accumulators for dashboard token stats
3f8d7dc ui: compact dashboard — reduce padding, gaps, font sizes, and chrome
5734322 fix: compute TPS for codex SSE responses with missing content-type
90a471d ui: fixed-viewport dashboard with scrollable panels
456efae fix: preserve cached token details in responses-to-chat-completion conversion
0520a8f fix: record token usage for codex SSE responses with missing content-type
021ae86 fix: remove ollama-cloud from GPT provider order (no GPT models except gpt-oss)
826810a feat: add factory provider to GPT model routing policy
c3c37e1 fix: permanently disable api_key accounts on 402/403
db31528 fix: strip max_output_tokens for codex paths (unsupported parameter)
b68c701 fix: codex instructions regression + dev workflow with e2e tests
191402b Merge pull request #42 from open-hax/feat/health-scores
d7238cd docs: add PR#42 review-fix spec draft
