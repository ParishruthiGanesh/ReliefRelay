# Devpost — copy/paste, field by field

Your Devpost draft is currently named **LoopProof**. Check that is the right project before
filling anything in; if it is a leftover, create a new one named ReliefRelay.

---

## 1. Project name

```
ReliefRelay
```

## 2. Elevator pitch  (200 characters max — this one is 156)

```
Flood relief coordination with a voice assistant that turns a spoken request into an actionable record — and refuses to invent the numbers nobody gave it.
```

Alternative, 143 characters:

```
Speak what you need. ReliefRelay records it honestly, never guesses a quantity, and keeps promises and deliveries as separate numbers.
```

---

## 3. About the project  (the big Markdown box)

Paste everything between the lines.

---

## Inspiration

In a flood, needs arrive as phone calls, group messages, and people shouting at whoever has a
radio. Organisations end up unable to answer three questions:

1. What is still unmet?
2. What has already been promised by someone else?
3. Did anything actually arrive?

The third is the one that gets glossed over. A commitment gets treated as a delivery, a shelter's
capacity figure from this morning gets treated as current, and the same pallets get promised twice
because two coordinators were looking at the same spreadsheet.

Meanwhile the people most in need are often the least able to fill in a form: no shared language
with the responders, a failing phone, no time. So the front door had to be a conversation, not a
form — and everything behind it had to be ruthless about not overstating what had happened.

## What it does

**Speak what you need.** A community representative says:

> *"We are at the school near the old bridge. There are twenty-five people here. We need food and
> drinking water."*

The assistant records **meal packs**, **drinking water** and a group size of **25 people** — and
both quantities as *amount not yet known*. It asks which school, because that landmark matched two
known places. It asks whether the request covers the whole group. Then it reads the request back
and submits only when she confirms:

> *"Your request has been submitted. Your reference is RR-1001. A coordinator has not yet accepted
> it."*

Not "help is on the way." A coordinator has not seen it yet, and the app says exactly that.

**Coordinate without double-spending.** Four separate records — stock, commitment, dispatch,
receipt — and outstanding need is computed, never stored:

```
outstanding = requested − open commitments − confirmed receipts
```

So the hard case falls out correctly. A 100-pack request covered 60 + 40 by two organisations,
where the 60 arrives as 50, **automatically returns to 10 outstanding** with a visible
discrepancy — and the 10 that never left goes back into available stock.

**Say where you are, three ways.** Your device's own location with its stated accuracy drawn as a
circle, a pin you place on the map, or a known shelter from the list. Nothing converts typed words
into coordinates.

**In your language.** The assistant answers in the language it was spoken to and switches by
itself. Hindi, Spanish, Tamil and Telugu work with no API key at all; Claude covers anything else
when configured.

## How we built it

Next.js 15, TypeScript, Tailwind, SQLite via better-sqlite3, Zod, Solidity 0.8.24 on a local
Hardhat EVM, ethers v6, Leaflet, Vitest, Playwright.

Five capabilities sit behind five provider interfaces — extraction, speech-to-text, text-to-speech,
environmental feed, chain — each with a live adapter and a labelled fallback. **The app runs fully
with an empty `.env`**, and `/about` reports which is which *from the running configuration*, so
that page cannot drift away from the truth.

### The AI boundary is structural, not a prompt

The schema a model may return has **no field** for a request status, an inventory quantity, a
commitment, an assignment or a delivery confirmation. A model cannot express those changes, so it
cannot make them. It proposes; backend validation, permissions and the user's explicit
confirmation decide what is saved.

An out-of-schema reply is discarded whole, the deterministic extractor runs instead, and the
interface reports **which extractor actually produced the draft**. We have a test that feeds the
adapter a reply containing `markDelivered: true` and asserts nothing of the sort reaches the draft.

Transcripts are untrusted data: the prompt wraps the user's words in a delimiter and states the
content is a report to extract from, never an instruction to follow. Danger detection runs
server-side on the raw text independently, so a model that misses it cannot suppress the
emergency interruption.

### Preventing double allocation

The stock guard is the `WHERE` clause of the update itself, inside an immediate transaction:

```sql
UPDATE inventory_lots
   SET qty_committed = qty_committed + @qty
 WHERE id = @id AND (qty_total - qty_committed) >= @qty
```

Check and write are one statement, so no other writer can slip between them. We test it by racing
**two separate OS processes** for the same lot — exactly one wins.

### Blockchain, scoped honestly

An append-only Solidity contract records organisation-level acknowledgements: commitment,
dispatch, receipt, and appended corrections. On-chain: an opaque organisation reference, an opaque
request reference, a sha256 manifest hash, an event type, and a timestamp **truncated to the
minute**. Off-chain: everything else, so a person can be shown exactly what a hash covers.

**Chain downtime cannot block relief work.** Acknowledgements are written to SQLite as `pending`
inside the same transaction as the commitment; a separate flush attempts the chain afterwards and
retries. We test the full workflow with the chain disabled, unreachable, and against a real node.

## Challenges we ran into

The hard problems were not plumbing. They were the places where the obvious implementation is
quietly dishonest.

