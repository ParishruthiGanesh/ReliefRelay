import { getDb } from '@/lib/db';
import { submitTurn } from '@/lib/conversation/engine';
import { handleError, json, readBody } from '@/lib/api/http';
import { conversationTurnSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readBody(request, conversationTurnSchema);
  if (!body.ok) return body.response;
  try {
    const { id } = await context.params;
    const view = await submitTurn(getDb(), id, {
      text: body.data.text,
      inputMode: body.data.inputMode,
      sttProvider: body.data.sttProvider ?? null,
    });
    return json({ conversation: view });
  } catch (error) {
    return handleError(error);
  }
}
