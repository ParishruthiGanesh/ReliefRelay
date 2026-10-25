# ReliefRelay — architecture and data flow

## The problem this shape is solving

People report needs through scattered calls and messages. Organisations cannot easily see what
remains unmet, which supplies are already committed, whether a shelter has space, or whether a
delivery actually arrived. The hard part is not storing reports — it is keeping four different
things apart that everyone's instinct is to collapse into one number.

Everything below follows from that.

---

## The four-record model

```
inventory_lots   what an organisation says it has
     │
     │  commitStock()   reserves qty atomically
     ▼
commitments      what it has promised to ONE request item   ← a promise, not a delivery
     │
     │  recordDispatch()
     ▼
dispatches       what physically left, and who carried it
     │
     │  recordReceipt()   ← a human confirms
     ▼
receipts         what the recipient confirms arrived        ← the only permanent reduction
```

Outstanding need for a request item is computed, never stored:

```
openCover   = Σ (commitment.qty − its receipts)  for status in (committed, dispatched)
received    = Σ (all receipts against this item)
outstanding = requested − openCover − received          (null if requested is unknown)
```

Subtracting a commitment's own receipts from its open cover is what stops a mid-flight partial
delivery being counted twice. The whole calculation lives in one pure function,
`computeItemAllocation` in `src/lib/domain/allocation.ts`, so no screen can disagree with another.

### The worked example, traced

| Step | open cover | received | outstanding | shortfall |
| --- | --- | --- | --- | --- |
| Shelter requests 100 packs | 0 | 0 | 100 | 0 |
| Org A commits 60 | 60 | 0 | **40** | 0 |
| Org B commits 40 | 100 | 0 | **0** | 0 |
| Org A dispatches 60 | 100 | 0 | 0 | 0 |
| Org A's receipt confirms 50 | 40 (B only) | 50 | **10** | **10** |
| Org C commits the reopened 10 | 50 | 50 | 0 | 10 |

The 10 packs that never left go back to Org A's available stock; the 50 that arrived leave the lot
permanently. Both happen in `recordReceipt`, in the same transaction as the receipt row.

---

## Preventing double allocation

`commitStock` runs inside `BEGIN IMMEDIATE`, and the stock guard is the `WHERE` clause of the
update itself:

```sql
UPDATE inventory_lots
   SET qty_committed = qty_committed + @qty
 WHERE id = @id AND (qty_total - qty_committed) >= @qty
```

Check and write are one statement, so no other writer can slip between them. A coordinator acting
on a stale reading of "90 available" gets `insufficient_stock`, not a silent over-commit. A
`CHECK (qty_committed <= qty_total)` constraint backs it up at the schema level.

`tests/concurrency.test.ts` proves this with two **separate OS processes** holding separate
connections, racing for the same lot: exactly one succeeds.

---

## The conversation

State is authoritative on the server. The browser holds no draft the server does not have, so a
reload, a crash or a dropped connection resumes exactly where it left off.

```
POST /api/conversation              → conversation id, provider status
POST /api/conversation/:id/turn     → extract → merge → resolve location → one next question
POST /api/conversation/:id/location → the user picks from offered candidates
POST /api/conversation/:id/confirm  → validate, save, return reference + tracking token
```

One turn, in order (`src/lib/conversation/engine.ts`):

1. Load the draft and the **stored** pending question. It is stored rather than recomputed so the
   question the user sees is always the one the server interprets their answer against.
2. Ask the extraction provider for a `ProposedUpdate`.
3. Validate it against `proposedUpdateSchema`, which is `.strict()`.
4. Merge it into the draft with `mergeProposal` — a pure function.
5. Re-check the raw text for danger signals, independently of the model.
6. Resolve the location into *candidates*, never into a guessed point.
7. Pick the single next question, or move to the read-back.
8. Persist the draft, the asked-fields list and the new pending question.

### What a model can and cannot express

`proposedUpdateSchema` has no field for a request status, an inventory quantity, a commitment, an
assignment or a delivery confirmation. A model cannot propose those changes, so it cannot make
them. It can only propose values for fields a person just spoke about.

An out-of-schema reply is discarded entirely, the deterministic extractor runs instead, and the UI
reports *which extractor actually produced the draft* — see
`tests/providers.test.ts`, which feeds the Anthropic adapter a reply containing
`markDelivered: true` and asserts nothing of the sort reaches the draft.

Transcripts are treated as untrusted data throughout. The Claude prompt wraps the user's words in
a delimiter and states that the content is a report to extract from, never an instruction.

### The two rules the extractors will not break

* **A group size is never a supply quantity.** There is no arithmetic anywhere between
  `groupSize` and any item quantity. "Water for 25 people" is `groupSize: 25` and a water item with
  `quantity: null`.
* **An unconvertible unit stays unconverted.** "50 bottles of water" produces `quantity: null`,
  `quantityUncertain: true`, and a note recording what was said. The assistant then asks for
  litres, offering "I don't know" as an answer.

### Question policy

`nextQuestion` asks one question at a time, in priority order, and never repeats one that was
answered or skipped. Essential questions (resources, location, which-of-these-places) are asked
even past the soft limit of three, because without them nobody can act. Optional ones stop at the
limit. Contact details and time windows are never asked — neither is needed to act on a request.

### Danger

`detectDanger` runs on the raw text server-side, so a model that misses it cannot suppress the
interruption. On a hit, the routine questions pause for brief guidance to call the configured
emergency number, the request is flagged for coordinator escalation, and the flag is sticky — a
later, calmer turn cannot clear it. The guidance object carries `respondersNotified: false`, which
is not a placeholder: nothing in this system notifies anyone.

