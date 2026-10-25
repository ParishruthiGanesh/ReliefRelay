import { randomBytes } from 'node:crypto';
import type { DB } from '@/lib/db';
import { nowIso } from '@/lib/util/ids';
import { sha256Hex } from '@/lib/util/tokens';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'rr_session';
const SESSION_HOURS = 12;

export type Role = 'coordinator' | 'facility_rep' | 'volunteer' | 'donor';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organizationId: string | null;
  facilityId: string | null;
  isApproved: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  organization_id: string | null;
  facility_id: string | null;
  password_hash: string;
  is_approved: number;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    organizationId: row.organization_id,
    facilityId: row.facility_id,
    isApproved: row.is_approved === 1,
  };
}

/** Returns the raw cookie value; only its hash is stored. */
export function login(db: DB, email: string, password: string): { token: string; user: SessionUser } | null {
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase().trim()) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(sha256Hex(token), row.id, nowIso(), expires);
  return { token, user: toSessionUser(row) };
}

export function resolveSession(db: DB, token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sha256Hex(token), nowIso()) as UserRow | undefined;
  return row ? toSessionUser(row) : null;
}

export function logout(db: DB, token: string | undefined | null): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
}

// ───────────────────────────── authorisation ───────────────────────────────

export class AuthorizationError extends Error {
  constructor(message = 'You do not have access to this.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function requireRole(user: SessionUser | null, ...roles: Role[]): SessionUser {
  if (!user) throw new AuthorizationError('Please sign in.');
  if (!roles.includes(user.role)) {
    throw new AuthorizationError('Your account does not have access to this area.');
  }
  if (user.role === 'volunteer' && !user.isApproved) {
    throw new AuthorizationError('Your volunteer account has not been approved yet.');
  }
  return user;
}

/**
 * Can this account see a request's sensitive fields (exact location, contact
 * details, original transcript)?
 *
 * Coordinators can. A facility representative can for requests resolved to
 * their own facility. A volunteer cannot: they see only the delivery
 * instructions attached to their own assignment. Everyone else needs the
 * private tracking token.
 */
export function canViewRequestPrivately(
  user: SessionUser | null,
  request: { resolved_facility_id: string | null },
): boolean {
  if (!user) return false;
  if (user.role === 'coordinator') return true;
  if (user.role === 'facility_rep') {
    return !!user.facilityId && user.facilityId === request.resolved_facility_id;
  }
  return false;
}

export function canUpdateFacility(user: SessionUser | null, facilityId: string): boolean {
  if (!user) return false;
  if (user.role === 'coordinator') return true;
  return user.role === 'facility_rep' && user.facilityId === facilityId;
}
