import { describe, expect, it } from 'vitest';
import { mergeProposal } from '@/lib/conversation/merge';
import { MAX_INITIAL_QUESTIONS, nextQuestion } from '@/lib/conversation/questions';
import { buildReadback, submissionConfirmation } from '@/lib/conversation/summary';
import { detectDanger, emergencyGuidance } from '@/lib/conversation/danger';
import { computeMissingFields, computeReviewFlags } from '@/lib/domain/requests';
import { emptyDraft, requestDraftSchema, type RequestDraft } from '@/lib/validation/schemas';
import { formatQuantity } from '@/lib/util/units';

function draft(partial: Partial<RequestDraft> = {}): RequestDraft {
  return requestDraftSchema.parse({ ...emptyDraft(), ...partial });
}

describe('merging a proposal into the draft', () => {
  it('never derives a supply quantity from a group size', () => {
    const result = mergeProposal(
      draft(),
      {
        groupSize: 25,
        items: [
          { categoryId: 'drinking_water', quantity: null, quantityUncertain: true },
          { categoryId: 'meal_packs', quantity: null, quantityUncertain: true },
        ],
      },
      'water and food for 25 people',
    );
    expect(result.draft.groupSize).toBe(25);
    for (const item of result.draft.items) {
      expect(item.quantity).toBeNull();
      expect(item.quantityUncertain).toBe(true);
    }
  });

  it('applies a correction to the group size and leaves quantities alone', () => {
    const before = draft({
      groupSize: 25,
      items: [{ categoryId: 'meal_packs', quantity: 60, unit: 'packs', quantityUncertain: false }],
    });
    const after = mergeProposal(before, { groupSize: 35 }, 'actually there are 35 people').draft;
    expect(after.groupSize).toBe(35);
    expect(after.items[0].quantity).toBe(60);
    expect(after.items[0].quantityUncertain).toBe(false);
  });

  it('settles an uncertain quantity when the user gives a number', () => {
    const before = draft({
      items: [{ categoryId: 'drinking_water', quantity: null, unit: 'litres', quantityUncertain: true }],
    });
    const after = mergeProposal(
      before,
      { items: [{ categoryId: 'drinking_water', quantity: 150, quantityUncertain: false }] },
      '150 litres',
    ).draft;
    expect(after.items[0].quantity).toBe(150);
    expect(after.items[0].quantityUncertain).toBe(false);
  });

  it('does not wipe a confirmed quantity when a later turn omits it', () => {
    const before = draft({
      items: [{ categoryId: 'meal_packs', quantity: 60, unit: 'packs', quantityUncertain: false }],
    });
    const after = mergeProposal(
      before,
      { items: [{ categoryId: 'meal_packs' }] },
      'and some food as well',
    ).draft;
    expect(after.items[0].quantity).toBe(60);
    expect(after.items[0].quantityUncertain).toBe(false);
  });

  it('invalidates a confirmed location when the words change', () => {
    const before = draft({
      locationText: 'Riverside Primary School',
      resolvedFacilityId: 'fac_riverside_primary',
      resolvedLat: 0.028,
      resolvedLng: -30.031,
      locationConfirmed: true,
    });
    const result = mergeProposal(before, { locationText: 'the hall by the bridge' }, 'we moved');
    expect(result.draft.locationConfirmed).toBe(false);
    expect(result.draft.resolvedFacilityId).toBeNull();
    expect(result.draft.resolvedLat).toBeNull();
    expect(result.locationNeedsResolving).toBe(true);
  });

  it('keeps a danger flag set once it has been raised', () => {
    const before = mergeProposal(draft(), { dangerReported: true }, 'my neighbour is trapped').draft;
    expect(before.dangerReported).toBe(true);
    // A later, calmer turn must not clear it.
    const after = mergeProposal(before, { groupSize: 4 }, 'there are four of us').draft;
    expect(after.dangerReported).toBe(true);
  });

  it('removes a category the user retracted', () => {
    const before = draft({
      items: [
        { categoryId: 'meal_packs', quantity: 10, unit: 'packs', quantityUncertain: false },
        { categoryId: 'hygiene_kits', quantity: 5, unit: 'kits', quantityUncertain: false },
      ],
    });
    const after = mergeProposal(before, { removeCategories: ['hygiene_kits'] }, 'not the kits').draft;
    expect(after.items.map((i) => i.categoryId)).toEqual(['meal_packs']);
  });

  it('records a skipped field without losing anything else', () => {
    const before = draft({ groupSize: 8 });
    const after = mergeProposal(before, { skipField: 'group_scope' }, "I don't know").draft;
    expect(after.skippedFields).toContain('group_scope');
    expect(after.groupSize).toBe(8);
  });

  it('keeps the user’s own words for the coordinator', () => {
    const after = mergeProposal(draft(), { groupSize: 3 }, 'there are three of us by the gate').draft;
    expect(after.originalText).toContain('three of us by the gate');
  });
});

