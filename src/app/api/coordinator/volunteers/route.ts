import { getDb } from '@/lib/db';
import { handleError, json, requireUser } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Approved volunteers only. An unapproved account is never offered here. */
export async function GET() {
  try {
    await requireUser('coordinator');
    const volunteers = getDb()
      .prepare(
        `SELECT id, display_name AS displayName FROM users
          WHERE role = 'volunteer' AND is_approved = 1 ORDER BY display_name`,
      )
      .all();
    return json({ volunteers });
  } catch (error) {
    return handleError(error);
  }
}
