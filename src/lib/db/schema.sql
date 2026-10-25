-- ReliefRelay schema (SQLite).
--
-- Design rules enforced here and in src/lib/domain:
--   * Quantities always carry an explicit unit. Nothing is unit-less.
--   * Group size (people) is stored separately from supply quantities and is
--     never used to derive a supply quantity.
--   * Stock, commitment, dispatch and receipt are four separate records.
--     A commitment is not a delivery.
--   * Private request access is by a hashed token only. The human-readable
--     reference code (RR-1042) is NOT an access credential.
--   * Nothing here is written by a language model. Models propose; the
--     backend validates, authorises and saves.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ───────────────────────────── reference data ──────────────────────────────

CREATE TABLE IF NOT EXISTS districts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  is_fictional  INTEGER NOT NULL DEFAULT 1,
  center_lat    REAL NOT NULL,
  center_lng    REAL NOT NULL
);

-- Resource categories with a single canonical unit each. Mixing units is a bug,
-- so the unit lives with the category rather than with each row's prose.
CREATE TABLE IF NOT EXISTS resource_categories (
  id            TEXT PRIMARY KEY,          -- meal_packs | drinking_water | hygiene_kits | shelter_spaces
  label         TEXT NOT NULL,
  unit          TEXT NOT NULL,             -- packs | litres | kits | spaces
  unit_label    TEXT NOT NULL,             -- "meal packs" | "litres" | "kits" | "spaces"
  counts_people INTEGER NOT NULL DEFAULT 0 -- 1 only for shelter_spaces (beds, still not people)
);

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('ngo','business','government','community')),
  is_fictional  INTEGER NOT NULL DEFAULT 1,
  -- Opaque on-chain identity. No organisation name is ever written on-chain.
  chain_org_ref TEXT NOT NULL UNIQUE,
  wallet_address TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facilities (
  id              TEXT PRIMARY KEY,
  district_id     TEXT NOT NULL REFERENCES districts(id),
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('shelter','supply_hub')),
  -- Facilities are public locations, so exact coordinates are fine here.
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  address         TEXT NOT NULL,
  public_contact  TEXT,                     -- only a channel approved for publication
  accessibility   TEXT NOT NULL DEFAULT '[]', -- JSON array of feature strings
  opening_status  TEXT NOT NULL DEFAULT 'open' CHECK (opening_status IN ('open','full','closed')),
  capacity_total  INTEGER,
  capacity_available INTEGER,
  is_fictional    INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

-- Every facility change is an append-only update carrying its own provenance
-- and timestamp, so "reported" / "confirmed" / "stale" can be told apart.
CREATE TABLE IF NOT EXISTS facility_updates (
  id              TEXT PRIMARY KEY,
  facility_id     TEXT NOT NULL REFERENCES facilities(id),
  capacity_available INTEGER,
  opening_status  TEXT CHECK (opening_status IN ('open','full','closed')),
  note            TEXT,
  resources_note  TEXT,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('user_reported','coordinator_reviewed','facility_confirmed','official_source')),
  reported_by     TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facility_updates_facility ON facility_updates(facility_id, created_at DESC);

-- ───────────────────────────── accounts ────────────────────────────────────
-- Public users never need an account. These are coordinators, facility
-- representatives, donors and approved volunteers.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('coordinator','facility_rep','volunteer','donor')),
  organization_id TEXT REFERENCES organizations(id),
  facility_id     TEXT REFERENCES facilities(id),
  password_hash   TEXT NOT NULL,
  is_approved     INTEGER NOT NULL DEFAULT 0,  -- volunteers must be approved
  is_fictional    INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,          -- sha256 of the cookie value
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);

-- ───────────────────────────── requests ────────────────────────────────────

CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,
  reference_code  TEXT NOT NULL UNIQUE,      -- RR-1042: human-readable, NOT a credential
  district_id     TEXT NOT NULL REFERENCES districts(id),
  intent          TEXT NOT NULL CHECK (intent IN ('need','offer','facility_update','status_inquiry')),
  status          TEXT NOT NULL CHECK (status IN (
                    'submitted','under_review','partially_allocated','fully_allocated',
                    'delivery_in_progress','partially_received','fulfilled','cancelled','disputed')),
  -- Group size is people. It is never converted into a supply quantity.
  group_size      INTEGER,
  group_size_uncertain INTEGER NOT NULL DEFAULT 0,

  -- Location: free text plus an optionally *confirmed* resolution. A vague
  -- landmark never silently becomes coordinates.
  location_text   TEXT NOT NULL,
  resolved_facility_id TEXT REFERENCES facilities(id),
  resolved_lat    REAL,
  resolved_lng    REAL,
  location_confirmed INTEGER NOT NULL DEFAULT 0,
  -- Coarse point for public maps (rounded). Exact points stay coordinator-only.
  public_lat      REAL,
  public_lng      REAL,

  needed_from     TEXT,
  needed_by       TEXT,
  reported_urgency TEXT CHECK (reported_urgency IN ('low','normal','high','critical')),

  -- Contact details are sensitive: coordinator views only, never public, never on-chain.
  contact_method  TEXT CHECK (contact_method IN ('phone','whatsapp','sms','none')),
  contact_value   TEXT,

  original_language   TEXT NOT NULL DEFAULT 'en',
  original_text       TEXT,                  -- user's words, kept for coordinators
  transcript_text     TEXT,
  submitted_on_behalf INTEGER NOT NULL DEFAULT 0,
  behalf_role     TEXT CHECK (behalf_role IN ('self','community_rep','coordinator','facility_rep')),

  missing_fields  TEXT NOT NULL DEFAULT '[]',-- JSON array, visible to coordinators
  review_flags    TEXT NOT NULL DEFAULT '[]',-- JSON array, e.g. ["danger_reported","quantity_uncertain"]
  danger_reported INTEGER NOT NULL DEFAULT 0,

  source_kind     TEXT NOT NULL DEFAULT 'user_reported'
                    CHECK (source_kind IN ('user_reported','coordinator_reviewed','facility_confirmed','official_source')),
  input_mode      TEXT NOT NULL DEFAULT 'text' CHECK (input_mode IN ('voice','text','voice_demo')),
  extraction_provider TEXT,                  -- which provider actually produced the draft
  stt_provider        TEXT,

  tracking_token_hash TEXT NOT NULL UNIQUE,  -- sha256 of the private tracking token
  created_by      TEXT REFERENCES users(id),
  is_fictional    INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  reviewed_at     TEXT,                      -- first coordinator review (metrics)
  first_allocated_at TEXT                    -- first commitment (metrics)
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_reference ON requests(reference_code);

CREATE TABLE IF NOT EXISTS request_items (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  category_id     TEXT NOT NULL REFERENCES resource_categories(id),
  -- NULL quantity with quantity_uncertain=1 means "they need this, amount
  -- unknown". It must stay unknown until a human supplies a number.
  quantity        REAL,
  unit            TEXT NOT NULL,
  quantity_uncertain INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (request_id, category_id)
);

-- Append-only audit trail. Status changes, edits, receipts, disputes.
CREATE TABLE IF NOT EXISTS request_events (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '{}',
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('public','coordinator','facility_rep','volunteer','donor','system')),
  actor_user_id   TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id, created_at);

