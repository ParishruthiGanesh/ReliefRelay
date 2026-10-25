import { getDb } from '@/lib/db';
import { currentUser, handleError, json, readBody } from '@/lib/api/http';
import { createOffer } from '@/lib/domain/inventory';
import { offerSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A donor publishes availability. This records an *offer*, not stock: it does
 * not become allocatable until a coordinator accepts it.
 */
export async function POST(request: Request) {
  const body = await readBody(request, offerSchema);
  if (!body.ok) return body.response;
  try {
    const db = getDb();
    const user = await currentUser(db);
    const result = createOffer(db, {
      ...body.data,
      organizationId: body.data.organizationId ?? user?.organizationId ?? null,
    });
    return json({
      result,
      message:
        'Thank you. Your offer has been recorded for coordinator review. It is not counted as available stock until a coordinator accepts it.',
    });
  } catch (error) {
    return handleError(error);
  }
}
