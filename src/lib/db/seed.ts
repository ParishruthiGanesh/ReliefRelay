import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { id, nowIso } from '@/lib/util/ids';
import {
  CATEGORIES,
  DISTRICT,
  FACILITIES,
  INVENTORY,
  ORGANIZATIONS,
  SCENARIO_ADVISORIES,
  USERS,
} from './seed-data';

/** Deletes every row. Reference data is reinserted by `seed`. */
export function clearAll(db: DB): void {
  const order = [
    'attestations',
    'receipts',
    'dispatches',
    'assignments',
    'commitments',
    'duplicate_candidates',
    'request_events',
    'request_items',
    'conversation_turns',
    'conversations',
    'requests',
    'offers',
    'inventory_lots',
    'facility_updates',
    'sessions',
    'users',
    'facilities',
    'organizations',
    'advisories',
    'resource_categories',
    'districts',
    'idempotency_keys',
  ];
  db.pragma('foreign_keys = OFF');
  transact(db, (tx) => {
    for (const table of order) tx.prepare(`DELETE FROM ${table}`).run();
  });
  db.pragma('foreign_keys = ON');
}

export interface SeedResult {
  accounts: Array<{ email: string; password: string; role: string; name: string }>;
}

export function seed(db: DB): SeedResult {
  const now = nowIso();

  transact(db, (tx) => {
    tx.prepare(
      `INSERT OR REPLACE INTO districts (id, name, is_fictional, center_lat, center_lng)
       VALUES (?, ?, 1, ?, ?)`,
    ).run(DISTRICT.id, DISTRICT.name, DISTRICT.centerLat, DISTRICT.centerLng);

    const insertCategory = tx.prepare(
      `INSERT OR REPLACE INTO resource_categories (id, label, unit, unit_label, counts_people)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const c of CATEGORIES) {
      insertCategory.run(c.id, c.label, c.unit, c.unitLabel, c.countsPeople);
    }

    const insertOrg = tx.prepare(
      `INSERT OR REPLACE INTO organizations (id, name, kind, is_fictional, chain_org_ref, wallet_address, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    );
    for (const o of ORGANIZATIONS) {
      insertOrg.run(o.id, o.name, o.kind, o.chainOrgRef, o.walletAddress, now);
    }

    const insertFacility = tx.prepare(
      `INSERT OR REPLACE INTO facilities (
         id, district_id, name, kind, lat, lng, address, public_contact,
         accessibility, opening_status, capacity_total, capacity_available,
         is_fictional, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    for (const f of FACILITIES) {
      insertFacility.run(
        f.id,
        DISTRICT.id,
        f.name,
        f.kind,
        f.lat,
        f.lng,
        f.address,
        f.publicContact,
        JSON.stringify(f.accessibility),
        f.openingStatus,
        f.capacityTotal,
        f.capacityAvailable,
        now,
      );
    }

    const insertUser = tx.prepare(
      `INSERT OR REPLACE INTO users (
         id, email, display_name, role, organization_id, facility_id,
         password_hash, is_approved, is_fictional, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    for (const u of USERS) {
      insertUser.run(
        u.id,
        u.email,
        u.displayName,
        u.role,
        u.organizationId,
        u.facilityId,
        hashPassword(u.password),
        u.isApproved,
        now,
      );
    }

    const insertLot = tx.prepare(
      `INSERT OR REPLACE INTO inventory_lots (
         id, organization_id, category_id, facility_id, general_location, unit,
         qty_total, qty_committed, available_from, available_until, expiry_note,
         storage_note, handover, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?)`,
    );
    for (const l of INVENTORY) {
      insertLot.run(
        l.id,
        l.organizationId,
        l.categoryId,
        l.facilityId,
        l.generalLocation,
        l.unit,
        l.qtyTotal,
        l.expiryNote ?? null,
        l.storageNote ?? null,
        l.handover,
        now,
        now,
      );
    }

    // Facility capacity figures are themselves updates with provenance, so the
    // directory can honestly say when each number was last confirmed.
    const insertUpdate = tx.prepare(
      `INSERT INTO facility_updates (
         id, facility_id, capacity_available, opening_status, note, resources_note,
         source_kind, reported_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'facility_confirmed', ?, ?)`,
    );
    const ages: Record<string, number> = {
      fac_riverside_primary: 35,
      fac_old_bridge_hall: 70,
      // Deliberately old, so the directory shows a stale badge in the demo.
      fac_northfield_college: 610,
      fac_depot_south: 50,
      fac_depot_north: 140,
    };
    for (const f of FACILITIES) {
      const minutesAgo = ages[f.id] ?? 60;
      const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
      insertUpdate.run(
        id('fup'),
        f.id,
        f.capacityAvailable,
        f.openingStatus,
        f.kind === 'shelter' ? 'Capacity confirmed by the shelter desk.' : 'Hub open for loading.',
        f.kind === 'shelter' ? 'Drinking water and meal packs on site.' : null,
        f.kind === 'shelter' ? 'usr_shelter_rep' : null,
        at,
      );
    }

    const insertAdvisory = tx.prepare(
      `INSERT OR REPLACE INTO advisories (
         id, external_id, headline, body, severity, source_name, source_url,
         record_kind, published_at, expires_at, coverage_label,
         center_lat, center_lng, radius_km, fetched_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scenario', ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of SCENARIO_ADVISORIES) {
      insertAdvisory.run(
        id('adv'),
        a.externalId,
        a.headline,
        a.body,
        a.severity,
        a.sourceName,
        a.sourceUrl,
        new Date(Date.now() + a.publishedOffsetMinutes * 60_000).toISOString(),
        new Date(Date.now() + a.expiresOffsetMinutes * 60_000).toISOString(),
        a.coverageLabel,
        a.centerLat,
        a.centerLng,
        a.radiusKm,
        now,
      );
    }
  });

  return {
    accounts: USERS.map((u) => ({
      email: u.email,
      password: u.password,
      role: u.role + (u.isApproved ? '' : ' (not approved)'),
      name: u.displayName,
    })),
  };
}
