import { z } from 'zod';
import { getDb } from '@/lib/db';
import { handleError, json, readBody, requireUser } from '@/lib/api/http';
import {
  cancelCommitment,
  commitStock,
  createAssignment,
  disputeCommitment,
  recordDispatch,
  recordReceipt,
} from '@/lib/domain/commitments';
import { acceptOffer, declineOffer } from '@/lib/domain/inventory';
import { markReviewed, setItemQuantity } from '@/lib/domain/requests';
import { coordinatorRequestView } from '@/lib/domain/dashboard';
import { getRequestById } from '@/lib/domain/requests';
import { listAdvisories } from '@/lib/domain/advisories';
import { flushAttestations } from '@/lib/providers/chain';
import {
  assignmentSchema,
  cancelCommitmentSchema,
  commitSchema,
  dispatchSchema,
  receiptSchema,
} from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Coordinator operations.
 *
 * One route with a discriminated action, so every operation shares the same
 * authorisation check and the same error translation. Each branch delegates to
 * a domain function that runs in a single immediate transaction — this handler
 * holds no business logic of its own and performs no arithmetic.
 *
 * Note the ordering in each branch that touches the chain: the domain call
 * completes and commits first, and only then is a flush attempted. A chain
 * failure can therefore never undo or block the relief operation.
 */
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review'), requestId: z.string().min(1) }),
  z.object({
    action: z.literal('set_quantity'),
    requestItemId: z.string().min(1),
    quantity: z.number().positive().max(1_000_000),
  }),
  commitSchema.extend({ action: z.literal('commit') }),
  dispatchSchema.extend({ action: z.literal('dispatch') }),
  receiptSchema.extend({ action: z.literal('receipt') }),
  cancelCommitmentSchema.extend({ action: z.literal('cancel_commitment') }),
  cancelCommitmentSchema.extend({ action: z.literal('dispute_commitment') }),
  assignmentSchema.extend({ action: z.literal('assign') }),
  z.object({
    action: z.literal('accept_offer'),
    offerId: z.string().min(1),
    organizationId: z.string().min(1),
    facilityId: z.string().optional(),
  }),
  z.object({ action: z.literal('decline_offer'), offerId: z.string().min(1) }),
  z.object({ action: z.literal('flush_attestations') }),
]);

export async function POST(request: Request) {
  const body = await readBody(request, actionSchema);
  if (!body.ok) return body.response;

  try {
    const user = await requireUser('coordinator');
    const db = getDb();
    const input = body.data;

    switch (input.action) {
      case 'review': {
        markReviewed(db, input.requestId, user.id);
        return json({ request: viewFor(input.requestId) });
      }
      case 'set_quantity': {
        setItemQuantity(db, input.requestItemId, input.quantity, {
          kind: 'coordinator',
          userId: user.id,
        });
        const item = db
          .prepare('SELECT request_id FROM request_items WHERE id = ?')
          .get(input.requestItemId) as { request_id: string };
        return json({ request: viewFor(item.request_id) });
      }
      case 'commit': {
        const result = commitStock(db, {
          requestItemId: input.requestItemId,
          inventoryLotId: input.inventoryLotId,
          qty: input.qty,
          approvedBy: user.id,
        });
        const chain = await flushAttestations(db);
        const item = db
          .prepare('SELECT request_id FROM request_items WHERE id = ?')
          .get(input.requestItemId) as { request_id: string };
        return json({ result, chain, request: viewFor(item.request_id) });
      }
      case 'dispatch': {
        const result = recordDispatch(db, {
          commitmentId: input.commitmentId,
          qty: input.qty,
          volunteerId: input.volunteerId ?? null,
          instructions: input.instructions ?? null,
          accessNote: input.accessNote ?? null,
          accessNoteSource: input.accessNoteSource ?? null,
          actorUserId: user.id,
        });
        const chain = await flushAttestations(db);
        return json({ result, chain, request: viewForCommitment(input.commitmentId) });
      }
      case 'receipt': {
        const result = recordReceipt(db, {
          commitmentId: input.commitmentId,
          qtyReceived: input.qtyReceived,
          note: input.note ?? null,
          confirmedByKind: input.confirmedByKind,
          confirmedByUserId: user.id,
        });
        const chain = await flushAttestations(db);
        return json({ result, chain, request: viewForCommitment(input.commitmentId) });
      }
      case 'cancel_commitment': {
        const result = cancelCommitment(db, {
          commitmentId: input.commitmentId,
          reason: input.reason,
          actorUserId: user.id,
        });
        const chain = await flushAttestations(db);
        return json({ result, chain, request: viewForCommitment(input.commitmentId) });
      }
      case 'dispute_commitment': {
        disputeCommitment(db, {
          commitmentId: input.commitmentId,
          reason: input.reason,
          actorUserId: user.id,
        });
        return json({ request: viewForCommitment(input.commitmentId) });
      }
      case 'assign': {
        const result = createAssignment(db, {
          commitmentId: input.commitmentId,
          volunteerId: input.volunteerId,
          instructions: input.instructions,
          assignedBy: user.id,
        });
        return json({ result, request: viewForCommitment(input.commitmentId) });
      }
      case 'accept_offer': {
        const result = acceptOffer(db, {
          offerId: input.offerId,
          organizationId: input.organizationId,
          facilityId: input.facilityId ?? null,
        });
        return json({ result });
      }
      case 'decline_offer': {
        declineOffer(db, input.offerId);
        return json({ ok: true });
      }
      case 'flush_attestations': {
        return json({ chain: await flushAttestations(db, 50) });
      }
    }

    function viewFor(requestId: string) {
      const row = getRequestById(db, requestId);
      if (!row) throw new Error('No such request.');
      return coordinatorRequestView(db, row, listAdvisories(db));
    }

    function viewForCommitment(commitmentId: string) {
      const row = db
        .prepare('SELECT request_id FROM commitments WHERE id = ?')
        .get(commitmentId) as { request_id: string } | undefined;
      if (!row) throw new Error('No such commitment.');
      return viewFor(row.request_id);
    }
  } catch (error) {
    return handleError(error);
  }
}
