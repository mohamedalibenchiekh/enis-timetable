import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = process.env.NODE_ENV !== 'production';
const dir = path.dirname(fileURLToPath(import.meta.url));
// Pin the workspace root so stray lockfiles in parent folders (e.g. C:\Users\you\package-lock.json) are ignored.
const root = path.join(dir, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  webpack: (config) => {
    config.resolve.alias['@'] = dir;
    return config;
  },
};

export default nextConfig;
