/**
 * Fictional demonstration data.
 *
 * Every district, facility, organisation, person and advisory below is
 * invented for this prototype, and every record is flagged `is_fictional`.
 * Nothing here describes a real emergency.
 *
 * On the coordinates: these were originally placed in open ocean so they could
 * not be mistaken for a real place, which worked but left the map a blank blue
 * rectangle — unusable for choosing a location, which is the one thing a
 * person in a flood most needs to do. They now sit on real land along the
 * Cedar River in Iowa, a genuinely flood-prone area, so the basemap shows
 * streets and the river a person can orient by.
 *
 * The trade is handled by labelling rather than by hiding: every facility name
 * and address carries "(fictional)", every screen carries the fictional-data
 * badge, and the map states that these are invented places drawn on a real
 * basemap. No real shelter, hub or organisation is named anywhere.
 *
 * To move the demonstration elsewhere, change DISTRICT and the facility
 * coordinates below, then run `npm run db:reset`. Nothing else depends on
 * where they are.
 */

export const DISTRICT = {
  id: 'dist_riverbend',
  name: 'Riverbend District (fictional)',
  // Near the Cedar River, Iowa. A fictional district on a real basemap.
  centerLat: 41.978,
  centerLng: -91.666,
};

export const CATEGORIES = [
  { id: 'meal_packs', label: 'Meal packs', unit: 'packs', unitLabel: 'meal packs', countsPeople: 0 },
  { id: 'drinking_water', label: 'Drinking water', unit: 'litres', unitLabel: 'litres', countsPeople: 0 },
  { id: 'hygiene_kits', label: 'Hygiene kits', unit: 'kits', unitLabel: 'hygiene kits', countsPeople: 0 },
  { id: 'shelter_spaces', label: 'Shelter spaces', unit: 'spaces', unitLabel: 'shelter spaces', countsPeople: 1 },
];

export const FACILITIES = [
  {
    id: 'fac_riverside_primary',
    name: 'Riverside Primary School',
    kind: 'shelter' as const,
    lat: 41.99,
    lng: -91.675,
    address: '14 Mill Lane, Riverbend (fictional)',
    publicContact: 'Shelter desk: +00 000 0101 (fictional)',
    accessibility: ['step_free_entrance', 'accessible_toilet', 'ground_floor_sleeping'],
    openingStatus: 'open' as const,
    capacityTotal: 180,
    capacityAvailable: 24,
  },
  {
    id: 'fac_old_bridge_hall',
    name: 'Old Bridge Community Hall',
    kind: 'shelter' as const,
    lat: 41.97,
    lng: -91.68,
    address: '2 Bridge Road, Riverbend (fictional)',
    publicContact: 'Hall warden: +00 000 0102 (fictional)',
    accessibility: ['step_free_entrance', 'quiet_room'],
    openingStatus: 'open' as const,
    capacityTotal: 90,
    capacityAvailable: 6,
  },
  {
    id: 'fac_northfield_college',
    name: 'Northfield College Gymnasium',
    kind: 'shelter' as const,
    lat: 42.01,
    lng: -91.65,
    address: 'Northfield Campus, Riverbend (fictional)',
    publicContact: 'Campus line: +00 000 0103 (fictional)',
    accessibility: ['step_free_entrance', 'accessible_toilet', 'assistance_animals_welcome'],
    openingStatus: 'open' as const,
    capacityTotal: 240,
    capacityAvailable: 112,
  },
  {
    id: 'fac_depot_south',
    name: 'Southgate Supply Hub',
    kind: 'supply_hub' as const,
    lat: 41.955,
    lng: -91.66,
    address: 'Unit 7, Southgate Industrial Estate, Riverbend (fictional)',
    publicContact: 'Hub desk: +00 000 0201 (fictional)',
    accessibility: ['loading_bay', 'forklift'],
    openingStatus: 'open' as const,
    capacityTotal: null,
    capacityAvailable: null,
  },
  {
    id: 'fac_depot_north',
    name: 'Northfield Rail Yard Hub',
    kind: 'supply_hub' as const,
    lat: 42.015,
    lng: -91.64,
    address: 'Rail Yard Gate 3, Riverbend (fictional)',
    publicContact: 'Hub desk: +00 000 0202 (fictional)',
    accessibility: ['loading_bay'],
    openingStatus: 'open' as const,
    capacityTotal: null,
    capacityAvailable: null,
  },
];

