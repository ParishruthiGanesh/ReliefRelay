# ReliefRelay — Devpost submission draft

> Draft for review. Nothing here has been submitted, published or entered anywhere.

---

## Tagline

Tell us what you need. Help teams coordinate the response.

## Elevator pitch

A flood-relief coordination tool whose front door is a conversational voice assistant. Speak what
you need; it asks one or two short questions, reads the request back, and submits only when you
confirm. Behind it, coordinators work from one shared picture of what is requested, what has been
promised, and what has actually arrived — three numbers that are never allowed to merge.

---

## The problem

In a flood, needs arrive as phone calls, group messages, and people shouting at whoever has a
radio. Organisations end up unable to answer three questions:

1. What is still unmet?
2. What has already been promised by someone else?
3. Did anything actually arrive?

The third is the one that gets glossed over. A commitment gets treated as a delivery, a shelter's
capacity figure from this morning gets treated as current, and the same pallets get promised twice
because two coordinators were looking at the same spreadsheet. Meanwhile the people most in need
are often the least able to fill in a form: no shared language with the responders, a failing
phone, no time.

## Track alignment

**Primary: Climate Data & Environmental Monitoring.** ReliefRelay positions flood relief as
climate *adaptation and resilience*. It combines three distinct information sources and keeps them
visibly distinct:

* **sourced environmental advisories** — issuing body, publication time, coverage area, expiry,
  and a link to the original where one is published;
* **community reports** — what people say about their own situation, with its own provenance;
* **facility updates** — what shelters and hubs confirm about themselves, with a timestamp and a
  freshness label.

Advisory areas then drive the workflow: coordinators can see which requests and facilities fall
inside an active advisory, and it is one of the visible prioritisation factors.

We are careful about two claims. ReliefRelay does **not** forecast flooding — there is no model
here that predicts anything, and the UI says so. And it does not attribute any individual flood to
a cause; it supports resilience to flood hazards.

**Secondary relevance: Sustainable Supply Chains.** Supply traceability — commitment, dispatch,
receipt and correction, attested at organisation level — is a real part of this build. We are not
claiming organiser approval or eligibility for that track; it is simply where the second half of
the work sits.

---

## What we built

### A conversational voice assistant that produces a real record

Turn by turn, server-authoritative:

> **User:** "We are at the school near the old bridge. There are twenty-five people here. We need
> food and drinking water."
>
> **Assistant:** "I recorded meal packs and drinking water for 25 people at the school near the old
> bridge. I found two places that could match. Which one are you at — Old Bridge Community Hall, or
> Riverside Primary School?"
>
> **User:** "Riverside Primary School."
>
> **Assistant:** "Is this request for the whole group of 25?"
>
> **User:** "Yes."
>
> **Assistant:** "Your request is for meal packs and drinking water for 25 people at Riverside
> Primary School. Supply quantities still need coordinator confirmation. Shall I submit it?"
>
> **Assistant** *(after the server saves it)*: "Your request has been submitted. Your reference is
> RR-1042. A coordinator has not yet accepted it."

Three things in that exchange took most of the design effort:

**Twenty-five people is not twenty-five bottles.** Group size and supply quantity are separate
fields, and there is no arithmetic anywhere in the codebase between them. The request is submitted
with the quantity genuinely unknown, flagged for a coordinator to confirm with the requester.
Likewise "50 bottles of water" does not become 50 litres — it records what was said, marks the
quantity unknown, and asks.

**A vague landmark does not become a coordinate.** It became two candidates and a question.

**The confirmation says what actually happened.** Not "help is on the way". A sentence like that
is gated in code on a real assignment row existing.

### Coordination that keeps promises and deliveries apart

Four separate records: stock, commitment, dispatch, receipt. Outstanding need is computed, never
stored:

```
outstanding = requested − open commitments − confirmed receipts
```

So the brief's hard case falls out correctly: a 100-pack request covered 60 + 40 by two
organisations, where the 60 arrives as 50, automatically returns to 10 outstanding with a visible
discrepancy — and the 10 that never left goes back into available stock.

Two coordinators cannot allocate the same stock. The guard is a conditional `UPDATE` inside an
immediate transaction, so the check and the write are one statement. We test it by racing two
separate OS processes for the same pallets.

### Honest infrastructure

Five capabilities behind five interfaces — extraction, speech-to-text, text-to-speech,
environmental feed, chain — each with a live adapter and a labelled fallback. The app runs fully
with an empty `.env`, and `/about` reports which is which *from the running configuration*, so the
page cannot drift away from the truth.

Speech-to-text deliberately has no silent fallback: with nothing configured, the endpoint returns
503 and the recording is dropped. It never returns a transcript that no service produced.

---

## How we used AI

**Where AI is used:** turning what a person said into structured, validated fields, and proposing
one next question.

**Where it is not:** everywhere that matters to the outcome. The schema a model may return has no
field for a request status, an inventory quantity, a commitment, an assignment or a delivery
confirmation — so a model cannot express those changes, let alone make them. It proposes; backend
validation, permissions and the user's explicit confirmation decide what is saved.

Specifically:

