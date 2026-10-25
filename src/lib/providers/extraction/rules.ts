import { detectDanger } from '@/lib/conversation/danger';
import { proposedUpdateSchema, type ProposedUpdate } from '@/lib/validation/schemas';
import type {
  ExtractionContext,
  ExtractionProvider,
  ExtractionResult,
  ProviderInfo,
} from '../types';
import { digitize, firstNumber } from './numbers';
import { detectLanguage } from '@/lib/i18n/detect';
import { CATEGORY_IDS as ALL_CATEGORY_IDS } from '@/lib/util/units';

const CATEGORY_IDS = ALL_CATEGORY_IDS as CategoryId[];

/**
 * Phrases that mark a correction rather than new information.
 *
 * Shared across languages because a correction usually arrives with a fresh
 * number, and the number is the signal that matters. A missed correction
 * marker only means the new value is treated as new information, which the
 * merge handles the same way.
 */
const CORRECTION_SIGNAL =
  /\b(actually|sorry|i meant|i mean|make it|correction|change (it|that) to|no,? it'?s|instead)\b|(en realidad|perd[oó]n|quise decir|corrijo|mejor)|(दरअसल|माफ़|माफ|मेरा मतलब|सुधार)|(உண்மையில்|மன்னிக்கவும்|திருத்தம்)|(నిజానికి|క్షమించండి|సవరణ)/i;

/**
 * The deterministic extractor.
 *
 * This is the default, and it is a real implementation rather than a stub: it
 * is what runs the demonstration when no AI credentials are configured. It is
 * honest about its limits — anything it cannot read confidently becomes an
 * uncertainty flag and a follow-up question, never a guess.
 *
 * Two rules it will not break:
 *   * A count in a unit it cannot convert ("50 bottles of water") produces an
 *     unknown litre quantity plus a note, not a converted number.
 *   * A group size is never used as a supply quantity.
 */

export const RULES_PROVIDER: ProviderInfo = {
  id: 'rules',
  label: 'Rule-based extraction (ran on this server; no AI service was called)',
  kind: 'local',
};

import { vocabularyFor, type CategoryId, type LanguageVocabulary } from './keywords';

function matchQuantity(patterns: RegExp[], text: string): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

function matchAmbiguous(
  entries: Array<{ re: RegExp; unitWord: string }>,
  text: string,
): { count: number; unitWord: string } | null {
  for (const entry of entries) {
    const m = text.match(entry.re);
    if (m?.[1]) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0) return { count: value, unitWord: entry.unitWord };
    }
  }
  return null;
}

function extractGroupSize(
  text: string,
  raw: string,
  vocab: LanguageVocabulary,
): { value: number; approximate: boolean } | null {
  for (const re of vocab.groupSize) {
    const m = text.match(re);
    if (m?.[1]) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100_000) {
        return { value, approximate: vocab.approximate.test(raw) };
      }
    }
  }
  return null;
}

/**
 * Answers to a pending question are read in that question's context first.
 * "Yes" only means something when there is a question on the table.
 */
function interpretAnswer(
  context: ExtractionContext,
  digits: string,
  vocab: LanguageVocabulary,
): ProposedUpdate | null {
  const question = context.pendingQuestion;
  if (!question) return null;
  const raw = context.userText.trim();

  if (vocab.skip.test(raw)) {
    return { skipField: question.field, notes: [`User could not answer: ${question.field}.`] };
  }

  switch (question.field) {
    case 'intent': {
      if (/\b(offer|provide|donate|give|supply)\b/i.test(raw)) {
        return { intent: 'offer', answeredField: 'intent' };
      }
      if (/\b(need|want|require|asking|help)\b/i.test(raw)) {
        return { intent: 'need', answeredField: 'intent' };
      }
      return null;
    }
    case 'location':
    case 'location_choice': {
      // Whatever they said is the place name. Resolution happens separately,
      // against the known facility list, with the user confirming.
      return { locationText: raw.slice(0, 400), answeredField: question.field };
    }
    case 'group_scope': {
      if (question.answerKind === 'yes_no') {
        if (vocab.affirmative.test(raw) && !vocab.negative.test(raw)) {
          // Confirms the scope. Still produces no supply quantity.
          return {
            answeredField: 'group_scope',
            notes: ['User confirmed the request covers the whole group.'],
          };
        }
        if (vocab.negative.test(raw)) {
          const n = firstNumber(digits);
          return n
            ? { groupSize: n, answeredField: 'group_scope' }
            : {
                answeredField: 'group_scope',
                notes: ['User said the request is not for the whole group; size needs checking.'],
              };
        }
        const n = firstNumber(digits);
        return n ? { groupSize: n, answeredField: 'group_scope' } : null;
      }
      const n = firstNumber(digits);
      return n ? { groupSize: n, answeredField: 'group_scope' } : null;
    }
    case 'quantity_ambiguous': {
      const n = firstNumber(digits);
      if (n === null) return null;
      const pending = context.draft.items.find((i) => i.quantity === null && i.quantityUncertain);
      if (!pending) return null;
      return {
        items: [{ categoryId: pending.categoryId, quantity: n, quantityUncertain: false }],
        answeredField: `quantity_ambiguous:${pending.categoryId}`,
      };
    }
    case 'resources':
      return null;
    default:
      return null;
  }
}

