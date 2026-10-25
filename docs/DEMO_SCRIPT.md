# ReliefRelay — four-to-five-minute demonstration

## Before you start

```bash
npm run db:reset        # clean, fictional dataset
npm run dev             # http://localhost:3000
```

Optional, for the blockchain segment (about 30 seconds of setup):

```bash
npm run chain:node      # terminal 2
npm run chain:deploy    # terminal 3 — prints the contract address
# put CHAIN_ENABLED=true and CHAIN_CONTRACT_ADDRESS=... in .env.local, restart the dev server
```

**If you skip it, the demo still works** — attestations show as *Pending*, which is itself worth
one sentence: chain downtime never blocks relief work.

Have two browser windows ready:

* **A** — a phone-sized window (the public).
* **B** — a desktop window, signed in at `/login` as `coordinator@reliefrelay.test`.

Everything you will show is fictional. Say so once, at the start, and move on.

---

## 0:00 — The problem (20 seconds)

> "During a flood, people report what they need by phone, by message, by shouting at whoever has a
> radio. Organisations end up unable to answer three questions: what is still unmet, what has
> already been promised by someone else, and whether anything actually arrived. ReliefRelay is
> about those three questions."

---

## 0:20 — Sourced environmental information (25 seconds)

**Window A → `/advisories`**

> "We start from sourced flood information. Each advisory shows who issued it, when, what area it
> covers, and when it expires — including one that has expired, kept visible so a withdrawn
> advisory is never mistaken for a current one."

Point at the purple dashed **Simulated record** badge.

> "This district's feed is simulated, and it says so on every record. Point `ENV_FEED_URL` at a
> real GeoJSON source and these become official records, stored separately and never mixed with
> the simulated ones. We don't forecast flooding, and we don't claim to."

---

## 0:45 — The voice assistant (90 seconds) — *the centrepiece*

**Window A → `Ask for help` → `Speak to the assistant`**

> "A community representative at a school. No account, no wallet."

Press the microphone (or use the text box, or the **Scripted demonstration** card — say which you
are using), and give the first line:

> *"We are at the school near the old bridge. There are twenty-five people here. We need food and
> drinking water."*

The transcript appears in an **editable** box. Point at it.

> "The transcript is always shown and always editable before it is sent. If a service transcribed
> it, the label says which one. If no speech service is configured, this says the browser did it,
> or that it is a scripted line — it never claims a service ran that didn't."

Send it. The assistant replies:

> *"I recorded meal packs and drinking water for 25 people at the school near the old bridge. I
> found two places that could match. Which one are you at — Old Bridge Community Hall, or Riverside
> Primary School?"*

**This is the moment to slow down.** Scroll to **Recorded so far**:

> "Twenty-five **people**. And both resources show *amount not yet known*. Twenty-five people who
> need water is not twenty-five bottles — nobody said how much. There is no arithmetic anywhere in
> this codebase between a group size and a supply quantity, and there is a test that proves it."

> "And 'the school near the old bridge' matched two known places, so it asks instead of guessing a
> coordinate."

Choose **Riverside Primary School**. Next question:

> *"Is this request for the whole group of 25?"*

Answer **Yes**. The read-back appears:

> *"Your request is for meal packs and drinking water for 25 people at Riverside Primary School.
> Supply quantities still need coordinator confirmation. Shall I submit it?"*

> "Two questions, then a read-back. Everything spoken is also text; nothing auto-plays; there are
> mute and stop controls. 'I don't know' is always an answer, and typing always works."

Press **Yes, submit this request**:

> *"Your request has been submitted. Your reference is RR-1001. A coordinator has not yet accepted
> it."*

> "Not 'help is on the way'. A coordinator hasn't even seen it yet, and the app says exactly that.
> The private tracking link is the only way back into this request — the reference code on its own
> opens nothing, so it's safe to read out over a phone."

**Copy the tracking link.** You need it at 3:40.

---

## 2:15 — Coordinator review and a refusal (45 seconds)

**Window B → `/coordinator`**

> "The situation summary is counted straight out of the database. No estimates."

Find RR-1001, press **Mark as reviewed**, then **Allocate supplies**.

> "Here is my favourite part."

Point at the orange panel: **Quantities still need confirming.**