* The proposal schema is `.strict()`. An out-of-schema reply is discarded whole, the deterministic
  extractor runs instead, and the interface reports which extractor actually produced the draft.
  We have a test that feeds the adapter a reply containing `markDelivered: true` and asserts
  nothing of the sort reaches the draft.
* Transcripts and uploads are untrusted data. The prompt wraps the user's words in a delimiter and
  states that the content is a report to extract from, not an instruction to follow.
* Danger detection runs server-side on the raw text, independently, so a model that misses it
  cannot suppress the emergency interruption.
* Match proposals are deterministic and explainable, not model-generated — a coordinator approves
  an argument, not a number from a black box. A model could phrase the same facts; it never
  decides an allocation.
* The default extractor calls no AI service at all. It is a real implementation, not a stub, and
  it runs the entire demonstration.

## How we used blockchain

A small Solidity contract on a local EVM network recording organisation-level supply
acknowledgements: commitment, dispatch, receipt, and appended corrections. Append-only — there is
no function that could alter an earlier record.

What goes on-chain: an opaque organisation reference, an opaque request reference, a sha256 hash
of a quantity-level manifest, an event type, and a timestamp truncated to the minute. What does
not: names, phone numbers, household coordinates, medical information, voice recordings,
transcripts. Those stay in the operator's database. The manifest itself is kept off-chain so a
person can be shown exactly what a given hash covers.

Each fictional organisation has its own development identity, and the contract refuses one
organisation acknowledging as another. Public users never touch a wallet.

Crucially, **the chain cannot block relief work**. Acknowledgements are written to the database as
`pending` inside the same transaction as the commitment, and a separate flush attempts the chain
afterwards and retries on failure. We test the full workflow with the chain disabled, with it
unreachable, and against a real running node.

---

## What we are not claiming

Being specific about this is part of the submission, not a disclaimer bolted on.

* **Not an emergency service.** No rescue dispatch. A report of immediate danger interrupts the
  supply questions with guidance to call locally configured emergency services, flags the request
  for coordinator escalation, and states plainly that nobody has been notified.
* **No flood forecasting.** We display advisories published by a source. No model here predicts
  flooding.
* **No SMS.** There is no messaging adapter, so the interface never shows "SMS sent".
* **No outcome metrics.** No lives saved, no emissions avoided, no beneficiaries verified. The
  metrics page shows only what the database can evidence: time to review, time to first
  allocation, requested vs committed vs received by category, delivery completion rate, cancelled
  and reassigned commitments, and the age of every facility update.
* **Not fully offline.** The shell is cached and drafts queue locally with idempotency keys, but
  speech needs a connection, and a queued request reads *"Saved on this device — not yet sent"*
  until the server acknowledges it.
* **A blockchain record is not proof of delivery.** It preserves that an acknowledgement was made.
  It does not stop anyone acknowledging something untrue.
* **Verified language coverage is English.** Hindi is wired through the same adapters; Tamil and
  Telugu are listed to show the architecture is extensible, and the app says their extraction
  patterns are not written yet rather than implying coverage.
* **All data is fictional.** Riverbend District, its three shelters, two hubs, three organisations,
  volunteers and advisories are invented. The coordinates sit in open ocean so they cannot be
  mistaken for a real place.

---

## Built with

Next.js 15 · TypeScript · Tailwind CSS · SQLite (better-sqlite3) · Zod · Solidity 0.8.24 ·
Hardhat · ethers v6 · Leaflet · Vitest · Playwright

Optional integrations: Anthropic Claude (extraction) · OpenAI Whisper or Deepgram (speech
recognition) · OpenAI TTS (spoken replies) · any GeoJSON advisory source.

---

## Challenges

The hard problems were not technical plumbing. They were the places where the obvious
implementation is quietly dishonest:

* **"25 people need water" is not a quantity.** Every extraction approach we tried wanted to fill
  the number in. Keeping it null all the way through — and making the coordinator UI refuse to
  allocate against it rather than defaulting to zero — meant the unknown had to be a first-class
  value in the schema, the status derivation and the dashboard.
* **Partial delivery against a still-open commitment double-counts** if you simply sum commitments
  and receipts. Subtracting each open commitment's own receipts from its cover is a one-line fix
  that took a worked example on paper to see.
* **A race condition you cannot test in one process.** We ended up spawning two OS processes
  racing for the same lot, which is the only way to show the guard is in the database.
* **A nonce bug the reasoning missed.** Sequential attestation transactions collided on nonce
  assignment. We only found it by standing up a real local node in a test; the offline tests all
  passed.

## What is next

* Hindi, Tamil and Telugu extraction patterns, and interface strings, verified against speech
  providers rather than assumed.
* An SMS/messaging adapter behind the existing provider interface — with "sent" shown only on a
  real success response.
* Postgres for multi-coordinator deployments (the allocation logic maps directly onto
  `SELECT ... FOR UPDATE`).
* Shelter capacity reservation, which is a genuinely different problem from the directory we have.
* A field evaluation with actual responders. Everything above is a prototype's guess at what they
  need, and they would tell us which half is wrong.
