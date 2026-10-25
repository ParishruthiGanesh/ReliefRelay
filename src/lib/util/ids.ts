import { randomBytes, randomUUID } from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * A private tracking token. 32 random bytes, returned to the user once and
 * stored only as a sha256 hash, so the database never holds anything that
 * grants access to a request.
 */
export function trackingToken(): string {
  return randomBytes(32).toString('base64url');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** RR-1042 style. Human-readable, shareable, and NOT an access credential. */
export function referenceCode(sequence: number): string {
  return `RR-${1000 + sequence}`;
}
