import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = process.env.NODE_ENV !== 'production';
const dir = path.dirname(fileURLToPath(import.meta.url));
// Pin the workspace root so stray lockfiles in parent folders (e.g. C:\Users\you\package-lock.json) are ignored.
const root = path.join(dir, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  // Keep Next's build typecheck enabled but use the TypeScript API: the CLI worker cannot open
  // its detached stdout pipes in this sandbox and returns empty --showConfig output.
  experimental: { useTypeScriptCli: false },
  outputFileTracingRoot: root,
  ...(dev
    ? {
        // `npm run dev`: the browser talks to Next, which forwards /api to the NestJS server.
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/:path*` }];
        },
      }
    : {
        // production / desktop: static site (apps/web/out) served by the NestJS server itself.
        output: 'export',
        images: { unoptimized: true },
      }),
  turbopack: {
    resolveAlias: {
      '@': dir,
    },
  },
  webpack: (config) => {
    config.resolve.alias['@'] = dir;
    return config;
  },
};

export default nextConfig;
