import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { DISTRICT } from '@/lib/db/seed-data';
import { createRequest, computeMissingFields } from '@/lib/domain/requests';
import { getExtractionProvider } from '@/lib/providers/extraction';
import type { ProviderInfo } from '@/lib/providers/types';
import { id, nowIso } from '@/lib/util/ids';
import {
  emptyDraft,
  requestDraftSchema,
  type LanguageCode,
  type RequestDraft,
} from '@/lib/validation/schemas';
import { detectDanger, emergencyGuidance, type EmergencyGuidance } from './danger';
import { detectLanguage, replyLanguage } from '@/lib/i18n/detect';
import { catalogueFor, isSupported, t } from '@/lib/i18n/messages';
import { matchLocation } from './locations';
import { mergeProposal } from './merge';
import {
  nextQuestion,
  questionKey,
  type AssistantQuestion,
} from './questions';
import { buildReadback, submissionConfirmation, type Readback } from './summary';
import { categoryLabel, formatQuantity } from '@/lib/util/units';

/**
 * Turn-by-turn conversation engine.
 *
 * Authoritative state lives in SQLite (`conversations.draft_json`), not in the
 * browser, so a refresh, a crash or a dropped connection does not lose the
 * draft and a client cannot talk the server into a different state.
 */

export type ConversationState = 'collecting' | 'confirming' | 'submitted' | 'abandoned';

export interface ConversationView {
  conversationId: string;
  state: ConversationState;
  language: LanguageCode;
  draft: RequestDraft;
  /** The one question to ask now, or null when ready to read back. */
  question: AssistantQuestion | null;
  /** Present once collecting is finished. */
  readback: Readback | null;
  /** Exactly what the assistant says this turn, always displayed as text too. */
  assistantText: string;
  questionCount: number;
  askedFields: string[];
  emergency: EmergencyGuidance | null;
  providers: { extraction: ProviderInfo | null };
  /**
   * The draft rendered in the conversation's language.
   *
   * Built on the server because that is where the catalogue lives. Rendering
   * it client-side meant the panel showed English category names beside a
   * Hindi read-back, which is the same information twice in two languages.
   */
  draftDisplay: {
    items: Array<{ categoryId: string; label: string; quantityLabel: string; note?: string }>;
    groupSizeLabel: string | null;
    placeLabel: string | null;
    placeConfirmed: boolean;
  };
  /** Which language the assistant is replying in, and how sure that is. */
  languageState: {
    replyingIn: string;
    label: string;
    reviewed: boolean;
    reviewNote?: string;
    /** True when the last turn changed the reply language automatically. */
    switched: boolean;
    /** Set when the person wrote in a script no catalogue covers. */
    needsModelForThisLanguage: boolean;
  };
  turns: Array<{ role: 'user' | 'assistant'; text: string; createdAt: string; inputMode: string }>;
  submitted: { requestId: string; referenceCode: string; status: string } | null;
}

interface ConversationRow {
  id: string;
  language: LanguageCode;
  mode: 'request' | 'facility_update' | 'request_update';
  draft_json: string;
  asked_fields: string;
  pending_question: string | null;
  question_count: number;
  state: ConversationState;
  user_id: string | null;
  target_request_id: string | null;
  target_facility_id: string | null;
  submitted_request_id: string | null;
  created_at: string;
  updated_at: string;
}

function loadRow(db: DB, conversationId: string): ConversationRow {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as
    | ConversationRow
    | undefined;
  if (!row) throw new Error('No such conversation.');
  return row;
}

function storedQuestion(row: ConversationRow): AssistantQuestion | null {
  if (!row.pending_question) return null;
  try {
    return JSON.parse(row.pending_question) as AssistantQuestion;
  } catch {
    return null;
  }
}

function loadTurns(db: DB, conversationId: string) {
  return db
    .prepare(
      `SELECT role, text, input_mode, created_at FROM conversation_turns
        WHERE conversation_id = ? ORDER BY created_at, rowid`,
    )
    .all(conversationId) as Array<{
    role: 'user' | 'assistant';
    text: string;
    input_mode: string;
    created_at: string;
  }>;
}

