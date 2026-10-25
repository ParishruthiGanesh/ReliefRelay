import { unitFor } from '@/lib/util/units';
import {
  requestDraftSchema,
  type ProposedUpdate,
  type RequestDraft,
} from '@/lib/validation/schemas';

/**
 * Applies a validated proposal to the draft.
 *
 * This is the only path from a model's output to stored state, and it is a
 * pure function so the rules can be tested directly:
 *
 *   * A group size never becomes a supply quantity. There is no arithmetic
 *     between `groupSize` and any item quantity anywhere below.
 *   * A correction replaces the earlier value ("actually there are 35 people"
 *     overwrites 25) and leaves every other field alone.
 *   * An uncertain quantity stays uncertain. Setting a number explicitly
 *     clears the uncertainty flag; proposing `quantity: null` does not
 *     silently drop an amount the user already confirmed.
 *   * Changing the location text invalidates the previous resolution, because
 *     a confirmed place must never be carried over to different words.
 */

export interface MergeOutcome {
  draft: RequestDraft;
  /** Field names whose value this turn changed, for the audit trail. */
  changed: string[];
  /** True when the location text changed and needs resolving again. */
  locationNeedsResolving: boolean;
}

export function mergeProposal(
  draft: RequestDraft,
  update: ProposedUpdate,
  userText: string,
): MergeOutcome {
  const next: RequestDraft = structuredClone(draft);
  const changed: string[] = [];
  let locationNeedsResolving = false;

  if (update.intent != null && update.intent !== next.intent) {
    next.intent = update.intent;
    changed.push('intent');
  }

  if (update.removeCategories && update.removeCategories.length > 0) {
    const before = next.items.length;
    next.items = next.items.filter((i) => !update.removeCategories!.includes(i.categoryId));
    if (next.items.length !== before) changed.push('items');
  }

  if (update.items) {
    for (const proposed of update.items) {
      const existing = next.items.find((i) => i.categoryId === proposed.categoryId);
      const hasExplicitQuantity = proposed.quantity != null;
      const uncertain = proposed.quantityUncertain === true;

      if (!existing) {
        next.items.push({
          categoryId: proposed.categoryId,
          quantity: hasExplicitQuantity ? proposed.quantity! : null,
          unit: unitFor(proposed.categoryId),
          quantityUncertain: hasExplicitQuantity ? uncertain : true,
          ...(proposed.note ? { note: proposed.note } : {}),
        });
        changed.push(`item:${proposed.categoryId}`);
        continue;
      }

      if (hasExplicitQuantity && proposed.quantity !== existing.quantity) {
        existing.quantity = proposed.quantity!;
        // An explicit number from the user settles the amount, unless the
        // proposal itself says it is still a guess.
        existing.quantityUncertain = uncertain;
        changed.push(`item:${proposed.categoryId}`);
      } else if (!hasExplicitQuantity && uncertain && !existing.quantityUncertain) {
        // Going from confirmed back to uncertain only happens if explicitly proposed.
        existing.quantityUncertain = true;
        changed.push(`item:${proposed.categoryId}`);
      }
      if (proposed.note && proposed.note !== existing.note) {
        existing.note = proposed.note;
        changed.push(`item:${proposed.categoryId}:note`);
      }
    }
  }

  if (update.groupSize != null && update.groupSize !== next.groupSize) {
    next.groupSize = update.groupSize;
    next.groupSizeUncertain = update.groupSizeUncertain === true;
    changed.push('groupSize');
  } else if (update.groupSizeUncertain != null) {
    next.groupSizeUncertain = update.groupSizeUncertain;
  }

  if (update.locationText != null) {
    const trimmed = update.locationText.trim();
    if (trimmed && trimmed !== next.locationText) {
      next.locationText = trimmed;
      // The words changed, so any previously confirmed point no longer applies.
      next.resolvedFacilityId = null;
      next.resolvedLat = null;
      next.resolvedLng = null;
      next.locationConfirmed = false;
      next.locationCandidates = [];
      locationNeedsResolving = true;
      changed.push('locationText');
    }
  }

  if (update.neededBy != null && update.neededBy !== next.neededBy) {
    next.neededBy = update.neededBy;
    changed.push('neededBy');
  }
  if (update.urgency != null && update.urgency !== next.urgency) {
    next.urgency = update.urgency;
    changed.push('urgency');
  }
  if (update.contactMethod != null && update.contactMethod !== next.contactMethod) {
    next.contactMethod = update.contactMethod;
    changed.push('contactMethod');
  }
  if (update.contactValue != null && update.contactValue !== next.contactValue) {
    next.contactValue = update.contactValue;
    changed.push('contactValue');
  }
  if (update.behalfRole != null && update.behalfRole !== next.behalfRole) {
    next.behalfRole = update.behalfRole;
    changed.push('behalfRole');
  }

  // Danger is sticky: once someone has said they are in danger, a later turn
  // that does not mention it must not quietly clear the flag.
  if (update.dangerReported === true && !next.dangerReported) {
    next.dangerReported = true;
    next.dangerText = update.dangerText ?? userText.slice(0, 600);
    changed.push('dangerReported');
  }

  if (update.skipField) {
    if (!next.skippedFields.includes(update.skipField)) {
      next.skippedFields.push(update.skipField);
      changed.push('skipped');
    }
  }

  if (update.notes) {
    for (const note of update.notes) {
      if (!next.notes.includes(note)) next.notes.push(note);
    }
  }

  // The user's own words are kept so a coordinator can always read the original.
  next.originalText = [next.originalText, userText].filter(Boolean).join('\n').slice(0, 8000);

  return {
    draft: requestDraftSchema.parse(next),
    changed,
    locationNeedsResolving,
  };
}
