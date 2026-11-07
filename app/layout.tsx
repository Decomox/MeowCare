import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'MeowCare — Donasi Untuk Kucing Jalanan',
  description: 'Patungan receh buat kasih makan kucing jalanan dengan transparan.',
  applicationName: 'MeowCare',
  // <link rel="manifest"> is injected automatically from app/manifest.ts
  appleWebApp: {
    capable: true,            // <meta name="apple-mobile-web-app-capable">
    title: 'MeowCare',        // name under the iOS home-screen icon
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

// theme-color lives in `viewport` (not `metadata`) since Next.js 14
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // makes the env(safe-area-inset-*) rules already in page.tsx take effect
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fffdf8' },
    { media: '(prefers-color-scheme: dark)', color: '#2a1d17' },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}