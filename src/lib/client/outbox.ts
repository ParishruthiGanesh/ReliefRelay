'use client';

/**
 * The offline outbox.
 *
 * Rules this file exists to keep:
 *   * A request that has not reached the server is labelled
 *     "Saved on this device — not yet sent", never "submitted".
 *   * Each queued item carries a stable idempotency key generated once, so a
 *     retry after a dropped connection produces the same server-side request
 *     rather than a duplicate.
 *   * Nothing is removed from the queue until the server has acknowledged it.
 */

const STORAGE_KEY = 'reliefrelay.outbox.v1';
const DRAFT_KEY = 'reliefrelay.draft.v1';

export type OutboxStatus = 'waiting_to_send' | 'sending' | 'sent' | 'failed';

export interface OutboxItem {
  id: string;
  /** Generated once, reused on every retry. */
  idempotencyKey: string;
  endpoint: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  /** Filled in from the server's own response. */
  result: { referenceCode: string; trackingToken: string; status: string } | null;
}

function read(): OutboxItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A full or blocked store must not break the form; the user can still send
    // directly while online.
  }
}

export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `rr-${random}`;
}

export function listOutbox(): OutboxItem[] {
  return read();
}

export function enqueue(endpoint: string, payload: unknown, idempotencyKey?: string): OutboxItem {
  const items = read();
  const item: OutboxItem = {
    id: newIdempotencyKey(),
    idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    endpoint,
    payload,
    status: 'waiting_to_send',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    result: null,
  };
  items.push(item);
  write(items);
  return item;
}

function update(id: string, patch: Partial<OutboxItem>): void {
  const items = read().map((item) => (item.id === id ? { ...item, ...patch } : item));
  write(items);
}

export function removeItem(id: string): void {
  write(read().filter((item) => item.id !== id));
}

export interface FlushReport {
  sent: OutboxItem[];
  failed: OutboxItem[];
  skipped: number;
}

/**
 * Tries to send everything queued. Safe to call repeatedly and concurrently:
 * the idempotency key carried by each item means a double send cannot create a
 * second request.
 */
export async function flushOutbox(): Promise<FlushReport> {
  const report: FlushReport = { sent: [], failed: [], skipped: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    report.skipped = read().filter((i) => i.status !== 'sent').length;
    return report;
  }

  for (const item of read()) {
    if (item.status === 'sent') continue;
    update(item.id, { status: 'sending', attempts: item.attempts + 1 });
    try {
      const response = await fetch(item.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(item.payload as object), idempotencyKey: item.idempotencyKey }),
      });
      const body = (await response.json()) as {
        result?: { referenceCode: string; trackingToken: string; status: string };
        error?: { message: string };
      };
      if (!response.ok || !body.result) {
        const message = body.error?.message ?? `Server returned ${response.status}`;
        update(item.id, { status: 'failed', lastError: message });
        report.failed.push({ ...item, lastError: message, status: 'failed' });
        continue;
      }
      // Only now is this request genuinely submitted.
      const result = {
        referenceCode: body.result.referenceCode,
        trackingToken: body.result.trackingToken,
        status: body.result.status,
      };
      update(item.id, { status: 'sent', result, lastError: null });
      report.sent.push({ ...item, status: 'sent', result });
    } catch (error) {
      const message = (error as Error).message;
      update(item.id, { status: 'failed', lastError: message });
      report.failed.push({ ...item, status: 'failed', lastError: message });
    }
  }
  return report;
}

// ───────────────────────────── local drafts ────────────────────────────────

/** Keeps an in-progress draft across a reload or a lost connection. */
export function saveLocalDraft(value: unknown): void {
  try {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ value, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Best effort only.
  }
}

export function loadLocalDraft<T>(): { value: T; savedAt: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as { value: T; savedAt: string }) : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Best effort only.
  }
}
