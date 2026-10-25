import type { DB } from '@/lib/db';
import { id, nowIso } from '@/lib/util/ids';
import { sha256Hex, sha256Prefixed } from '@/lib/util/tokens';

export type AttestationEventType = 'commitment' | 'dispatch' | 'receipt' | 'discrepancy';

/**
 * The canonical manifest that gets hashed onto the local chain.
 *
 * What it deliberately does NOT contain: any person's name, phone number or
 * contact detail, any household coordinate, any medical information, any voice
 * recording or transcript, and any organisation's real name. The only
 * identifiers are opaque refs; everything human-readable stays in SQLite.
 *
 * `subjectRef` is sha256(requestId) — a stable pointer that lets two
 * organisations agree they are talking about the same request without
 * publishing which request it is.
 *
 * Timestamps are truncated to the minute so the hash cannot be used as a
 * high-resolution movement trace.
 */
export interface AttestationManifest {
  v: 1;
  eventType: AttestationEventType;
  chainOrgRef: string;
  subjectRef: string;
  commitmentRef: string;
  categoryId: string;
  unit: string;
  /** Promised quantity for commitment/dispatch; confirmed quantity for receipt. */
  qty: number;
  /** Only set on a discrepancy: promised minus confirmed. */
  shortfallQty?: number;
  occurredAtMinute: string;
}

/** Deterministic JSON with sorted keys, so the same facts always hash alike. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function manifestHash(manifest: AttestationManifest): string {
  return sha256Prefixed(canonicalJson(manifest));
}

export function subjectRefFor(requestId: string): string {
  return sha256Prefixed(requestId);
}

export function commitmentRefFor(commitmentId: string): string {
  return sha256Prefixed(commitmentId);
}

function toMinute(iso: string): string {
  return `${iso.slice(0, 16)}Z`;
}

export function buildManifest(input: {
  eventType: AttestationEventType;
  chainOrgRef: string;
  requestId: string;
  commitmentId: string;
  categoryId: string;
  unit: string;
  qty: number;
  shortfallQty?: number;
  occurredAt?: string;
}): AttestationManifest {
  return {
    v: 1,
    eventType: input.eventType,
    chainOrgRef: input.chainOrgRef,
    subjectRef: subjectRefFor(input.requestId),
    commitmentRef: commitmentRefFor(input.commitmentId),
    categoryId: input.categoryId,
    unit: input.unit,
    qty: input.qty,
    ...(input.shortfallQty !== undefined ? { shortfallQty: input.shortfallQty } : {}),
    occurredAtMinute: toMinute(input.occurredAt ?? nowIso()),
  };
}

/**
 * Records an attestation as `pending` in SQLite. No network call happens here.
 *
 * This is the whole reason chain downtime cannot block relief work: the
 * acknowledgement is durable in the database the instant the commitment is
 * saved, and a separate flush tries the chain afterwards and retries on
 * failure.
 */
export function queueAttestation(
  db: DB,
  input: Parameters<typeof buildManifest>[0],
): { attestationId: string; manifest: AttestationManifest; hash: string } {
  const manifest = buildManifest(input);
  const hash = manifestHash(manifest);
  const attestationId = id('att');
  const now = nowIso();
  db.prepare(
    `INSERT INTO attestations (
       id, commitment_id, event_type, chain_org_ref, manifest_hash, manifest_json,
       status, attempts, created_at, updated_at
     ) VALUES (@id, @commitmentId, @eventType, @orgRef, @hash, @manifest, 'pending', 0, @now, @now)`,
  ).run({
    id: attestationId,
    commitmentId: input.commitmentId,
    eventType: input.eventType,
    orgRef: input.chainOrgRef,
    hash,
    manifest: JSON.stringify(manifest),
    now,
  });
  return { attestationId, manifest, hash };
}

export interface AttestationRow {
  id: string;
  commitment_id: string;
  event_type: AttestationEventType;
  chain_org_ref: string;
  manifest_hash: string;
  manifest_json: string;
  status: 'pending' | 'confirmed' | 'failed';
  attempts: number;
  last_error: string | null;
  tx_hash: string | null;
  block_number: number | null;
  chain_id: string | null;
  created_at: string;
  updated_at: string;
}

export function pendingAttestations(db: DB, limit = 25): AttestationRow[] {
  return db
    .prepare(
      `SELECT * FROM attestations WHERE status IN ('pending','failed') ORDER BY created_at LIMIT ?`,
    )
    .all(limit) as AttestationRow[];
}

export function markAttestationConfirmed(
  db: DB,
  attestationId: string,
  result: { txHash: string; blockNumber: number; chainId: string },
): void {
  db.prepare(
    `UPDATE attestations
        SET status = 'confirmed', tx_hash = @txHash, block_number = @blockNumber,
            chain_id = @chainId, last_error = NULL, updated_at = @now
      WHERE id = @id`,
  ).run({ ...result, id: attestationId, now: nowIso() });
}

export function markAttestationFailed(db: DB, attestationId: string, error: string): void {
  db.prepare(
    `UPDATE attestations
        SET status = 'failed', attempts = attempts + 1, last_error = @error, updated_at = @now
      WHERE id = @id`,
  ).run({ error: error.slice(0, 500), id: attestationId, now: nowIso() });
}

/** Human-readable explanation of exactly what a given hash covers. */
export function explainManifest(manifest: AttestationManifest): string {
  const parts = [
    `an organisation-level ${manifest.eventType} acknowledgement`,
    `for ${manifest.qty} ${manifest.unit} of ${manifest.categoryId}`,
    `recorded at ${manifest.occurredAtMinute}`,
  ];
  if (manifest.shortfallQty !== undefined) {
    parts.push(`with a recorded shortfall of ${manifest.shortfallQty} ${manifest.unit}`);
  }
  return `This hash covers ${parts.join(', ')}. It identifies the organisation and the request only by opaque reference, and contains no names, contact details, locations, transcripts or recordings. It preserves that the acknowledgement was made; it is not independent proof that goods changed hands.`;
}

export { sha256Hex };
