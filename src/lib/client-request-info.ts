import type { FastifyRequest } from "fastify";

import type { ClientRequestInfo } from "./request-log-store.js";

/**
 * Extract client IP and host from a Fastify request.
 *
 * IP precedence:
 * 1. cf-connecting-ip
 * 2. fly-client-ip
 * 3. x-real-ip
 * 4. first IP from x-forwarded-for
 * 5. socket remote address
 *
 * Host precedence:
 * 1. x-forwarded-host
 * 2. host
 */
export function extractClientRequestInfo(request: FastifyRequest): ClientRequestInfo {
  const ip = resolveClientIp(request);
  const host = resolveClientHost(request);
  return { ip, host };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(raw)) {
    const joined = raw.join(", ").trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

function stripIpv6Brackets(value: string): string {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1);
  }
  return value;
}

function sanitizeIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return stripIpv6Brackets(trimmed);
}

function firstForwardedIp(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(",")[0];
  if (!first) return undefined;
  return sanitizeIp(first);
}

function resolveClientIp(request: FastifyRequest): string | undefined {
  return (
    sanitizeIp(headerValue(request, "cf-connecting-ip"))
    ?? sanitizeIp(headerValue(request, "fly-client-ip"))
    ?? sanitizeIp(headerValue(request, "x-real-ip"))
    ?? firstForwardedIp(headerValue(request, "x-forwarded-for"))
    ?? sanitizeIp(request.raw.socket.remoteAddress)
  );
}

function resolveClientHost(request: FastifyRequest): string | undefined {
  const forwarded = headerValue(request, "x-forwarded-host");
  if (forwarded) return forwarded;

  const host = headerValue(request, "host");
  return host;
}
