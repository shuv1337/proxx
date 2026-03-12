# Plan: Add Maple OTEL Telemetry to Proxx

Instrument the proxx OpenAI-compatible proxy with OTEL telemetry exported to the Maple observability stack.

## Context

Proxx is an OpenAI-compatible chat proxy (`open-hax-openai-proxy`) running in Docker on shuvdev via pm2-runtime. It handles multi-provider routing, key rotation, model aliasing, and protocol translation (Messages, Responses, Ollama native). It uses Fastify as its HTTP framework.

Maple OTEL ingest gateway runs at `shuvdev:3474` with ingest key `maple_pk_u0Z7qYQTZSKBU7xtM8FJwt9GVk-gq2CZ`. The container can reach the host via `host.docker.internal`.

### Current Maple services (8)
- `shiv`, `shuvmon-hub`, `shuvdev-host` (shuvdev)
- `overseer-fleet-relay`, `overseer-agent-shuvbot` (shuvbot)
- `overseer-agent-shuvdev` (shuvdev)
- `overseer-agent-nick` (nick)
- `shuvlr-backend` (shuvdev)

### Architecture

- **Framework**: Fastify (Node.js)
- **Runtime**: Docker container, pm2-runtime, Node 22
- **Entry point**: `src/main.ts` -> `src/app.ts` (`createApp()`)
- **Key request flows**:
  - `POST /v1/chat/completions` -- main proxy endpoint, multi-provider fallback
  - `POST /v1/embeddings` -- embedding proxy
  - `POST /api/chat`, `/api/generate`, `/api/embed`, `/api/embeddings` -- Ollama native bridges
  - `GET /v1/models`, `/api/tags` -- model catalog
  - `GET /health` -- health check
  - `/api/ui/*` -- web console API routes
- **Existing request logging**: `RequestLogStore` tracks per-attempt provider/model/latency/status/tokens -- this data is the primary source for span attributes
- **Config**: All via env vars (`src/lib/config.ts`), no config files for OTEL needed

### Approach

Copy the zero-dependency OTEL HTTP exporter from the shuvlr implementation (`~/repos/shuvlr/apps/backend/src/telemetry/otel.ts`). This reads from standard `OTEL_*` env vars and uses raw `fetch` to POST OTLP JSON -- no npm dependencies required.

Instrument at two levels:
1. **Fastify request hook** -- automatic span per HTTP request with method/path/status
2. **Provider attempt tracking** -- span per upstream attempt with provider/model/account/latency/status/tokens

The Fastify hook gives us blanket coverage. The provider-level spans give deep insight into key rotation, fallback chains, and upstream latency.

---

## Tasks

### 1. Copy and adapt the telemetry module

- [x] Copy the telemetry module into proxx:
  ```bash
  mkdir -p ~/repos/proxx/src/lib/telemetry
  cp ~/repos/shuvlr/apps/backend/src/telemetry/otel.ts ~/repos/proxx/src/lib/telemetry/otel.ts
  ```

- [x] Update the scope name constant from `shuvlr-backend` to `proxx` and the default service name fallback from `shuvlr-backend` to `proxx`:
  ```typescript
  const SCOPE_NAME = "proxx";
  // in initTelemetry():
  const serviceName = process.env.OTEL_SERVICE_NAME || "proxx";
  ```

### 2. Add telemetry initialization to the entry point

- [x] In `src/main.ts`, import and call `initTelemetry()` before `createApp()`, and add `shutdownTelemetry()` on process signals:
  ```typescript
  import { initTelemetry, shutdownTelemetry } from "./lib/telemetry/otel.js";

  const telemetry = initTelemetry();

  const config = loadConfig();
  const app = await createApp(config);

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, "open-hax-openai-proxy listening");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await shutdownTelemetry();
      process.exit(0);
    });
  }
  ```

### 3. Add Fastify request hook for automatic HTTP spans

- [x] In `src/app.ts`, add an `onRequest`/`onResponse` hook pair that creates a span per non-OPTIONS request. Add this inside `createApp()` after the existing `onRequest` hook:

  ```typescript
  import { getTelemetry, type TelemetrySpan } from "./telemetry/otel.js";

  // Attach a telemetry span to each request
  app.decorateRequest("_otelSpan", null);

  app.addHook("onRequest", async (request) => {
    if (request.method === "OPTIONS") return;
    const span = getTelemetry().startSpan("http.request", {
      "http.method": request.method,
      "http.path": (request.raw.url ?? request.url).split("?")[0],
    });
    (request as any)._otelSpan = span;
  });

  app.addHook("onResponse", async (request, reply) => {
    const span = (request as any)._otelSpan as TelemetrySpan | null;
    if (!span) return;
    span.setAttribute("http.status_code", reply.statusCode);
    if (reply.statusCode >= 400) span.setStatus("error", `HTTP ${reply.statusCode}`);
    else span.setStatus("ok");
    span.end();
  });
  ```

  Place these hooks right after the existing CORS/auth `onRequest` hook (before route definitions).

### 4. Instrument provider upstream attempts

