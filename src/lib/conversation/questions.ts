import { categoryLabel } from '@/lib/util/units';
import { t } from '@/lib/i18n/messages';
import type { RequestDraft } from '@/lib/validation/schemas';

/**
 * Which single question to ask next.
 *
 * Rules from the brief, encoded here so they can be tested:
 *   * one question at a time;
 *   * only questions that make the request actionable;
 *   * normally at most three clarifications before the read-back;
 *   * never repeat a question that was answered or skipped;
 *   * always allow "I don't know", "skip", or switching to typing.
 *
 * Asking for a contact number or a time window is *not* in this list. Neither
 * is needed to act on a request, and someone standing in floodwater should not
 * be made to answer optional questions.
 */

export type QuestionField =
  | 'intent'
  | 'resources'
  | 'location'
  | 'location_choice'
  | 'group_scope'
  | 'quantity_ambiguous';

export interface AssistantQuestion {
  field: QuestionField;
  /** Spoken and displayed. Short, calm, one question. */
  text: string;
  /** How the user can answer, so the UI can offer the right controls. */
  answerKind: 'text' | 'choice' | 'yes_no' | 'number';
  choices?: Array<{ value: string; label: string; detail?: string }>;
  /** Shown as a quick reply alongside every question. */
  allowSkip: boolean;
}

export const MAX_INITIAL_QUESTIONS = 3;

export interface QuestionContext {
  draft: RequestDraft;
  askedFields: string[];
  questionCount: number;
  /** Which catalogue to word the question from. Defaults to the draft's. */
  language?: string;
}

function lang(ctx: QuestionContext): string {
  return ctx.language ?? ctx.draft.language;
}

function alreadyHandled(ctx: QuestionContext, field: string): boolean {
  return ctx.askedFields.includes(field) || ctx.draft.skippedFields.includes(field);
}

export function nextQuestion(ctx: QuestionContext): AssistantQuestion | null {
  const { draft } = ctx;

  // Essential questions are asked even past the soft limit, because without
  // them nobody can act on the request at all.
  const essential = pickEssential(ctx);
  if (essential) return essential;

  if (ctx.questionCount >= MAX_INITIAL_QUESTIONS) return null;

  const helpful = pickHelpful(ctx);
  return helpful;
}

function pickEssential(ctx: QuestionContext): AssistantQuestion | null {
  const { draft } = ctx;

  if (draft.items.length === 0 && !alreadyHandled(ctx, 'resources')) {
    return {
      field: 'resources',
      text: t(lang(ctx), 'q.resources'),
      answerKind: 'text',
      allowSkip: true,
    };
  }

  if (!draft.intent && !alreadyHandled(ctx, 'intent')) {
    return {
      field: 'intent',
      text: t(lang(ctx), 'q.intent'),
      answerKind: 'choice',
      choices: [
        { value: 'need', label: t(lang(ctx), 'q.intent.need') },
        { value: 'offer', label: t(lang(ctx), 'q.intent.offer') },
      ],
      allowSkip: false,
    };
  }

  if (!draft.locationText && !alreadyHandled(ctx, 'location')) {
    return {
      field: 'location',
      // Not skippable: a request with no location cannot be acted on at all,
      // and `confirmAndSubmit` refuses one. Offering "I don't know" here only
      // led people to a read-back that then would not submit. The map, the
      // device's own location and the known-place list are all offered
      // alongside, so there is always a way to answer.
      text: t(lang(ctx), 'q.location'),
      answerKind: 'text',
      allowSkip: false,
    };
  }

  // A vague landmark matched more than one known place. The user picks; the app
  // does not guess coordinates.
  if (
    draft.locationText &&
    !draft.locationConfirmed &&
    draft.locationCandidates.length > 1 &&
    !alreadyHandled(ctx, 'location_choice')
  ) {
    return {
      field: 'location_choice',
      text:
        draft.locationCandidates.length === 2
          ? t(lang(ctx), 'q.location_choice.two', {
              a: draft.locationCandidates[0].label,
              b: draft.locationCandidates[1].label,
            })
          : t(lang(ctx), 'q.location_choice.many'),
      answerKind: 'choice',
      choices: draft.locationCandidates.map((c) => ({
        value: c.facilityId ?? c.label,
        label: c.label,
        detail: c.kind === 'shelter' ? 'Shelter' : c.kind === 'supply_hub' ? 'Supply hub' : undefined,
      })),
      allowSkip: true,
    };
  }

  return null;
}

function pickHelpful(ctx: QuestionContext): AssistantQuestion | null {
  const { draft } = ctx;

  // The brief's second question: a group size is known but no supply quantity
  // is. Confirming the request covers the whole group is the useful question —
  // and it still does not turn 25 people into 25 of anything.
  if (
    draft.groupSize !== null &&
    draft.items.length > 0 &&
    draft.items.every((i) => i.quantity === null) &&
    !alreadyHandled(ctx, 'group_scope')
  ) {
    return {
      field: 'group_scope',
      text: t(lang(ctx), 'q.group_scope.yesno', { n: draft.groupSize! }),
      answerKind: 'yes_no',
      allowSkip: true,
    };
  }

  // Someone gave a count in a unit the app cannot convert (for example bottles
  // rather than litres). Ask rather than convert.
  const ambiguous = draft.items.find(
    (i) =>
      i.quantity === null &&
      i.quantityUncertain &&
      i.note?.includes('unit not recognised') &&
      !alreadyHandled(ctx, `quantity_ambiguous:${i.categoryId}`),
  );
  if (ambiguous) {
    return {
      field: 'quantity_ambiguous',
      text: t(lang(ctx), 'q.quantity_ambiguous', {
        resource: categoryLabel(ambiguous.categoryId, lang(ctx)).toLowerCase(),
        unit: t(lang(ctx), `unitLabel.${ambiguous.categoryId}`),
      }),
      answerKind: 'number',
      allowSkip: true,
    };
  }

  if (
    draft.groupSize === null &&
    draft.items.length > 0 &&
    draft.items.every((i) => i.quantity === null) &&
    !alreadyHandled(ctx, 'group_scope')
  ) {
    return {
      field: 'group_scope',
      text: 'How many people is this for? If you are not sure, say “I don’t know”.',
      answerKind: 'number',
      allowSkip: true,
    };
  }

  return null;
}

/** The field name a question is recorded against, including per-category ones. */
export function questionKey(question: AssistantQuestion, draft: RequestDraft): string {
  if (question.field === 'quantity_ambiguous') {
    const item = draft.items.find((i) => i.quantity === null && i.quantityUncertain);
    return item ? `quantity_ambiguous:${item.categoryId}` : 'quantity_ambiguous';
  }
  return question.field;
}
