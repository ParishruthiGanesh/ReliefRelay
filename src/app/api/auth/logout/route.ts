import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { logout, SESSION_COOKIE } from '@/lib/auth/session';
import { json } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const store = await cookies();
  logout(getDb(), store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
}
