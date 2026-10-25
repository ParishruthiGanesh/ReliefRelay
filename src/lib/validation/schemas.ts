import { z } from 'zod';
import { CATEGORY_IDS } from '@/lib/util/units';

export const categoryIdSchema = z.enum(['meal_packs', 'drinking_water', 'hygiene_kits', 'shelter_spaces']);
export type CategoryIdValue = z.infer<typeof categoryIdSchema>;

export const intentSchema = z.enum(['need', 'offer', 'facility_update', 'status_inquiry']);
export const urgencySchema = z.enum(['low', 'normal', 'high', 'critical']);
export const behalfRoleSchema = z.enum(['self', 'community_rep', 'coordinator', 'facility_rep']);
export const contactMethodSchema = z.enum(['phone', 'whatsapp', 'sms', 'none']);

/** Languages the app offers. Each must be verified against the configured
 * speech providers before it is shown as voice-capable — see
 * src/lib/providers/languages.ts. */
export const languageSchema = z.enum(['en', 'hi', 'ta', 'te']);
export type LanguageCode = z.infer<typeof languageSchema>;

// ─────────────────────────────── draft ─────────────────────────────────────

export const draftItemSchema = z.object({
  categoryId: categoryIdSchema,
  /** null = needed, amount not yet known. Never inferred from group size. */
  quantity: z.number().positive().max(1_000_000).nullable(),
  unit: z.string().min(1),
  quantityUncertain: z.boolean().default(false),
  note: z.string().max(400).optional(),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

export const locationCandidateSchema = z.object({
  facilityId: z.string().optional(),
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  kind: z.enum(['shelter', 'supply_hub', 'landmark']),
  matchedOn: z.string().optional(),
});
export type LocationCandidate = z.infer<typeof locationCandidateSchema>;

export const requestDraftSchema = z.object({
  intent: intentSchema.nullable().default(null),
  items: z.array(draftItemSchema).max(8).default([]),

  /** People. Separate from supply quantities, always. */
  groupSize: z.number().int().positive().max(100_000).nullable().default(null),
  groupSizeUncertain: z.boolean().default(false),

  locationText: z.string().max(400).nullable().default(null),
  /** Possible matches offered to the user. A vague landmark is never silently
   * turned into coordinates; the user picks. */
  locationCandidates: z.array(locationCandidateSchema).max(8).default([]),
  resolvedFacilityId: z.string().nullable().default(null),
  resolvedLat: z.number().nullable().default(null),
  resolvedLng: z.number().nullable().default(null),
  locationConfirmed: z.boolean().default(false),

  neededFrom: z.string().nullable().default(null),
  neededBy: z.string().nullable().default(null),
  urgency: urgencySchema.nullable().default(null),

  contactMethod: contactMethodSchema.nullable().default(null),
  contactValue: z.string().max(120).nullable().default(null),

  language: languageSchema.default('en'),
  originalText: z.string().max(8000).default(''),
  behalfRole: behalfRoleSchema.default('self'),

  dangerReported: z.boolean().default(false),
  dangerText: z.string().max(600).nullable().default(null),

  /** Fields the user explicitly declined or could not answer. */
  skippedFields: z.array(z.string()).max(20).default([]),
  notes: z.array(z.string().max(400)).max(20).default([]),
});
export type RequestDraft = z.infer<typeof requestDraftSchema>;

export function emptyDraft(language: LanguageCode = 'en'): RequestDraft {
  return requestDraftSchema.parse({ language });
}

// ───────────────────── what a model is allowed to propose ──────────────────

/**
 * The only shape an extraction model may return.
 *
 * `.strict()` is deliberate: an unexpected key is a validation failure rather
 * than something quietly ignored. Note what is absent — there is no field here
 * for a request status, an inventory quantity, a commitment, an assignment or a
 * delivery confirmation. A model cannot express those changes, so it cannot
 * make them. It proposes; the backend validates, authorises and saves.
 */
export const proposedUpdateSchema = z
  .object({
    intent: intentSchema.nullish(),
    items: z
      .array(
        z
          .object({
            categoryId: categoryIdSchema,
            quantity: z.number().positive().max(1_000_000).nullish(),
            quantityUncertain: z.boolean().nullish(),
            note: z.string().max(400).nullish(),
          })
          .strict(),
      )
      .max(8)
      .nullish(),
    removeCategories: z.array(categoryIdSchema).max(8).nullish(),

    groupSize: z.number().int().positive().max(100_000).nullish(),
    groupSizeUncertain: z.boolean().nullish(),

    locationText: z.string().max(400).nullish(),
    neededBy: z.string().max(200).nullish(),
    urgency: urgencySchema.nullish(),
    contactMethod: contactMethodSchema.nullish(),
    contactValue: z.string().max(120).nullish(),
    behalfRole: behalfRoleSchema.nullish(),

    /** Set when the user describes immediate danger to life. */
    dangerReported: z.boolean().nullish(),
    dangerText: z.string().max(600).nullish(),

    /** Which pending question this turn answered, so it is not asked again. */
    answeredField: z.string().max(60).nullish(),
    /** The user said "I don't know" / "skip". */
    skipField: z.string().max(60).nullish(),

    /** User agreed to submit the read-back summary. Advisory only: the server
     * still requires an explicit confirm call. */
    confirmSubmission: z.boolean().nullish(),
    cancelRequest: z.boolean().nullish(),

    notes: z.array(z.string().max(400)).max(6).nullish(),
    /** Free-text reason the model gives for its reading. Shown to coordinators. */
    reasoning: z.string().max(600).nullish(),
  })
  .strict();
export type ProposedUpdate = z.infer<typeof proposedUpdateSchema>;

// ─────────────────────────── facility update draft ─────────────────────────

export const facilityUpdateDraftSchema = z.object({
  facilityId: z.string().nullable().default(null),
  capacityAvailable: z.number().int().min(0).max(100_000).nullable().default(null),
  openingStatus: z.enum(['open', 'full', 'closed']).nullable().default(null),
  resourcesNote: z.string().max(600).nullable().default(null),
  note: z.string().max(600).nullable().default(null),
  language: languageSchema.default('en'),
  originalText: z.string().max(8000).default(''),
  skippedFields: z.array(z.string()).max(20).default([]),
});
export type FacilityUpdateDraft = z.infer<typeof facilityUpdateDraftSchema>;

export const facilityProposedUpdateSchema = z
  .object({
    capacityAvailable: z.number().int().min(0).max(100_000).nullish(),
    openingStatus: z.enum(['open', 'full', 'closed']).nullish(),
    resourcesNote: z.string().max(600).nullish(),
    note: z.string().max(600).nullish(),
    answeredField: z.string().max(60).nullish(),
    skipField: z.string().max(60).nullish(),
    confirmSubmission: z.boolean().nullish(),
  })
  .strict();
export type FacilityProposedUpdate = z.infer<typeof facilityProposedUpdateSchema>;

// ───────────────────── receipt / request-update proposals ──────────────────

/** "We received 30 of the 50 meal packs." */
export const receiptProposalSchema = z
  .object({
    categoryId: categoryIdSchema.nullish(),
    qtyReceived: z.number().min(0).max(1_000_000).nullish(),
    nothingArrived: z.boolean().nullish(),
    note: z.string().max(400).nullish(),
    confirmSubmission: z.boolean().nullish(),
  })
  .strict();
export type ReceiptProposal = z.infer<typeof receiptProposalSchema>;

// ───────────────────────────── API inputs ──────────────────────────────────

export const startConversationSchema = z.object({
  language: languageSchema.default('en'),
  mode: z.enum(['request', 'facility_update', 'request_update']).default('request'),
  behalfRole: behalfRoleSchema.default('self'),
  facilityId: z.string().optional(),
  trackingToken: z.string().optional(),
});

export const conversationTurnSchema = z.object({
  text: z.string().min(1).max(4000),
  inputMode: z.enum(['voice', 'text', 'voice_demo']).default('text'),
  sttProvider: z.string().max(40).optional(),
});

export const confirmSubmissionSchema = z.object({
  /** Required so a retry from an offline queue cannot create a second request. */
  idempotencyKey: z.string().min(8).max(100),
  /** Honest about what the user accepted: the exact summary they confirmed. */
  confirmedSummary: z.string().min(1).max(4000),
  acceptIncomplete: z.boolean().default(false),
});

export const selectLocationSchema = z.object({
  facilityId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  label: z.string().max(200).optional(),
});

export const directRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  language: languageSchema.default('en'),
  behalfRole: behalfRoleSchema.default('self'),
  intent: z.literal('need').default('need'),
  locationText: z.string().min(2).max(400),
  facilityId: z.string().optional(),
  groupSize: z.number().int().positive().max(100_000).nullable().default(null),
  items: z
    .array(
      z.object({
        categoryId: categoryIdSchema,
        quantity: z.number().positive().max(1_000_000).nullable(),
        quantityUncertain: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(8),
  urgency: urgencySchema.nullable().default(null),
  contactMethod: contactMethodSchema.nullable().default(null),
  contactValue: z.string().max(120).nullable().default(null),
  note: z.string().max(1000).optional(),
  dangerReported: z.boolean().default(false),
  acceptIncomplete: z.boolean().default(true),
});
export type DirectRequestInput = z.infer<typeof directRequestSchema>;

export const commitSchema = z.object({
  requestItemId: z.string().min(1),
  inventoryLotId: z.string().min(1),
  qty: z.number().positive().max(1_000_000),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const dispatchSchema = z.object({
  commitmentId: z.string().min(1),
  qty: z.number().positive().max(1_000_000),
  volunteerId: z.string().optional(),
  instructions: z.string().max(1000).optional(),
  accessNote: z.string().max(600).optional(),
  accessNoteSource: z.string().max(200).optional(),
});

export const receiptSchema = z.object({
  commitmentId: z.string().min(1),
  qtyReceived: z.number().min(0).max(1_000_000),
  note: z.string().max(600).optional(),
  confirmedByKind: z.enum(['recipient', 'coordinator', 'facility_rep']),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const cancelCommitmentSchema = z.object({
  commitmentId: z.string().min(1),
  reason: z.string().min(2).max(400),
});

export const assignmentSchema = z.object({
  commitmentId: z.string().min(1),
  volunteerId: z.string().min(1),
  instructions: z.string().max(1000).optional(),
});

export const assignmentUpdateSchema = z.object({
  assignmentId: z.string().min(1),
  status: z.enum(['accepted', 'withdrawn', 'completed']),
});

export const offerSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  organizationId: z.string().optional(),
  contactName: z.string().max(120).optional(),
  contactMethod: z.string().max(40).optional(),
  contactValue: z.string().max(120).optional(),
  categoryId: categoryIdSchema,
  qty: z.number().positive().max(1_000_000),
  generalLocation: z.string().min(2).max(200),
  availableFrom: z.string().max(60).optional(),
  availableUntil: z.string().max(60).optional(),
  handover: z.enum(['collection', 'delivery', 'either']).default('either'),
  storageNote: z.string().max(400).optional(),
  expiryNote: z.string().max(400).optional(),
});

export const facilityUpdateSubmitSchema = z.object({
  facilityId: z.string().min(1),
  capacityAvailable: z.number().int().min(0).max(100_000).nullable(),
  openingStatus: z.enum(['open', 'full', 'closed']).nullable(),
  resourcesNote: z.string().max(600).nullable(),
  note: z.string().max(600).nullable(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const sttRequestSchema = z.object({
  language: languageSchema.default('en'),
  /** base64 audio. Kept out of logs; deleted after transcription unless the
   * operator has explicitly enabled retention. */
  audioBase64: z.string().min(16).max(20_000_000),
  mimeType: z.string().max(80).default('audio/webm'),
});

export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(1200),
  language: languageSchema.default('en'),
});

export const duplicateDecisionSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(['confirmed_duplicate', 'not_duplicate']),
});

export function assertKnownCategory(categoryId: string): void {
  if (!CATEGORY_IDS.includes(categoryId)) {
    throw new Error(`Unknown resource category: ${categoryId}`);
  }
}
