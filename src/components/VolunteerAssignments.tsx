'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DefinitionRow, SectionHeading, Spinner } from './ui';

interface Assignment {
  id: string;
  status: string;
  instructions: string | null;
  createdAge: string;
  commitmentId: string;
  commitmentStatus: string;
  what: string;
  organizationName: string;
  collectFrom: string;
  handover: string;
  referenceCode: string;
  destination: string;
  destinationAddress: string | null;
  accessNote: string | null;
  accessNoteSource: string | null;
  accessNoteAge: string | null;
}

/**
 * A volunteer's own assignments.
 *
 * What is shown is what a courier needs: what to carry, where from, where to,
 * the coordinator's instructions, and any recorded access restriction with its
 * source and age. No requester contact details, and no route described as safe
 * — an access note is a report, not a guarantee.
 */
export function VolunteerAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [disclosure, setDisclosure] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/volunteer/assignments');
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not load your deliveries.');
      setAssignments(body.assignments ?? []);
      setDisclosure(body.disclosure ?? '');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (assignmentId: string, status: 'accepted' | 'withdrawn' | 'completed') => {
    setBusy(true);
    try {
      const response = await fetch('/api/volunteer/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignmentId, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be saved.');
      await load();
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading your deliveries…" />;

  return (
    <div className="space-y-4">
      {error ? <Alert tone="attention">{error}</Alert> : null}

      {assignments.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-500">
            You have no deliveries assigned. A coordinator assigns deliveries; you will see them
            here.
          </p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {assignments.map((assignment) => (
            <Card as="li" key={assignment.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    assignment.status === 'accepted'
                      ? 'good'
                      : assignment.status === 'completed'
                        ? 'neutral'
                        : 'warn'
                  }
                >
                  {assignment.status}
                </Badge>
                <SectionHeading>{assignment.what}</SectionHeading>
              </div>
              <dl>
                <DefinitionRow label="Collect from">
                  {assignment.collectFrom} ({assignment.organizationName})
                </DefinitionRow>
                <DefinitionRow label="Deliver to">
                  {assignment.destination}
                  {assignment.destinationAddress ? (
                    <span className="block text-sm text-ink-500">{assignment.destinationAddress}</span>
                  ) : null}
                </DefinitionRow>
                <DefinitionRow label="Request">{assignment.referenceCode}</DefinitionRow>
                <DefinitionRow label="Handover">{assignment.handover}</DefinitionRow>
                {assignment.instructions ? (
                  <DefinitionRow label="Coordinator instructions">
                    {assignment.instructions}
                  </DefinitionRow>
                ) : null}
                {assignment.accessNote ? (
                  <DefinitionRow label="Access report">
                    {assignment.accessNote}
                    <span className="block text-xs text-ink-500">
                      Source: {assignment.accessNoteSource ?? 'not stated'} ·{' '}
                      {assignment.accessNoteAge ?? 'age unknown'}. This is a report, not a
                      guarantee. No route here is described as safe.
                    </span>
                  </DefinitionRow>
                ) : null}
                <DefinitionRow label="Assigned">{assignment.createdAge}</DefinitionRow>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {assignment.status === 'offered' ? (
                  <>
                    <Button disabled={busy} onClick={() => void update(assignment.id, 'accepted')}>
                      Accept this delivery
                    </Button>
                    <Button
                      disabled={busy}
                      variant="danger"
                      onClick={() => void update(assignment.id, 'withdrawn')}
                    >
                      I cannot do this one
                    </Button>
                  </>
                ) : null}
                {assignment.status === 'accepted' ? (
                  <Button
                    disabled={busy}
                    variant="danger"
                    onClick={() => void update(assignment.id, 'withdrawn')}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-ink-500">
                The recipient confirms what actually arrived — a delivery is not complete because a
                courier says so.
              </p>
            </Card>
          ))}
        </ul>
      )}

      {disclosure ? <p className="text-xs text-ink-500">{disclosure}</p> : null}
    </div>
  );
}