export const ORGANIZATIONS = [
  {
    id: 'org_riverbend_aid',
    name: 'Riverbend Aid Collective (fictional)',
    kind: 'ngo' as const,
    chainOrgRef: '0x1111111111111111111111111111111111111111111111111111111111111111',
    // Hardhat local development account #1. A well-known key with no value.
    walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  },
  {
    id: 'org_northfield_trust',
    name: 'Northfield Relief Trust (fictional)',
    kind: 'ngo' as const,
    chainOrgRef: '0x2222222222222222222222222222222222222222222222222222222222222222',
    // Hardhat local development account #2.
    walletAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  },
  {
    id: 'org_southgate_foods',
    name: 'Southgate Foods Ltd (fictional)',
    kind: 'business' as const,
    chainOrgRef: '0x3333333333333333333333333333333333333333333333333333333333333333',
    // Hardhat local development account #3.
    walletAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  },
];

/** Demonstration accounts. Passwords are printed by the seed script. */
export const USERS = [
  {
    id: 'usr_coordinator',
    email: 'coordinator@reliefrelay.test',
    displayName: 'A. Mehta (fictional coordinator)',
    role: 'coordinator' as const,
    password: 'coordinator-demo',
    organizationId: 'org_riverbend_aid',
    facilityId: null,
    isApproved: 1,
  },
  {
    id: 'usr_coordinator2',
    email: 'coordinator2@reliefrelay.test',
    displayName: 'J. Okafor (fictional coordinator)',
    role: 'coordinator' as const,
    password: 'coordinator-demo',
    organizationId: 'org_northfield_trust',
    facilityId: null,
    isApproved: 1,
  },
  {
    id: 'usr_shelter_rep',
    email: 'shelter@reliefrelay.test',
    displayName: 'R. Das (fictional shelter representative)',
    role: 'facility_rep' as const,
    password: 'shelter-demo',
    organizationId: null,
    facilityId: 'fac_riverside_primary',
    isApproved: 1,
  },
  {
    id: 'usr_hall_rep',
    email: 'hall@reliefrelay.test',
    displayName: 'M. Silva (fictional hall warden)',
    role: 'facility_rep' as const,
    password: 'shelter-demo',
    organizationId: null,
    facilityId: 'fac_old_bridge_hall',
    isApproved: 1,
  },
  {
    id: 'usr_volunteer_1',
    email: 'volunteer1@reliefrelay.test',
    displayName: 'T. Nguyen (fictional approved volunteer)',
    role: 'volunteer' as const,
    password: 'volunteer-demo',
    organizationId: 'org_riverbend_aid',
    facilityId: null,
    isApproved: 1,
  },
  {
    id: 'usr_volunteer_2',
    email: 'volunteer2@reliefrelay.test',
    displayName: 'P. Haddad (fictional approved volunteer)',
    role: 'volunteer' as const,
    password: 'volunteer-demo',
    organizationId: 'org_northfield_trust',
    facilityId: null,
    isApproved: 1,
  },
  {
    id: 'usr_volunteer_3',
    email: 'volunteer3@reliefrelay.test',
    displayName: 'S. Brennan (fictional volunteer, not yet approved)',
    role: 'volunteer' as const,
    password: 'volunteer-demo',
    organizationId: null,
    facilityId: null,
    isApproved: 0,
  },
  {
    id: 'usr_donor',
    email: 'donor@reliefrelay.test',
    displayName: 'Southgate Foods duty manager (fictional)',
    role: 'donor' as const,
    password: 'donor-demo',
    organizationId: 'org_southgate_foods',
    facilityId: null,
    isApproved: 1,
  },
];

