import { getDb } from '@/lib/db';
import { selectLocation } from '@/lib/conversation/engine';
import { handleError, json, readBody } from '@/lib/api/http';
import { selectLocationSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readBody(request, selectLocationSchema);
  if (!body.ok) return body.response;
  try {
    const { id } = await context.params;
    return json({ conversation: selectLocation(getDb(), id, body.data) });
  } catch (error) {
    return handleError(error);
  }
}
