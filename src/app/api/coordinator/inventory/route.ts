import { getDb } from '@/lib/db';
import { handleError, json, requireUser } from '@/lib/api/http';
import { listInventory, listOffers } from '@/lib/domain/inventory';
import { pendingAttestations } from '@/lib/domain/attestations';
import { chainStatus } from '@/lib/providers/chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser('coordinator');
    const db = getDb();
    const attestations = db
      .prepare(
        `SELECT a.*, o.name AS org_name, c.request_id
           FROM attestations a
           JOIN organizations o ON o.chain_org_ref = a.chain_org_ref
           JOIN commitments c ON c.id = a.commitment_id
          ORDER BY a.created_at DESC LIMIT 60`,
      )
      .all();
    return json({
      inventory: listInventory(db),
      offers: listOffers(db),
      attestations,
      pendingAttestations: pendingAttestations(db, 100).length,
      chain: await chainStatus(),
    });
  } catch (error) {
    return handleError(error);
  }
}
