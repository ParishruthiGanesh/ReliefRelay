# Live, local, or simulated

The running app generates this table from its own configuration at `/about`. This file is the
reference version, with the configuration needed for each row.

## Capabilities

| Capability | Default state | Live when configured | Honesty mechanism |
| --- | --- | --- | --- |
| Request submission, coordinator review, allocation, dispatch, receipts, discrepancies | **Real** | — | SQLite with transactional allocation. Nothing about this is simulated. |
| Private tracking links | **Real** | — | sha256-hashed tokens; reference code rejected as a credential |
| Request status | **Real** | — | Derived from records after every change; never stored independently |
| Conversational extraction | **Local** — deterministic rules, no network call | Claude via Anthropic API | Provider id and label stored with each request and shown in the UI |
| Speech to text | **Unavailable** — 503, no transcript invented | OpenAI Whisper or Deepgram | Endpoint refuses rather than falling back; browser recogniser labelled as the browser's |
| Spoken replies | **Local** — browser speech synthesis | OpenAI TTS | Response says which produced the audio; text always returned |
| Environmental advisories | **Simulated** scenario feed | Any GeoJSON source | `record_kind` column; dashed violet "Simulated record" badge; never merged with official records |
| Supply attestations | **Queued** as `pending` rows | Local Hardhat EVM + deployed contract | Status shown as pending / confirmed / failed-and-retryable with tx hash and block |
| Offline draft queue | **Real** | — | "Saved on this device — not yet sent" until the server acknowledges |
| District, facilities, organisations, people, advisories | **Fictional** | — | `is_fictional` flag on every row; coordinates in open ocean; badge on every screen |
| SMS / messaging notifications | **Not implemented** | — | No adapter exists, so no "sent" state can be rendered |
| Flood forecasting | **Not implemented, not claimed** | — | Advisories page states ReliefRelay displays what a source published |
| Rescue dispatch | **Deliberately absent** | — | Danger reports interrupt with guidance to call emergency services; `respondersNotified: false` |
| Shelter reservation | **Not implemented** | — | "Finding a shelter does not reserve a place" stated on the directory |

## Configuration

| Row | Environment |
| --- | --- |
| Claude extraction | `EXTRACTION_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` |
| OpenAI speech recognition | `STT_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_STT_MODEL` |
| Deepgram speech recognition | `STT_PROVIDER=deepgram`, `DEEPGRAM_API_KEY`, optional `DEEPGRAM_STT_MODEL` |
| OpenAI spoken replies | `TTS_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` |
| Live advisory feed | `ENV_FEED_PROVIDER=geojson`, `ENV_FEED_URL`, optional `ENV_FEED_SOURCE_NAME`, `ENV_FEED_ATTRIBUTION_URL` |
| Local chain | `CHAIN_ENABLED=true`, `CHAIN_RPC_URL`, `CHAIN_CONTRACT_ADDRESS`, `CHAIN_ATTESTER_PRIVATE_KEY` |
| Emergency guidance | `EMERGENCY_NUMBER`, `EMERGENCY_LABEL` |
| Audio retention | `RETAIN_SERVER_AUDIO` (default `false`) |

## Language coverage

Reported per language at `/about`, split three ways so nothing is over-claimed.

| Language | Interface + extraction | Speech recognition | Spoken replies |
| --- | --- | --- | --- |
| English | **Written and tested** | Whisper or Deepgram when configured | OpenAI TTS, or the browser's voice |
| Hindi | Wired; patterns not tuned | Whisper (documented); Deepgram nova-2 (documented) | OpenAI TTS, or the browser's voice |
| Tamil | **Not written** — listed to show extensibility | Whisper only | OpenAI TTS, or the browser's voice |
| Telugu | **Not written** — listed to show extensibility | Whisper only | OpenAI TTS, or the browser's voice |

The app never advertises a language as voice-ready unless the *configured* provider documents it.
Selecting Deepgram, for example, marks Tamil and Telugu as unsupported with the reason stated.
