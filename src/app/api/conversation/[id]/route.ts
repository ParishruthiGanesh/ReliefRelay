import { getDb } from '@/lib/db';
import { viewConversation } from '@/lib/conversation/engine';
import { handleError, json } from '@/lib/api/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return json({ conversation: viewConversation(getDb(), id) });
  } catch (error) {
    return handleError(error);
  }
}
