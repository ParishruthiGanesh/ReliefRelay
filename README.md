# ReliefRelay

**Tell us what you need. Help teams coordinate the response.**

A flood-relief coordination prototype built for the IEEE ClimateChain Global Hackathon. Its
signature feature is a conversational voice assistant that turns a spoken request into a
structured, actionable relief request — asking one short question at a time, reading the result
back, and submitting only after the person confirms.

> **This is a prototype, not an emergency service.** It cannot send rescuers and never notifies
> responders on anyone's behalf. Every district, facility, organisation, person and advisory in it
> is fictional.

The fictional Riverbend District is placed on real land along the Cedar River in Iowa, a
genuinely flood-prone area, so the map shows streets and a river a person can orient by. Every
facility name and address carries "(fictional)" and every screen carries the fictional-data
badge; no real shelter, hub or organisation is named anywhere. To move it, change `DISTRICT` and
the facility coordinates in `src/lib/db/seed-data.ts` and run `npm run db:reset`.

---

## Run it

```bash
npm install
cp .env.example .env.local     # optional: everything below runs with it empty
npm run db:seed                # creates ./data/reliefrelay.db with fictional data
npm run dev                    # http://localhost:3000
```

That is the whole setup. With no credentials configured you get:

* the full request → review → allocation → delivery → receipt workflow;
* the conversational assistant, running the deterministic on-server extractor;
* a clearly-labelled **simulated** advisory feed;
* a clearly-labelled **scripted** voice demonstration;
* attestations queued as `pending` in the database.

### Demonstration accounts

Printed by `npm run db:seed`. All fictional; the passwords are not secrets.

| Email | Password | Role |
| --- | --- | --- |
| `coordinator@reliefrelay.test` | `coordinator-demo` | Coordinator |
| `coordinator2@reliefrelay.test` | `coordinator-demo` | Second coordinator (for the concurrency demo) |
| `shelter@reliefrelay.test` | `shelter-demo` | Shelter representative (Riverside Primary) |
| `hall@reliefrelay.test` | `shelter-demo` | Shelter representative (Old Bridge Hall) |
| `volunteer1@reliefrelay.test` | `volunteer-demo` | Approved volunteer |
| `volunteer2@reliefrelay.test` | `volunteer-demo` | Approved volunteer |
| `volunteer3@reliefrelay.test` | `volunteer-demo` | Volunteer **awaiting approval** (shows the refusal) |
| `donor@reliefrelay.test` | `donor-demo` | Donor organisation |

Members of the public never need an account, and never need a crypto wallet.

### Reset

```bash
npm run db:reset         # clears and reseeds in place — safe while `npm run dev` is running
npm run db:reset:hard    # deletes and recreates the file; stop the dev server first
```

Use the plain reset for a clean demonstration. It clears the tables rather than replacing the
file, because a running dev server holds an open handle: deleting the file would leave the server
writing to a deleted inode while a freshly seeded file sat on disk, and the two would silently
diverge until you restarted. `--hard` is for after a schema change.

---

## Turning on the optional integrations

Each key flips exactly one capability from fallback to live. `/about` in the running app reports
which ones are actually active, read from the live configuration rather than from this file.

### Live speech

```bash
# .env.local
STT_PROVIDER=openai          # or: deepgram
OPENAI_API_KEY=sk-...
TTS_PROVIDER=openai
```

Without this, the microphone falls back to the browser's own speech recognition where available
(labelled as such), otherwise typing or the scripted demonstration. **Nothing ever reports a
transcript that no service produced.**

### Claude for extraction

