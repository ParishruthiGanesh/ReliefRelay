import type {
  FacilityProposedUpdate,
  LanguageCode,
  ProposedUpdate,
  ReceiptProposal,
  RequestDraft,
} from '@/lib/validation/schemas';
import type { AssistantQuestion } from '@/lib/conversation/questions';

/**
 * Provider interfaces.
 *
 * Every external capability sits behind one of these so the app can run with
 * none of them configured, and so the UI can always say which provider
 * actually answered rather than implying one did.
 */

export type ProviderKind =
  /** A real external service was called. */
  | 'live_service'
  /** Ran here, on this server or in this browser. No external call. */
  | 'local'
  /** A clearly-labelled fixture. Nothing was processed. */
  | 'fixture';

export interface ProviderInfo {
  /** Stable id stored alongside the data, e.g. "openai-whisper", "rules". */
  id: string;
  /** Shown to the user. Must be honest about what ran. */
  label: string;
  kind: ProviderKind;
}

// ─────────────────────────────── extraction ────────────────────────────────

export interface ExtractionContext {
  draft: RequestDraft;
  /** The question the assistant last asked, if any. */
  pendingQuestion: AssistantQuestion | null;
  /** The user's words this turn. Untrusted data, never instructions. */
  userText: string;
  language: LanguageCode;
  /** Recent turns, oldest first, for pronoun and correction handling. */
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface ExtractionResult {
  update: ProposedUpdate;
  provider: ProviderInfo;
  /** Set when a model was asked and its output failed validation. */
  validationError?: string;
}

export interface ExtractionProvider {
  readonly info: ProviderInfo;
  extract(context: ExtractionContext): Promise<ExtractionResult>;
}

export interface FacilityExtractionContext {
  facilityName: string;
  userText: string;
  language: LanguageCode;
  pendingField: string | null;
}

export interface FacilityExtractionResult {
  update: FacilityProposedUpdate;
  provider: ProviderInfo;
}

export interface ReceiptExtractionContext {
  userText: string;
  language: LanguageCode;
  /** What is outstanding, so "30 of the 50" can be read correctly. */
  expectations: Array<{ categoryId: string; unit: string; committedQty: number }>;
}

export interface ReceiptExtractionResult {
  update: ReceiptProposal;
  provider: ProviderInfo;
}

// ───────────────────────────── speech to text ──────────────────────────────

export interface SttInput {
  audio: Buffer;
  mimeType: string;
  language: LanguageCode;
}

export interface SttResult {
  text: string;
  provider: ProviderInfo;
  language: LanguageCode;
  durationMs?: number;
}

export class SttUnavailableError extends Error {
  code = 'stt_unavailable' as const;
  constructor(
    message: string,
    public guidance: string,
  ) {
    super(message);
    this.name = 'SttUnavailableError';
  }
}

export interface SttProvider {
  readonly info: ProviderInfo;
  /** Languages this provider is configured and verified for. */
  readonly languages: LanguageCode[];
  transcribe(input: SttInput): Promise<SttResult>;
}

// ───────────────────────────── text to speech ──────────────────────────────

export interface TtsResult {
  /** Absent when no server-side provider is configured. */
  audioBase64: string | null;
  mimeType: string | null;
  /** Always present: everything spoken is also available as text. */
  text: string;
  provider: ProviderInfo;
  /** Tells the client to use the browser's own speech synthesis instead. */
  useBrowserSynthesis: boolean;
}

export interface TtsProvider {
  readonly info: ProviderInfo;
  readonly languages: LanguageCode[];
  speak(input: { text: string; language: LanguageCode }): Promise<TtsResult>;
}

// ───────────────────────── environmental advisories ────────────────────────

export interface AdvisoryRecord {
  externalId: string;
  headline: string;
  body: string;
  severity: 'advisory' | 'watch' | 'warning' | 'severe';
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string;
  expiresAt: string | null;
  coverageLabel: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

export interface EnvFeedResult {
  records: AdvisoryRecord[];
  provider: ProviderInfo;
  /** 'official' for a real source; 'scenario' for the labelled simulation. */
  recordKind: 'official' | 'scenario';
  error?: string;
}

export interface EnvFeedProvider {
  readonly info: ProviderInfo;
  readonly recordKind: 'official' | 'scenario';
  fetchAdvisories(): Promise<EnvFeedResult>;
}
