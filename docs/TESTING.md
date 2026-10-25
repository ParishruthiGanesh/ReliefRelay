# What was tested, and what is still blocked

```bash
npm run verify     # typecheck + 92 tests + 7 contract tests + production build
```

Last full run: **92 passing** (Vitest, 9 files) · **7 passing** (Hardhat) · typecheck clean ·
production build clean · browser walkthrough clean.

---

## The behaviour the brief asked to be tested

| Required behaviour | Where | Result |
| --- | --- | --- |
| Voice corrections update the draft correctly | `conversation.test.ts`, `merge.test.ts` | ✅ "Actually, there are 35 people" updates group size and leaves a confirmed 60-pack figure untouched |
| Uncertain quantities remain uncertain | `conversation.test.ts`, `merge.test.ts`, `workflow.test.ts` | ✅ "water for 25 people" submits with `quantity: null`; "50 bottles" never becomes 50 litres |
| Requests cannot appear submitted before server acknowledgment | `workflow.test.ts` | ✅ no request row exists before confirm; reference and status come from the server |
| Missing API credentials produce honest fallbacks | `providers.test.ts` | ✅ STT returns 503 and says nothing was transcribed; extraction falls back and labels itself; feed is badged simulated |
| Unauthorized users cannot access private requests | `security.test.ts` | ✅ token-only access; reference code rejected; wrong role, unapproved volunteer and cross-facility access all refused |
| Two coordinators cannot allocate the same stock twice | `concurrency.test.ts` | ✅ **two separate OS processes** race the same lot; exactly one wins |
| Partial delivery leaves the correct outstanding quantity | `allocation.test.ts`, `workflow.test.ts` | ✅ 60 promised, 50 received → outstanding 10, shortfall 10, 10 back in stock |
| Cancelled commitments reopen the appropriate need | `allocation.test.ts`, `workflow.test.ts` | ✅ need reopens, stock released, assigned volunteer stood down |
| Offline retries do not create duplicate requests | `conversation.test.ts`, `workflow.test.ts` | ✅ same idempotency key returns the same request; a second confirm with a new key is refused |
| Blockchain failure does not block relief operations | `chain.test.ts` | ✅ full flow completes with the chain disabled and unreachable; rows stay pending and retryable |
| Sensitive information stays out of public views and on-chain records | `security.test.ts` | ✅ public feed carries no contact, transcript, exact point, group size or quantity; manifest keys asserted exhaustively |

---

## Test files

| File | Tests | Covers |
| --- | --- | --- |
| `allocation.test.ts` | 13 | The arithmetic, as pure functions and against the database. The brief's worked example traced step by step; status derivation; "help is on the way" gating |
| `conversation.test.ts` | 9 | The brief's scripted dialogue end to end; corrections; unconvertible units; need vs offer; danger interruption; skipping; draft survival across a reload |
| `merge.test.ts` | 24 | Merge rules, question policy, read-back wording, missing-field computation, danger detection — all pure |
| `workflow.test.ts` | 6 | The complete demonstration scenario through the same functions the API calls; cancellation mid-flight; reassignment; offer acceptance; submission ordering |
| `security.test.ts` | 17 | Tracking tokens, role authorisation, facility scoping, public/private field boundaries, manifest contents, timeline allow-list |
| `concurrency.test.ts` | 4 | Two-process race; stale-read refusal; burst of reservations; the database-level CHECK constraint |
| `chain.test.ts` | 5 | Chain disabled; chain unreachable; appended corrections for shortfall and cancellation; hash explanation |
| `chain-live.test.ts` | 1 | A real Hardhat node, real deployment, real transactions: 4 acknowledgements confirmed with tx hashes and block numbers |
| `providers.test.ts` | 13 | Every fallback path, language-claim honesty, out-of-schema model replies, spoken-number handling |
| `chain/test/supplyAttestations.test.cjs` | 7 | Access control, org-mismatch refusal, append-only correction, per-subject and per-org trails |

---

## Browser walkthrough

Playwright against the **production build**, at a 390×844 phone viewport for the public screens and
1280×1000 for the coordinator:

* Public: home → ask → voice assistant → both clarifying questions → read-back → submission →
  private tracking link.
* Coordinator: sign in → review → allocation refused on an unknown quantity → confirm quantity →
  proposed matches with reasons → commit 60.
* Tracking: real status shown; a bad token refused.
* Every other screen rendered: find, advisories, about, offer, form, metrics, inventory,
  duplicates.

**Result:** no page errors, no console errors, and no horizontal overflow on any screen at phone
width. First tab stop is the skip link.

Two issues it caught and that were fixed: the assistant's reply was squeezed into a narrow column
beside the playback buttons on a phone, and the read-back listed "quantity not yet known" twice
without saying which resource each referred to.

---

## Issues found by testing, and fixed

These are worth listing because none of them were caught by reasoning about the code:

1. **The view returned the wrong question.** It recomputed the next question instead of returning
   the one actually asked, so the user saw question *n+1* while the server interpreted their
   answer against question *n*. Fixed by storing the pending question server-side.
2. **Offers were misread as needs.** The conversation pre-set `intent: 'need'`, so "we can provide
   50 meal packs" was recorded as a request for them.
3. **"at Riverside Primary School" was not recognised as a place** when phrased without "we are
   at". Now the whole utterance is checked against known facility names, with a single exact match
   required — still no guessing.
4. **A cancelled commitment dropped the request back to "submitted"**, hiding that a coordinator
   had already worked it. Approving a commitment now counts as review.
5. **The tracking timeline leaked another person's request id** through a duplicate-review event's
   raw detail. Replaced with an allow-list of event kinds and fields.
6. **Attestation transactions collided on nonce assignment** when flushed in sequence — found only
   by standing up a real local node. The adapter now tracks the nonce and resyncs after a failure.

---

## Blocked by missing credentials

Nothing is blocked from running. These paths are implemented but **unverified against the real
service**, because no API keys were used in this build:

| Path | State | What would verify it |
| --- | --- | --- |
| OpenAI Whisper transcription | Adapter written; request shape and error handling implemented. Not called. | `STT_PROVIDER=openai` + `OPENAI_API_KEY`, then record a clip |
| Deepgram transcription | Same. | `STT_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` |
| OpenAI text-to-speech | Same. Browser synthesis path is exercised. | `TTS_PROVIDER=openai` + `OPENAI_API_KEY` |
| Claude extraction | Adapter exercised with **mocked** transport in `providers.test.ts`, covering the success shape, an unparseable reply, an out-of-schema reply and a network failure. Never called for real. | `EXTRACTION_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` |
| Live GeoJSON advisory feed | Parser written and the failure path tested. No real source configured. | `ENV_FEED_PROVIDER=geojson` + `ENV_FEED_URL` |

Until those are configured, the app says so on `/about` and at the point of use. It does not
present any of them as working.

Also not implemented, and not claimed anywhere in the interface: SMS or messaging delivery, flood
forecasting, rescue dispatch, shelter reservation, and Tamil/Telugu extraction.

---

## Known limitations

* **The deterministic extractor is English-only** and pattern-based. It handles the demonstration
  and a reasonable range of phrasings, but it is not a substitute for a model on messy real
  speech. It is the honest default, not the recommended production configuration.
* **SQLite single-writer.** Correct and genuinely concurrent-safe for a district-scale prototype;
  a larger deployment wants Postgres.
* **Duplicate detection is heuristic.** It only suggests, and a coordinator decides — which is the
  point, but it means the suggestions themselves are unevaluated.
* **No load testing.** Correctness under concurrency is tested; throughput is not.
