import type { MetadataRoute } from 'next';

// Web app manifest (served at /manifest.webmanifest, linked from every page by
// Next.js). Chrome needs a name, 192 px and 512 px icons, a start URL and a
// standalone display before it offers "Install app".
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Design & Build',
    short_name: 'Design&Build',
    description: 'Turn a floor plan into a 3D model, walk inside it and render it photoreal.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#eef3ff',
    theme_color: '#f4f6fb',
    categories: ['productivity', 'design'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
