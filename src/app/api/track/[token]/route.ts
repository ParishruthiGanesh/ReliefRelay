import { getDb } from '@/lib/db';
import { fail, handleError, json } from '@/lib/api/http';
import { getRequestByTrackingToken } from '@/lib/domain/requests';
import { trackingView } from '@/lib/domain/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Private tracking. Access is the token and nothing else: the printable
 * reference code is not accepted here, and an unknown token gets the same
 * answer as a valid-looking one that does not exist.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const db = getDb();
    const row = getRequestByTrackingToken(db, token);
    if (!row) {
      return fail(
        'not_found',
        'That tracking link does not match a request. Check the full link, including every character after /track/.',
        404,
      );
    }
    return json({ request: trackingView(db, row) });
  } catch (error) {
    return handleError(error);
  }
}