---

## Request status

Status is derived from facts by `deriveRequestStatus` and recomputed after every commitment,
dispatch, receipt and cancellation, so it cannot drift from the records.

```
submitted → under_review → partially_allocated → fully_allocated
                                   ↓                    ↓
                         delivery_in_progress → partially_received → fulfilled
                                   ↓
                      cancelled   disputed
```

`draft` and `waiting_to_send` exist only before the server has acknowledged anything — the first in
the conversation record, the second in the browser's outbox. They are typed as
`ClientOnlyRequestStatus` and the database `CHECK` constraint does not accept them.

**"Help is on the way" is gated.** `canSayHelpIsOnTheWay(status, hasActiveAssignment)` requires a
real assignment row *and* a delivery-stage status. A submitted request, and even a fully allocated
one, returns false.

---

## Provider interfaces

Five capabilities sit behind one interface each in `src/lib/providers/`:

| Interface | Live adapter | Fallback | Reported as |
| --- | --- | --- | --- |
| `ExtractionProvider` | Anthropic Messages API | deterministic rules | the id and label of whichever ran |
| `SttProvider` | OpenAI Whisper, Deepgram | **none** — returns 503 | "nothing was transcribed" + alternatives |
| `TtsProvider` | OpenAI TTS | browser speech synthesis | "no server service was called" |
| `EnvFeedProvider` | GeoJSON source | labelled scenario feed | `record_kind: official \| scenario` |
| chain adapter | ethers → local Hardhat EVM | queued `pending` rows | pending / confirmed / failed |

Every result carries a `ProviderInfo` with `kind: 'live_service' | 'local' | 'fixture'`, which is
stored with the data and shown in the interface. `/about` renders the whole table from the running
configuration, so it cannot drift away from what the server is doing.

**Speech-to-text has no silent fallback on purpose.** With no provider configured the endpoint
returns 503 and the audio is dropped. It never returns a transcript that no service produced. The
user is offered typing, the browser's own recogniser (labelled as the browser's), or a clearly
labelled scripted demonstration.

---

## Blockchain attestations

`SupplyAttestations.sol` stores, per record: an opaque `orgRef`, an opaque `subjectRef`, a
`manifestHash`, an event type, a timestamp and the attester address. Nothing else. It is
append-only — a correction is a new `Discrepancy` record, and there is no function that could
alter an earlier one. Each fictional organisation has its own development identity, and the
contract refuses an organisation acknowledging as another.

The manifest that each hash covers is kept **off-chain** so it can be shown to a person and
explained (`explainManifest`). It contains: version, event type, org ref, subject ref, commitment
ref, category, unit, quantity, optional shortfall, and a timestamp **truncated to the minute** so
the hash cannot serve as a movement trace. `subjectRef` is `sha256(requestId)` — a stable pointer
that lets two organisations agree they mean the same request without publishing which one.

**Chain downtime cannot block relief work.** `queueAttestation` writes a durable `pending` row
inside the same transaction as the commitment. A separate flush attempts the chain afterwards and
returns a report rather than throwing, so a handler can never turn a chain problem into a failed
relief operation. `tests/chain.test.ts` runs the full flow with the chain disabled and with it
unreachable; `tests/chain-live.test.ts` starts a real node and confirms the trail end to end.

The flush assigns nonces itself rather than letting the signer derive each one — a batch of
sequential sends otherwise races the node's pending count and later transactions are rejected as
"nonce too low". That bug was found by the live test, not reasoned about.

---

## Privacy boundaries

One place decides what each audience sees: `src/lib/domain/dashboard.ts`.

| View | Exact location | Contact | Transcript | Quantities | Group size |
| --- | --- | --- | --- | --- | --- |
| `publicNeedSummaries` | coarsened ~1 km | no | no | no | no |
| `trackingView` (own request) | yes | — | — | yes | yes |
| `coordinatorRequestView` | yes | yes | yes | yes | yes |

The tracking timeline uses an **allow-list** of event kinds and fields, not a redaction list: an
unrecognised event kind is dropped. This was added because a duplicate-review decision writes an
event whose detail names *another person's request id*, which the raw timeline had been passing
through. `tests/security.test.ts` covers that case specifically.

Tracking tokens are 32 random bytes, returned once, stored only as a sha256 hash. The reference
code is deliberately not accepted as a credential, so it is safe to read aloud over a phone.

---

## Offline behaviour

Honest and narrow. The service worker caches the interface shell and **never** caches an API
response — a stale shelter capacity or request status read as current would be worse than no
answer. Submissions queue in the page's own outbox (`src/lib/client/outbox.ts`), where each item
carries an idempotency key generated once and reused on every retry, so a retry cannot create a
second request. Queued items read **"Saved on this device — not yet sent"** and never "submitted".

Speech needs the network; the offline page says so and points at the typed form.

There is no SMS adapter, so the interface never shows "SMS sent" anywhere.

---

## Prioritisation

A transparent weighted sum, with every term shown to the coordinator and the weights adjustable:
age, share still unmet, urgency as reported, danger reported, shelter capacity pressure, and
whether the location falls inside an active advisory.

Deliberately excluded: how fluently someone writes or speaks, which language they used, what
device they have, and whether they can produce identification. None indicate need, and using them
would push help away from the people most likely to need it.

Duplicate detection likewise only ever **suggests**. Nothing is merged, hidden, deleted or
deprioritised automatically, and confirming a duplicate records a judgement on both timelines
without closing either request.
