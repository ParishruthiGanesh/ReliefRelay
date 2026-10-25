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

export async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
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
