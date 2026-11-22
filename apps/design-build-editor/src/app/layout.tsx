import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Design Build Editor' };

// Phones: scale 1, draw under the notch / home bar (the layout keeps clear of
// them with env(safe-area-inset-*)), and tint the browser bar to match.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f6fb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