> "It won't let me allocate stock. The requested amount is unknown, so there is no number to check
> an allocation against — and the system refuses to invent one. A human has to confirm a figure
> with the requester first."

Enter **100** for meal packs, press **Confirm quantity**. Proposed matches appear.

> "Now it proposes matches, with the actual ranking reasons — who has enough, how far away, whether
> they can deliver. A coordinator approves each one. The AI never allocates anything."

---

## 3:00 — Two organisations, no double-spend (40 seconds)

Commit **60** from Riverbend Aid Collective → *outstanding 40*.
Commit **40** from Northfield Relief Trust → *outstanding 0*.

> "Two organisations, one request, no overlap. Requested, committed and received stay three
> separate figures all the way through."

Optional, if you have 15 seconds — open `/coordinator/inventory` in a second tab signed in as
`coordinator2@reliefrelay.test` and try to commit the same lot:

> "And if two coordinators go for the same pallets at the same instant, one gets it and the other
> is told why. The guard is in the database, not in the browser — there's a test that races two
> separate processes for it."

---

## 3:40 — A short delivery, and recovery (60 seconds)

On the Riverbend Aid commitment: **Record dispatch**, then assign a volunteer.

**Window A → the tracking link.**

> "Only now does the requester's page say supplies are on the way — because an assignment actually
> exists. That sentence is gated on a real assignment row."

**Window B** — in *Confirmed received*, enter **50** and press **Record receipt**.

> "Sixty were promised. Fifty arrived."

Point at the row:

> "Outstanding has gone from zero back to **ten**, by itself, with the discrepancy visible. The ten
> that never left are back in Riverbend Aid's available stock. A commitment is a promise; only a
> confirmed receipt reduces need for good."

Commit the reopened **10** from Southgate Foods, dispatch, and record receipt of **10**.

> "A third organisation covers the gap. The recipient confirms what actually arrived — not the
> courier."

---

## 4:40 — Facility update, attestations, honesty (50 seconds)

**Shelter capacity** — `/find`:

> "Shelter figures carry a source and an age. Northfield's is more than eight hours old, so it is
> badged stale rather than shown as current. And finding a shelter here does not reserve a place —
> we say that explicitly."

Optionally sign in as `shelter@reliefrelay.test` at `/facility` and say *"We have ten spaces left
and enough drinking water until this evening."* It reads the fields back and saves only on
confirmation.

**Attestations** — `/coordinator/requests/<id>`, scroll to *Blockchain acknowledgements*:

> "Commitment, dispatch, receipt, and an appended correction for the shortfall. Each one is an
> opaque organisation reference, an opaque request reference, and a hash of a quantity-level
> manifest. No names, no phone numbers, no coordinates, no transcripts."

> "And it's honest about what it is: this preserves that an acknowledgement was made. It is not
> proof that goods changed hands."

If the chain is off, point at **Pending**:

> "The chain isn't running. Nothing stopped — acknowledgements queue and retry, and relief work
> never waits on a blockchain."

**Close on `/about`:**

> "This page is generated from the running configuration, not from the README. It says which
> integrations are live, which run locally, and which are simulated. Speech is unconfigured right
> now, so it says so — it will never show you a transcript that no service produced."

---

## If something goes wrong

| Problem | What to do |
| --- | --- |
| Microphone blocked or no speech service | Use the text box, or the **Scripted demonstration** card. Say which — the labelling is part of the point. |
| Dashboard looks cluttered from a previous run | `npm run db:reset` and start again. |
| Chain unreachable | Leave it. Attestations show *Pending*, which demonstrates the resilience claim. |
| Map tiles slow | Press **Hide the map**. Every map has a full list alternative. |
| "Why is the map just blue?" | The fictional district sits in open ocean on purpose, so it can never be mistaken for a real place. The markers and advisory circles are real; there is simply no land to draw. Say it in one sentence and move on. |

## Lines worth not cutting

* "Twenty-five people is not twenty-five bottles."
* "It refuses to allocate against a quantity nobody has confirmed."
* "A commitment is a promise; only a receipt reduces need."
* "The outstanding ten came back by itself."
* "A coordinator hasn't even seen it yet, and the app says exactly that."
