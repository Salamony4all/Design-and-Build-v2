import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Design Build Editor',
  applicationName: 'Design & Build',
  description: 'Turn a floor plan into a 3D model, walk inside it and render it photoreal.',
  // Home-screen app on iPhone and iPad (Android and desktop read app/manifest.ts).
  appleWebApp: { capable: true, title: 'Design & Build', statusBarStyle: 'default' },
};

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