export class RulesExtractionProvider implements ExtractionProvider {
  readonly info = RULES_PROVIDER;

  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    const raw = context.userText;
    // Read the text with the vocabulary of the language it is actually in,
    // falling back to the conversation's language and then to English. Place
    // names stay in the person's own words either way.
    const detected = detectLanguage(raw);
    const language = detected.language ?? context.language;
    const vocab = vocabularyFor(language);
    const digits = digitize(raw, vocab.numberWords);
    const update: ProposedUpdate = {};
    const notes: string[] = [];

    if (detected.unsupportedScript) {
      notes.push(
        'The text is in a script the built-in extractor has no vocabulary for. Configure EXTRACTION_PROVIDER=anthropic to read it.',
      );
    }

    // 1. The answer to a pending question takes precedence.
    const answer = interpretAnswer(context, digits, vocab);
    if (answer) Object.assign(update, answer);

    // 2. Intent. An explicit offer wins over a bare mention of supplies, and
    // can still correct an earlier reading, because "we need 50 meals" and
    // "we can provide 50 meals" must never be confused.
    const offers = vocab.offer.test(raw);
    const needs = vocab.need.test(raw);
    if (!update.intent) {
      if (offers && !needs) update.intent = 'offer';
      else if (needs) update.intent = 'need';
      else if (context.draft.intent === null) {
        // Resources named with no verb either way ("food and water for 25")
        // read as a need, which is what this screen is for. Flagged so a
        // coordinator can see it was inferred rather than stated.
        const anyResource = CATEGORY_IDS.some((id) => vocab.categories[id].test(raw));
        if (anyResource) {
          update.intent = 'need';
          notes.push('Intent inferred as a need: resources were named without "need" or "offer".');
        }
      }
    }

    // 3. Resources, with quantities only where a recognised unit was used.
    const items: NonNullable<ProposedUpdate['items']> = update.items ? [...update.items] : [];
    for (const categoryId of CATEGORY_IDS) {
      if (items.some((i) => i.categoryId === categoryId)) continue;
      const mentioned = vocab.categories[categoryId].test(raw);
      const quantity = matchQuantity(vocab.quantities[categoryId] ?? [], digits);
      const ambiguous =
        quantity === null ? matchAmbiguous(vocab.ambiguous[categoryId] ?? [], digits) : null;

      if (quantity !== null) {
        items.push({
          categoryId,
          quantity,
          quantityUncertain: vocab.approximate.test(raw),
        });
      } else if (ambiguous) {
        // The number is real but the unit is not one we track. Record what they
        // said and ask; never convert bottles into litres.
        items.push({
          categoryId,
          quantity: null,
          quantityUncertain: true,
          note: `User said ${ambiguous.count} ${ambiguous.unitWord}; unit not recognised, canonical quantity still needed.`,
        });
      } else if (mentioned) {
        items.push({ categoryId, quantity: null, quantityUncertain: true });
      }
    }
    if (items.length > 0) update.items = items;

    // 4. Group size — people, kept well away from supply quantities.
    if (!update.groupSize) {
      const group = extractGroupSize(digits, raw, vocab);
      if (group) {
        update.groupSize = group.value;
        update.groupSizeUncertain = group.approximate;
      } else if (CORRECTION_SIGNAL.test(raw)) {
        const n = firstNumber(digits);
        if (n !== null) {
          update.groupSize = n;
          notes.push('Correction applied to group size.');
        }
      }
    }

    // 5. Location, when phrased as a place rather than as an answer.
    if (update.locationText === undefined) {
      const place = raw.match(
        /\b(?:we are|we're|i am|i'm|they are)\s+(?:at|in|near|by|outside|inside)\s+(.{3,120}?)(?:[.,;!?]|$)/i,
      ) ?? raw.match(/\b(?:at|near|outside)\s+(the\s+.{3,120}?)(?:[.,;!?]|$)/i);
      if (place?.[1]) update.locationText = place[1].trim();
    }

    // 6. Urgency as the user reported it. Never inferred from phrasing quality.
    if (vocab.critical.test(raw)) update.urgency = 'critical';
    else if (vocab.urgent.test(raw)) update.urgency = 'high';

    // 7. Immediate danger.
    const danger = detectDanger(raw);
    if (danger.detected) {
      update.dangerReported = true;
      update.dangerText = danger.excerpt;
      notes.push(`Danger indicators detected: ${danger.labels.join(', ')}.`);
    }

    // 8. Explicit confirmation or cancellation of a read-back.
    if (!context.pendingQuestion) {
      if (/\b(submit|send it|yes submit|go ahead|please submit)\b/i.test(raw)) {
        update.confirmSubmission = true;
      } else if (vocab.affirmative.test(raw) && !vocab.negative.test(raw) && raw.trim().length <= 24) {
        update.confirmSubmission = true;
      }
      if (/\b(cancel|don'?t send|do not send|stop|discard)\b/i.test(raw)) {
        update.cancelRequest = true;
      }
    }

    if (notes.length > 0) update.notes = [...(update.notes ?? []), ...notes];

    const parsed = proposedUpdateSchema.safeParse(update);
    if (!parsed.success) {
      // Should not happen for a deterministic extractor, but the same guard
      // applies to every provider: an invalid proposal changes nothing.
      return {
        update: {},
        provider: this.info,
        validationError: parsed.error.message,
      };
    }
    return { update: parsed.data, provider: this.info };
  }
}