- [x] In `src/lib/provider-strategy.ts`, add a span around each upstream `fetch` attempt. The `recordAttempt()` helper is already called for every attempt -- wrap it to also emit a telemetry span.

  Add a helper at the top of the file:
  ```typescript
  import { getTelemetry } from "./telemetry/otel.js";
  ```

  In `executeLocalStrategy()`, wrap the upstream fetch in a span:
  ```typescript
  const upstreamSpan = getTelemetry().startSpan("proxy.upstream_attempt", {
    "proxy.provider_id": "ollama",
    "proxy.account_id": "local",
    "proxy.auth_type": "local",
    "proxy.upstream_mode": strategy.mode,
    "proxy.upstream_path": upstreamPath,
    "proxy.model": context.routedModel,
    "proxy.requested_model": context.requestedModel,
  });
  ```
  Set status/error and call `span.end()` at each exit point (success, network error).

  In `executeProviderFallback()`, add a span per candidate attempt inside the for-loop where `fetchWithResponseTimeout` is called. Attributes should include:
  - `proxy.provider_id`
  - `proxy.account_id`
  - `proxy.auth_type`
  - `proxy.upstream_mode`
  - `proxy.upstream_path`
  - `proxy.model` (routed model)
  - `proxy.requested_model`
  - `proxy.base_url`
  - `proxy.status` (HTTP status from upstream)
  - `proxy.latency_ms`
  - `proxy.prompt_tokens` / `proxy.completion_tokens` (when available)
  - `proxy.fallback_attempt` (attempt number, 1-indexed)

  End the span after each attempt resolves (success, rate-limit, error, fallback).

### 5. Instrument key pool rate-limit events

- [x] In `src/lib/key-pool.ts`, emit a metric when an account is rate-limited:
  ```typescript
  import { getTelemetry } from "./telemetry/otel.js";

  // Inside markRateLimited():
  getTelemetry().recordMetric("proxy.key_pool.rate_limited", 1, {
    "proxy.provider_id": credential.providerId ?? this.defaultProviderId,
    "proxy.account_id": credential.label ?? credential.id,
  });
  ```

### 6. Add OTEL env vars to docker-compose

- [x] Add OTEL environment variables to `docker-compose.yml` in the `open-hax-openai-proxy` service:
  ```yaml
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://host.docker.internal:3474"
  OTEL_EXPORTER_OTLP_HEADERS: "x-maple-ingest-key=maple_pk_u0Z7qYQTZSKBU7xtM8FJwt9GVk-gq2CZ"
  OTEL_SERVICE_NAME: "proxx"
  OTEL_RESOURCE_ATTRIBUTES: "service.name=proxx,deployment.environment=local,host.name=shuvdev"
  ```

### 7. Build and deploy

- [x] Rebuild the Docker image and restart the container:
  ```bash
  cd ~/repos/proxx
  docker compose build
  docker compose up -d
  ```

- [x] Wait for the container to become healthy:
  ```bash
  docker compose ps  # wait for "(healthy)"
  docker compose logs open-hax-openai-proxy 2>&1 | grep -i 'telemetry\|otel\|listening' | tail -5
  ```

### 8. Verify in Maple

- [x] Generate traffic and verify the service appears:
  ```bash
  # Hit the health endpoint
  source <(grep PROXY_AUTH_TOKEN ~/repos/proxx/.env 2>/dev/null || echo "")
  PROXX_TOKEN="${PROXY_AUTH_TOKEN:-$(jq -r '.proxyAuthToken // empty' ~/repos/proxx/keys.json 2>/dev/null)}"
  curl -s -H "Authorization: Bearer $PROXX_TOKEN" http://localhost:8789/health -o /dev/null
  curl -s -H "Authorization: Bearer $PROXX_TOKEN" http://localhost:8789/v1/models -o /dev/null
  sleep 15
  mcporter call maple.service_overview
  # Should show "proxx" as a new service
  ```

- [x] Verify diagnostic details:
  ```bash
  mcporter call maple.diagnose_service service_name="proxx"
  ```

---

## Expected Outcome

Service `proxx` appears in Maple with:
- **Traces** for every HTTP request (method, path, status code)
- **Traces** for every upstream provider attempt (provider, model, account, latency, status, tokens)
- **Metrics** for key pool rate-limit events
- **Logs** for OTLP flush failures

After completion, the full Maple service list should be:

| Service | Host | Type |
|---|---|---|
| shiv | shuvdev | Telegram bot |
| shuvmon-hub | shuvdev | Fleet monitoring |
| shuvdev-host | shuvdev | Host metrics (collector) |
| overseer-fleet-relay | shuvbot | Shuvdo API |
| overseer-agent-shuvdev | shuvdev | Overseer agent |
| overseer-agent-nick | nick | Overseer agent |
| overseer-agent-shuvbot | shuvbot | Overseer agent |
| shuvlr-backend | shuvdev | Shuvlr WebSocket server |
| proxx | shuvdev | OpenAI-compatible proxy |

---

## Key Files Reference

| What | Path |
|---|---|
| Maple ingest gateway | shuvdev:3474 (host), `host.docker.internal:3474` (from container) |
| Maple ingest key | `maple_pk_u0Z7qYQTZSKBU7xtM8FJwt9GVk-gq2CZ` |
| Telemetry module (source) | `~/repos/shuvlr/apps/backend/src/telemetry/otel.ts` |
| Proxx entry point | `~/repos/proxx/src/main.ts` |
| Proxx app (Fastify) | `~/repos/proxx/src/app.ts` |
| Proxx config | `~/repos/proxx/src/lib/config.ts` |
| Proxx provider strategy | `~/repos/proxx/src/lib/provider-strategy.ts` |
| Proxx key pool | `~/repos/proxx/src/lib/key-pool.ts` |
| Proxx request log store | `~/repos/proxx/src/lib/request-log-store.ts` |
| Proxx docker-compose | `~/repos/proxx/docker-compose.yml` |
| Proxx Dockerfile | `~/repos/proxx/Dockerfile` |
| Proxx pm2 config | `~/repos/proxx/ecosystem.container.config.cjs` |
