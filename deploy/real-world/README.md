# Real-world proxx deploy

This directory contains a minimal host-side deployment bundle for running `proxx` on the real-world `shuv.dev` host.

## Files

- `.env.example` — copy to `.env` and fill secrets/settings
- `docker-compose.yml` — local compose stack for API + web + Postgres
- `keys.json` — starts empty; provider accounts can be added later through the proxx UI
- `models.json` — starter model list for `/v1/models`

## Expected host layout

Suggested target path on the server:

- `/home/shuv/proxx`

## Start

```bash
cd /home/shuv/proxx
cp .env.example .env
# edit .env
sudo docker compose up -d --build
```

## Verify

```bash
curl -H "Authorization: Bearer $PROXY_AUTH_TOKEN" http://127.0.0.1:3001/health
curl -H "Authorization: Bearer $PROXY_AUTH_TOKEN" http://127.0.0.1:3001/v1/models
curl -I http://127.0.0.1:5174
```

## Browser UI

If nginx is routing `https://shuvrouter.shuv.dev` to `127.0.0.1:3001`, the API and SPA are served from the same public hostname.

## Add provider accounts later

Once the stack is up, open the UI and use the Credentials page to add provider accounts. The SQL store becomes the runtime source of truth when `DATABASE_URL` is configured.
