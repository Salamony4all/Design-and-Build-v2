import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The repo root also hosts the FROZEN preservation app whose @pascal-app/core
// is 0.6.0. npm hoists @pascal-app/nodes to the root, so without aliases its
// peer imports resolve to core 0.6.0 (missing useLiveNodeOverrides etc.).
// Pin every @pascal-app/* specifier to THIS app's nested 0.9.2 stack.
const pin = (pkg) => path.join(__dirname, 'node_modules', '@pascal-app', pkg);

const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // mupdf 1.28.0 is an ESM package ("type":"module") whose entry performs
  // top-level await to boot a WASM module. It must stay a genuine runtime
  // server dependency: bundling it makes webpack inline the WASM bootstrap
  // and emit a CJS interop shim, which fails both at build-time page-data
  // collection and at request time ("a is not a function", i.e. the underlying
  // ERR_REQUIRE_ASYNC_MODULE).
  //
  // Only 'mupdf' itself is externalized. The workspace package
  // design-build-extraction-mupdf must STAY transpiled: it ships raw
  // TypeScript with extensionless relative imports, which Node cannot load
  // natively (ERR_MODULE_NOT_FOUND on ./mupdf-pure). Webpack keeps compiling
  // that package, but the `import * as mupdf from 'mupdf'` edge inside it now
  // resolves to a runtime external instead of being inlined.
  serverExternalPackages: ['mupdf'],
  transpilePackages: [
    '@pascal-app/core',
    '@pascal-app/viewer',
    '@pascal-app/editor',
    '@pascal-app/nodes',
    'design-build-simplified-viewer-shell',
    'design-build-conversation-core',
    'design-build-extraction-contracts',
    'design-build-render-orchestrator',
    'design-build-provider-registry',
    'design-build-coordinate-frame',
    'design-build-pascal-adapter',
    'design-build-extraction-mupdf',
    'design-build-extraction-ai',
    'design-build-attachment-service',
    'design-build-shared-ui',
  ],
  webpack: (config, { dev, isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        https: false,
        http: false,
        path: false,
        stream: false,
        zlib: false,
      };
    }
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/.data/**',
          '**/scratch/**',
          '**/.git/**',
          '**/test drawings and png/**',
          '**/*.log',
        ],
      };
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      // Exact-file aliases: directory aliases bypass the package exports map
      // (editor 0.9.2 is source-only with no `main`, so a directory alias
      // fails to resolve).
      '@pascal-app/core$': path.join(pin('core'), 'dist', 'index.js'),
      '@pascal-app/viewer$': path.join(pin('viewer'), 'dist', 'index.js'),
      '@pascal-app/editor$': path.join(pin('editor'), 'src', 'index.tsx'),
      '@pascal-app/editor/catalog$': path.join(pin('editor'), 'src', 'components', 'ui', 'item-catalog', 'catalog-items.tsx'),
      // three 0.185 (Pascal 0.9.2 requirement) is nested under this app;
      // root hoists 0.184 for the frozen preservation app. Exact-match ($)
      // plus explicit subpaths so the exports map keeps working.
      three$: path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js'),
      'three/webgpu$': path.join(__dirname, 'node_modules', 'three', 'build', 'three.webgpu.js'),
      'three/tsl$': path.join(__dirname, 'node_modules', 'three', 'build', 'three.tsl.js'),
      'three/addons': path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm'),
    };
    return config;
  },
};
export default nextConfig;
