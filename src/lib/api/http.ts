import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, type DB } from '@/lib/db';
import { AuthorizationError, resolveSession, SESSION_COOKIE, requireRole, type Role, type SessionUser } from '@/lib/auth/session';
import { AllocationError } from '@/lib/domain/commitments';
import { SttUnavailableError } from '@/lib/providers/types';

/**
 * Route-handler helpers.
 *
 * Two things are centralised here on purpose: body validation (so no handler
 * ever reads an unvalidated field) and error translation (so a domain error
 * reaches the client as a stable code and a sentence a person can act on,
 * rather than as a stack trace or a bare 500).
 */

export const runtime = 'nodejs';

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(data, responseInit);
}

export interface ApiErrorBody {
  error: { code: string; message: string; detail?: unknown; guidance?: string };
}

export function fail(
  code: string,
  message: string,
  status = 400,
  extra: { detail?: unknown; guidance?: string } = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } } satisfies ApiErrorBody, {
    status,
  });
}

/**
 * Largest body any endpoint accepts.
 *
 * The audio upload is the only genuinely large one: `sttRequestSchema` caps
 * base64 audio at 20 MB, and base64 costs about a third on top. Everything
 * else is small JSON.
 */
const MAX_BODY_BYTES = 28 * 1024 * 1024;
/** Everything except the audio endpoint is small; hold those to a tight cap. */
const MAX_JSON_BODY_BYTES = 256 * 1024;

export async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
  options: { maxBytes?: number } = {},
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const limit = options.maxBytes ?? MAX_JSON_BODY_BYTES;

  // Read and measure the body before parsing it.
  //
  // Schema limits like `.max(8)` on an array are checked *after* the whole
  // payload has been parsed into memory, so they do not protect against
  // someone posting a hundred-megabyte array at a public endpoint. Validators
  // have had memory-exhaustion advisories for exactly this shape of input
  // (zod GHSA, Nov 2025), and the durable fix is to refuse the body before any
  // parser sees it rather than to rely on the validator being careful.
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, response: tooLarge(limit) };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: fail('invalid_json', 'The request body could not be read.') };
  }
  // A missing or dishonest content-length is why this is measured again.
  if (Buffer.byteLength(text, 'utf8') > limit) {
    return { ok: false, response: tooLarge(limit) };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: fail('invalid_json', 'The request body was not valid JSON.') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail('invalid_input', 'Some fields were missing or invalid.', 422, {
        detail: parsed.error.flatten(),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

function tooLarge(limit: number): NextResponse {
  return fail(
    'body_too_large',
    `That request was too large. The limit is ${Math.round(limit / 1024)} KB.`,
    413,
  );
}

/** The audio endpoint, and only that one, may send a large body. */
export const AUDIO_BODY_LIMIT = MAX_BODY_BYTES;

export async function currentUser(db: DB = getDb()): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(db, store.get(SESSION_COOKIE)?.value);
}

export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  return requireRole(user, ...roles);
}

/** Translates domain errors into honest HTTP responses. */
export function handleError(error: unknown): NextResponse {
  if (error instanceof AuthorizationError) {
    return fail('forbidden', error.message, 403);
  }
  if (error instanceof AllocationError) {
    const status =
      error.code === 'insufficient_stock' || error.code === 'exceeds_outstanding' ? 409 : 400;
    return fail(error.code, error.message, status, { detail: error.detail });
  }
  if (error instanceof SttUnavailableError) {
    return fail(error.code, error.message, 503, { guidance: error.guidance });
  }
  if (error instanceof Error) {
    // Domain invariants are thrown as plain Errors with messages written for a
    // person to read; nothing secret is put in them.
    return fail('request_failed', error.message, 400);
  }
  return fail('unknown_error', 'Something went wrong.', 500);
}

export function withDb<T>(fn: (db: DB) => T): T {
  return fn(getDb());
}