describe('the question policy', () => {
  it('asks for resources first when nothing is known', () => {
    const question = nextQuestion({ draft: draft(), askedFields: [], questionCount: 0 });
    expect(question?.field).toBe('resources');
    expect(question?.allowSkip).toBe(true);
  });

  it('asks the user to choose when a landmark matches more than one place', () => {
    const question = nextQuestion({
      draft: draft({
        intent: 'need',
        items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
        locationText: 'the school near the old bridge',
        locationCandidates: [
          { label: 'Riverside Primary School', lat: 0, lng: 0, kind: 'shelter', facilityId: 'a' },
          { label: 'Old Bridge Community Hall', lat: 0, lng: 0, kind: 'shelter', facilityId: 'b' },
        ],
      }),
      askedFields: ['resources'],
      questionCount: 1,
    });
    expect(question?.field).toBe('location_choice');
    expect(question?.answerKind).toBe('choice');
    expect(question?.choices).toHaveLength(2);
  });

  it('never repeats a question that was answered or skipped', () => {
    const base = draft({
      intent: 'need',
      items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
      locationText: 'Riverside Primary School',
      locationConfirmed: true,
      groupSize: 25,
    });
    const first = nextQuestion({ draft: base, askedFields: [], questionCount: 1 });
    expect(first?.field).toBe('group_scope');

    const afterAnswer = nextQuestion({ draft: base, askedFields: ['group_scope'], questionCount: 2 });
    expect(afterAnswer).toBeNull();

    const afterSkip = nextQuestion({
      draft: { ...base, skippedFields: ['group_scope'] },
      askedFields: [],
      questionCount: 1,
    });
    expect(afterSkip).toBeNull();
  });

  it('stops asking optional questions past the limit, but still asks essentials', () => {
    const noLocation = draft({
      intent: 'need',
      items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
    });
    // Over the limit, yet a location is still essential to act on the request.
    const essential = nextQuestion({
      draft: noLocation,
      askedFields: ['resources'],
      questionCount: MAX_INITIAL_QUESTIONS + 2,
    });
    expect(essential?.field).toBe('location');

    // With the essentials in hand, the limit does stop further questions.
    const complete = draft({
      intent: 'need',
      items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
      locationText: 'Riverside Primary School',
      locationConfirmed: true,
    });
    expect(
      nextQuestion({ draft: complete, askedFields: ['resources'], questionCount: MAX_INITIAL_QUESTIONS }),
    ).toBeNull();
  });

  it('asks for a canonical quantity when the unit was not one we track', () => {
    const question = nextQuestion({
      draft: draft({
        intent: 'need',
        locationText: 'Old Bridge Community Hall',
        locationConfirmed: true,
        groupSize: 10,
        items: [
          {
            categoryId: 'drinking_water',
            quantity: null,
            unit: 'litres',
            quantityUncertain: true,
            note: 'User said 50 bottles; unit not recognised, canonical quantity still needed.',
          },
        ],
      }),
      askedFields: ['resources', 'group_scope'],
      questionCount: 2,
    });
    expect(question?.field).toBe('quantity_ambiguous');
    expect(question?.text).toMatch(/litres/);
    expect(question?.text).toMatch(/I don’t know/);
  });
});

