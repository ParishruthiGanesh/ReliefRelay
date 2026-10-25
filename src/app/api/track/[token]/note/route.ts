import { z } from 'zod';
import { getDb } from '@/lib/db';
import { fail, handleError, json, readBody } from '@/lib/api/http';
import { appendEvent, getRequestByTrackingToken, refreshMissingFields, setItemQuantity } from '@/lib/domain/requests';
import { trackingView } from '@/lib/domain/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  note: z.string().min(1).max(1000).optional(),
  /** Correcting a quantity the person now knows. */
  itemQuantity: z
    .object({ requestItemId: z.string().min(1), quantity: z.number().positive().max(1_000_000) })
    .optional(),
  cancel: z.boolean().optional(),
});

/** Adding information, correcting a quantity, or cancelling one's own request. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const body = await readBody(request, schema);
  if (!body.ok) return body.response;
  try {
    const { token } = await context.params;
    const db = getDb();
    const row = getRequestByTrackingToken(db, token);
    if (!row) return fail('not_found', 'That tracking link does not match a request.', 404);

    if (body.data.note) {
      appendEvent(db, {
        requestId: row.id,
        kind: 'information_added',
        detail: { note: body.data.note },
        actorKind: 'public',
      });
    }

    if (body.data.itemQuantity) {
      const item = db
        .prepare('SELECT request_id FROM request_items WHERE id = ?')
        .get(body.data.itemQuantity.requestItemId) as { request_id: string } | undefined;
      if (!item || item.request_id !== row.id) {
        return fail('forbidden', 'That item does not belong to this request.', 403);
      }
      setItemQuantity(db, body.data.itemQuantity.requestItemId, body.data.itemQuantity.quantity, {
        kind: 'public',
      });
    }

    if (body.data.cancel) {
      db.prepare("UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        row.id,
      );
      appendEvent(db, {
        requestId: row.id,
        kind: 'cancelled_by_requester',
        actorKind: 'public',
      });
    }

    refreshMissingFields(db, row.id);
    return json({ request: trackingView(db, getRequestByTrackingToken(db, token)!) });
  } catch (error) {
    return handleError(error);
  }
}
