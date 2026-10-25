import { categoryLabel, formatQuantity } from '@/lib/util/units';
import { t } from '@/lib/i18n/messages';
import type { RequestDraft } from '@/lib/validation/schemas';
import { computeMissingFields } from '@/lib/domain/requests';

/**
 * The read-back. Everything spoken is also displayed, word for word.
 *
 * It states what was recorded and nothing more. In particular it never implies
 * that supplies are coming, and when a quantity is unknown it says so rather
 * than printing a number nobody gave.
 */
export interface Readback {
  /** Spoken and shown. */
  summary: string;
  /** Short lines for the confirmation panel. */
  lines: Array<{ label: string; value: string; caution?: boolean }>;
  /** What a coordinator will see as missing. */
  missingFields: string[];
  caveats: string[];
}

function describeItems(draft: RequestDraft, language: string): string {
  if (draft.items.length === 0) return 'supplies not yet specified';
  const parts = draft.items.map((item) => {
    const label = categoryLabel(item.categoryId, language).toLowerCase();
    if (item.quantity === null) return label;
    return formatQuantity(item.quantity, item.categoryId, item.quantityUncertain, language);
  });
  // Joined with a comma in every language; the final conjunction varies too
  // much to be worth a per-language rule for a list of at most four items.
  return parts.join(', ');
}

export function buildReadback(draft: RequestDraft, language: string = draft.language): Readback {
  const missingFields = computeMissingFields(draft);
  const caveats: string[] = [];

  const items = describeItems(draft, language);
  const forWhom =
    draft.groupSize !== null
      ? t(language, 'readback.for_people', {
          n: draft.groupSize,
          people: t(language, draft.groupSize === 1 ? 'people.one' : 'people.many'),
        })
      : '';
  const place = draft.locationText
    ? t(language, 'readback.at_place', { place: draft.locationText })
    : '';

  const opening =
    draft.intent === 'offer'
      ? t(language, 'readback.offer', { items, place })
      : t(language, 'readback.request', { items, forWhom, place });

  if (draft.items.some((i) => i.quantity === null || i.quantityUncertain)) {
    caveats.push(t(language, 'caveat.quantities'));
  }
  if (draft.locationText && !draft.locationConfirmed) {
    caveats.push(t(language, 'caveat.location'));
  }
  if (draft.dangerReported) {
    caveats.push(t(language, 'caveat.danger'));
  }
  if (draft.skippedFields.length > 0) {
    caveats.push(t(language, 'caveat.skipped'));
  }

  const summary = [opening, ...caveats, t(language, 'readback.submit_question')].join(' ');

  const lines: Array<{ label: string; value: string; caution?: boolean }> = [];
  lines.push({
    label: draft.intent === 'offer' ? 'Offering' : 'Requesting',
    // Named per category, so an unknown amount reads as a fact about that
    // resource rather than as a repeated disclaimer.
    value: draft.items.length
      ? draft.items
          .map(
            (i) =>
              `${categoryLabel(i.categoryId, language)}: ${formatQuantity(
                i.quantity,
                i.categoryId,
                i.quantityUncertain,
                language,
              )}`,
          )
          .join('\n')
      : 'not yet specified',
    caution: draft.items.some((i) => i.quantity === null),
  });
  if (draft.groupSize !== null) {
    lines.push({
      label: 'Group size',
      value: `${draft.groupSize} ${t(language, draft.groupSize === 1 ? 'people.one' : 'people.many')}${
        draft.groupSizeUncertain ? ' (approximate)' : ''
      }`,
    });
  }
  lines.push({
    label: 'Place',
    value: draft.locationText ?? 'not given',
    caution: !draft.locationConfirmed,
  });
  if (draft.urgency) lines.push({ label: 'Urgency as reported', value: draft.urgency });
  if (draft.contactMethod && draft.contactMethod !== 'none' && draft.contactValue) {
    lines.push({ label: 'Contact', value: `${draft.contactMethod}: ${draft.contactValue}` });
  }
  if (draft.behalfRole !== 'self') {
    lines.push({ label: 'Submitted by', value: draft.behalfRole.replace('_', ' ') });
  }

  return { summary, lines, missingFields, caveats };
}

/**
 * The message after a successful save. Deliberately flat: a reference code and
 * the true status. No "help is on the way".
 */
export function submissionConfirmation(referenceCode: string, language = 'en'): string {
  return t(language, 'submitted.confirmation', { reference: referenceCode });
}

export function offlineNotice(): string {
  return 'Saved on this device — not yet sent.';
}