-- ───────────────────── conversation state (server authoritative) ───────────

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  language        TEXT NOT NULL DEFAULT 'en',
  mode            TEXT NOT NULL CHECK (mode IN ('request','facility_update','request_update')),
  -- Validated structured draft. The only thing a model may influence, and only
  -- through a validated merge.
  draft_json      TEXT NOT NULL,
  asked_fields    TEXT NOT NULL DEFAULT '[]',-- so a question is never repeated
  -- The question the assistant actually asked and is waiting on. Stored rather
  -- than recomputed, so the client can never be shown a different question from
  -- the one the server is interpreting the next answer against.
  pending_question TEXT,
  question_count  INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL CHECK (state IN ('collecting','confirming','submitted','abandoned')),
  -- set for authenticated flows (facility updates, request updates)
  user_id         TEXT REFERENCES users(id),
  target_request_id TEXT REFERENCES requests(id),
  target_facility_id TEXT REFERENCES facilities(id),
  submitted_request_id TEXT REFERENCES requests(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text            TEXT NOT NULL,
  -- Transcripts are treated as untrusted data, never as instructions.
  input_mode      TEXT NOT NULL CHECK (input_mode IN ('voice','text','voice_demo','system')),
  stt_provider    TEXT,
  extraction_provider TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation ON conversation_turns(conversation_id, created_at);

-- ───────────────────────────── supply side ─────────────────────────────────

-- Recorded stock. qty_committed can never exceed qty_total; that invariant is
-- what stops two coordinators allocating the same stock twice.
CREATE TABLE IF NOT EXISTS inventory_lots (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  category_id     TEXT NOT NULL REFERENCES resource_categories(id),
  facility_id     TEXT REFERENCES facilities(id),
  general_location TEXT NOT NULL,
  unit            TEXT NOT NULL,
  qty_total       REAL NOT NULL CHECK (qty_total >= 0),
  qty_committed   REAL NOT NULL DEFAULT 0 CHECK (qty_committed >= 0),
  available_from  TEXT,
  available_until TEXT,
  expiry_note     TEXT,
  storage_note    TEXT,
  handover        TEXT NOT NULL DEFAULT 'either' CHECK (handover IN ('collection','delivery','either')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (qty_committed <= qty_total)
);

CREATE INDEX IF NOT EXISTS idx_lots_category ON inventory_lots(category_id);

-- A commitment reserves stock against one request item. It is a promise,
-- not a delivery.
CREATE TABLE IF NOT EXISTS commitments (
  id              TEXT PRIMARY KEY,
  request_item_id TEXT NOT NULL REFERENCES request_items(id) ON DELETE CASCADE,
  request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  inventory_lot_id TEXT NOT NULL REFERENCES inventory_lots(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  qty             REAL NOT NULL CHECK (qty > 0),
  unit            TEXT NOT NULL,
  -- committed  : stock reserved, nothing moving yet
  -- dispatched : on its way; still covers the need until a receipt resolves it
  -- received / partially_received / cancelled / disputed : settled, the need is
  --   then covered only by confirmed receipts
  status          TEXT NOT NULL CHECK (status IN
                    ('committed','dispatched','received','partially_received','cancelled','disputed')),
  cancel_reason   TEXT,
  approved_by     TEXT REFERENCES users(id),   -- a coordinator approves allocation
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_item ON commitments(request_item_id, status);
CREATE INDEX IF NOT EXISTS idx_commitments_request ON commitments(request_id);

-- Dispatch: an organisation says the goods left, with who is carrying them.
CREATE TABLE IF NOT EXISTS dispatches (
  id              TEXT PRIMARY KEY,
  commitment_id   TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  qty             REAL NOT NULL CHECK (qty > 0),
  unit            TEXT NOT NULL,
  volunteer_id    TEXT REFERENCES users(id),
  instructions    TEXT,
  access_note     TEXT,                        -- known access restrictions, with a source
  access_note_source TEXT,
  access_note_at  TEXT,
  created_at      TEXT NOT NULL
);

-- Receipt: the recipient confirms what actually arrived. This is the only
-- thing that reduces outstanding need permanently.
CREATE TABLE IF NOT EXISTS receipts (
  id              TEXT PRIMARY KEY,
  commitment_id   TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  request_item_id TEXT NOT NULL REFERENCES request_items(id) ON DELETE CASCADE,
  qty_received    REAL NOT NULL CHECK (qty_received >= 0),
  unit            TEXT NOT NULL,
  confirmed_by_kind TEXT NOT NULL CHECK (confirmed_by_kind IN ('recipient','coordinator','facility_rep')),
  confirmed_by_user_id TEXT REFERENCES users(id),
  note            TEXT,
  is_shortfall    INTEGER NOT NULL DEFAULT 0,
  is_failure      INTEGER NOT NULL DEFAULT 0,  -- nothing arrived
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipts_item ON receipts(request_item_id);
CREATE INDEX IF NOT EXISTS idx_receipts_commitment ON receipts(commitment_id);

-- Volunteer assignments. A volunteer sees only their own assignments.
CREATE TABLE IF NOT EXISTS assignments (
  id              TEXT PRIMARY KEY,
  commitment_id   TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  volunteer_id    TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('offered','accepted','withdrawn','completed','reassigned')),
  assigned_by     TEXT REFERENCES users(id),
  instructions    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assignments_volunteer ON assignments(volunteer_id, status);

-- ───────────────────────────── offers from donors ──────────────────────────

CREATE TABLE IF NOT EXISTS offers (
  id              TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  contact_name    TEXT,
  contact_method  TEXT,
  contact_value   TEXT,
  category_id     TEXT NOT NULL REFERENCES resource_categories(id),
  qty             REAL NOT NULL CHECK (qty > 0),
  unit            TEXT NOT NULL,
  general_location TEXT NOT NULL,
  available_from  TEXT,
  available_until TEXT,
  handover        TEXT NOT NULL DEFAULT 'either' CHECK (handover IN ('collection','delivery','either')),
  storage_note    TEXT,
  expiry_note     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review','accepted','declined')),
  inventory_lot_id TEXT REFERENCES inventory_lots(id),
  created_at      TEXT NOT NULL
);

-- ───────────────────────────── duplicate review ────────────────────────────
-- Suggested only. Nothing is auto-merged, deleted or suppressed.

CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id              TEXT PRIMARY KEY,
  request_a_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  request_b_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  score           REAL NOT NULL,
  reasons         TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','confirmed_duplicate','not_duplicate')),
  decided_by      TEXT REFERENCES users(id),
  decided_at      TEXT,
  created_at      TEXT NOT NULL,
  UNIQUE (request_a_id, request_b_id)
);

-- ───────────────────────────── environmental advisories ────────────────────

CREATE TABLE IF NOT EXISTS advisories (
  id              TEXT PRIMARY KEY,
  external_id     TEXT,
  headline        TEXT NOT NULL,
  body            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('advisory','watch','warning','severe')),
  source_name     TEXT NOT NULL,
  source_url      TEXT,
  -- 'official' records and 'scenario' records are never mixed in the UI.
  record_kind     TEXT NOT NULL CHECK (record_kind IN ('official','scenario')),
  published_at    TEXT NOT NULL,
  expires_at      TEXT,
  coverage_label  TEXT NOT NULL,
  -- Simple circular coverage is enough for a district-scale prototype.
  center_lat      REAL NOT NULL,
  center_lng      REAL NOT NULL,
  radius_km       REAL NOT NULL,
  fetched_at      TEXT NOT NULL,
  UNIQUE (source_name, external_id)
);

-- ───────────────────────────── chain attestations ──────────────────────────
-- Organisation-level acknowledgements only. Opaque refs and manifest hashes.
-- Chain downtime must never block relief work, so rows queue here and retry.

CREATE TABLE IF NOT EXISTS attestations (
  id              TEXT PRIMARY KEY,
  commitment_id   TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('commitment','dispatch','receipt','discrepancy')),
  -- What goes on-chain: these three fields and nothing else.
  chain_org_ref   TEXT NOT NULL,
  manifest_hash   TEXT NOT NULL,             -- 0x-prefixed sha256 of the canonical manifest
  manifest_json   TEXT NOT NULL,             -- kept OFF-chain so the hash can be explained
  status          TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  tx_hash         TEXT,
  block_number    INTEGER,
  chain_id        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attestations_status ON attestations(status, created_at);

-- ───────────────────────────── idempotency ─────────────────────────────────
-- An offline client may retry the same submission. Same key => same request,
-- never a duplicate.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  scope           TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