export const INVENTORY = [
  {
    id: 'lot_aid_meals',
    organizationId: 'org_riverbend_aid',
    categoryId: 'meal_packs',
    facilityId: 'fac_depot_south',
    generalLocation: 'Southgate Supply Hub',
    unit: 'packs',
    qtyTotal: 260,
    handover: 'delivery' as const,
    storageNote: 'Dry store, pallets of 20.',
    expiryNote: 'Best before in 6 months.',
  },
  {
    id: 'lot_trust_meals',
    organizationId: 'org_northfield_trust',
    categoryId: 'meal_packs',
    facilityId: 'fac_depot_north',
    generalLocation: 'Northfield Rail Yard Hub',
    unit: 'packs',
    qtyTotal: 140,
    handover: 'either' as const,
    storageNote: 'Dry store.',
    expiryNote: 'Best before in 11 months.',
  },
  {
    id: 'lot_foods_meals',
    organizationId: 'org_southgate_foods',
    categoryId: 'meal_packs',
    facilityId: 'fac_depot_south',
    generalLocation: 'Southgate Foods warehouse',
    unit: 'packs',
    qtyTotal: 90,
    handover: 'collection' as const,
    storageNote: 'Chilled ambient, collect before 20:00.',
    expiryNote: 'Best before in 3 weeks.',
  },
  {
    id: 'lot_aid_water',
    organizationId: 'org_riverbend_aid',
    categoryId: 'drinking_water',
    facilityId: 'fac_depot_south',
    generalLocation: 'Southgate Supply Hub',
    unit: 'litres',
    qtyTotal: 1800,
    handover: 'delivery' as const,
    storageNote: '1.5 litre sealed bottles, shrink-wrapped.',
  },
  {
    id: 'lot_trust_water',
    organizationId: 'org_northfield_trust',
    categoryId: 'drinking_water',
    facilityId: 'fac_depot_north',
    generalLocation: 'Northfield Rail Yard Hub',
    unit: 'litres',
    qtyTotal: 950,
    handover: 'either' as const,
    storageNote: '5 litre containers.',
  },
  {
    id: 'lot_trust_hygiene',
    organizationId: 'org_northfield_trust',
    categoryId: 'hygiene_kits',
    facilityId: 'fac_depot_north',
    generalLocation: 'Northfield Rail Yard Hub',
    unit: 'kits',
    qtyTotal: 220,
    handover: 'either' as const,
    storageNote: 'Boxed in tens.',
  },
];

/**
 * Scenario advisory feed.
 *
 * These are SIMULATED records for the demonstration district. They are stored
 * with record_kind='scenario' and shown with a distinct simulated badge, never
 * mixed in with records fetched from a real source.
 */
export const SCENARIO_ADVISORIES = [
  {
    externalId: 'scenario-riverbend-001',
    headline: 'River Bend main channel above second alert level',
    body:
      'Simulated advisory for the ReliefRelay demonstration district. The main channel is reported above the second alert level between Mill Lane and Southgate. Low-lying streets on the left bank are affected. Residents in single-storey housing on Mill Lane, Bridge Road and Canal Row are advised to move to higher ground or to a designated shelter.',
    severity: 'warning' as const,
    sourceName: 'Riverbend District Water Office (fictional)',
    sourceUrl: null,
    coverageLabel: 'Riverbend left bank: Mill Lane to Southgate',
    centerLat: 41.980,
    centerLng: -91.672,
    radiusKm: 6,
    publishedOffsetMinutes: -95,
    expiresOffsetMinutes: 600,
  },
  {
    externalId: 'scenario-riverbend-002',
    headline: 'Northfield tributary under observation',
    body:
      'Simulated advisory for the ReliefRelay demonstration district. The Northfield tributary is being monitored after upstream rainfall. No evacuation advice is in force for Northfield at this time.',
    severity: 'watch' as const,
    sourceName: 'Riverbend District Water Office (fictional)',
    sourceUrl: null,
    coverageLabel: 'Northfield tributary catchment',
    centerLat: 42.012,
    centerLng: -91.645,
    radiusKm: 4,
    publishedOffsetMinutes: -220,
    expiresOffsetMinutes: 400,
  },
  {
    externalId: 'scenario-riverbend-003',
    headline: 'Southgate road access advisory withdrawn',
    body:
      'Simulated advisory for the ReliefRelay demonstration district. The earlier advisory covering Southgate Industrial Estate access has been withdrawn. This record is retained to show how an expired advisory is presented.',
    severity: 'advisory' as const,
    sourceName: 'Riverbend District Roads Office (fictional)',
    sourceUrl: null,
    coverageLabel: 'Southgate Industrial Estate',
    centerLat: 41.955,
    centerLng: -91.660,
    radiusKm: 3,
    publishedOffsetMinutes: -900,
    expiresOffsetMinutes: -120,
  },
];

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी (Hindi)',
  ta: 'தமிழ் (Tamil)',
  te: 'తెలుగు (Telugu)',
};
