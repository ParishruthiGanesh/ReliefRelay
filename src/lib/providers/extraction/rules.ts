import { detectDanger } from '@/lib/conversation/danger';
import { proposedUpdateSchema, type ProposedUpdate } from '@/lib/validation/schemas';
import type {
  ExtractionContext,
  ExtractionProvider,
  ExtractionResult,
  ProviderInfo,
} from '../types';
import { digitize, firstNumber } from './numbers';

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

const AFFIRMATIVE = /\b(yes|yeah|yep|yup|correct|that'?s right|right|ok|okay|sure|please do|go ahead|confirm|submit it)\b/i;
const NEGATIVE = /\b(no|nope|not really|that'?s wrong|incorrect|don'?t|do not|cancel|stop)\b/i;
const SKIP = /\b(i don'?t know|dont know|not sure|no idea|skip|pass|can'?t say|cannot say|unsure|unknown)\b/i;

const OFFER_SIGNALS =
  /\b(we|i)\s+(can|could|will|would)\s+(provide|supply|donate|give|bring|deliver|spare|send|offer)\b|\boffering\b|\bwe have\b[^.]*\b(available|spare|to (give|donate|spare))\b|\bhappy to (provide|donate|help with)\b/i;
const NEED_SIGNALS =
  /\b(we|i|they)\s+(need|needs|require|want)\b|\bneed\b|\bwe have no\b|\bran? out of\b|\brunning out of\b|\bshort of\b|\bplease send\b|\bcan you send\b|\bwe are without\b|\bno (food|water|drinking water)\b/i;

const CORRECTION_SIGNAL =
  /\b(actually|sorry|i meant|i mean|make it|correction|change (it|that) to|no,? it'?s|instead)\b/i;

interface CategoryRule {
  categoryId: 'meal_packs' | 'drinking_water' | 'hygiene_kits' | 'shelter_spaces';
  /** Mentions of the resource at all. */
  mention: RegExp;
  /** A quantity in the category's own canonical unit. */
  quantity: RegExp[];
  /** A count in a unit this app does not convert. */
  ambiguous?: Array<{ re: RegExp; unitWord: string }>;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    categoryId: 'meal_packs',
    mention: /\b(food|meals?|meal packs?|ration|rations|something to eat|hungry|cooked food|dry food|food packs?)\b/i,
    quantity: [
      /\b(\d{1,6})\s*(?:meal\s*packs?|food\s*packs?|packs?|rations?|meals?)\b/i,
    ],
    ambiguous: [
      { re: /\b(\d{1,6})\s*(?:boxes?|cartons?|crates?|sacks?|bags?)\b[^.]{0,20}\b(?:food|meals?|ration)/i, unitWord: 'boxes' },
      { re: /\b(?:food|meals?|rations?)\b[^.]{0,20}\b(\d{1,6})\s*(?:boxes?|cartons?|crates?|sacks?|bags?)\b/i, unitWord: 'boxes' },
    ],
  },
  {
    categoryId: 'drinking_water',
    mention: /\b(water|drinking water|clean water|thirsty|no water)\b/i,
    quantity: [
      /\b(\d{1,6})\s*(?:litres?|liters?|ltrs?|l)\b(?:\s*of)?(?:\s*(?:drinking\s*)?water)?/i,
      /\bwater\b[^.]{0,15}\b(\d{1,6})\s*(?:litres?|liters?|ltrs?)\b/i,
    ],
    ambiguous: [
      { re: /\b(\d{1,6})\s*(?:bottles?|cans?|jerry\s?cans?|containers?|packs?|cases?)\b[^.]{0,15}\b(?:of\s*)?(?:drinking\s*)?water\b/i, unitWord: 'bottles' },
      { re: /\bwater\b[^.]{0,15}\b(\d{1,6})\s*(?:bottles?|cans?|jerry\s?cans?|containers?|cases?)\b/i, unitWord: 'bottles' },
    ],
  },
  {
    categoryId: 'hygiene_kits',
    mention: /\b(hygiene|sanitary|sanitation|soap|toiletries|nappies|diapers|sanitary pads|washing)\b/i,
    quantity: [/\b(\d{1,6})\s*(?:hygiene\s*kits?|sanitation\s*kits?|kits?)\b/i],
  },
  {
    categoryId: 'shelter_spaces',
    mention: /\b(shelter|somewhere to stay|place to stay|sleep|beds?|spaces?|accommodation|roof over)\b/i,
    quantity: [/\b(\d{1,6})\s*(?:shelter\s*spaces?|spaces?|beds?|places?|spots?)\b/i],
  },
];

const GROUP_SIZE_PATTERNS: RegExp[] = [
  /\b(?:there (?:are|is)|we are|we're)\s*(?:about|around|roughly|approximately)?\s*(\d{1,6})\s*(?:people|persons|of us|adults|families|children|here)?\b/i,
  /\b(\d{1,6})\s*(?:people|persons|individuals|survivors|residents)\b/i,
  /\bfamily of\s*(\d{1,6})\b/i,
  /\bgroup of\s*(\d{1,6})\b/i,
  /\b(\d{1,6})\s*of us\b/i,
];

const APPROX = /\b(about|around|roughly|approximately|maybe|more or less|or so)\b/i;

const URGENCY_CRITICAL = /\b(critical|life threatening|emergency)\b/i;
const URGENCY_HIGH = /\b(urgent|urgently|immediately|right now|as soon as possible|asap|desperate)\b/i;

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
  rule: CategoryRule,
  text: string,
): { count: number; unitWord: string } | null {
  for (const entry of rule.ambiguous ?? []) {
    const m = text.match(entry.re);
    if (m?.[1]) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0) return { count: value, unitWord: entry.unitWord };
    }
  }
  return null;
}