```bash
EXTRACTION_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

The model proposes a strictly-validated patch; the backend decides what is saved. If the reply is
unparseable or outside the schema, the deterministic extractor runs instead and the UI says so.

### A real environmental feed

```bash
ENV_FEED_PROVIDER=geojson
ENV_FEED_URL=https://example.org/flood-advisories.geojson
ENV_FEED_SOURCE_NAME=Example Water Office
```

Expected GeoJSON `properties` per feature: `id`, `headline` (required), `description`, `severity`,
`source`, `url`, `published`, `expires`, `coverage`, `radius_km`. Point geometry gives the centre.
Official records and simulated ones are stored with different `record_kind` values and are never
merged in the interface.

### The local blockchain

```bash
npm run chain:compile
npm run chain:node          # terminal 1 — local Hardhat EVM on :8545
npm run chain:deploy        # terminal 2 — deploys and registers the three org identities
```

The deploy script prints the contract address and writes `chain/deployment.local.json`. Then:

```bash
# .env.local
CHAIN_ENABLED=true
CHAIN_RPC_URL=http://127.0.0.1:8545
CHAIN_CONTRACT_ADDRESS=0x...        # from the deploy output
CHAIN_ATTESTER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

That private key is Hardhat's well-known development account #1, registered as the attester for
*Riverbend Aid Collective*. It holds nothing and must never be used on a public network.

Restart the dev server. Attestation status moves from *Pending* to *Confirmed on local development
chain*, with a transaction hash and block number. **Stopping the node at any point does not break
anything** — acknowledgements stay queued and retryable, and relief coordination continues.

### Emergency number

```bash
EMERGENCY_NUMBER=112
EMERGENCY_LABEL=Your local emergency services
```

Configure this for your region before showing the app to anyone. The app displays it when someone
reports immediate danger, and always says plainly that it has **not** contacted anyone.

---

## What is real, what is local, what is simulated

| Capability | State without credentials | With credentials |
| --- | --- | --- |
| Requests, review, allocation, dispatch, receipts, discrepancies | **Real**, SQLite with transactional allocation | same |
| Private tracking links | **Real**, sha256-hashed tokens | same |
| Conversational extraction | **Local** — deterministic rule-based extractor, no network call | **Live** — Claude via the Anthropic API |
| Speech to text | **Unavailable** — browser recogniser if present, else typing or the scripted demo | **Live** — OpenAI Whisper or Deepgram |
| Spoken replies | **Local** — the browser's own voice | **Live** — OpenAI TTS |
| Flood advisories | **Simulated** — labelled scenario feed | **Live** — configured GeoJSON source |
| Supply attestations | **Queued** as pending in the database | **Local chain** — real Solidity on a local Hardhat EVM |
| District, facilities, organisations, people | **Fictional** always | — |
| SMS / messaging notifications | **Not implemented.** No adapter exists, so the UI never shows "SMS sent" | — |
| Flood forecasting | **Not implemented and not claimed.** ReliefRelay displays what a source published | — |
| Rescue dispatch | **Deliberately absent.** Danger reports interrupt with guidance to call emergency services | — |

The running app reproduces this table at `/about` from its actual configuration.

---

## The demonstration

`docs/DEMO_SCRIPT.md` is a four-to-five-minute walkthrough. The short version:

1. A simulated flood advisory is in force over the left bank.
2. A community representative speaks a request: *"We are at the school near the old bridge. There
   are twenty-five people here. We need food and drinking water."*
3. The assistant records both resources and the group size, asks **which** school (two match), then
   whether the request covers the whole group, reads it back, and submits on confirmation.
   It never turns 25 people into 25 of anything.
4. A coordinator reviews it. Committing stock is **refused** until a human confirms a quantity.
   Assigning a volunteer names them on the commitment row, so the coordinator can see it took
   effect.
5. Two organisations commit 60 and 40 of 100 meal packs. Neither can take the other's stock.
6. A delivery of 60 arrives as 50. The outstanding need automatically becomes 10, with a visible
   discrepancy, and the 10 that never left returns to available stock.
7. A third organisation covers the reopened 10; the recipient confirms receipt.
8. The shelter representative updates capacity by voice; the directory shows it as
   *facility-confirmed, just now*.
9. The attestation trail shows commitment, dispatch, receipt and the appended correction.

---

## Project layout

