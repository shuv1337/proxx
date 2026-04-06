import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";

import { extractClientRequestInfo } from "../lib/client-request-info.js";
import type { ClientRequestInfo } from "../lib/request-log-store.js";

function mockRequest(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress?: string,
): FastifyRequest {
  return {
    headers,
    raw: {
      socket: {
        remoteAddress,
      },
    },
  } as unknown as FastifyRequest;
}

// ─── IP extraction precedence ───────────────────────────────────────────────

test("cf-connecting-ip takes precedence over all other headers", () => {
  const request = mockRequest({
    "cf-connecting-ip": "1.2.3.4",
    "fly-client-ip": "5.6.7.8",
    "x-real-ip": "9.10.11.12",
    "x-forwarded-for": "13.14.15.16, 17.18.19.20",
  }, "21.22.23.24");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "1.2.3.4");
});

test("fly-client-ip takes precedence over x-real-ip and x-forwarded-for", () => {
  const request = mockRequest({
    "fly-client-ip": "5.6.7.8",
    "x-real-ip": "9.10.11.12",
    "x-forwarded-for": "13.14.15.16, 17.18.19.20",
  }, "21.22.23.24");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "5.6.7.8");
});

test("x-real-ip takes precedence over x-forwarded-for", () => {
  const request = mockRequest({
    "x-real-ip": "9.10.11.12",
    "x-forwarded-for": "13.14.15.16, 17.18.19.20",
  }, "21.22.23.24");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "9.10.11.12");
});

test("x-forwarded-for single IP is used when no higher precedence headers", () => {
  const request = mockRequest({
    "x-forwarded-for": "13.14.15.16",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "13.14.15.16");
});

test("x-forwarded-for multi-IP picks first IP from the list", () => {
  const request = mockRequest({
    "x-forwarded-for": "13.14.15.16, 17.18.19.20, 21.22.23.24",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "13.14.15.16");
});

test("falls back to socket remoteAddress when no headers present", () => {
  const request = mockRequest({}, "192.168.1.100");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "192.168.1.100");
});

test("returns undefined ip when no headers and no socket address", () => {
  const request = mockRequest({});

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, undefined);
});

// ─── Host extraction ─────────────────────────────────────────────────────────

test("x-forwarded-host takes precedence over host header", () => {
  const request = mockRequest({
    "x-forwarded-host": "proxy.example.com",
    "host": "origin.example.com",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.host, "proxy.example.com");
});

test("falls back to host header when x-forwarded-host not present", () => {
  const request = mockRequest({
    "host": "origin.example.com",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.host, "origin.example.com");
});

// ─── IPv6 bracket stripping ──────────────────────────────────────────────────

test("strips IPv6 brackets from x-real-ip", () => {
  const request = mockRequest({
    "x-real-ip": "[::1]",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "::1");
});

test("strips IPv6 brackets from socket remoteAddress", () => {
  const request = mockRequest({}, "[::1]");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "::1");
});

test("strips IPv6 brackets from x-forwarded-for first IP", () => {
  const request = mockRequest({
    "x-forwarded-for": "[2001:db8::1], 192.168.1.1",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "2001:db8::1");
});

test("strips IPv6 brackets from cf-connecting-ip", () => {
  const request = mockRequest({
    "cf-connecting-ip": "[2001:db8::1234]",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "2001:db8::1234");
});

test("strips IPv6 brackets from fly-client-ip", () => {
  const request = mockRequest({
    "fly-client-ip": "[::ffff:192.0.2.1]",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "::ffff:192.0.2.1");
});

// ─── Edge cases: empty/whitespace headers ───────────────────────────────────

test("empty string headers are ignored", () => {
  const request = mockRequest({
    "cf-connecting-ip": "",
    "fly-client-ip": "",
    "x-real-ip": "",
    "x-forwarded-for": "",
  }, "192.168.1.100");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "192.168.1.100");
});

test("whitespace-only headers are ignored", () => {
  const request = mockRequest({
    "cf-connecting-ip": "   ",
    "fly-client-ip": "   ",
    "x-real-ip": "   ",
    "x-forwarded-for": "   ",
  }, "192.168.1.100");

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "192.168.1.100");
});

test("whitespace around IP addresses is trimmed", () => {
  const request = mockRequest({
    "x-real-ip": "  192.168.1.100  ",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "192.168.1.100");
});

test("whitespace around x-forwarded-for first IP is trimmed", () => {
  const request = mockRequest({
    "x-forwarded-for": "  10.0.0.1  , 10.0.0.2",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "10.0.0.1");
});

// ─── Combined IP and host extraction ─────────────────────────────────────────

test("returns both ip and host together", () => {
  const request = mockRequest({
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-host": "api.example.com",
    "host": "backend.internal",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "203.0.113.10");
  assert.equal(result.host, "api.example.com");
});

test("returns only ip when host headers are missing", () => {
  const request = mockRequest({
    "x-real-ip": "192.168.1.50",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "192.168.1.50");
  assert.equal(result.host, undefined);
});

test("returns only host when ip headers are missing and no socket address", () => {
  const request = mockRequest({
    "host": "internal.local",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, undefined);
  assert.equal(result.host, "internal.local");
});

// ─── Array header values ─────────────────────────────────────────────────────

test("handles array header values by joining with commas", () => {
  const request = mockRequest({
    "x-forwarded-for": ["10.0.0.1", "10.0.0.2"],
  }) as FastifyRequest;

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "10.0.0.1");
});

test("handles array host header by joining", () => {
  const request = mockRequest({
    "host": ["host1.example.com", "host2.example.com"],
  }) as FastifyRequest;

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.host, "host1.example.com, host2.example.com");
});

// ─── IPv6 addresses without brackets ───────────────────────────────────────

test("IPv6 address without brackets is preserved", () => {
  const request = mockRequest({
    "x-real-ip": "2001:db8::1",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "2001:db8::1");
});

// ─── IPv4-mapped IPv6 addresses ────────────────────────────────────────────

test("IPv4-mapped IPv6 address with brackets is handled", () => {
  const request = mockRequest({
    "x-real-ip": "[::ffff:192.168.1.1]",
  });

  const result: ClientRequestInfo = extractClientRequestInfo(request);
  assert.equal(result.ip, "::ffff:192.168.1.1");
});
