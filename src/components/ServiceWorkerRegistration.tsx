'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that caches the interface shell.
 *
 * It caches the shell so the app opens on a poor connection; it does not make
 * the app work offline in any larger sense, and nothing about the registration
 * implies that a queued request has been sent.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registering in development would cache a constantly-changing bundle.
    if (process.env.NODE_ENV !== 'production') return;
    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Caching is an optimisation; failing to register changes nothing else.
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
