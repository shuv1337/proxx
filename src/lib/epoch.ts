export function normalizeEpochMilliseconds(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  // postgres.js returns BIGINT columns as strings — coerce to number.
  const numeric = typeof value === "string" ? Number(value) : value;

  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return undefined;
  }

  const normalized = Math.trunc(numeric);
  return normalized < 1_000_000_000_000 ? normalized * 1000 : normalized;
}
