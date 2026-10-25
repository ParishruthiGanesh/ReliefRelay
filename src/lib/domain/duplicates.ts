import type { DB } from '@/lib/db';
import { id, nowIso } from '@/lib/util/ids';
import { distanceKm, minutesBetween } from '@/lib/util/time';
import { appendEvent } from './requests';

/**
 * Possible-duplicate detection.
 *
 * Everything here only ever *suggests*. No request is merged, hidden, deleted
 * or deprioritised automatically — two families at the same shelter asking for
 * water are not a duplicate, and getting that wrong costs someone their
 * supplies. A coordinator decides, and a "not a duplicate" decision is
 * recorded so the pair stops being suggested.
 */

interface Candidate {
  id: string;
  location_text: string;
  resolved_facility_id: string | null;
  resolved_lat: number | null;
  resolved_lng: number | null;
  group_size: number | null;
  created_at: string;
  categories: string;
}

export interface DuplicateSuggestion {
  id: string;
  requestA: { id: string; referenceCode: string; locationText: string; createdAt: string };
  requestB: { id: string; referenceCode: string; locationText: string; createdAt: string };
  score: number;
  reasons: string[];
  status: 'open' | 'confirmed_duplicate' | 'not_duplicate';
}

function scorePair(a: Candidate, b: Candidate): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (a.resolved_facility_id && a.resolved_facility_id === b.resolved_facility_id) {
    score += 0.4;
    reasons.push('Both resolved to the same facility.');
  } else if (
    a.resolved_lat !== null &&
    a.resolved_lng !== null &&
    b.resolved_lat !== null &&
    b.resolved_lng !== null
  ) {
    const km = distanceKm(a.resolved_lat, a.resolved_lng, b.resolved_lat, b.resolved_lng);
    if (km < 0.3) {
      score += 0.3;
      reasons.push(`Locations are about ${km.toFixed(2)} km apart.`);
    }
  } else if (a.location_text.trim().toLowerCase() === b.location_text.trim().toLowerCase()) {
    score += 0.25;
    reasons.push('The location text is identical.');
  }

  const catsA = new Set(JSON.parse(a.categories) as string[]);
  const catsB = new Set(JSON.parse(b.categories) as string[]);
  const shared = [...catsA].filter((c) => catsB.has(c));
  if (shared.length > 0 && shared.length === catsA.size && catsA.size === catsB.size) {
    score += 0.3;
    reasons.push('The same resource categories were requested.');
  } else if (shared.length > 0) {
    score += 0.15;
    reasons.push(`Both ask for ${shared.join(', ')}.`);
  }

  const minutes = Math.abs(minutesBetween(a.created_at, b.created_at));
  if (minutes <= 45) {
    score += 0.2;
    reasons.push(`Submitted ${Math.round(minutes)} minutes apart.`);
  }

  if (a.group_size !== null && a.group_size === b.group_size) {
    score += 0.15;
    reasons.push(`Both report a group of ${a.group_size}.`);
  }

  return { score: Math.min(1, Math.round(score * 100) / 100), reasons };
}

const SUGGESTION_THRESHOLD = 0.55;

export function refreshDuplicateCandidates(db: DB): { suggested: number } {
  const rows = db
    .prepare(
      `SELECT r.id, r.location_text, r.resolved_facility_id, r.resolved_lat, r.resolved_lng,
              r.group_size, r.created_at,
              (SELECT json_group_array(category_id) FROM request_items WHERE request_id = r.id) AS categories
         FROM requests r
        WHERE r.status NOT IN ('cancelled','fulfilled')
        ORDER BY r.created_at DESC
        LIMIT 200`,
    )
    .all() as Candidate[];

  let suggested = 0;
  const insert = db.prepare(
    `INSERT INTO duplicate_candidates (id, request_a_id, request_b_id, score, reasons, status, created_at)
     VALUES (@id, @a, @b, @score, @reasons, 'open', @now)
     ON CONFLICT (request_a_id, request_b_id) DO UPDATE SET
       score = excluded.score, reasons = excluded.reasons
     WHERE duplicate_candidates.status = 'open'`,
  );

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const { score, reasons } = scorePair(rows[i], rows[j]);
      if (score < SUGGESTION_THRESHOLD) continue;
      // Stable ordering so the same pair is one row, not two.
      const [a, b] = rows[i].id < rows[j].id ? [rows[i].id, rows[j].id] : [rows[j].id, rows[i].id];
      insert.run({ id: id('dup'), a, b, score, reasons: JSON.stringify(reasons), now: nowIso() });
      suggested += 1;
    }
  }
  return { suggested };
}

export function listDuplicateSuggestions(db: DB, status = 'open'): DuplicateSuggestion[] {
  const rows = db
    .prepare(
      `SELECT d.*,
              ra.reference_code AS a_ref, ra.location_text AS a_loc, ra.created_at AS a_created,
              rb.reference_code AS b_ref, rb.location_text AS b_loc, rb.created_at AS b_created
         FROM duplicate_candidates d
         JOIN requests ra ON ra.id = d.request_a_id
         JOIN requests rb ON rb.id = d.request_b_id
        WHERE d.status = ?
        ORDER BY d.score DESC, d.created_at DESC`,
    )
    .all(status) as Array<{
    id: string;
    request_a_id: string;
    request_b_id: string;
    score: number;
    reasons: string;
    status: DuplicateSuggestion['status'];
    a_ref: string;
    a_loc: string;
    a_created: string;
    b_ref: string;
    b_loc: string;
    b_created: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    score: row.score,
    reasons: JSON.parse(row.reasons) as string[],
    status: row.status,
    requestA: {
      id: row.request_a_id,
      referenceCode: row.a_ref,
      locationText: row.a_loc,
      createdAt: row.a_created,
    },
    requestB: {
      id: row.request_b_id,
      referenceCode: row.b_ref,
      locationText: row.b_loc,
      createdAt: row.b_created,
    },
  }));
}

/**
 * Records a coordinator's decision.
 *
 * Note what confirming a duplicate does NOT do: it does not delete, hide or
 * cancel either request. It records the human judgement and notes it on both
 * request timelines; closing one remains a separate, deliberate action.
 */
export function decideDuplicate(
  db: DB,
  input: {
    candidateId: string;
    decision: 'confirmed_duplicate' | 'not_duplicate';
    userId: string;
  },
): void {
  const row = db
    .prepare('SELECT * FROM duplicate_candidates WHERE id = ?')
    .get(input.candidateId) as
    | { id: string; request_a_id: string; request_b_id: string }
    | undefined;
  if (!row) throw new Error('No such duplicate suggestion.');

  db.prepare(
    `UPDATE duplicate_candidates SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
  ).run(input.decision, input.userId, nowIso(), input.candidateId);

  for (const requestId of [row.request_a_id, row.request_b_id]) {
    appendEvent(db, {
      requestId,
      kind: `duplicate_${input.decision}`,
      detail: { candidateId: input.candidateId, otherRequestId: requestId === row.request_a_id ? row.request_b_id : row.request_a_id },
      actorKind: 'coordinator',
      actorUserId: input.userId,
    });
  }
}
