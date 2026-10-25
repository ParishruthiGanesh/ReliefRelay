'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, FieldLabel, Provenance, SectionHeading, Spinner } from './ui';
import { clearLocalDraft, loadLocalDraft, newIdempotencyKey, saveLocalDraft } from '@/lib/client/outbox';

/**
 * The conversational voice assistant.
 *
 * Shape of the interaction, and the promises the screen keeps:
 *   * one large microphone control with unmistakable recording and processing states;
 *   * the transcript is always shown and always editable before it is sent;
 *   * exactly one question at a time, with "I don't know", "skip" and
 *     "type instead" always available;
 *   * everything the assistant says is displayed as text, word for word;
 *   * nothing is spoken automatically — the user presses play, and can mute or stop;
 *   * authoritative state lives on the server, so a reload resumes the draft;
 *   * nothing reads as submitted until the server has returned a reference code.
 */

type ConversationState = 'collecting' | 'confirming' | 'submitted' | 'abandoned';

interface Question {
  field: string;
  text: string;
  answerKind: 'text' | 'choice' | 'yes_no' | 'number';
  choices?: Array<{ value: string; label: string; detail?: string }>;
  allowSkip: boolean;
}

interface DraftItem {
  categoryId: string;
  quantity: number | null;
  unit: string;
  quantityUncertain: boolean;
  note?: string;
}

interface Draft {
  intent: string | null;
  items: DraftItem[];
  groupSize: number | null;
  groupSizeUncertain: boolean;
  locationText: string | null;
  locationCandidates: Array<{ facilityId?: string; label: string; kind: string; lat: number; lng: number }>;
  locationConfirmed: boolean;
  urgency: string | null;
  dangerReported: boolean;
  skippedFields: string[];
  language: string;
}

interface Readback {
  summary: string;
  lines: Array<{ label: string; value: string; caution?: boolean }>;
  missingFields: string[];
  caveats: string[];
}

interface Conversation {
  conversationId: string;
  state: ConversationState;
  draft: Draft;
  question: Question | null;
  readback: Readback | null;
  assistantText: string;
  questionCount: number;
  emergency: {
    headline: string;
    body: string;
    emergencyNumber: string;
    emergencyLabel: string;
    respondersNotified: boolean;
  } | null;
  providers: { extraction: { id: string; label: string; kind: string } | null };
  turns: Array<{ role: 'user' | 'assistant'; text: string; createdAt: string; inputMode: string }>;
  submitted: { requestId: string; referenceCode: string; status: string } | null;
}

interface ProviderStatus {
  extraction: { active: string; live: boolean; note: string };
  stt: { active: string | null; live: boolean; note: string; languages: string[] };
  tts: { active: string; live: boolean; note: string };
}

interface LanguageOption {
  code: string;
  label: string;
  uiReady: boolean;
  sttReady: boolean;
  ttsReady: boolean;
  note: string;
}

type MicState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'unavailable';

const CATEGORY_LABELS: Record<string, string> = {
  meal_packs: 'Meal packs',
  drinking_water: 'Drinking water',
  hygiene_kits: 'Hygiene kits',
  shelter_spaces: 'Shelter spaces',
};

interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getBrowserRecognition(): (new () => BrowserRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceAssistant({ languages }: { languages: LanguageOption[] }) {
  const [language, setLanguage] = useState('en');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [behalfRole, setBehalfRole] = useState('self');

  const [micState, setMicState] = useState<MicState>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [transcriptSource, setTranscriptSource] = useState<{ label: string; kind: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);

  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechNote, setSpeechNote] = useState<string | null>(null);

  const [demoLines, setDemoLines] = useState<Array<{ step: number; text: string; hint: string }>>([]);
  const [demoIndex, setDemoIndex] = useState(0);
  const [demoActive, setDemoActive] = useState(false);

  const [submission, setSubmission] = useState<{
    referenceCode: string;
    trackingToken: string;
    status: string;
    assistantText: string;
    missingFields: string[];
  } | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recognition = useRef<BrowserRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  const browserRecognitionAvailable = useMemo(() => getBrowserRecognition() !== null, []);
  const selectedLanguage = languages.find((l) => l.code === language) ?? languages[0];

  // ── session bootstrap, resuming a draft the server already holds ─────────
  const startConversation = useCallback(
    async (nextLanguage: string, role: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/conversation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: nextLanguage, mode: 'request', behalfRole: role }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'Could not start the assistant.');
        setConversation(body.conversation);
        setProviders(body.providers);
        idempotencyKey.current = newIdempotencyKey();
        saveLocalDraft({ conversationId: body.conversation.conversationId, language: nextLanguage });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const stored = loadLocalDraft<{ conversationId: string; language: string }>();
    if (stored?.value?.conversationId) {
      void (async () => {
        try {
          const response = await fetch(`/api/conversation/${stored.value.conversationId}`);
          const body = await response.json();
          if (response.ok && body.conversation && body.conversation.state !== 'submitted') {
            setConversation(body.conversation);
            setLanguage(body.conversation.draft.language);
            const statusResponse = await fetch('/api/status');
            const statusBody = await statusResponse.json();
            setProviders({ extraction: statusBody.extraction, stt: statusBody.stt, tts: statusBody.tts });
            return;
          }
        } catch {
          // Fall through to a fresh conversation.
        }
        clearLocalDraft();
        void startConversation('en', 'self');
      })();
    } else {
      void startConversation('en', 'self');
    }
  }, [startConversation]);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/demo-script?language=${language}`);
      if (response.ok) {
        const body = await response.json();
        setDemoLines(body.lines ?? []);
      }
    })();
  }, [language]);

  // ── speaking the assistant's replies, only on request ───────────────────
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (muted || !text) return;
      stopSpeaking();
      setSpeaking(true);
      setSpeechNote(null);
      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, language }),
        });
        const body = await response.json();
        if (body?.note) setSpeechNote(body.note);
        const speech = body?.speech;
        if (speech?.audioBase64) {
          const audio = new Audio(`data:${speech.mimeType};base64,${speech.audioBase64}`);
          audioRef.current = audio;
          audio.onended = () => setSpeaking(false);
          await audio.play();
          return;
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = language === 'en' ? 'en-GB' : language;
          utterance.onend = () => setSpeaking(false);
          window.speechSynthesis.speak(utterance);
          setSpeechNote(
            'Spoken by your browser’s own speech synthesis. No speech service was called.',
          );
          return;
        }
        setSpeaking(false);
        setSpeechNote('This browser has no speech synthesis. The reply is shown as text above.');
      } catch {
        setSpeaking(false);
        setSpeechNote('Speech playback failed. The reply is shown as text above.');
      }
    },
    [language, muted, stopSpeaking],
  );

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  // ── recording ───────────────────────────────────────────────────────────
  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const transcribe = useCallback(
    async (blob: Blob) => {
      setMicState('transcribing');
      try {
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const response = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            language,
            audioBase64: btoa(binary),
            mimeType: blob.type || 'audio/webm',
          }),
        });
        const body = await response.json();
        if (!response.ok) {
          // Honest failure: no transcript is invented, and the alternatives are offered.
          setError(body?.error?.message ?? 'The recording could not be transcribed.');
          setGuidance(body?.error?.guidance ?? null);
          setMicState('unavailable');
          return;
        }
        setTranscript(body.transcript);
        setTranscriptSource({ label: body.provider.label, kind: body.provider.kind });
        setMicState('idle');
      } catch (caught) {
        setError((caught as Error).message);
        setMicState('idle');
      }
    },
    [language],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setGuidance(null);

    // With no server provider, the browser's own recogniser is the honest
    // option: the transcript genuinely comes from the browser, and is labelled
    // that way.
    if (providers && !providers.stt.live && browserRecognitionAvailable) {
      const Recognition = getBrowserRecognition();
      if (!Recognition) return;
      const instance = new Recognition();
      recognition.current = instance;
      instance.lang = language === 'en' ? 'en-GB' : language;
      instance.continuous = false;
      instance.interimResults = false;
      instance.onresult = (event) => {
        const text = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript)
          .join(' ')
          .trim();
        setTranscript(text);
        setTranscriptSource({
          label: 'Your browser’s own speech recognition (no server service was called)',
          kind: 'local',
        });
      };
      instance.onerror = (event) => {
        setError(
          `Your browser’s speech recognition reported "${event.error ?? 'an error'}". Nothing was transcribed.`,
        );
        setGuidance('You can type your request instead, or play the labelled scripted demonstration.');
        setMicState('idle');
      };
      instance.onend = () => {
        stopTimer();
        setMicState('idle');
      };
      setMicState('recording');
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      instance.start();
      return;
    }

    if (providers && !providers.stt.live && !browserRecognitionAvailable) {
      setMicState('unavailable');
      setError(
        'No speech-to-text provider is configured on this server, and this browser has no speech recognition of its own. Nothing was recorded.',
      );
      setGuidance(
        'Type your request below, or play the labelled scripted demonstration to see the full workflow.',
      );
      return;
    }

    try {
      setMicState('requesting');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        stopTimer();
        const blob = new Blob(chunks.current, { type: recorder.mimeType || 'audio/webm' });
        chunks.current = [];
        void transcribe(blob);
      };
      recorder.start();
      setMicState('recording');
      setRecordSeconds(0);
      timerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (caught) {
      setMicState('unavailable');
      setError(
        `The microphone could not be used: ${(caught as Error).message}. Nothing was recorded.`,
      );
      setGuidance('You can type your request instead.');
    }
  }, [browserRecognitionAvailable, language, providers, transcribe]);

  const stopRecording = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      return;
    }
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
      mediaRecorder.current = null;
    }
    stopTimer();
  }, []);

  // ── sending a turn ──────────────────────────────────────────────────────
  const sendTurn = useCallback(
    async (text: string, inputMode: 'voice' | 'text' | 'voice_demo', sttProvider?: string) => {
      if (!conversation || !text.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/conversation/${conversation.conversationId}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text.trim(), inputMode, sttProvider }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'That could not be recorded.');
        setConversation(body.conversation);
        setTranscript('');
        setTranscriptSource(null);
        setTyped('');
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [conversation],
  );

  const chooseLocation = useCallback(
    async (facilityId: string) => {
      if (!conversation) return;
      setBusy(true);
      try {
        const response = await fetch(`/api/conversation/${conversation.conversationId}/location`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ facilityId }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'That place could not be set.');
        setConversation(body.conversation);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [conversation],
  );

  const confirmSubmission = useCallback(async () => {
    if (!conversation?.readback) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversation/${conversation.conversationId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          confirmedSummary: conversation.readback.summary,
          acceptIncomplete: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'The request could not be submitted.');
      // Only now is anything shown as submitted.
      setSubmission(body.result);
      clearLocalDraft();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [conversation]);

  const runDemoLine = useCallback(async () => {
    const line = demoLines[demoIndex];
    if (!line) return;
    setDemoActive(true);
    setTranscript(line.text);
    setTranscriptSource({
      label: 'Scripted demonstration line (nothing was recorded; no speech service was called)',
      kind: 'fixture',
    });
    setDemoIndex((i) => Math.min(i + 1, demoLines.length));
  }, [demoIndex, demoLines]);

  const draft = conversation?.draft;
  const question = conversation?.question ?? null;
  const readback = conversation?.readback ?? null;
  const assistantText = conversation?.assistantText ?? '';

  // ── submitted ───────────────────────────────────────────────────────────
  if (submission) {
    return (
      <div className="space-y-5">
        <Alert tone="good" title="Submitted">
          <p className="text-lg font-semibold">{submission.assistantText}</p>
        </Alert>
        <Card>
          <SectionHeading description="Keep this link. It is the only way to open your request.">
            Your private tracking link
          </SectionHeading>
          <p className="break-all rounded-xl bg-sand-100 p-3 font-mono text-sm">
            {typeof window !== 'undefined' ? window.location.origin : ''}/track/
            {submission.trackingToken}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-[48px] items-center rounded-xl bg-teal-600 px-4 font-semibold text-white"
              href={`/track/${submission.trackingToken}`}
            >
              Open my request
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  `${window.location.origin}/track/${submission.trackingToken}`,
                );
              }}
            >
              Copy link
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-500">
            Your reference <strong>{submission.referenceCode}</strong> is for talking to a
            coordinator. On its own it does not open your request, so it is safe to read out.
          </p>
          {submission.missingFields.length > 0 ? (
            <p className="mt-3 text-sm text-ember-700">
              A coordinator will see that this information is still missing:{' '}
              {submission.missingFields.join(', ')}.
            </p>
          ) : null}
        </Card>
        <p className="text-sm text-ink-500">
          Status now: <strong>{submission.status}</strong>. Nobody has been assigned to your request
          yet, and no supplies are on the way. Your tracking link will show when that changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Language and who is submitting */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="language">Language</FieldLabel>
            <select
              className="rr-input mt-1"
              id="language"
              value={language}
              onChange={(event) => {
                const next = event.target.value;
                setLanguage(next);
                clearLocalDraft();
                void startConversation(next, behalfRole);
              }}
            >
              {languages.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                  {option.uiReady ? '' : ' — speech path only'}
                </option>
              ))}
            </select>
            {selectedLanguage ? (
              <p className="rr-hint">{selectedLanguage.note}</p>
            ) : null}
          </div>
          <div>
            <FieldLabel htmlFor="behalf">Who is asking?</FieldLabel>
            <select
              className="rr-input mt-1"
              id="behalf"
              value={behalfRole}
              onChange={(event) => {
                setBehalfRole(event.target.value);
                clearLocalDraft();
                void startConversation(language, event.target.value);
              }}
            >
              <option value="self">I need help myself</option>
              <option value="community_rep">I am a community representative</option>
              <option value="coordinator">I am a coordinator submitting for someone</option>
              <option value="facility_rep">I represent a shelter or facility</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Emergency interruption takes precedence over everything else */}
      {conversation?.emergency ? (
        <Alert tone="emergency" title={conversation.emergency.headline}>
          <p>{conversation.emergency.body}</p>
          <p className="mt-2 text-lg font-semibold">
            Call {conversation.emergency.emergencyNumber} — {conversation.emergency.emergencyLabel}
          </p>
          <p className="mt-2 text-sm">
            ReliefRelay has <strong>not</strong> contacted anyone on your behalf.
          </p>
        </Alert>
      ) : null}

      {/* What the assistant just said, as text, with optional playback */}
      <Card className="border-teal-600/30 bg-teal-50/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Full width on a phone so the reply is never squeezed into a
              narrow column beside the playback controls. */}
          <div className="w-full sm:w-auto sm:flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
              Assistant
            </p>
            <p aria-live="polite" className="mt-1 text-lg text-ink-900">
              {assistantText || 'Tell me what you need and where you are. Take your time.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void speak(assistantText)}
              disabled={muted || !assistantText}
            >
              {speaking ? 'Playing…' : 'Play'}
            </Button>
            {speaking ? (
              <Button variant="ghost" onClick={stopSpeaking}>
                Stop
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => { setMuted((m) => !m); stopSpeaking(); }}>
              {muted ? 'Unmute' : 'Mute'}
            </Button>
          </div>
        </div>
        {speechNote ? <p className="mt-2 text-xs text-ink-500">{speechNote}</p> : null}
        <p className="mt-2 text-xs text-ink-500">
          Nothing is spoken automatically. Everything the assistant says is shown here as text.
        </p>
      </Card>

      {/* One question at a time */}
      {question ? (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Question {conversation?.questionCount ?? 1} of at most 3
          </p>
          <p className="mt-1 text-lg font-semibold text-ink-900">{question.text}</p>

          {question.answerKind === 'choice' && question.choices ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {question.choices.map((choice) => (
                <Button
                  key={choice.value}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (question.field === 'location_choice') void chooseLocation(choice.value);
                    else void sendTurn(choice.label, 'text');
                  }}
                >
                  {choice.label}
                  {choice.detail ? <span className="text-xs text-ink-500">({choice.detail})</span> : null}
                </Button>
              ))}
            </div>
          ) : null}

          {question.answerKind === 'yes_no' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void sendTurn('Yes', 'text')}>
                Yes
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void sendTurn('No', 'text')}>
                No
              </Button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {question.allowSkip ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void sendTurn("I don't know", 'text')}
              >
                I don&rsquo;t know
              </Button>
            ) : null}
            {question.field === 'location_choice' || question.field === 'location' ? (
              <Link className="self-center text-sm font-semibold text-teal-700 underline" href="/find">
                Choose a place from the map
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Microphone */}
      {!readback ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-2">
            <button
              aria-label={micState === 'recording' ? 'Stop recording' : 'Start recording'}
              aria-pressed={micState === 'recording'}
              className={`flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-full text-white
                          transition-colors disabled:opacity-60
                          ${micState === 'recording' ? 'rr-pulse-record bg-ember-500' : 'bg-teal-600 hover:bg-teal-700'}`}
              disabled={busy || micState === 'transcribing' || micState === 'requesting'}
              onClick={() => (micState === 'recording' ? stopRecording() : void startRecording())}
              type="button"
            >
              <span aria-hidden className="text-4xl">
                {micState === 'recording' ? '■' : '🎤'}
              </span>
              <span className="text-sm font-semibold">
                {micState === 'recording' ? 'Stop' : 'Speak'}
              </span>
            </button>

            <p aria-live="polite" className="min-h-[1.5rem] text-sm font-semibold text-ink-700">
              {micState === 'requesting' ? 'Asking for microphone permission…' : null}
              {micState === 'recording' ? (
                <span className="text-ember-700">
                  ● Recording — {recordSeconds}s. Press stop when you have finished.
                </span>
              ) : null}
              {micState === 'transcribing' ? <Spinner label="Transcribing your recording…" /> : null}
              {micState === 'idle' ? 'Press the microphone and say what you need.' : null}
              {micState === 'unavailable' ? (
                <span className="text-ember-700">Voice input is not available right now.</span>
              ) : null}
            </p>

            {providers ? (
              <p className="max-w-xl text-center text-xs text-ink-500">
                <Badge tone={providers.stt.live ? 'good' : 'neutral'}>
                  {providers.stt.live ? 'Live transcription' : 'No speech service configured'}
                </Badge>{' '}
                {providers.stt.live
                  ? providers.stt.note
                  : browserRecognitionAvailable
                    ? 'Your browser has its own speech recognition, which will be used instead. The transcript will say so.'
                    : providers.stt.note}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Editable transcript */}
      {transcript ? (
        <Card className="border-ember-500/30">
          <SectionHeading description="Check this before sending it. You can change any word.">
            What was transcribed
          </SectionHeading>
          {transcriptSource ? (
            <p className="mb-2">
              <Badge tone={transcriptSource.kind === 'fixture' ? 'simulated' : 'neutral'}>
                {transcriptSource.label}
              </Badge>
            </p>
          ) : null}
          <label className="sr-only" htmlFor="transcript">
            Transcript
          </label>
          <textarea
            className="rr-input"
            id="transcript"
            rows={4}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy || !transcript.trim()}
              onClick={() =>
                void sendTurn(
                  transcript,
                  transcriptSource?.kind === 'fixture' ? 'voice_demo' : 'voice',
                  transcriptSource?.label,
                )
              }
            >
              {busy ? 'Sending…' : 'Send this'}
            </Button>
            <Button variant="ghost" onClick={() => { setTranscript(''); setTranscriptSource(null); }}>
              Discard
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Typing alternative, always available */}
      {!readback ? (
        <Card>
          <FieldLabel
            htmlFor="typed"
            hint="Typing works exactly the same way as speaking, and is the better option on a weak connection."
          >
            Or type instead
          </FieldLabel>
          <textarea
            className="rr-input mt-1"
            id="typed"
            rows={3}
            placeholder="For example: we need drinking water for 12 people at Old Bridge Community Hall"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className="mt-3">
            <Button disabled={busy || !typed.trim()} onClick={() => void sendTurn(typed, 'text')}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Read-back and confirmation */}
      {readback ? (
        <Card className="border-teal-600/40">
          <SectionHeading description="Nothing is sent until you confirm this.">
            Please check this is right
          </SectionHeading>
          <p className="text-lg text-ink-900">{readback.summary}</p>
          <dl className="mt-4">
            {readback.lines.map((line) => (
              <div
                className="flex flex-wrap items-baseline gap-x-3 border-b border-sand-200 py-2 last:border-b-0"
                key={line.label}
              >
                <dt className="min-w-[8rem] text-sm font-semibold text-ink-700">{line.label}</dt>
                <dd
                  className={`flex-1 whitespace-pre-line ${line.caution ? 'text-ember-700' : 'text-ink-900'}`}
                >
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
          {readback.caveats.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-ember-700">
              {readback.caveats.map((caveat) => (
                <li key={caveat}>• {caveat}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="lg" disabled={busy} onClick={() => void confirmSubmission()}>
              {busy ? 'Submitting…' : 'Yes, submit this request'}
            </Button>
            <Button variant="secondary" onClick={() => void speak(readback.summary)} disabled={muted}>
              Read it back to me
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void sendTurn('Actually, I need to change something.', 'text')}
            >
              Something is wrong
            </Button>
          </div>
        </Card>
      ) : null}

      {/* What has been recorded so far */}
      {draft ? (
        <Card>
          <SectionHeading description="Held on the server, so this survives a reload or a lost connection.">
            Recorded so far
          </SectionHeading>
          <dl>
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-sand-200 py-2">
              <dt className="min-w-[8rem] text-sm font-semibold text-ink-700">Resources</dt>
              <dd className="flex-1">
                {draft.items.length === 0 ? (
                  <span className="text-ink-500">nothing yet</span>
                ) : (
                  <ul className="space-y-1">
                    {draft.items.map((item) => (
                      <li key={item.categoryId}>
                        {CATEGORY_LABELS[item.categoryId] ?? item.categoryId}:{' '}
                        {item.quantity === null ? (
                          <span className="text-ember-700">
                            amount not yet known ({item.unit})
                          </span>
                        ) : (
                          <>
                            {item.quantity} {item.unit}
                            {item.quantityUncertain ? (
                              <span className="text-ember-700"> (unconfirmed)</span>
                            ) : null}
                          </>
                        )}
                        {item.note ? (
                          <span className="block text-xs text-ink-500">{item.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-sand-200 py-2">
              <dt className="min-w-[8rem] text-sm font-semibold text-ink-700">People</dt>
              <dd className="flex-1">
                {draft.groupSize === null ? (
                  <span className="text-ink-500">not given</span>
                ) : (
                  `${draft.groupSize} ${draft.groupSize === 1 ? 'person' : 'people'}`
                )}
                <span className="block text-xs text-ink-500">
                  A group size is never used as a supply quantity.
                </span>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 py-2">
              <dt className="min-w-[8rem] text-sm font-semibold text-ink-700">Place</dt>
              <dd className="flex-1">
                {draft.locationText ?? <span className="text-ink-500">not given</span>}
                {draft.locationText && !draft.locationConfirmed ? (
                  <span className="block text-xs text-ember-700">Not yet confirmed.</span>
                ) : null}
              </dd>
            </div>
          </dl>
          {conversation?.providers.extraction ? (
            <p className="mt-3">
              <Provenance
                age="this turn"
                sourceLabel={conversation.providers.extraction.label}
              />
            </p>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Alert tone="attention" title="That did not work">
          <p>{error}</p>
          {guidance ? <p className="mt-2">{guidance}</p> : null}
        </Alert>
      ) : null}

      {/* The labelled demonstration */}
      {demoLines.length > 0 && !readback ? (
        <Card className="border-dashed border-violet-300 bg-violet-50/40">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="simulated">Scripted demonstration</Badge>
            {demoActive ? <Badge tone="simulated">In progress</Badge> : null}
          </div>
          <p className="mt-2 text-sm text-ink-700">
            These are scripted lines, not a recording of a person. Playing them records nothing and
            calls no speech service — they are here so the whole conversation can be shown without
            speech credentials. Each line lands in the editable transcript box above, exactly as a
            real transcription would.
          </p>
          {demoLines[demoIndex] ? (
            <p className="mt-2 text-sm text-ink-500">
              Next line ({demoIndex + 1} of {demoLines.length}): {demoLines[demoIndex].hint}
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-500">All scripted lines have been played.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || demoIndex >= demoLines.length}
              onClick={() => void runDemoLine()}
            >
              Play the next scripted line
            </Button>
            {demoIndex > 0 ? (
              <Button variant="ghost" onClick={() => setDemoIndex(0)}>
                Restart the script
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