function extractGroupSize(text: string): { value: number; approximate: boolean } | null {
  for (const re of GROUP_SIZE_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100_000) {
        return { value, approximate: APPROX.test(text) };
      }
    }
  }
  return null;
}

/**
 * Answers to a pending question are read in that question's context first.
 * "Yes" only means something when there is a question on the table.
 */
function interpretAnswer(context: ExtractionContext, digits: string): ProposedUpdate | null {
  const question = context.pendingQuestion;
  if (!question) return null;
  const raw = context.userText.trim();

  if (SKIP.test(raw)) {
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
        if (AFFIRMATIVE.test(raw) && !NEGATIVE.test(raw)) {
          // Confirms the scope. Still produces no supply quantity.
          return {
            answeredField: 'group_scope',
            notes: ['User confirmed the request covers the whole group.'],
          };
        }
        if (NEGATIVE.test(raw)) {
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
    const digits = digitize(raw);
    const update: ProposedUpdate = {};
    const notes: string[] = [];

    // 1. The answer to a pending question takes precedence.
    const answer = interpretAnswer(context, digits);
    if (answer) Object.assign(update, answer);

    // 2. Intent. An explicit offer wins over a bare mention of supplies, and
    // can still correct an earlier reading, because "we need 50 meals" and
    // "we can provide 50 meals" must never be confused.
    const offers = OFFER_SIGNALS.test(raw);
    const needs = NEED_SIGNALS.test(raw);
    if (!update.intent) {
      if (offers && !needs) update.intent = 'offer';
      else if (needs) update.intent = 'need';
      else if (context.draft.intent === null) {
        // Resources named with no verb either way ("food and water for 25")
        // read as a need, which is what this screen is for. Flagged so a
        // coordinator can see it was inferred rather than stated.
        const anyResource = CATEGORY_RULES.some((rule) => rule.mention.test(raw));
        if (anyResource) {
          update.intent = 'need';
          notes.push('Intent inferred as a need: resources were named without "need" or "offer".');
        }
      }
    }

    // 3. Resources, with quantities only where a recognised unit was used.
    const items: NonNullable<ProposedUpdate['items']> = update.items ? [...update.items] : [];
    for (const rule of CATEGORY_RULES) {
      if (items.some((i) => i.categoryId === rule.categoryId)) continue;
      const mentioned = rule.mention.test(raw);
      const quantity = matchQuantity(rule.quantity, digits);
      const ambiguous = quantity === null ? matchAmbiguous(rule, digits) : null;

      if (quantity !== null) {
        items.push({
          categoryId: rule.categoryId,
          quantity,
          quantityUncertain: APPROX.test(raw),
        });
      } else if (ambiguous) {
        // The number is real but the unit is not one we track. Record what they
        // said and ask; never convert bottles into litres.
        items.push({
          categoryId: rule.categoryId,
          quantity: null,
          quantityUncertain: true,
          note: `User said ${ambiguous.count} ${ambiguous.unitWord}; unit not recognised, canonical quantity still needed.`,
        });
      } else if (mentioned) {
        items.push({ categoryId: rule.categoryId, quantity: null, quantityUncertain: true });
      }
    }
    if (items.length > 0) update.items = items;

    // 4. Group size — people, kept well away from supply quantities.
    if (!update.groupSize) {
      const group = extractGroupSize(digits);
      if (group) {
        update.groupSize = group.value;
        update.groupSizeUncertain = group.approximate;
      } else if (CORRECTION_SIGNAL.test(raw) && /\b(people|persons|of us)\b/i.test(raw)) {
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
    if (URGENCY_CRITICAL.test(raw)) update.urgency = 'critical';
    else if (URGENCY_HIGH.test(raw)) update.urgency = 'high';

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
      } else if (AFFIRMATIVE.test(raw) && !NEGATIVE.test(raw) && raw.trim().length <= 24) {
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
