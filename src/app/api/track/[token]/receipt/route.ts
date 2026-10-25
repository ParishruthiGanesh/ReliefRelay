import { getDb } from '@/lib/db';
import { fail, handleError, json, readBody } from '@/lib/api/http';
import { recordReceipt } from '@/lib/domain/commitments';
import { getRequestByTrackingToken } from '@/lib/domain/requests';
import { trackingView } from '@/lib/domain/dashboard';
import { flushInBackground } from '@/lib/providers/chain';
import { receiptSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The recipient confirms what arrived, or reports that nothing did.
 *
 * The commitment must belong to the request behind this token, so a token
 * cannot be used to confirm receipts on anyone else's request.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const body = await readBody(request, receiptSchema.omit({ confirmedByKind: true }));
  if (!body.ok) return body.response;
  try {
    const { token } = await context.params;
    const db = getDb();
    const row = getRequestByTrackingToken(db, token);
    if (!row) return fail('not_found', 'That tracking link does not match a request.', 404);

    const commitment = db
      .prepare('SELECT request_id FROM commitments WHERE id = ?')
      .get(body.data.commitmentId) as { request_id: string } | undefined;
    if (!commitment || commitment.request_id !== row.id) {
      return fail('forbidden', 'That delivery does not belong to this request.', 403);
    }

    const result = recordReceipt(db, {
      commitmentId: body.data.commitmentId,
      qtyReceived: body.data.qtyReceived,
      note: body.data.note ?? null,
      confirmedByKind: 'recipient',
    });
    flushInBackground(db);

    return json({ result, request: trackingView(db, getRequestByTrackingToken(db, token)!) });
  } catch (error) {
    return handleError(error);
  }
}
