'use client';

import { useEffect } from 'react';

/* Registers /sw.js in production only, so `next dev` never serves stale files */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  }, []);
  return null;
}