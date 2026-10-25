'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * The account corner of the header.
 *
 * A client component on purpose: reading the session cookie in the root layout
 * would force every page in the app to render dynamically, including the
 * public pages that have no reason to. The cost is that the signed-in state
 * appears a moment after load, which is acceptable for a control nobody
 * navigates by.
 *
 * It also stops the header inviting someone to "sign in" when they already
 * are, and gives them a way out — neither of which existed before.
 */

interface Account {
  id: string;
  displayName: string;
  role: 'coordinator' | 'facility_rep' | 'volunteer' | 'donor';
}

const HOME_FOR_ROLE: Record<Account['role'], { href: string; label: string }> = {
  coordinator: { href: '/coordinator', label: 'Dashboard' },
  facility_rep: { href: '/facility', label: 'My facility' },
  volunteer: { href: '/volunteer', label: 'My deliveries' },
  donor: { href: '/offer', label: 'Offer supplies' },
};

export function HeaderAccount() {
  const router = useRouter();
  // The App Router keeps the root layout mounted across client-side
  // navigation, so a fetch on mount alone would be answered once — on
  // whichever page happened to load first — and never again. Signing in would
  // leave the header still offering "Team sign in" until a hard reload.
  // Re-checking on each path change costs one small request per navigation.
  const pathname = usePathname();
  const [account, setAccount] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me')
      .then((r) => r.json())
      .then((body) => {
        if (active) setAccount(body.user ?? null);
      })
      .catch(() => {
        // Signed out is the safe assumption.
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  // Render nothing until the first answer arrives, rather than flashing the
  // wrong control. Later re-checks keep showing what is already known.
  if (!loaded) return <span className="h-5 w-24" />;

  if (!account) {
    return (
      <Link className="font-semibold text-teal-700 hover:underline" href="/login">
        Team sign in
      </Link>
    );
  }

  const home = HOME_FOR_ROLE[account.role];

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link className="font-semibold text-teal-700 hover:underline" href={home.href}>
        {home.label}
      </Link>
      <span className="text-ink-500">
        {account.displayName.replace(/\s*\(fictional[^)]*\)/, '')}
      </span>
      <button
        className="font-semibold text-ink-700 underline hover:text-teal-700"
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          setAccount(null);
          router.push('/');
          router.refresh();
        }}
        type="button"
      >
        Sign out
      </button>
    </span>
  );
}
