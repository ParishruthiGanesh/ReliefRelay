import { getDb } from '@/lib/db';
import { handleError, json } from '@/lib/api/http';
import { listFacilities } from '@/lib/domain/facilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const kind = new URL(request.url).searchParams.get('kind');
    const facilities = listFacilities(
      getDb(),
      kind === 'shelter' || kind === 'supply_hub' ? kind : undefined,
    );
    return json({
      facilities,
      disclosure:
        'Finding a shelter here does not reserve a place. Capacity figures are reports with a timestamp and a source; check before travelling.',
    });
  } catch (error) {
    return handleError(error);
  }
}
