/**
 * Plain JavaScript on purpose. Next loads this file at build time *and* at
 * `next start`; a `.ts` config makes the `typescript` package a runtime
 * dependency, which breaks on any host that installs without devDependencies.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // better-sqlite3 is a native addon; it must not be bundled by webpack/turbopack.
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