```
contracts/SupplyAttestations.sol   append-only organisation-level acknowledgements
chain/                             deploy script and contract tests
scripts/                           migrate, seed, reset
src/lib/db/                        schema.sql, connection, fictional seed data
src/lib/domain/                    allocation, requests, commitments, facilities,
                                   duplicates, metrics, matching, attestations
src/lib/conversation/              engine, merge, questions, readback, danger, locations
src/lib/providers/                 stt, tts, extraction, envfeed, chain — one interface each
src/lib/validation/schemas.ts      every API input and every model output
src/app/                           pages and route handlers
tests/                             92 tests; see docs/TESTING.md
```

`docs/ARCHITECTURE.md` explains the data flow and the design rules in detail.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | 92 backend and domain tests |
| `npm run chain:test` | 7 Solidity contract tests |
| `npm run verify` | typecheck + tests + contract tests + production build |
| `npm run db:seed` / `db:reset` | Seed, or clear and reseed in place |
| `npm run db:reset:hard` | Delete and rebuild the database file (stop the dev server first) |
| `npm run chain:node` / `chain:deploy` | Local EVM node and deployment |

---

## Privacy and retention

* **Recordings** are held in memory for the length of the transcription call and then discarded.
  They are never written to disk and never written to a log. Set `RETAIN_SERVER_AUDIO=true` only
  with explicit consent from the people recorded.
* **Transcripts** stay in the operator database so a coordinator can read what someone actually
  said. They are never published and never written on-chain.
* **Exact locations and contact details** are coordinator-only. Public maps show points coarsened
  to roughly a one-kilometre grid.
* **Tracking tokens** are stored only as sha256 hashes. The printable reference code (`RR-1042`) is
  not accepted as a credential, so it is safe to read aloud.
* **On-chain records** contain an opaque organisation reference, an opaque request reference, a
  sha256 manifest hash, an event type, and a timestamp truncated to the minute. No names, phone
  numbers, coordinates, medical information, recordings or transcripts.

A blockchain record preserves that an acknowledgement was made. It is **not** independent proof
that goods changed hands, and it does not prevent anyone acknowledging something untrue.

---

## Languages

The assistant answers in the language it was spoken to, and switches by itself when the script is
decisive — someone who picked English and then speaks Tamil is answered in Tamil.

Three separate questions, reported separately at `/about`, because conflating them is how products
end up claiming coverage they do not have:

| Language | Replies | Understood without an API key | Speech recognition |
| --- | --- | --- | --- |
| English | Reviewed | Yes | Whisper or Deepgram |
| Hindi | Written, awaiting native review | Yes | Whisper or Deepgram |
| Spanish | Written, awaiting native review | Yes | Whisper or Deepgram |
| Tamil | Written, awaiting native review | Yes | Whisper only |
| Telugu | Written, awaiting native review | Yes | Whisper only |
| Anything else | English | Only with `ANTHROPIC_API_KEY` | Depends on the provider |

"Understood without an API key" means the built-in extractor has a vocabulary for that language —
keyword matching for resources, quantities and group size, not full comprehension. Claude reads
any language when configured, and the interface always reports which extractor actually ran.

**On translation quality.** Only the English wording has been checked by a native speaker. The
others were written for this prototype and are labelled in the interface as awaiting review,
because a mistranslated question in a relief app is a real harm rather than a cosmetic one. What
gets *recorded* is unaffected either way: the structure of every reply is decided by tested code
and only the wording comes from a catalogue, so a translation can change how something reads but
cannot make the assistant claim something that did not happen.

Adding a language means adding one entry to `src/lib/i18n/messages.ts` and, optionally, a
vocabulary in `src/lib/providers/extraction/keywords.ts`. A test asserts that every language
defines every string English does, with the same placeholders.

## Saying where you are

A request with no location cannot be acted on, so the location question cannot be skipped — and
there are four ways to answer it:

* say or type the place in your own words;
* **use my current location**, with the device's own stated accuracy drawn as a circle;
* tap the map to place a pin;
* choose a known shelter or hub from the list.

