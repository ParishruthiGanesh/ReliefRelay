import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { ConnectivityBar } from '@/components/ConnectivityBar';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: 'ReliefRelay — flood relief coordination',
  description:
    'Tell us what you need. Help teams coordinate the response. A flood-relief coordination prototype with a conversational voice assistant.',
  applicationName: 'ReliefRelay',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f6b66',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sand-50 antialiased">
        <a className="rr-skip-link" href="#main">
          Skip to main content
        </a>
        <ServiceWorkerRegistration />
        <ConnectivityBar />
        <header className="border-b border-sand-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link className="flex items-center gap-2 font-semibold text-teal-700" href="/">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white"
              >
                RR
              </span>
              <span>
                ReliefRelay
                <span className="ml-2 rounded bg-sand-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  Prototype
                </span>
              </span>
            </Link>
            <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link className="hover:underline" href="/find">
                Shelters &amp; supplies
              </Link>
              <Link className="hover:underline" href="/advisories">
                Flood advisories
              </Link>
              <Link className="hover:underline" href="/offer">
                Offer help
              </Link>
              <Link className="hover:underline" href="/about">
                What is real here
              </Link>
              <Link className="font-semibold text-teal-700 hover:underline" href="/login">
                Team sign in
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6" id="main">
          {children}
        </main>
        <footer className="mt-10 border-t border-sand-200 bg-white px-4 py-6">
          <div className="mx-auto max-w-5xl space-y-2 text-sm text-ink-500">
            <p className="font-semibold text-ink-700">
              ReliefRelay is a hackathon prototype and is not an emergency service.
            </p>
            <p>
              If anyone is in immediate danger, contact your local emergency services by phone.
              ReliefRelay cannot send rescuers and never notifies responders on your behalf.
            </p>
            <p>
              All districts, facilities, organisations, people and advisories shown here are
              fictional. <Link className="underline" href="/about">See exactly what is live, local and simulated.</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
