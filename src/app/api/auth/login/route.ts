import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { login, SESSION_COOKIE } from '@/lib/auth/session';
import { fail, handleError, json, readBody } from '@/lib/api/http';
import { loginSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readBody(request, loginSchema);
  if (!body.ok) return body.response;
  try {
    const result = login(getDb(), body.data.email, body.data.password);
    if (!result) return fail('invalid_credentials', 'That email and password do not match.', 401);
    const store = await cookies();
    store.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 3600,
    });
    return json({ user: result.user });
  } catch (error) {
    return handleError(error);
  }
}
