const dev = process.env.NODE_ENV !== 'production';

/** @type {import('next').NextConfig} */
const nextConfig = dev
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
    };

export default nextConfig;
