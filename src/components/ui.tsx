import Link from 'next/link';
import type { ReactNode } from 'react';

/** Small, accessible primitives shared across every screen. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'attention' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-teal-600 text-white hover:bg-teal-700 disabled:bg-teal-600/40',
  secondary: 'bg-white text-teal-700 border border-teal-600/40 hover:bg-teal-50',
  ghost: 'bg-transparent text-ink-700 hover:bg-sand-100',
  attention: 'bg-ember-500 text-white hover:bg-ember-600',
  danger: 'bg-white text-ember-700 border border-ember-500/50 hover:bg-ember-50',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizing = size === 'lg' ? 'px-6 py-4 text-lg' : 'px-4 py-3 text-base';
  return (
    <button
      {...props}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl font-semibold
                  transition-colors disabled:cursor-not-allowed ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const sizing = size === 'lg' ? 'px-6 py-4 text-lg' : 'px-4 py-3 text-base';
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl font-semibold
                  transition-colors ${sizing} ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={`rr-card p-5 ${className}`}>{children}</Tag>;
}

type BadgeTone = 'neutral' | 'teal' | 'attention' | 'warn' | 'good' | 'simulated';

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-sand-100 text-ink-700 border-sand-300',
  teal: 'bg-teal-50 text-teal-700 border-teal-300/60',
  attention: 'bg-ember-50 text-ember-700 border-ember-500/40',
  warn: 'bg-amber-50 text-amber-800 border-amber-300',
  good: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  simulated: 'bg-violet-50 text-violet-800 border-violet-300 border-dashed',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold
                  ${BADGE_STYLES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'attention' | 'emergency' | 'good';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: 'border-teal-300/60 bg-teal-50 text-teal-900',
    attention: 'border-ember-500/40 bg-ember-50 text-ember-700',
    emergency: 'border-ember-600 bg-ember-50 text-ember-700',
    good: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  }[tone];
  return (
    <div
      className={`rounded-xl border-l-4 border p-4 ${styles}`}
      role={tone === 'emergency' ? 'alert' : 'status'}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-[0.95rem] leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * Provenance and freshness, shown together.
 * A number without a source and an age is not information a coordinator can
 * act on, so these always travel as a pair.
 */
export function Provenance({
  sourceLabel,
  age,
  freshness,
}: {
  sourceLabel: string;
  age: string;
  freshness?: 'fresh' | 'ageing' | 'stale' | 'expired';
}) {
  const tone: BadgeTone =
    freshness === 'fresh' ? 'good' : freshness === 'stale' || freshness === 'expired' ? 'attention' : 'neutral';
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-500">
      <Badge tone="neutral">{sourceLabel}</Badge>
      <Badge tone={tone}>
        {freshness === 'expired' ? 'Expired' : freshness === 'stale' ? 'Stale' : 'Updated'} {age}
      </Badge>
    </span>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <>
      <label className="rr-label" htmlFor={htmlFor}>
        {children}
      </label>
      {hint ? (
        <p className="rr-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

export function SectionHeading({
  children,
  description,
  id,
}: {
  children: ReactNode;
  description?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-semibold text-ink-900" id={id}>
        {children}
      </h2>
      {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
    </div>
  );
}

export function FictionalNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-ink-500 ${className}`}>
      <Badge tone="simulated">Fictional demonstration data</Badge>{' '}
      Every district, facility, organisation, person and advisory in this prototype is invented. This
      is not a live emergency service.
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-500" role="status">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent"
      />
      {label}
    </span>
  );
}

export function DefinitionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-sand-200 py-2 last:border-b-0">
      <dt className="min-w-[8rem] text-sm font-semibold text-ink-700">{label}</dt>
      <dd className="flex-1 text-[0.95rem] text-ink-900">{children}</dd>
    </div>
  );
}
