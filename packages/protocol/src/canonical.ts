import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization used everywhere a mandate or receipt is
 * hashed or signed: object keys sorted lexicographically at every depth,
 * no insignificant whitespace, arrays in given order. SPEC.md §Canonicalization.
 *
 * Rejects values JSON cannot round-trip deterministically (undefined in
 * arrays, non-finite numbers) instead of guessing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical JSON');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`cannot canonicalize value of type ${typeof value}`);
  }
}

/** Hex-encoded SHA-256 of the canonical JSON form of a value. */
export function sha256CanonicalHex(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
