import { getDb } from '@/lib/db';
import { handleError, json, readBody, requireUser } from '@/lib/api/http';
import { updateAssignment } from '@/lib/domain/commitments';
import { assignmentUpdateSchema } from '@/lib/validation/schemas';
import { categoryLabel } from '@/lib/util/units';
import { formatAge } from '@/lib/util/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A volunteer's own assignments, and nothing else.
 *
 * The query is filtered by the signed-in volunteer's id, so there is no
 * parameter a volunteer could change to see another person's work. The fields
 * returned are what a courier needs: what to carry, where to collect, where to
 * take it, the coordinator's instructions, and any recorded access
 * restriction with its source and age. No requester contact details.
 */
export async function GET() {
  try {
    const user = await requireUser('volunteer');
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.id, a.status, a.instructions, a.created_at,
                c.id AS commitment_id, c.qty, c.unit, c.status AS commitment_status,
                ri.category_id,
                r.reference_code, r.location_text, r.resolved_facility_id,
                org.name AS organization_name,
                lot.general_location AS collect_from,
                lot.handover,
                f.name AS destination_name, f.address AS destination_address,
                d.access_note, d.access_note_source, d.access_note_at
           FROM assignments a
           JOIN commitments c ON c.id = a.commitment_id
           JOIN request_items ri ON ri.id = c.request_item_id
           JOIN requests r ON r.id = c.request_id
           JOIN organizations org ON org.id = c.organization_id
           JOIN inventory_lots lot ON lot.id = c.inventory_lot_id
           LEFT JOIN facilities f ON f.id = r.resolved_facility_id
           LEFT JOIN dispatches d ON d.commitment_id = c.id
          WHERE a.volunteer_id = @userId AND a.status IN ('offered','accepted','completed')
          ORDER BY a.created_at DESC`,
      )
      .all({ userId: user.id }) as Array<Record<string, unknown>>;

    return json({
      assignments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        instructions: row.instructions,
        createdAge: formatAge(row.created_at as string),
        commitmentId: row.commitment_id,
        commitmentStatus: row.commitment_status,
        what: `${row.qty} ${row.unit} of ${categoryLabel(row.category_id as string).toLowerCase()}`,
        organizationName: row.organization_name,
        collectFrom: row.collect_from,
        handover: row.handover,
        referenceCode: row.reference_code,
        // The destination a volunteer needs is the facility, not a household.
        destination: row.destination_name ?? row.location_text,
        destinationAddress: row.destination_address ?? null,
        accessNote: row.access_note ?? null,
        accessNoteSource: row.access_note_source ?? null,
        accessNoteAge: row.access_note_at ? formatAge(row.access_note_at as string) : null,
      })),
      disclosure:
        'Access notes are reports with a source and an age. No route is described as safe on the basis of a map or a model; a coordinator approves every dispatch.',
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  const body = await readBody(request, assignmentUpdateSchema);
  if (!body.ok) return body.response;
  try {
    const user = await requireUser('volunteer');
    updateAssignment(getDb(), {
      assignmentId: body.data.assignmentId,
      volunteerId: user.id,
      status: body.data.status,
    });
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
