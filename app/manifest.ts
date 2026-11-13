import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest and linked automatically by Next.js
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'MeowCare â€” Donasi Untuk Kucing Jalanan',
    short_name: 'MeowCare',
    description: 'Patungan receh buat kasih makan kucing jalanan dengan transparan.',
    lang: 'id',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fff6ea',
    theme_color: '#fffdf8',
    categories: ['lifestyle', 'social'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
