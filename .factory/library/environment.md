# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

- `PROXY_AUTH_TOKEN` — Required for authenticated API access. Set in `.env` (gitignored).
- `DATABASE_URL` — PostgreSQL connection string. For local dev: `postgresql://openai_proxy:openai_proxy@127.0.0.1:5432/openai_proxy`
- `.env`, `keys.json`, `models.json` are all gitignored — contain secrets
- Node.js runtime: uses `--env-file-if-exists=.env` flag to load env vars
