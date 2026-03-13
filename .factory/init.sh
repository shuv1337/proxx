#!/usr/bin/env bash
set -euo pipefail

cd /home/shuv/repos/proxx

# Stop the Docker app container (keep DB running)
docker stop proxx-open-hax-openai-proxy-1 2>/dev/null || true

# Ensure dependencies are installed
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Ensure DATABASE_URL is in .env for local dev
if ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  echo 'DATABASE_URL=postgresql://openai_proxy:openai_proxy@127.0.0.1:5432/openai_proxy' >> .env
fi

# Verify Postgres is reachable
pg_isready -h localhost -p 5432 -U openai_proxy || echo "WARNING: Postgres not reachable on 5432"
