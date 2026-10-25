import { z } from 'zod';
import { getDb } from '@/lib/db';
import { applyManualEdit, viewConversation } from '@/lib/conversation/engine';
import { handleError, json, readBody } from '@/lib/api/http';
import { categoryIdSchema, requestDraftSchema, urgencySchema } from '@/lib/validation/schemas';
import { unitFor } from '@/lib/util/units';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Direct edits to the draft, made by the person themselves before submitting.
 *
 * Deliberately narrow: a person may correct what they asked for, how many
 * people it is for, and how urgent it is. They cannot touch a status, a
 * commitment or anything on the coordination side — the same boundary that
 * applies to a model applies here, because this is still an unauthenticated
 * endpoint.
 *
 * Setting a quantity to null is meaningful and allowed: it is how someone says
 * "I don't actually know how many", and it must stay unknown rather than
 * being recorded as zero.
 */
const editSchema = z
  .object({
    items: z
      .array(
        z.object({
          categoryId: categoryIdSchema,
          quantity: z.number().positive().max(1_000_000).nullable(),
          quantityUncertain: z.boolean().default(false),
        }),
      )
      .max(8)
      .optional(),
    groupSize: z.number().int().positive().max(100_000).nullable().optional(),
    urgency: urgencySchema.nullable().optional(),
    contactMethod: z.enum(['phone', 'whatsapp', 'sms', 'none']).nullable().optional(),
    contactValue: z.string().max(120).nullable().optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readBody(request, editSchema);
  if (!body.ok) return body.response;
  try {
    const { id } = await context.params;
    const db = getDb();

    const patch: Partial<z.infer<typeof requestDraftSchema>> = {};
    if (body.data.items) {
      patch.items = body.data.items.map((item) => ({
        categoryId: item.categoryId,
        quantity: item.quantity,
        unit: unitFor(item.categoryId),
        // An amount the person has just typed is confirmed by them; a blank
        // one stays explicitly unknown.
        quantityUncertain: item.quantity === null ? true : item.quantityUncertain,
      }));
    }
    if (body.data.groupSize !== undefined) patch.groupSize = body.data.groupSize;
    if (body.data.urgency !== undefined) patch.urgency = body.data.urgency;
    if (body.data.contactMethod !== undefined) patch.contactMethod = body.data.contactMethod;
    if (body.data.contactValue !== undefined) patch.contactValue = body.data.contactValue;

    applyManualEdit(db, id, patch);
    return json({ conversation: viewConversation(db, id) });
  } catch (error) {
    return handleError(error);
  }
}
