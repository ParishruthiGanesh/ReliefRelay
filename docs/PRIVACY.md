# Data handling in ReliefRelay

A short, specific account of what is stored, where it goes, and what is deleted. Written for
someone deciding whether this could be deployed, not as a legal notice.

## Voice recordings

* Audio is posted to `/api/stt` as base64, held **in memory** for the length of the transcription
  call, and dropped when the call returns.
* It is **never written to disk** and **never written to a log**. No logging statement in this
  repository takes audio, and the request body is not logged.
* `RETAIN_SERVER_AUDIO` defaults to `false`. Setting it to `true` is an operator decision that
  should only be made with the explicit consent of the people being recorded; the API response
  states which mode is active.
* With no speech provider configured, the recording is **not sent anywhere at all** — the endpoint
  returns 503 before any upload, and the user is offered typing, their browser's own recogniser,
  or a labelled scripted demonstration.

## Transcripts

* Kept in the operator's database (`requests.transcript_text`, `conversation_turns.text`) so a
  coordinator can read what someone actually said rather than only the extracted fields. This
  matters when the extraction got something wrong.
* Never published, never shown in a public view, never written on-chain.
* Treated as untrusted data everywhere: passed to models as delimited content with an explicit
  instruction that it is a report, not an instruction.

## Locations

| Where | What is stored | Who sees it |
| --- | --- | --- |
| `requests.resolved_lat/lng` | Exact point, only when the user confirmed it | Coordinators; the requester via their own link |
| `requests.public_lat/lng` | Rounded to 2 decimal places (~1 km) | Anyone |
| `facilities.lat/lng` | Exact | Anyone — these are public buildings |

A vague landmark is never converted into coordinates. It becomes candidates for the user to
choose from, and an unconfirmed location is labelled as such for coordinators.

## Contact details

* `contact_method` and `contact_value` are coordinator-only. They appear in no public response, in
  no volunteer view, and in no on-chain record.
* Volunteers receive the delivery destination (a facility), the coordinator's instructions, and any
  recorded access note with its source and age — not the requester's contact details.

## Private tracking links

* 32 random bytes, base64url, returned to the user **once**.
* Stored only as `sha256(token)`. The database holds nothing that opens a request.
* The human-readable reference code (`RR-1042`) is deliberately **not** accepted as a credential,
  so it can be read aloud over a phone without granting access.
* Tracking pages are marked `noindex` and are never cached by the service worker.

## On-chain records

Each attestation puts exactly this on the local chain:

```
orgRef        opaque 32 bytes, per organisation
subjectRef    sha256(requestId) — a stable pointer, not an identifier
manifestHash  sha256 of the canonical manifest
eventType     commitment | dispatch | receipt | discrepancy
recordedAt    block timestamp
attester      the signing address
```

The manifest the hash covers is kept **off-chain** so it can be shown and explained. It contains:
version, event type, org ref, subject ref, commitment ref, resource category, unit, quantity,
optional shortfall, and a timestamp **truncated to the minute** — so the record cannot be used as
a high-resolution movement trace.

Nothing else. No names, no phone numbers, no household coordinates, no medical information, no
recordings, no transcripts. `tests/security.test.ts` asserts the manifest's key set exhaustively
and checks that known-sensitive strings do not appear in it.

## Browser storage

* `localStorage` holds the in-progress draft and the outbox queue, on that device only. It is
  cleared on successful submission.
* The service worker caches the interface shell. It **never** caches an API response, and never
  caches a `/track/` page.

## Deletion and retention

* Server audio: deleted immediately after transcription (default).
* `npm run db:reset` deletes the database file entirely and rebuilds it.
* Sessions expire after 12 hours and are stored as hashes.
* There is no automatic expiry of requests or transcripts. A real deployment needs a retention
  policy agreed with the responding organisations; this prototype does not presume one.
* Chain records cannot be deleted. That is a property of the design and a reason the manifest
  contains no personal data.

## What this prototype does not do

* It does not contact emergency services, and never claims to have done so.
* It does not send SMS or messages; there is no adapter, so no "sent" state can be displayed.
* It does not share data with any third party beyond the speech and extraction providers an
  operator explicitly configures.