function appendTurn(
  db: DB,
  conversationId: string,
  turn: {
    role: 'user' | 'assistant';
    text: string;
    inputMode: 'voice' | 'text' | 'voice_demo' | 'system';
    sttProvider?: string | null;
    extractionProvider?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO conversation_turns (
       id, conversation_id, role, text, input_mode, stt_provider, extraction_provider, created_at
     ) VALUES (@id, @conversationId, @role, @text, @inputMode, @stt, @extraction, @now)`,
  ).run({
    id: id('trn'),
    conversationId,
    role: turn.role,
    text: turn.text,
    inputMode: turn.inputMode,
    stt: turn.sttProvider ?? null,
    extraction: turn.extractionProvider ?? null,
    now: nowIso(),
  });
}

export function startConversation(
  db: DB,
  input: {
    language: LanguageCode;
    mode: 'request' | 'facility_update' | 'request_update';
    behalfRole?: 'self' | 'community_rep' | 'coordinator' | 'facility_rep';
    userId?: string | null;
    facilityId?: string | null;
    targetRequestId?: string | null;
  },
): ConversationView {
  const draft = requestDraftSchema.parse({
    ...emptyDraft(input.language),
    behalfRole: input.behalfRole ?? 'self',
  });
  const conversationId = id('cnv');
  const now = nowIso();

  transact(db, (tx) => {
    tx.prepare(
      `INSERT INTO conversations (
         id, language, mode, draft_json, asked_fields, pending_question,
         question_count, state, user_id, target_request_id, target_facility_id,
         created_at, updated_at
       ) VALUES (@id, @language, @mode, @draft, '[]', NULL, 0, 'collecting',
                 @userId, @targetRequestId, @facilityId, @now, @now)`,
    ).run({
      id: conversationId,
      language: input.language,
      mode: input.mode,
      draft: JSON.stringify(draft),
      userId: input.userId ?? null,
      targetRequestId: input.targetRequestId ?? null,
      facilityId: input.facilityId ?? null,
      now,
    });

    const opening = t(
      input.language,
      input.mode === 'facility_update' ? 'opening.facility' : 'opening.request',
    );
    appendTurn(tx, conversationId, { role: 'assistant', text: opening, inputMode: 'system' });
  });

  return viewConversation(db, conversationId);
}

export function viewConversation(db: DB, conversationId: string): ConversationView {
  const row = loadRow(db, conversationId);
  const draft = requestDraftSchema.parse(JSON.parse(row.draft_json));
  const askedFields: string[] = JSON.parse(row.asked_fields);
  const turns = loadTurns(db, conversationId);
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');

  // The question the assistant actually asked, so the user is never shown one
  // question while the server interprets their answer against another.
  const question = row.state === 'collecting' ? storedQuestion(row) : null;
  const readback = row.state === 'confirming' ? buildReadback(draft, row.language) : null;

  let submitted: ConversationView['submitted'] = null;
  if (row.submitted_request_id) {
    const request = db
      .prepare('SELECT id, reference_code, status FROM requests WHERE id = ?')
      .get(row.submitted_request_id) as
      | { id: string; reference_code: string; status: string }
      | undefined;
    if (request) {
      submitted = {
        requestId: request.id,
        referenceCode: request.reference_code,
        status: request.status,
      };
    }
  }

  return {
    conversationId,
    state: row.state,
    language: row.language,
    draft,
    question,
    readback,
    assistantText: lastAssistant?.text ?? '',
    questionCount: row.question_count,
    askedFields,
    emergency: draft.dangerReported ? emergencyGuidance([]) : null,
    providers: { extraction: null },
    draftDisplay: {
      items: draft.items.map((item) => ({
        categoryId: item.categoryId,
        label: categoryLabel(item.categoryId, row.language),
        quantityLabel: formatQuantity(
          item.quantity,
          item.categoryId,
          item.quantityUncertain,
          row.language,
        ),
        ...(item.note ? { note: item.note } : {}),
      })),
      groupSizeLabel:
        draft.groupSize === null
          ? null
          : `${draft.groupSize} ${t(row.language, draft.groupSize === 1 ? 'people.one' : 'people.many')}`,
      placeLabel: draft.locationText,
      placeConfirmed: draft.locationConfirmed,
    },
    languageState: {
      replyingIn: row.language,
      label: catalogueFor(row.language).label,
      reviewed: catalogueFor(row.language).reviewed,
      reviewNote: catalogueFor(row.language).reviewNote,
      switched: false,
      needsModelForThisLanguage: !isSupported(row.language),
    },
    turns: turns.map((t) => ({
      role: t.role,
      text: t.text,
      createdAt: t.created_at,
      inputMode: t.input_mode,
    })),
    submitted,
  };
}

export interface TurnOptions {
  text: string;
  inputMode: 'voice' | 'text' | 'voice_demo';
  sttProvider?: string | null;
}

/**
 * One user turn: extract, merge, resolve the location, then decide on the
 * single next question or move to the read-back.
 */
export async function submitTurn(
  db: DB,
  conversationId: string,
  options: TurnOptions,
): Promise<ConversationView> {
  const row = loadRow(db, conversationId);
  if (row.state === 'submitted') {
    throw new Error('This conversation has already been submitted.');
  }

  const draftBefore = requestDraftSchema.parse(JSON.parse(row.draft_json));
  const askedFields: string[] = JSON.parse(row.asked_fields);
  const turns = loadTurns(db, conversationId);

  const pendingQuestion = storedQuestion(row);

  const provider = getExtractionProvider();
  const extraction = await provider.extract({
    draft: draftBefore,
    pendingQuestion,
    userText: options.text,
    language: row.language,
    history: turns.slice(-6).map((t) => ({ role: t.role, text: t.text })),
  });

  // Which language they actually used this turn. A decisive script signal
  // overrides the menu choice, so someone who picked English and then spoke
  // Tamil is answered in Tamil rather than being left behind by a dropdown.
  const detection = detectLanguage(options.text);
  const { language: activeLanguage, switched: languageSwitched } = replyLanguage(
    row.language,
    detection,
  );

  const merged = mergeProposal(draftBefore, extraction.update, options.text);
  let draft = merged.draft;
  // Only a language with a catalogue goes into the draft. An unlisted one is
  // still detected and reported, so the interface can say a model is needed
  // for it, but it never becomes a stored value nothing can render.
  if (isSupported(activeLanguage) && activeLanguage !== draft.language) {
    draft = requestDraftSchema.parse({ ...draft, language: activeLanguage });
  }

  // Danger is also checked server-side on the raw text, so a model that misses
  // it cannot suppress the emergency interruption.
  const danger = detectDanger(options.text);
  if (danger.detected && !draft.dangerReported) {
    draft = requestDraftSchema.parse({
      ...draft,
      dangerReported: true,
      dangerText: danger.excerpt,
    });
  }

  // Nobody phrases a place the same way twice, so when no location phrase was
  // picked out, check the whole utterance against the known facility names.
  // Only a single exact name match counts: a partial match is left for the
  // location question rather than being guessed at.
  if (!draft.locationText) {
    const whole = matchLocation(db, options.text);
    if (whole.resolved) {
      draft = requestDraftSchema.parse({
        ...draft,
        locationText: whole.resolved.label,
        locationCandidates: [whole.resolved],
        resolvedFacilityId: whole.resolved.facilityId ?? null,
        resolvedLat: whole.resolved.lat,
        resolvedLng: whole.resolved.lng,
        locationConfirmed: true,
      });
    }
  }

  // Resolve the location into candidates. Coordinates are never guessed: an
  // unambiguous facility name resolves, anything else becomes a choice.
  if (draft.locationText && (merged.locationNeedsResolving || draft.locationCandidates.length === 0)) {
    const match = matchLocation(db, draft.locationText);
    draft = requestDraftSchema.parse({
      ...draft,
      locationCandidates: match.candidates,
      ...(match.resolved
        ? {
            resolvedFacilityId: match.resolved.facilityId ?? null,
            resolvedLat: match.resolved.lat,
            resolvedLng: match.resolved.lng,
            locationConfirmed: true,
          }
        : {}),
    });
  }

  // Record which question this turn dealt with, so it is never asked twice.
  const nextAsked = [...askedFields];
  if (pendingQuestion) {
    const key = questionKey(pendingQuestion, draftBefore);
    const answered = extraction.update.answeredField ?? (merged.changed.length > 0 ? key : null);
    if (answered && !nextAsked.includes(key)) nextAsked.push(key);
    if (extraction.update.skipField && !nextAsked.includes(key)) nextAsked.push(key);
  }

  let questionCount = row.question_count;
  const following = nextQuestion({
    draft,
    askedFields: nextAsked,
    questionCount,
    language: activeLanguage,
  });

  let state: ConversationState = row.state === 'confirming' ? 'confirming' : 'collecting';
  let assistantText: string;

  if (danger.detected) {
    // Interrupt the routine questions with brief guidance, then continue.
    const guidance = emergencyGuidance(danger.labels, activeLanguage);
    assistantText = `${guidance.body} ${t(activeLanguage, 'danger.call', {
      number: guidance.emergencyNumber,
      label: guidance.emergencyLabel,
    })}`;
    if (following) {
      assistantText += ` ${t(activeLanguage, 'danger.still_need', { question: following.text })}`;
      questionCount += 1;
      if (!nextAsked.includes(questionKey(following, draft))) {
        nextAsked.push(questionKey(following, draft));
      }
    } else {
      state = 'confirming';
      assistantText += ` ${buildReadback(draft, activeLanguage).summary}`;
    }
  } else if (following) {
    assistantText = acknowledge(draftBefore, draft, merged.changed, activeLanguage) + following.text;
    questionCount += 1;
    if (!nextAsked.includes(questionKey(following, draft))) {
      nextAsked.push(questionKey(following, draft));
    }
  } else {
    state = 'confirming';
    assistantText = buildReadback(draft, activeLanguage).summary;
  }

  transact(db, (tx) => {
    appendTurn(tx, conversationId, {
      role: 'user',
      text: options.text,
      inputMode: options.inputMode,
      sttProvider: options.sttProvider ?? null,
      extractionProvider: extraction.provider.id,
    });
    appendTurn(tx, conversationId, {
      role: 'assistant',
      text: assistantText,
      inputMode: 'system',
      extractionProvider: extraction.provider.id,
    });
    tx.prepare(
      `UPDATE conversations
          SET draft_json = @draft, asked_fields = @asked, pending_question = @pending,
              question_count = @count, state = @state, language = @language, updated_at = @now
        WHERE id = @id`,
    ).run({
      id: conversationId,
      draft: JSON.stringify(draft),
      asked: JSON.stringify(nextAsked),
      pending: state === 'collecting' && following ? JSON.stringify(following) : null,
      count: questionCount,
      state,
      language: activeLanguage,
      now: nowIso(),
    });
  });

  const view = viewConversation(db, conversationId);
  return {
    ...view,
    assistantText,
    providers: { extraction: extraction.provider },
    languageState: {
      ...view.languageState,
      switched: languageSwitched,
      needsModelForThisLanguage: detection.unsupportedScript || !isSupported(activeLanguage),
    },
    emergency: danger.detected ? emergencyGuidance(danger.labels, activeLanguage) : view.emergency,
  };
}

/**
 * A short acknowledgement of what was understood, before the next question.
 * It repeats back only what the user actually said.
 */
function acknowledge(
  before: RequestDraft,
  after: RequestDraft,
  changed: string[],
  language: string,
): string {
  if (changed.length === 0) return '';
  const parts: string[] = [];

  const newItems = after.items.filter(
    (item) => !before.items.some((b) => b.categoryId === item.categoryId),
  );
  if (newItems.length > 0) {
    const list = newItems
      .map((i) => categoryLabel(i.categoryId, language).toLowerCase())
      .join(', ');
    parts.push(t(language, 'ack.recorded', { list }));
  }
  if (after.groupSize !== before.groupSize && after.groupSize !== null) {
    parts.push(
      t(language, before.groupSize === null ? 'ack.for_people' : 'ack.updated_people', {
        n: after.groupSize,
      }),
    );
  }
  const changedQty = after.items.find((item) => {
    const prev = before.items.find((b) => b.categoryId === item.categoryId);
    return prev && prev.quantity !== item.quantity && item.quantity !== null;
  });
  if (changedQty) {
    parts.push(
      formatQuantity(changedQty.quantity, changedQty.categoryId, changedQty.quantityUncertain, language),
    );
  }
  if (changed.includes('locationText') && after.locationText) {
    parts.push(t(language, 'ack.at_place', { place: after.locationText }));
  }
  return parts.length > 0 ? `${parts.join(' ')}. ` : '';
}

/** The user picked one of the offered location candidates. */
export function selectLocation(
  db: DB,
  conversationId: string,
  selection: { facilityId?: string; lat?: number; lng?: number; label?: string },
): ConversationView {
  const row = loadRow(db, conversationId);
  const draft = requestDraftSchema.parse(JSON.parse(row.draft_json));

  let resolved: { facilityId: string | null; lat: number; lng: number; label: string } | null = null;
  if (selection.facilityId) {
    const facility = db
      .prepare('SELECT id, name, lat, lng FROM facilities WHERE id = ?')
      .get(selection.facilityId) as { id: string; name: string; lat: number; lng: number } | undefined;
    if (!facility) throw new Error('No such facility.');
    resolved = { facilityId: facility.id, lat: facility.lat, lng: facility.lng, label: facility.name };
  } else if (selection.lat !== undefined && selection.lng !== undefined) {
    // A point the user placed themselves on the map. That is a confirmation by
    // the person who is there, which is the only kind we accept.
    resolved = {
      facilityId: null,
      lat: selection.lat,
      lng: selection.lng,
      label: selection.label ?? draft.locationText ?? 'Point chosen on the map',
    };
  }
  if (!resolved) throw new Error('No location given.');

  const next = requestDraftSchema.parse({
    ...draft,
    locationText: resolved.label,
    resolvedFacilityId: resolved.facilityId,
    resolvedLat: resolved.lat,
    resolvedLng: resolved.lng,
    locationConfirmed: true,
  });

  const askedFields: string[] = JSON.parse(row.asked_fields);
  if (!askedFields.includes('location_choice')) askedFields.push('location_choice');
  if (!askedFields.includes('location')) askedFields.push('location');

  const following = nextQuestion({
    draft: next,
    askedFields,
    questionCount: row.question_count,
    language: row.language,
  });
  const state: ConversationState = following ? 'collecting' : 'confirming';
  const assistantText = following
    ? `${t(row.language, 'ack.at_place', { place: resolved.label })}. ${following.text}`
    : buildReadback(next, row.language).summary;

  transact(db, (tx) => {
    appendTurn(tx, conversationId, {
      role: 'user',
      text: `Selected location: ${resolved.label}`,
      inputMode: 'text',
    });
    appendTurn(tx, conversationId, { role: 'assistant', text: assistantText, inputMode: 'system' });
    if (following && !askedFields.includes(questionKey(following, next))) {
      askedFields.push(questionKey(following, next));
    }
    tx.prepare(
      `UPDATE conversations
          SET draft_json = @draft, asked_fields = @asked, pending_question = @pending,
              question_count = @count, state = @state, updated_at = @now
        WHERE id = @id`,
    ).run({
      id: conversationId,
      draft: JSON.stringify(next),
      asked: JSON.stringify(askedFields),
      pending: following ? JSON.stringify(following) : null,
      count: following ? row.question_count + 1 : row.question_count,
      state,
      now: nowIso(),
    });
  });

  return { ...viewConversation(db, conversationId), assistantText };
}

/** Replaces the draft after the user edited the transcript or a field directly. */
export function applyManualEdit(
  db: DB,
  conversationId: string,
  patch: Partial<RequestDraft>,
): ConversationView {
  const row = loadRow(db, conversationId);
  const draft = requestDraftSchema.parse(JSON.parse(row.draft_json));
  const next = requestDraftSchema.parse({ ...draft, ...patch });
  db.prepare('UPDATE conversations SET draft_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    nowIso(),
    conversationId,
  );
  return viewConversation(db, conversationId);
}

export function moveToConfirmation(db: DB, conversationId: string): ConversationView {
  const row = loadRow(db, conversationId);
  const draft = requestDraftSchema.parse(JSON.parse(row.draft_json));
  const readback = buildReadback(draft, row.language);
  transact(db, (tx) => {
    appendTurn(tx, conversationId, { role: 'assistant', text: readback.summary, inputMode: 'system' });
    tx.prepare(
      "UPDATE conversations SET state = 'confirming', pending_question = NULL, updated_at = ? WHERE id = ?",
    ).run(nowIso(), conversationId);
  });
  return { ...viewConversation(db, conversationId), assistantText: readback.summary };
}

export interface SubmitResult {
  requestId: string;
  referenceCode: string;
  trackingToken: string;
  status: string;
  missingFields: string[];
  assistantText: string;
  /** True when this exact submission had already been saved. */
  deduplicated: boolean;
}

/**
 * Saves the request after an explicit confirmation.
 *
 * The idempotency key is required, so an offline client that retries the same
 * submission gets the same request back instead of creating a second one.
 * Nothing is reported to the user as submitted until this has returned.
 */
export function confirmAndSubmit(
  db: DB,
  conversationId: string,
  input: { idempotencyKey: string; confirmedSummary: string; acceptIncomplete: boolean; userId?: string | null },
): SubmitResult {
  const scope = `conversation_submit:${conversationId}`;
  const existing = db
    .prepare('SELECT response_json FROM idempotency_keys WHERE key = ? AND scope = ?')
    .get(input.idempotencyKey, scope) as { response_json: string } | undefined;
  if (existing) {
    return { ...(JSON.parse(existing.response_json) as SubmitResult), deduplicated: true };
  }

  const row = loadRow(db, conversationId);
  if (row.state === 'submitted' && row.submitted_request_id) {
    const request = db
      .prepare('SELECT reference_code, status FROM requests WHERE id = ?')
      .get(row.submitted_request_id) as { reference_code: string; status: string };
    throw new Error(
      `This conversation was already submitted as ${request.reference_code} (${request.status}).`,
    );
  }

  const draft = requestDraftSchema.parse(JSON.parse(row.draft_json));
  const missing = computeMissingFields(draft);

  if (draft.items.length === 0) {
    throw new Error('A request needs at least one resource before it can be submitted.');
  }
  if (!draft.locationText) {
    throw new Error('A request needs a location before it can be submitted.');
  }
  // Everything else may be missing: someone who cannot answer more questions
  // can still submit, and the gaps are made visible to coordinators.
  if (!input.acceptIncomplete && missing.length > 0) {
    throw new Error(`Essential information is missing: ${missing.join(', ')}.`);
  }

  const transcript = loadTurns(db, conversationId)
    .filter((t) => t.role === 'user')
    .map((t) => t.text)
    .join('\n');

  const created = createRequest(db, draft, {
    districtId: DISTRICT.id,
    inputMode: row.mode === 'request' ? inferInputMode(db, conversationId) : 'text',
    extractionProvider: getExtractionProvider().info.id,
    sttProvider: inferSttProvider(db, conversationId),
    createdBy: input.userId ?? null,
    transcriptText: transcript,
  });

  const assistantText = submissionConfirmation(created.referenceCode, row.language);
  const result: SubmitResult = {
    requestId: created.requestId,
    referenceCode: created.referenceCode,
    trackingToken: created.trackingToken,
    status: created.status,
    missingFields: created.missingFields,
    assistantText,
    deduplicated: false,
  };

  transact(db, (tx) => {
    appendTurn(tx, conversationId, {
      role: 'user',
      text: `Confirmed: ${input.confirmedSummary}`,
      inputMode: 'text',
    });
    appendTurn(tx, conversationId, { role: 'assistant', text: assistantText, inputMode: 'system' });
    tx.prepare(
      `UPDATE conversations SET state = 'submitted', submitted_request_id = @requestId, updated_at = @now WHERE id = @id`,
    ).run({ id: conversationId, requestId: created.requestId, now: nowIso() });
    tx.prepare(
      'INSERT INTO idempotency_keys (key, scope, response_json, created_at) VALUES (?, ?, ?, ?)',
    ).run(input.idempotencyKey, scope, JSON.stringify(result), nowIso());
  });

  return result;
}

function inferInputMode(db: DB, conversationId: string): 'voice' | 'text' | 'voice_demo' {
  const row = db
    .prepare(
      `SELECT input_mode, COUNT(*) AS n FROM conversation_turns
        WHERE conversation_id = ? AND role = 'user' AND input_mode != 'system'
        GROUP BY input_mode ORDER BY n DESC LIMIT 1`,
    )
    .get(conversationId) as { input_mode: string } | undefined;
  const mode = row?.input_mode;
  return mode === 'voice' || mode === 'voice_demo' ? mode : 'text';
}

function inferSttProvider(db: DB, conversationId: string): string | null {
  const row = db
    .prepare(
      `SELECT stt_provider FROM conversation_turns
        WHERE conversation_id = ? AND stt_provider IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(conversationId) as { stt_provider: string } | undefined;
  return row?.stt_provider ?? null;
}

export function abandonConversation(db: DB, conversationId: string): void {
  db.prepare("UPDATE conversations SET state = 'abandoned', updated_at = ? WHERE id = ?").run(
    nowIso(),
    conversationId,
  );
}