**"25 people need water" is not a quantity.** Every extraction approach wanted to fill the number
in. Keeping it null all the way through — and making the coordinator UI *refuse to allocate*
against it rather than defaulting to zero — meant the unknown had to be a first-class value in the
schema, the status derivation and the dashboard.

**Partial delivery against a still-open commitment double-counts** if you simply sum commitments
and receipts. Subtracting each open commitment's own receipts from its cover is a one-line fix
that took a worked example on paper to see.

**A race you cannot test in one process.** We ended up spawning two OS processes racing for the
same lot, which is the only way to show the guard is in the database and not in JavaScript.

**A nonce bug the reasoning missed.** Sequential attestation transactions collided on nonce
assignment. Every offline test passed; we only found it by standing up a real local node in a
test.

**An action with no visible result reads as a broken action.** Assigning a volunteer saved
correctly every time, but no view carried it — so the dropdown reset and the coordinator saw
nothing. Found by a person using it, not by reading the code.

**`db:reset` silently desynchronised a running server.** It deleted the database file, so the
server kept writing to the deleted inode while a freshly seeded file sat on disk. Found by running
the demo against a clean clone rather than our own working copy.

## Accomplishments we're proud of

The thing we are proudest of is a **refusal**. Ask the coordinator dashboard to allocate stock
against a quantity nobody has confirmed, and it will not. There is no number to check an
allocation against, and the system will not invent one.

Also: 135 tests and 7 contract tests covering the behaviour that actually matters — that
uncertain quantities stay uncertain, that a request cannot appear submitted before the server
acknowledged it, that two coordinators cannot allocate the same stock, that cancelled commitments
reopen the right need, that offline retries cannot duplicate a request, that chain failure blocks
nothing, and that the "nobody has been notified" promise survives translation into all five
languages.

## What we learned

That most of the engineering in a relief tool is in **what you refuse to compute**. It is trivial
to show a confident number. It is hard — and the whole point — to carry "we do not know yet"
through a schema, a status machine, a dashboard and five languages without it quietly becoming
zero.

And that you find the real defects by using the thing. Six of our fixed bugs came from driving a
browser or standing up a real node; none came from re-reading the code.

## What's next for ReliefRelay

- Native-speaker review of the Hindi, Tamil, Telugu and Spanish wording. Only English is checked.
- An SMS adapter behind the existing interface — with "sent" shown only on a real success response.
- Postgres for multi-coordinator deployments (the allocation logic maps onto `SELECT … FOR UPDATE`).
- Shelter capacity reservation, which is a genuinely different problem from the directory we have.
- A field evaluation with actual responders. Everything above is a prototype's guess at what they
  need, and they would tell us which half is wrong.

## What we are *not* claiming

Being specific about this is part of the submission.

- **Not an emergency service.** No rescue dispatch. A report of immediate danger interrupts the
  supply questions with guidance to call locally configured emergency services, flags the request
  for coordinator escalation, and states plainly that nobody has been notified.
- **No flood forecasting.** We display advisories published by a source. No model here predicts
  flooding, and we do not attribute any individual flood to a cause.
- **No SMS.** There is no messaging adapter, so the interface never shows "SMS sent".
- **No outcome metrics.** No lives saved, no emissions avoided, no beneficiaries verified. The
  metrics page shows only what the database can evidence.
- **A blockchain record is not proof of delivery.** It preserves that an acknowledgement was made.
- **All data is fictional.** Riverbend District, its shelters, hubs, organisations and advisories
  are invented and badged as such on every screen.

---

## 4. Built with  (tags — paste one at a time)

```
next.js
typescript
react
tailwindcss
sqlite
better-sqlite3
zod
solidity
hardhat
ethers.js
leaflet
openstreetmap
anthropic-claude
openai-whisper
web-speech-api
vitest
playwright
progressive-web-app
node.js
```

## 5. "Try it out" links

```
https://github.com/ParishruthiGanesh/ReliefRelay/tree/claude/happy-knuth-hg1or1
```

Add your public app URL as a second link once the tunnel or deploy is up.

If you host on a Render free instance, add one honest line beside the link — judges respect it far
more than discovering it themselves:

> Hosted on a free instance: the first load after a quiet period takes about 50 seconds to wake, and
> the demonstration dataset reseeds on each cold start.

## 6. Video demo link

Upload `ReliefRelay-demo.mp4` to YouTube as **Unlisted**, then paste the watch URL. Devpost needs
a hosted link, not a file.

Suggested title:

```
ReliefRelay — flood relief coordination with a conversational voice assistant
```

## 7. Additional info — "Upload a File"

Zip and upload:

```
docs/ARCHITECTURE.md
docs/TESTING.md
docs/PRIVACY.md
docs/INTEGRATION_MATRIX.md
docs/DEMO_SCRIPT.md
README.md
```

## 8. Track

**Climate Data & Environmental Monitoring** — positioned as climate adaptation and resilience:
sourced environmental advisories, community reports and facility updates kept visibly distinct,
with advisory areas driving the coordination workflow. Supply traceability also touches
Sustainable Supply Chains; we are not claiming organiser approval or eligibility for that track.