describe('the read-back', () => {
  it('states what was recorded and caveats what was not', () => {
    const readback = buildReadback(
      draft({
        intent: 'need',
        items: [
          { categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true },
          { categoryId: 'drinking_water', quantity: null, unit: 'litres', quantityUncertain: true },
        ],
        groupSize: 25,
        locationText: 'Riverside Primary School',
        locationConfirmed: true,
      }),
    );
    expect(readback.summary).toContain('25 people');
    expect(readback.summary).toContain('Riverside Primary School');
    expect(readback.summary).toMatch(/quantities still need coordinator confirmation/i);
    expect(readback.summary).toMatch(/shall i submit it\?$/i);
    // No number is invented anywhere in it.
    expect(readback.summary).not.toMatch(/25 (packs|litres)/);
  });

  it('warns that an unconfirmed place will be checked', () => {
    const readback = buildReadback(
      draft({
        intent: 'need',
        items: [{ categoryId: 'meal_packs', quantity: 10, unit: 'packs', quantityUncertain: false }],
        locationText: 'the school near the old bridge',
        locationConfirmed: false,
      }),
    );
    expect(readback.caveats.some((c) => /not been confirmed/i.test(c))).toBe(true);
  });

  it('phrases an offer as an offer', () => {
    const readback = buildReadback(
      draft({
        intent: 'offer',
        items: [{ categoryId: 'meal_packs', quantity: 50, unit: 'packs', quantityUncertain: false }],
        locationText: 'Southgate Supply Hub',
        locationConfirmed: true,
      }),
    );
    expect(readback.summary).toMatch(/^You are offering/);
    expect(readback.summary).not.toMatch(/your request is for/i);
  });

  it('confirms submission with the reference and nothing more', () => {
    const message = submissionConfirmation('RR-1042');
    expect(message).toBe(
      'Your request has been submitted. Your reference is RR-1042. A coordinator has not yet accepted it.',
    );
    expect(message).not.toMatch(/on the way|coming|dispatched|assigned/i);
  });

  it('shows an unknown quantity as unknown', () => {
    expect(formatQuantity(null, 'drinking_water')).toBe('quantity not yet known (litres)');
    expect(formatQuantity(150, 'drinking_water')).toBe('150 litres');
    expect(formatQuantity(150, 'drinking_water', true)).toBe('about 150 litres (unconfirmed)');
  });
});

describe('missing information and review flags', () => {
  it('lists every gap a coordinator needs to see', () => {
    const missing = computeMissingFields(
      draft({
        intent: 'need',
        items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
        locationText: 'somewhere near the bridge',
        locationConfirmed: false,
      }),
    );
    expect(missing).toContain('location_confirmation');
    expect(missing).toContain('scale');
    expect(missing).toContain('quantity:meal_packs');
  });

  it('flags an uncertain quantity, an unconfirmed place and a proxy submission', () => {
    const flags = computeReviewFlags(
      draft({
        intent: 'need',
        items: [{ categoryId: 'meal_packs', quantity: null, unit: 'packs', quantityUncertain: true }],
        locationText: 'the hall',
        locationConfirmed: false,
        behalfRole: 'community_rep',
        skippedFields: ['group_scope'],
      }),
    );
    expect(flags).toEqual(
      expect.arrayContaining([
        'quantity_uncertain',
        'location_unconfirmed',
        'submitted_on_behalf',
        'questions_skipped',
      ]),
    );
  });
});

describe('danger detection', () => {
  it('recognises descriptions of danger to life', () => {
    for (const phrase of [
      'my neighbour is trapped on the roof',
      'the water is rising fast',
      'someone is unconscious',
      'we need rescue',
      'a child is stranded and cut off',
      'he is bleeding badly',
    ]) {
      expect(detectDanger(phrase).detected).toBe(true);
    }
  });

  it('does not treat an ordinary supply request as an emergency', () => {
    for (const phrase of [
      'we need 50 meal packs at the shelter',
      'we are running out of drinking water',
      'can you send hygiene kits tomorrow',
      'we have ten spaces left',
    ]) {
      expect(detectDanger(phrase).detected).toBe(false);
    }
  });

  it('never claims responders were notified', () => {
    const guidance = emergencyGuidance(['trapped']);
    expect(guidance.respondersNotified).toBe(false);
    expect(guidance.body).toMatch(/has not contacted anyone on your behalf/i);
    expect(guidance.body).toMatch(/cannot send rescuers/i);
    expect(guidance.body).not.toMatch(/we have notified|responders are on their way/i);
  });
});