Nothing here turns typed words into coordinates. A vague landmark that matches two known places
becomes a question, not a guess. Exact points are stored for coordinators; the public map shows a
point coarsened to roughly a kilometre.

## Dependency advisories

`npm install` reports advisories. Here is the honest state of them, because the
headline count is misleading:

```bash
npm audit --omit=dev     # what actually ships: 1 underlying issue
npm audit                # everything, including the test and chain toolchains
```

**Runtime tree (what ships): one underlying issue, not reachable here.** Both entries
(`next` and `postcss`) trace to the same thing — `next` has no advisory of its own, it is
flagged `via: ["postcss"]`. The PostCSS advisories concern CSS source-map handling and
`</style>` escaping, and they require *attacker-controlled CSS*. PostCSS runs here at build
time over this repository's own stylesheet and Tailwind's output; no user input ever reaches
it. Clearing the flag requires Next 16, a framework major version, which would close no
actual exposure in this application. Worth doing deliberately, not in a rush before a demo.

**Everything else is dev-only** and never ships: `hardhat` and its tree (`undici`,
`adm-zip`, `serialize-javascript`, `tmp`, `@fastify/busboy`), `vitest` and `tinypool`.
They run on a developer's machine against this repository's own code.

**What was actually acted on:**

* **`zod` upgraded to 4.6.7.** This one mattered — it is a runtime dependency that validates
  every untrusted API body, and the advisory is memory exhaustion while validating oversized
  constrained collections, which is exactly what a public endpoint receives. There is no fix
  on the 3.x line. `tests/validation-guarantees.test.ts` re-verifies the properties the
  security model depends on across the major version, above all that `.strict()` still
  rejects the keys a language model is not allowed to propose.
* **Request bodies are capped before parsing** (`src/lib/api/http.ts`). A schema limit such
  as `.max(8)` on an array is checked *after* the payload has been parsed into memory, so it
  cannot defend an endpoint against a hundred-megabyte array. The cap is 256 KB for JSON and
  28 MB for the audio endpoint, enforced on the measured body rather than a claimed
  `content-length`. This holds regardless of which validator is in use, which is the point.

`npm audit fix --force` would install Hardhat 3 and Next 16. Both are breaking, and neither
closes a path that is reachable in this application. Run them when you intend to migrate, not
to quiet a number.

## Deployment notes

The app needs a **writable filesystem** for the SQLite database at `RELIEFRELAY_DB_PATH`. It does
not need a *persistent* one to be demonstrable: on boot, an empty database is detected and seeded
with the fictional dataset, logging `empty database detected — seeded the fictional demonstration
data`. So on an ephemeral host (a Render free instance, for example) point `RELIEFRELAY_DB_PATH` at
`/tmp/reliefrelay.db` and every cold start comes up as a clean, fully populated district; requests
submitted between restarts are lost. Set `RELIEFRELAY_NO_AUTOSEED=true` to disable the behaviour.

For data that survives a restart, point `RELIEFRELAY_DB_PATH` at a mounted volume, or port the
repository layer in `src/lib/domain/` to a hosted Postgres — the allocation logic depends on
`BEGIN IMMEDIATE` plus a conditional `UPDATE`, which maps to `SELECT ... FOR UPDATE` or the same
conditional-update pattern.

The build needs devDependencies — `typescript`, `tailwindcss` and `postcss` among them. If your
host sets `NODE_ENV=production` before the install step, `npm install` silently skips them and
`next build` fails with `Cannot find module 'typescript'`. Install with `npm ci --include=dev`, and
leave `NODE_ENV` to the platform rather than setting it as a build variable. `next.config.mjs` is
plain JavaScript for the same family of reasons: Next loads the config at `next start` as well as at
build time, and a `.ts` config would make `typescript` a runtime dependency.

The local chain is **local only**. There is no configuration in this repository that deploys to a
public network, and the development keys hold no value.
